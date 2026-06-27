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

test("the scaling and integrations topics are selectable and on-topic", async () => {
  const t = register();
  const scaling = textOf(await call(t.get("flarum_dev"), { topic: "scaling" }));
  assert.match(scaling, /Scaling: queues/);
  for (const k of ["sync", "AbstractJob", "Horizon", "Extend\\Filesystem"]) {
    assert.ok(scaling.includes(k), `scaling should cover ${k}`);
  }
  const integrations = textOf(await call(t.get("flarum_dev"), { topic: "integrations" }));
  assert.match(integrations, /Optional ecosystem integrations/);
  for (const k of ["flarum-realtime", "flarum-audit", "fof-forum-widgets-core", "fof-sitemap", "flarum-tags"]) {
    assert.ok(integrations.includes(k), `integrations should cover ${k}`);
  }
});

test("the Tier 1 core/deployment contracts are present", async () => {
  const t = register();
  const backend = textOf(await call(t.get("flarum_dev"), { topic: "backend" }));
  for (const k of ["Extend\\ApiResource", "NotificationSyncer", "RequestUtil::getActor"]) {
    assert.ok(backend.includes(k), `backend should cover ${k}`);
  }
  const scaling = textOf(await call(t.get("flarum_dev"), { topic: "scaling" }));
  assert.ok(scaling.includes("UrlGenerator") && scaling.includes("config.php"), "scaling should cover URL portability");
});

test("the Tier 2 contracts are present", async () => {
  const t = register();
  const backend = textOf(await call(t.get("flarum_dev"), { topic: "backend" }));
  for (const k of ["Extend\\SearchDriver", "Extend\\ModelUrl", "Extend\\Formatter"]) {
    assert.ok(backend.includes(k), `backend should cover ${k}`);
  }
  const integrations = textOf(await call(t.get("flarum_dev"), { topic: "integrations" }));
  for (const k of ["is_locked", "is_approved", "flarum-likes", "UploadedFileInterface", "flarum-mentions"]) {
    assert.ok(integrations.includes(k), `integrations should cover ${k}`);
  }
});

test("the Tier 3 contracts are present", async () => {
  const t = register();
  const backend = textOf(await call(t.get("flarum_dev"), { topic: "backend" }));
  for (const k of ["app.registry", "ScopeVisibilityTrait", "Extend\\ErrorHandling", "Extend\\ThrottleApi"]) {
    assert.ok(backend.includes(k), `backend should cover ${k}`);
  }
  // The big 2.0 rename must be documented, not the stale name.
  assert.ok(backend.includes("app.registry"), "must use the 2.0 app.registry name");
  const scaling = textOf(await call(t.get("flarum_dev"), { topic: "scaling" }));
  assert.ok(scaling.includes("onOneServer") && scaling.includes("Extend\\Console"), "scaling should cover console/scheduling");
});

test("the porting (1.x -> 2.0) topic is selectable and covers the big breaking changes", async () => {
  const t = register();
  const porting = textOf(await call(t.get("flarum_dev"), { topic: "porting" }));
  assert.match(porting, /Porting a 1\.x extension/);
  for (const k of ["AbstractSerializer", "Extend\\ApiResource", "Extend\\SearchDriver", "app.registry", "^8.3"]) {
    assert.ok(porting.includes(k), `porting should cover ${k}`);
  }
});
