import { randomBytes } from "node:crypto";

const MEDIA_TYPE = "model/3mf";
const MAX_BYTES = 24 * 1024 * 1024;
const EXPIRY_MS = 5 * 60 * 1000;

export function createSlicerHandoff() {
  const files = new Map();
  let pending = 0;

  return async function handle(req, res, path, allowUpload = false) {
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
      if (!file || file.expires <= Date.now()) return send(404, "Export unavailable or expired");
      res.setHeader("Content-Disposition", 'attachment; filename="model.3mf"');
      return send(200, file.bytes, MEDIA_TYPE);
    }

    if (req.method !== "POST") return send(405, "POST required");
    if (!allowUpload) return send(403, "Same-origin editor upload required");
    if (req.headers["content-type"] !== MEDIA_TYPE) return send(415, "3MF required");
    if (Number(req.headers["content-length"]) > MAX_BYTES) return send(413, "Model too large");
    if (files.size + pending >= 4) return send(429, "Too many active exports");
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
      if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50 ||
          !bytes.includes(Buffer.from("3D/3dmodel.model"))) return send(400, "Expected a 3MF model");
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
  };
}
