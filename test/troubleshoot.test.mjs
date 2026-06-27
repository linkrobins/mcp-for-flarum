import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { registerTroubleshootTool } from "../dist/tools/troubleshoot.js";

// Drive the tool the way the real MCP server would: validate raw args through
// the tool's zod shape, then call the handler.
function register() {
  const tools = new Map();
  registerTroubleshootTool({ registerTool: (name, cfg, handler) => tools.set(name, { cfg, handler }) });
  return tools;
}
const call = (tool, raw = {}) => tool.handler(z.object(tool.cfg.inputSchema).parse(raw));
const textOf = (res) => res.content.map((c) => c.text).join("\n");

test("registers the flarum_troubleshoot tool", () => {
  const t = register();
  assert.deepEqual([...t.keys()], ["flarum_troubleshoot"]);
});

test("no topic returns the full guide as plain markdown", async () => {
  const t = register();
  const text = textOf(await call(t.get("flarum_troubleshoot")));
  assert.match(text, /^# Flarum troubleshooting/);
  for (const heading of ["First aid", "system info", "logs", "Common problems", "support request"]) {
    assert.ok(text.includes(heading), `full guide should include "${heading}"`);
  }
  // It is genuinely actionable for a non-coder.
  assert.ok(text.includes("php flarum info"), "tells them the info command");
  assert.ok(text.includes("storage/logs/flarum.log"), "tells them where logs are");
  assert.ok(text.includes("discuss.flarum.org"), "tells them where to post");
});

test("a topic narrows to just that section", async () => {
  const t = register();
  const text = textOf(await call(t.get("flarum_troubleshoot"), { topic: "report" }));
  assert.ok(text.includes("support request"), "includes the requested section");
  assert.ok(!text.includes("## First aid"), "excludes other sections");
});

test("the topic enum rejects unknown sections", () => {
  const t = register();
  assert.throws(() => z.object(t.get("flarum_troubleshoot").cfg.inputSchema).parse({ topic: "nope" }));
});

test("stays vendor-neutral (no Link Robins branding)", async () => {
  const t = register();
  const text = textOf(await call(t.get("flarum_troubleshoot"))).toLowerCase();
  for (const brand of ["link robins", "linkrobins", "risendad"]) {
    assert.ok(!text.includes(brand), `should not mention ${brand}`);
  }
});
