import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { createSlicerHandoff } from "../server/slicer-handoff.mjs";

test("slicer handoff accepts editor uploads and returns an opaque 3MF download", async () => {
  const handoff = createSlicerHandoff();
  let origin;
  const server = createServer((req, res) => {
    void handoff(req, res, req.url, req.headers.origin === origin);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
  const uploadUrl = origin + "/slicer-handoff";
  const bytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("3D/3dmodel.model")]);
  const upload = (body, headers) => fetch(uploadUrl, { method: "POST", body, headers });
  const allowed = { Origin: origin, "Content-Type": "model/3mf" };
  try {
    assert.equal((await upload(bytes, { "Content-Type": "model/3mf" })).status, 403);
    assert.equal((await upload(bytes, { ...allowed, "Content-Type": "text/html" })).status, 415);
    assert.equal((await upload("not a model", allowed)).status, 400);
    const uploaded = await upload(bytes, allowed);
    assert.equal(uploaded.status, 201);
    const { id } = await uploaded.json();
    assert.match(id, /^[a-f0-9]{48}$/);
    const url = `${uploadUrl}/${id}/model.3mf`;
    assert.equal((await fetch(url, { method: "HEAD" })).headers.get("Content-Length"), String(bytes.length));
    const downloaded = await fetch(url);
    assert.equal(downloaded.headers.get("Content-Type"), "model/3mf");
    assert.equal(downloaded.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
    assert.equal((await fetch(`${uploadUrl}/${"0".repeat(48)}/model.3mf`)).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
