import test from "node:test";
import assert from "node:assert/strict";
import { tutorialCoverage } from "../benchmarks/coverage.mjs";

test("MCP tutorial coverage matches the active tutorial baseline", () => {
  const coverage = tutorialCoverage();
  assert.equal(coverage.total, 16);
  assert.equal(coverage.implemented, 16);
  assert.deepEqual(coverage.missing.map(({ id }) => id), []);
  assert.deepEqual(coverage.obsolete, ["b-top", "a-cup", "a-params"]);
});
