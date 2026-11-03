import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";
import opencascade from "../../third_party/replicad-opencascadejs/dist/replicad_single.js";
import { inspectTriangleMesh } from "../shared/geometry.js";

test("a closed imported curved mesh remains a usable solid after face unification", { timeout: 60000 }, async t => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const dir = await mkdtemp(join(tmpdir(), "jumpstart-mesh-solid-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = join(dir, "kernel.cjs");
  await build({
    stdin: { contents: 'export { initKernel, buildBodies, setAsset } from "./src/kernel.js"; export { repairMesh, packMesh } from "./src/meshimport.js";', resolveDir: root },
    bundle: true, platform: "node", format: "cjs", outfile: output,
    alias: {
      replicad: join(root, "third_party/replicad/src/index.ts"),
      "opentype.js": join(root, "third_party/opentype.js/dist/opentype.module.js"),
      flatbush: join(root, "third_party/flatbush/index.js"), flatqueue: join(root, "third_party/flatqueue/index.js"),
    },
  });
  const kernel = createRequire(import.meta.url)(output);
  await kernel.initKernel(opencascade, gunzipSync(await readFile(join(root, "src/occt-gz.wasm"))));
  // Generate our own reference mesh rather than bundling a user's licensed part.
  const source = kernel.buildBodies([{ id: "source", rev: "source", node: { t: "prim", kind: "sphere", p: { w: 40, d: 30, h: 20 } } }])[0];
  assert.equal(source.ok, true, source.error);
  const corners = new Float32Array(source.mesh.triangles.length * 3);
  source.mesh.triangles.forEach((vertex, i) => corners.set(source.mesh.vertices.subarray(vertex * 3, vertex * 3 + 3), i * 3));
  const repaired = kernel.repairMesh(corners);
  assert.equal(repaired.report.open, 0);
  assert.equal(repaired.report.nonManifold, 0);
  kernel.setAsset("curved", "mesh", kernel.packMesh(repaired.mesh));
  const node = { t: "mesh", asset: "curved", keepPos: true };
  const results = kernel.buildBodies([
    { id: "import", rev: "import", node },
    ...[1, -1].map(side => ({ id: `half-${side}`, rev: `half-${side}`, node: { ...node, mods: [{ t: "halfspace", plane: { o: [0, 0, 10], n: [1, 0, 0] }, side }] } })),
  ]);
  for (const result of results) {
    assert.equal(result.ok, true, result.error);
    assert.ok(result.mesh.volume > 0);
  }
  for (const result of results) {
    const mesh = inspectTriangleMesh(result.mesh);
    for (const field of ["degenerateTriangles", "boundaryEdges", "nonManifoldEdges", "inconsistentWindingEdges"]) assert.equal(mesh[field], 0, field);
    assert.equal(mesh.disconnectedComponents, 1);
  }
  const [whole, positive, negative] = results.map(result => result.mesh);
  assert.ok(Math.abs(positive.volume + negative.volume - whole.volume) < 0.01);
  assert.ok(Math.abs(positive.bbox.min[0]) < 0.001);
  assert.ok(Math.abs(negative.bbox.max[0]) < 0.001);
});
