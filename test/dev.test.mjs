import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { registerDevTools } from "../dist/tools/dev.js";

// Collect the tool via a stub server and drive its handler the way the real MCP
// server would (validate raw args through the tool's zod shape first).
function register() {
  const tools = new Map();
  registerDevTools({ registerTool: (name, cfg, handler) => tools.set(name, { cfg, handler }) });
  return tools;
}
const call = (tool, raw = {}) => tool.handler(z.object(tool.cfg.inputSchema).parse(raw));
const textOf = (res) => res.content.map((c) => c.text).join("\n");

test("registers the flarum_dev tool", () => {
  const t = register();
  assert.deepEqual([...t.keys()], ["flarum_dev"]);
});

test("with no topic returns the full reference (all sections) as plain markdown", async () => {
  const t = register();
  const res = await call(t.get("flarum_dev"));
  const text = textOf(res);
  // Not JSON-wrapped: raw markdown the agent can read directly.
  assert.match(text, /^# Flarum 2\.0 extension development/);
  for (const heading of ["Scaffold", "composer.json", "Frontend", "Backend", "Internationalization", "Testing", "Releasing"]) {
    assert.ok(text.includes(heading), `full reference should include the "${heading}" section`);
  }
});

test("a topic narrows the output to just that section", async () => {
  const t = register();
  const res = await call(t.get("flarum_dev"), { topic: "testing" });
  const text = textOf(res);
  assert.ok(text.includes("Testing"), "should include the requested section");
  // Other sections are excluded when a topic is given.
  assert.ok(!text.includes("## Releasing"), "should not include other sections");
  assert.ok(!text.includes("## Backend"), "should not include other sections");
});

test("the topic enum rejects unknown sections", () => {
  const t = register();
  assert.throws(() => z.object(t.get("flarum_dev").cfg.inputSchema).parse({ topic: "nonsense" }));
});

test("'all' is accepted and yields the full reference", async () => {
  const t = register();
  const res = await call(t.get("flarum_dev"), { topic: "all" });
  assert.match(textOf(res), /## Releasing/);
});
