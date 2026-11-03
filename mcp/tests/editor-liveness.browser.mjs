import { test, expect } from "@playwright/test";
import { setTimeout as delay } from "node:timers/promises";

test("an expired poll re-registers immediately while a CAD command stays open", async ({ page }, info) => {
  let heartbeats = 0, polls = 0, releaseExpired;
  const expired = new Promise(resolve => { releaseExpired = resolve; });
  const results = [];
  await page.addInitScript(() => {
    const interval = window.setInterval;
    // Simulate throttled background heartbeat timers, not a dead editor.
    window.setInterval = (callback, ms, ...args) => interval(callback, ms === 5000 ? 60000 : ms, ...args);
  });
  await page.route("**/__mcp/heartbeat", async route => {
    heartbeats++;
    await route.fulfill({ json: { ok: true, agent: {} } });
  });
  await page.route("**/__mcp/poll", async route => {
    polls++;
    if (polls === 1) {
      await expired;
      return route.fulfill({ status: 410, json: { error: "Editor heartbeat expired" } });
    }
    if (polls === 2) return route.fulfill({ json: { command: { id: "probe", action: "preview_new_document", params: {} } } });
    await delay(250);
    await route.fulfill({ json: { command: null } });
  });
  await page.route("**/__mcp/result", async route => {
    results.push(route.request().postDataJSON());
    await route.fulfill({ json: { accepted: true } });
  });
  await page.goto(`${info.project.use.baseURL}?mcp=1`);
  await page.waitForFunction(() => window.__app?.kernel?.ready);
  await page.evaluate(() => { window.__app.command = { name: "manual edit" }; });
  releaseExpired();
  await expect.poll(() => heartbeats, { timeout: 2500 }).toBeGreaterThanOrEqual(2);
  await expect.poll(() => results.length).toBe(1);
  expect(results[0].ok).toBe(false);
  expect(results[0].error).toContain("Finish or cancel the open Sketch or CAD command");
  expect(await page.evaluate(() => window.__app.command.name)).toBe("manual edit");
  await page.evaluate(() => { window.__app.command = null; });
});
