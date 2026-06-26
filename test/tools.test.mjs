import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { FlarumClient } from "../dist/flarum-client.js";
import { registerTools } from "../dist/tools/index.js";

// Collect registered tools via a stub server, then drive their handlers the
// way the real MCP server would: validate raw args through the tool's zod
// shape (applying defaults/clamps) before calling the handler.
function register(client) {
  const tools = new Map();
  registerTools({ registerTool: (name, cfg, handler) => tools.set(name, { cfg, handler }) }, client);
  return tools;
}
const call = (tool, raw = {}) => tool.handler(z.object(tool.cfg.inputSchema).parse(raw));
const writeClient = () => new FlarumClient({ baseUrl: "http://forum.test", readOnly: false });
const readClient = () => new FlarumClient({ baseUrl: "http://forum.test", readOnly: true });

let calls = [];
const origFetch = globalThis.fetch;
function stubFetch(body = {}, status = 200) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
}
afterEach(() => {
  globalThis.fetch = origFetch;
});

const WRITE_TOOLS = ["flarum_create", "flarum_update", "flarum_delete", "flarum_create_discussion", "flarum_reply"];

test("write mode registers all 10 tools", () => {
  const t = register(writeClient());
  assert.equal(t.size, 10);
  for (const n of WRITE_TOOLS) assert.ok(t.has(n), `missing ${n}`);
});

test("read-only mode hides mutation tools, leaving 5 read tools", () => {
  const t = register(readClient());
  assert.deepEqual(
    [...t.keys()].sort(),
    ["flarum_get", "flarum_list", "flarum_request", "flarum_search", "flarum_whoami"],
  );
  for (const n of WRITE_TOOLS) assert.ok(!t.has(n), `${n} should not be registered`);
});

test("flarum_request refuses non-GET in read-only and never hits the network", async () => {
  stubFetch();
  const t = register(readClient());
  const res = await call(t.get("flarum_request"), { method: "POST", path: "/discussions", body: { x: 1 } });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /read-only/i);
  assert.equal(calls.length, 0);
});

test("flarum_request allows GET in read-only", async () => {
  stubFetch({ data: [] });
  const t = register(readClient());
  const res = await call(t.get("flarum_request"), { method: "GET", path: "/discussions" });
  assert.ok(!res.isError);
  assert.equal(calls.length, 1);
});

test("flarum_list maps to GET with paging/fields/filter and defaults limit to 20", async () => {
  stubFetch({ data: [] });
  const t = register(writeClient());
  await call(t.get("flarum_list"), { type: "users", filter: { q: "bob" }, fields: { users: "username" } });
  const u = new URL(calls[0].url);
  assert.equal(calls[0].init.method ?? "GET", "GET");
  assert.equal(u.pathname, "/api/users");
  assert.equal(u.searchParams.get("filter[q]"), "bob");
  assert.equal(u.searchParams.get("fields[users]"), "username");
  assert.equal(u.searchParams.get("page[limit]"), "20");
});

test("flarum_list rejects a page size over the max of 50", () => {
  const t = register(writeClient());
  assert.throws(() => z.object(t.get("flarum_list").cfg.inputSchema).parse({ type: "posts", limit: 999 }));
});

test("flarum_create issues POST with a JSON:API body", async () => {
  stubFetch({ data: { type: "discussions", id: "1" } });
  const t = register(writeClient());
  await call(t.get("flarum_create"), {
    type: "discussions",
    attributes: { title: "x" },
    relationships: { tags: { data: [] } },
  });
  assert.equal(calls[0].init.method, "POST");
  assert.equal(new URL(calls[0].url).pathname, "/api/discussions");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    data: { type: "discussions", attributes: { title: "x" }, relationships: { tags: { data: [] } } },
  });
});

test("flarum_update issues PATCH with the id in path and body", async () => {
  stubFetch({ data: {} });
  const t = register(writeClient());
  await call(t.get("flarum_update"), { type: "discussions", id: "42", attributes: { isLocked: true } });
  assert.equal(calls[0].init.method, "PATCH");
  assert.equal(new URL(calls[0].url).pathname, "/api/discussions/42");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    data: { type: "discussions", id: "42", attributes: { isLocked: true } },
  });
});

test("flarum_delete issues DELETE and returns a deleted marker", async () => {
  stubFetch({});
  const t = register(writeClient());
  const res = await call(t.get("flarum_delete"), { type: "posts", id: "7" });
  assert.equal(calls[0].init.method, "DELETE");
  assert.equal(new URL(calls[0].url).pathname, "/api/posts/7");
  assert.deepEqual(JSON.parse(res.content[0].text), { deleted: true, type: "posts", id: "7" });
});

test("maxFieldChars truncates long fields, and 0 disables truncation", async () => {
  const long = "a".repeat(2000);
  const doc = () => ({ data: [{ type: "posts", id: "1", attributes: { contentHtml: long } }] });

  stubFetch(doc());
  const t = register(writeClient());
  const trimmed = await call(t.get("flarum_list"), { type: "posts", maxFieldChars: 100 });
  assert.match(trimmed.content[0].text, /\[truncated 1900 chars\]/);
  assert.ok(!trimmed.content[0].text.includes(long));

  stubFetch(doc());
  const full = await call(t.get("flarum_list"), { type: "posts", maxFieldChars: 0 });
  assert.ok(!full.content[0].text.includes("[truncated"));
  assert.ok(full.content[0].text.includes(long));
});

test("API errors surface as an isError result containing the API body", async () => {
  stubFetch({ errors: [{ status: "403", detail: "nope" }] }, 403);
  const t = register(writeClient());
  const res = await call(t.get("flarum_get"), { type: "discussions", id: "1" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /403/);
  assert.match(res.content[0].text, /nope/);
});
