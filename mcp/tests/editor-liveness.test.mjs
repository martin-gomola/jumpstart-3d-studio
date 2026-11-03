import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

async function broker(t) {
  const child = spawn(process.execPath, ["--import", "./mcp/tests/fixtures/server-clock.mjs", "mcp/server/server.mjs"], {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, JUMPSTART_MCP_PORT: "0", JUMPSTART_MCP_HTTP_ONLY: "1" },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  t.after(async () => {
    const exited = once(child, "exit");
    child.disconnect();
    child.kill("SIGTERM");
    await exited;
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  for (let attempt = 0; attempt < 200 && !/MCP app: http:\/\/localhost:(\d+)/.test(stderr); attempt++) await delay(10);
  const port = /MCP app: http:\/\/localhost:(\d+)/.exec(stderr)?.[1];
  assert.ok(port, stderr);
  const post = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${port}/__mcp/${path}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  let id = 0;
  const call = async (name, args = {}) => {
    const response = await post("rpc", { jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } });
    assert.ok(response.result, JSON.stringify(response));
    return JSON.parse(response.result.content[0].text);
  };
  const advance = async ms => {
    const expected = ++id;
    const done = new Promise(resolve => {
      const listener = message => { if (message.id === expected) { child.off("message", listener); resolve(); } };
      child.on("message", listener);
    });
    child.send({ id: expected, advance: ms });
    await done;
  };
  const editors = async () => (await call("jumpstart_list_editors")).editors;
  await post("heartbeat", { editorId: "editor", documentId: "doc", documentName: "Test" });
  return { post, call, advance, editors };
}

test("an idle long poll renews the editor lease when it completes", { timeout: 10000 }, async t => {
  const b = await broker(t);
  const poll = b.post("poll", { editorId: "editor" });
  for (let i = 0; i < 100 && (await b.editors())[0]?.connectionState !== "listening"; i++) await delay(10);
  assert.equal((await b.editors())[0]?.connectionState, "listening");
  await b.advance(25000);
  assert.equal((await poll).command, null);
  assert.equal((await b.editors())[0]?.editorId, "editor");
  await b.advance(16000);
  assert.deepEqual(await b.editors(), []);
});

test("a delivered command survives missed heartbeats and its result renews the lease", { timeout: 10000 }, async t => {
  const b = await broker(t);
  const poll = b.post("poll", { editorId: "editor" });
  const result = b.call("jumpstart_get_document", { editorId: "editor" });
  const { command } = await poll;
  await b.advance(20000);
  assert.equal((await b.editors())[0]?.connectionState, "busy");
  assert.equal((await b.post("result", { editorId: "editor", commandId: command.id, ok: true, data: { revision: "r1" } })).accepted, true);
  assert.equal((await result).revision, "r1");
  await b.advance(14000);
  assert.equal((await b.editors())[0]?.editorId, "editor");
  await b.advance(2000);
  assert.deepEqual(await b.editors(), []);
});

test("an unresponsive delivered command still reaches its deadline", { timeout: 10000 }, async t => {
  const b = await broker(t);
  const poll = b.post("poll", { editorId: "editor" });
  const result = b.call("jumpstart_get_document", { editorId: "editor" });
  await poll;
  await b.advance(30000);
  assert.match((await result).error, /timed out after 30000 ms/);
  assert.deepEqual(await b.editors(), []);
});
