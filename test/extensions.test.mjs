import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { FlarumClient } from "../dist/flarum-client.js";
import { registerExtensionTools } from "../dist/tools/extensions.js";

// Same stub-server pattern as tools.test.mjs: collect registered tools and
// drive their handlers through the tool's zod shape (applying defaults).
function register(client) {
  const tools = new Map();
  registerExtensionTools({ registerTool: (name, cfg, handler) => tools.set(name, { cfg, handler }) }, client);
  return tools;
}
const call = (tool, raw = {}) => tool.handler(z.object(tool.cfg.inputSchema).parse(raw));
const writeClient = () => new FlarumClient({ baseUrl: "http://forum.test", readOnly: false });
const readClient = () => new FlarumClient({ baseUrl: "http://forum.test", readOnly: true });

// Router-style fetch stub: route(method, pathname) -> { body, status }.
let calls = [];
const origFetch = globalThis.fetch;
function routeFetch(router) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url: u, init });
    const { body = {}, status = 200 } = router(method, u.pathname, u) ?? {};
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
}
afterEach(() => {
  globalThis.fetch = origFetch;
});

const READ_TOOLS = ["flarum_ext_search", "flarum_ext_tasks"];
const WRITE_TOOLS = [
  "flarum_ext_why_not",
  "flarum_ext_install",
  "flarum_ext_update",
  "flarum_ext_remove",
  "flarum_ext_toggle",
  "flarum_ext_check_updates",
  "flarum_ext_bulk_update",
  "flarum_ext_configure_composer",
];

test("write mode registers all 10 extension tools", () => {
  const t = register(writeClient());
  assert.equal(t.size, 10);
  for (const n of [...READ_TOOLS, ...WRITE_TOOLS]) assert.ok(t.has(n), `missing ${n}`);
});

test("read-only mode exposes only the two GET tools", () => {
  const t = register(readClient());
  assert.deepEqual([...t.keys()].sort(), [...READ_TOOLS].sort());
  for (const n of WRITE_TOOLS) assert.ok(!t.has(n), `${n} should not be registered`);
});

test("flarum_ext_search maps to GET /external-extensions with q/type filters", async () => {
  routeFetch(() => ({ body: { data: [], meta: { page: { total: 0 } } } }));
  const t = register(writeClient());
  await call(t.get("flarum_ext_search"), { query: "upload", type: "extension" });
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].url.pathname, "/api/external-extensions");
  assert.equal(calls[0].url.searchParams.get("filter[q]"), "upload");
  assert.equal(calls[0].url.searchParams.get("filter[type]"), "extension");
});

test("flarum_ext_why_not POSTs the package/version and is blocked in read-only", async () => {
  routeFetch(() => ({ body: { data: { reason: "ok" } } }));
  const t = register(writeClient());
  await call(t.get("flarum_ext_why_not"), { package: "fof/upload", version: "*" });
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url.pathname, "/api/extension-manager/why-not");
  assert.deepEqual(JSON.parse(calls[0].init.body), { data: { package: "fof/upload", version: "*" } });

  // read-only: tool isn't even registered
  assert.equal(register(readClient()).has("flarum_ext_why_not"), false);
});

test("flarum_ext_install (sync forum) returns the install result and can auto-enable", async () => {
  // No 202 -> sync path. Install returns {id}, then core enable PATCH fires.
  routeFetch((method, path) => {
    if (path === "/api/extension-manager/extensions") return { body: { id: "fof-upload" } };
    if (path === "/api/extensions/fof-upload") return { body: {} };
    return { body: {} };
  });
  const t = register(writeClient());
  const res = await call(t.get("flarum_ext_install"), { package: "fof/upload", enable: true });

  const install = calls.find((c) => c.url.pathname === "/api/extension-manager/extensions");
  assert.equal(install.method, "POST");
  assert.deepEqual(JSON.parse(install.init.body), { data: { package: "fof/upload" } });

  const enable = calls.find((c) => c.url.pathname === "/api/extensions/fof-upload");
  assert.equal(enable.method, "PATCH");
  assert.deepEqual(JSON.parse(enable.init.body), { enabled: true }); // flat, not JSON:API
  assert.match(res.content[0].text, /"enabled": "fof-upload"/);
});

test("flarum_ext_install (async forum) polls the task to completion", async () => {
  // latestTaskId() -> 5; dispatch -> 202 processing; task poll -> id 6 success.
  let dispatched = false;
  routeFetch((method, path) => {
    if (path === "/api/extension-manager/extensions") {
      dispatched = true;
      return { body: { processing: true }, status: 202 };
    }
    if (path === "/api/extension-manager-tasks") {
      return dispatched
        ? { body: { data: [{ id: "6", attributes: { status: "success", operation: "extension_install", command: "require x", package: "fof/upload", output: "done", finishedAt: "t", peakMemoryUsed: 1 } }] } }
        : { body: { data: [{ id: "5", attributes: {} }] } };
    }
    return { body: {} };
  });
  const t = register(writeClient());
  const res = await call(t.get("flarum_ext_install"), { package: "fof/upload" });
  const out = JSON.parse(res.content[0].text);
  assert.equal(out.install.status, "success");
  assert.equal(out.install.taskId, "6");
});

test("flarum_ext_toggle issues a flat-body core PATCH", async () => {
  routeFetch(() => ({ body: {} }));
  const t = register(writeClient());
  await call(t.get("flarum_ext_toggle"), { extensionId: "fof-upload", enabled: false });
  assert.equal(calls[0].method, "PATCH");
  assert.equal(calls[0].url.pathname, "/api/extensions/fof-upload");
  assert.deepEqual(JSON.parse(calls[0].init.body), { enabled: false });
});

test("flarum_ext_bulk_update maps scope to the right endpoint with dryRun", async () => {
  routeFetch(() => ({ body: { processing: false }, status: 201 }));
  const t = register(writeClient());
  await call(t.get("flarum_ext_bulk_update"), { scope: "major", dryRun: true, await: false });
  assert.equal(calls[0].url.pathname, "/api/extension-manager/major-update");
  assert.deepEqual(JSON.parse(calls[0].init.body), { data: { dryRun: 1 } });
});

test("flarum_ext_tasks truncates long composer output", async () => {
  const long = "x".repeat(9000);
  routeFetch(() => ({ body: { data: [{ id: "1", attributes: { status: "success", output: long } }] } }));
  const t = register(writeClient());
  const res = await call(t.get("flarum_ext_tasks"), { maxOutputChars: 100 });
  assert.match(res.content[0].text, /\[truncated 8900 chars\]/);
  assert.ok(!res.content[0].text.includes(long));
});
