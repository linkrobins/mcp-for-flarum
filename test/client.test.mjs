import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { FlarumClient, FlarumError } from "../dist/flarum-client.js";

// Mock global fetch, capturing calls and returning a canned response.
let calls = [];
const origFetch = globalThis.fetch;
function stubFetch(body = {}, status = 200) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
}
afterEach(() => {
  globalThis.fetch = origFetch;
});

test("read-only client refuses every mutating method (before any network call)", async () => {
  const c = new FlarumClient({ baseUrl: "http://forum.test", readOnly: true });
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    await assert.rejects(
      () => c.request({ method, path: "/discussions" }),
      /read-only/i,
      `${method} should be refused`,
    );
  }
});

test("read-only client still allows reads", async () => {
  stubFetch({ data: [] });
  const c = new FlarumClient({ baseUrl: "http://forum.test", readOnly: true });
  assert.deepEqual(await c.request({ path: "/discussions" }), { data: [] });
  assert.equal(calls.length, 1);
});

test("builds JSON:API query params (filter/include/fields/sort/page)", async () => {
  stubFetch({});
  const c = new FlarumClient({ baseUrl: "http://forum.test" });
  await c.request({
    path: "/discussions",
    query: {
      filter: { q: "hi" },
      include: "user",
      fields: { discussions: "title" },
      sort: "-createdAt",
      page: { limit: 5, offset: 10 },
    },
  });
  const u = new URL(calls[0].url);
  assert.equal(u.pathname, "/api/discussions");
  assert.equal(u.searchParams.get("filter[q]"), "hi");
  assert.equal(u.searchParams.get("include"), "user");
  assert.equal(u.searchParams.get("fields[discussions]"), "title");
  assert.equal(u.searchParams.get("sort"), "-createdAt");
  assert.equal(u.searchParams.get("page[limit]"), "5");
  assert.equal(u.searchParams.get("page[offset]"), "10");
});

test("targets the /api root and normalises base URL", async () => {
  stubFetch({});
  const c = new FlarumClient({ baseUrl: "http://forum.test/" });
  await c.request({ path: "users/1" });
  assert.equal(new URL(calls[0].url).pathname, "/api/users/1");
});

test("sends Token auth header with userId", async () => {
  stubFetch({});
  const c = new FlarumClient({ baseUrl: "http://forum.test", apiKey: "KEY", userId: 1 });
  await c.request({ path: "/" });
  assert.equal(calls[0].init.headers.Authorization, "Token KEY; userId=1");
});

test("omits auth header when no key is set", async () => {
  stubFetch({});
  const c = new FlarumClient({ baseUrl: "http://forum.test" });
  await c.request({ path: "/" });
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test("GET never sends a body, even if one is passed", async () => {
  stubFetch({});
  const c = new FlarumClient({ baseUrl: "http://forum.test" });
  await c.request({ path: "/x", body: { a: 1 } });
  assert.equal(calls[0].init.body, undefined);
});

test("pre-change snapshot: fires once before the first write, not on reads", async () => {
  stubFetch({ data: {} });
  const c = new FlarumClient({
    baseUrl: "http://forum.test",
    snapshotUrl: "http://host.test/snap",
    snapshotToken: "TOK",
  });
  // A read must not trigger a snapshot.
  await c.request({ path: "/discussions" });
  assert.equal(calls.filter((x) => x.url === "http://host.test/snap").length, 0);

  // First write triggers exactly one snapshot POST with the bearer token.
  await c.request({ method: "POST", path: "/discussions", body: { data: {} } });
  // Second write must NOT trigger another (once per instance/session).
  await c.request({ method: "PATCH", path: "/discussions/1", body: { data: {} } });

  const snaps = calls.filter((x) => x.url === "http://host.test/snap");
  assert.equal(snaps.length, 1, "exactly one snapshot for multiple writes");
  assert.equal(snaps[0].init.method, "POST");
  assert.equal(snaps[0].init.headers.Authorization, "Bearer TOK");
});

test("pre-change snapshot: never fires in read-only mode (write refused first)", async () => {
  stubFetch({});
  const c = new FlarumClient({
    baseUrl: "http://forum.test",
    readOnly: true,
    snapshotUrl: "http://host.test/snap",
    snapshotToken: "TOK",
  });
  await assert.rejects(() => c.request({ method: "POST", path: "/x" }), /read-only/i);
  assert.equal(calls.length, 0, "no snapshot, no write");
});

test("pre-change snapshot: no-op when snapshot env is unset", async () => {
  stubFetch({ data: {} });
  const c = new FlarumClient({ baseUrl: "http://forum.test" });
  await c.request({ method: "POST", path: "/discussions", body: { data: {} } });
  assert.equal(calls.length, 1, "only the write itself, no snapshot call");
});

test("throws FlarumError carrying status and parsed body on non-2xx", async () => {
  const errBody = { errors: [{ status: "404", code: "not_found" }] };
  stubFetch(errBody, 404);
  const c = new FlarumClient({ baseUrl: "http://forum.test" });
  await assert.rejects(
    () => c.request({ path: "/discussions/999" }),
    (e) => {
      assert.ok(e instanceof FlarumError);
      assert.equal(e.status, 404);
      assert.deepEqual(e.body, errBody);
      return true;
    },
  );
});
