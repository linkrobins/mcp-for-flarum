import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { registerDocsTools } from "../dist/tools/docs.js";

// Collect docs tools via a stub server and drive their handlers the way the
// real MCP server would (validate raw args through the tool's zod shape first).
function register() {
  const tools = new Map();
  registerDocsTools({ registerTool: (name, cfg, handler) => tools.set(name, { cfg, handler }) }, "test-ua/1.0");
  return tools;
}
const call = (tool, raw = {}) => tool.handler(z.object(tool.cfg.inputSchema).parse(raw));

// Router-style fetch stub: route(method, url) -> { body, status }.
let calls = [];
const origFetch = globalThis.fetch;
function routeFetch(router) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url: u, init });
    const { body = "", status = 200 } = router(method, u, init) ?? {};
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
}
afterEach(() => {
  globalThis.fetch = origFetch;
});

test("registers the three docs tools", () => {
  const t = register();
  assert.deepEqual([...t.keys()].sort(), ["flarum_docs_get", "flarum_docs_list", "flarum_docs_search"]);
});

test("flarum_docs_search queries Algolia, constrains to English 2.x, and maps hits", async () => {
  routeFetch((method, url) => {
    assert.match(url, /algolia\.net\/1\/indexes\/flarum\/query/);
    assert.equal(method, "POST");
    return {
      body: {
        hits: [
          {
            url: "https://docs.flarum.org/2.x/extend/permissions/#naming",
            hierarchy: { lvl0: "Extend", lvl1: null, lvl2: "Permission Naming​", lvl3: null },
            content: "How permissions are named.",
          },
        ],
      },
    };
  });
  const t = register();
  const res = await call(t.get("flarum_docs_search"), { query: "permissions" });
  // Sends our facet filters + UA + search-only key.
  const sent = JSON.parse(calls[0].init.body);
  assert.deepEqual(sent.facetFilters, [["language:en"], ["docusaurus_tag:docs-default-current"]]);
  assert.equal(calls[0].init.headers["X-Algolia-API-Key"].length > 0, true);
  assert.equal(calls[0].init.headers["User-Agent"], "test-ua/1.0");
  const out = JSON.parse(res.content[0].text);
  assert.equal(out.results[0].page, "extend/permissions"); // slug, anchor + /2.x/ stripped
  assert.equal(out.results[0].title, "Extend › Permission Naming"); // zero-width stripped
  assert.equal(out.results[0].snippet, "How permissions are named.");
});

test("flarum_docs_get fetches Markdown source, strips frontmatter, tags the source", async () => {
  routeFetch((method, url) => {
    assert.equal(url, "https://raw.githubusercontent.com/flarum/docs/main/docs/rest-api.md");
    return { body: "---\ntitle: REST\n---\n# Consuming the REST API\n\nBody." };
  });
  const t = register();
  const res = await call(t.get("flarum_docs_get"), { page: "/2.x/rest-api" });
  const text = res.content[0].text;
  assert.match(text, /Flarum 2\.0 docs: https:\/\/docs\.flarum\.org\/2\.x\/rest-api/);
  assert.match(text, /# Consuming the REST API/);
  assert.ok(!text.includes("title: REST")); // frontmatter stripped
});

test("flarum_docs_get falls back to <slug>/index.md on 404, else errors helpfully", async () => {
  routeFetch((method, url) => {
    if (url.endsWith("/extend.md")) return { status: 404 };
    if (url.endsWith("/extend/index.md")) return { body: "# Extending Flarum" };
    return { status: 404 };
  });
  const t = register();
  const ok = await call(t.get("flarum_docs_get"), { page: "extend" });
  assert.match(ok.content[0].text, /# Extending Flarum/);

  routeFetch(() => ({ status: 404 }));
  const miss = await call(t.get("flarum_docs_get"), { page: "nope" });
  assert.equal(miss.isError, true);
  assert.match(miss.content[0].text, /No Flarum 2\.0 docs page found/);
});

test("flarum_docs_list parses the sitemap, keeps /2.x/ pages, and filters", async () => {
  routeFetch((method, url) => {
    assert.match(url, /\/sitemap\.xml$/);
    return {
      body:
        "<urlset>" +
        "<url><loc>https://docs.flarum.org/2.x/</loc></url>" +
        "<url><loc>https://docs.flarum.org/2.x/rest-api</loc></url>" +
        "<url><loc>https://docs.flarum.org/2.x/extend/api</loc></url>" +
        "<url><loc>https://docs.flarum.org/extend/api</loc></url>" + // 1.x: excluded
        "</urlset>",
    };
  });
  const t = register();
  const all = JSON.parse((await call(t.get("flarum_docs_list"))).content[0].text);
  assert.deepEqual(
    all.pages.map((p) => p.path),
    ["extend/api", "rest-api"], // bare /2.x/ root dropped, 1.x excluded, sorted
  );
  // Cache is populated now; filtering is a pure in-memory pass.
  const filtered = JSON.parse((await call(t.get("flarum_docs_list"), { filter: "extend" })).content[0].text);
  assert.deepEqual(filtered.pages.map((p) => p.path), ["extend/api"]);
});
