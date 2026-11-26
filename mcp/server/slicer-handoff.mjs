import { randomBytes } from "node:crypto";

const MEDIA_TYPE = "model/3mf";
const MAX_BYTES = 24 * 1024 * 1024;
const EXPIRY_MS = 5 * 60 * 1000;
const MAX_ACTIVE = 4;

export function buildSlicerHandoffLinks(origin, id) {
  const modelUrl = new URL(`/slicer-handoff/${id}/model.3mf`, origin).href;
  const encoded = encodeURIComponent(modelUrl);
  return {
    modelUrl,
    macosUrl: `bambustudioopen://${encoded}`,
    desktopUrl: `bambustudio://open?file=${encoded}`,
  };
}

function isValidThreeMf(bytes) {
  return bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50 &&
    bytes.includes(Buffer.from("3D/3dmodel.model"));
}

export function createSlicerHandoff() {
  const files = new Map();
  let pending = 0;

  function pruneExpired() {
    const now = Date.now();
    for (const [key, entry] of files) {
      if (entry.expires <= now) files.delete(key);
    }
  }

  function register(input) {
    pruneExpired();
    const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
    if (bytes.length > MAX_BYTES) throw new Error("3MF export exceeds the 24 MiB slicer handoff limit");
    if (!isValidThreeMf(bytes)) throw new Error("Expected a valid 3MF model for slicer handoff");
    if (files.size + pending >= MAX_ACTIVE) throw new Error("Too many active slicer handoff exports; retry after an earlier link expires");
    const id = randomBytes(24).toString("hex");
    const expires = Date.now() + EXPIRY_MS;
    files.set(id, { bytes, expires });
    setTimeout(() => files.delete(id), EXPIRY_MS).unref();
    return { id, expiresAt: new Date(expires).toISOString(), ttlSeconds: EXPIRY_MS / 1000 };
  }

  async function handle(req, res, path, allowUpload = false) {
    const send = (status, data, type = "text/plain; charset=utf-8") => {
      res.writeHead(status, {
        "Content-Type": type,
        "Content-Length": Buffer.byteLength(data),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    };

    if (path !== "/slicer-handoff") {
      if (req.method !== "GET" && req.method !== "HEAD") return send(405, "GET or HEAD required");
      const id = /^\/slicer-handoff\/([a-f0-9]{48})\/model\.3mf$/.exec(path)?.[1];
      const file = files.get(id);
      if (!file || file.expires <= Date.now()) {
        if (file) files.delete(id);
        return send(404, "Export unavailable or expired");
      }
      res.setHeader("Content-Disposition", 'attachment; filename="model.3mf"');
      return send(200, file.bytes, MEDIA_TYPE);
    }

    if (req.method !== "POST") return send(405, "POST required");
    if (!allowUpload) return send(403, "Same-origin editor upload required");
    if (req.headers["content-type"] !== MEDIA_TYPE) return send(415, "3MF required");
    if (Number(req.headers["content-length"]) > MAX_BYTES) return send(413, "Model too large");
    pruneExpired();
    if (files.size + pending >= MAX_ACTIVE) return send(429, "Too many active exports");
    pending++;
    const timeout = setTimeout(() => req.destroy(), 30000);
    try {
      let length = 0;
      const chunks = [];
      for await (const chunk of req) {
        length += chunk.length;
        if (length > MAX_BYTES) return send(413, "Model too large");
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (!isValidThreeMf(bytes)) return send(400, "Expected a 3MF model");
      const id = randomBytes(24).toString("hex");
      files.set(id, { bytes, expires: Date.now() + EXPIRY_MS });
      setTimeout(() => files.delete(id), EXPIRY_MS).unref();
      return send(201, JSON.stringify({ id }), "application/json");
    } catch {
      if (!res.destroyed) send(400, "Upload interrupted");
    } finally {
      clearTimeout(timeout);
      pending--;
    }
  }

  handle.register = register;
  return handle;
}
