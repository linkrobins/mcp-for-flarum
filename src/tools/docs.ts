/**
 * Documentation tools: search and read Flarum's official 2.0 docs
 * (https://docs.flarum.org/2.x/) live, so an AI working against a forum can
 * look up how a feature, permission, extender, or REST endpoint is supposed to
 * work without the operator pasting docs in by hand.
 *
 * Everything here hits public, read-only sources -- it never touches the
 * configured forum or its API key -- so these tools are always available,
 * even in read-only mode and even with no FLARUM_API_KEY set:
 *
 *   - search: Algolia DocSearch, the same index the docs site's own search box
 *     uses. Public search-only credentials (shipped in the site's client JS),
 *     constrained to the English "current" version, which is 2.x.
 *   - get:    the page's Markdown source from the flarum/docs repo, which keeps
 *     code fences and headings intact (cleaner than scraping rendered HTML).
 *   - list:   the published sitemap, filtered to /2.x/ pages.
 *
 * Because all three read the live site/repo, the docs stay current on their own
 * -- no rebuild or re-publish of this server is needed when Flarum edits a page.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { result, errorResult } from "./shared.js";

const DOCS_ORIGIN = "https://docs.flarum.org";
/** English 2.x docs live under this path prefix on the live site. */
const V2_PREFIX = "/2.x/";
/** Markdown source for 2.x pages: flarum/docs main branch, docs/<slug>.md. */
const GH_RAW_BASE = "https://raw.githubusercontent.com/flarum/docs/main/docs";

/**
 * Public Algolia DocSearch credentials, lifted verbatim from the docs site's
 * own configuration (docusaurus.config.js -> themeConfig.algolia). The apiKey
 * is a search-only key designed to be exposed in client JS, so embedding it
 * here is exactly how the site itself ships it. Constrain queries to English +
 * the "current" Docusaurus version, which is Flarum 2.x (1.x is the released
 * default served at the root).
 */
const ALGOLIA_APP_ID = "QHP1YG60G0";
const ALGOLIA_API_KEY = "dcfd7f09bbede3329311afd89da074b7";
const ALGOLIA_INDEX = "flarum";
const ALGOLIA_FACETS = [["language:en"], ["docusaurus_tag:docs-default-current"]];

/** Cleaned-up fetch with a timeout and our identifiable User-Agent. */
async function fetchText(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; userAgent?: string; timeoutMs: number },
): Promise<{ ok: boolean; status: number; text: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: {
        ...(opts.userAgent ? { "User-Agent": opts.userAgent } : {}),
        ...opts.headers,
      },
      body: opts.body,
      signal: ctrl.signal,
    });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

/** Strip zero-width chars and collapse whitespace in a docs string. */
function clean(s: unknown): string {
  return typeof s === "string" ? s.replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").trim() : "";
}

/** Build a readable breadcrumb title from an Algolia hit's hierarchy object. */
function hitTitle(hierarchy: Record<string, unknown> | undefined): string {
  if (!hierarchy) return "";
  return ["lvl0", "lvl1", "lvl2", "lvl3", "lvl4", "lvl5", "lvl6"]
    .map((k) => clean(hierarchy[k]))
    .filter(Boolean)
    .join(" › ");
}

/**
 * Turn a user-supplied page reference into a docs slug relative to the 2.x
 * root. Accepts a bare slug ("rest-api", "extend/api"), a site path
 * ("/2.x/rest-api"), or a full docs URL, with any #anchor or ?query stripped.
 */
function toSlug(page: string): string {
  let p = page.trim();
  if (/^https?:\/\//i.test(p)) {
    try {
      p = new URL(p).pathname;
    } catch {
      /* fall through and treat as a path */
    }
  }
  p = p.split("#")[0].split("?")[0];
  p = p.replace(/^\/+/, "").replace(/\/+$/, "");
  p = p.replace(/^2\.x\//, "");
  if (p === "2.x") p = "";
  return p;
}

/** Drop a leading YAML frontmatter block, if the page has one. */
function stripFrontmatter(md: string): string {
  return md.startsWith("---\n") ? md.replace(/^---\n[\s\S]*?\n---\n/, "") : md;
}

let sitemapCache: Array<{ path: string; url: string }> | null = null;

export function registerDocsTools(server: McpServer, userAgent?: string, timeoutMs = 30_000): void {
  server.registerTool(
    "flarum_docs_search",
    {
      title: "Search Flarum docs",
      description:
        "Search the official Flarum 2.0 documentation (docs.flarum.org/2.x) and return ranked " +
        "results with their page path and a snippet. Use this to look up how something works -- " +
        "admin settings, permissions, extenders, REST API usage, extension development -- before " +
        "acting on a forum. Reads the live docs, so results reflect the current docs. " +
        'Then call flarum_docs_get with a result\'s "page" to read the full page. ' +
        'Example: query="approve posts permission".',
      inputSchema: {
        query: z.string().describe("What to look up, in natural language or keywords."),
        limit: z
          .number()
          .int()
          .positive()
          .max(20)
          .optional()
          .default(8)
          .describe("Maximum number of results (default 8, max 20)."),
      },
    },
    async ({ query, limit }) => {
      try {
        const res = await fetchText(
          `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/${ALGOLIA_INDEX}/query`,
          {
            method: "POST",
            userAgent,
            timeoutMs,
            headers: {
              "X-Algolia-API-Key": ALGOLIA_API_KEY,
              "X-Algolia-Application-Id": ALGOLIA_APP_ID,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query,
              hitsPerPage: limit,
              facetFilters: ALGOLIA_FACETS,
              attributesToRetrieve: ["hierarchy", "url", "content", "type"],
              attributesToHighlight: [],
            }),
          },
        );
        if (!res.ok) {
          throw new Error(`Docs search failed: Algolia responded ${res.status}`);
        }
        const hits = (JSON.parse(res.text)?.hits ?? []) as Array<Record<string, unknown>>;
        const results = hits.map((h) => {
          const url = String(h.url ?? "");
          const slug = toSlug(url);
          const out: Record<string, unknown> = {
            title: hitTitle(h.hierarchy as Record<string, unknown> | undefined),
            page: slug,
            url,
          };
          const snippet = clean(h.content);
          if (snippet) out.snippet = snippet.length > 240 ? `${snippet.slice(0, 240)}...` : snippet;
          return out;
        });
        return result({
          query,
          count: results.length,
          results,
          hint: 'Read a full page with flarum_docs_get using a result\'s "page" value.',
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "flarum_docs_get",
    {
      title: "Read a Flarum docs page",
      description:
        "Fetch the full Markdown of one Flarum 2.0 documentation page. Accepts a page slug " +
        '("rest-api", "extend/api"), a site path ("/2.x/rest-api"), or a full docs URL (any ' +
        "#anchor is ignored). Reads the page's Markdown source, so code blocks and headings " +
        "are preserved. Pair with flarum_docs_search to find the right page first.",
      inputSchema: {
        page: z
          .string()
          .describe('Page to read, e.g. "rest-api", "extend/permissions", or a docs URL.'),
        maxChars: z
          .number()
          .int()
          .min(0)
          .optional()
          .default(0)
          .describe("Truncate the page to this many characters. 0 (default) returns the whole page."),
      },
    },
    async ({ page, maxChars }) => {
      try {
        const slug = toSlug(page) || "index";
        // Pages are docs/<slug>.md; folder index pages are docs/<slug>/index.md.
        const candidates = [`${GH_RAW_BASE}/${slug}.md`, `${GH_RAW_BASE}/${slug}/index.md`];
        let md: string | null = null;
        for (const url of candidates) {
          const res = await fetchText(url, { userAgent, timeoutMs });
          if (res.ok) {
            md = res.text;
            break;
          }
          if (res.status !== 404) {
            throw new Error(`Failed to fetch docs page "${slug}": ${res.status}`);
          }
        }
        if (md === null) {
          throw new Error(
            `No Flarum 2.0 docs page found for "${slug}". ` +
              "Use flarum_docs_search to find a page, or flarum_docs_list to browse paths.",
          );
        }
        let text = stripFrontmatter(md).trim();
        if (maxChars > 0 && text.length > maxChars) {
          text = `${text.slice(0, maxChars)}\n\n... [truncated ${text.length - maxChars} chars; raise maxChars for more]`;
        }
        const canonical = `${DOCS_ORIGIN}${V2_PREFIX}${slug}`;
        return {
          content: [{ type: "text" as const, text: `<!-- Flarum 2.0 docs: ${canonical} -->\n\n${text}` }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "flarum_docs_list",
    {
      title: "List Flarum docs pages",
      description:
        "List the available Flarum 2.0 documentation pages (paths and URLs), from the live " +
        "sitemap. Useful to discover what pages exist before reading one with flarum_docs_get. " +
        'Optionally pass a substring to filter by path, e.g. filter="extend".',
      inputSchema: {
        filter: z
          .string()
          .optional()
          .describe('Case-insensitive substring to filter page paths, e.g. "extend" or "mail".'),
      },
    },
    async ({ filter }) => {
      try {
        if (!sitemapCache) {
          const res = await fetchText(`${DOCS_ORIGIN}/sitemap.xml`, { userAgent, timeoutMs });
          if (!res.ok) throw new Error(`Failed to fetch docs sitemap: ${res.status}`);
          const prefix = `${DOCS_ORIGIN}${V2_PREFIX}`;
          const urls = [...res.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
          sitemapCache = urls
            .filter((u) => u.startsWith(prefix))
            .map((u) => ({ path: u.slice(prefix.length).replace(/\/$/, ""), url: u }))
            .filter((p) => p.path) // drop the bare /2.x/ root entry
            .sort((a, b) => a.path.localeCompare(b.path));
        }
        const needle = filter?.toLowerCase();
        const pages = needle ? sitemapCache.filter((p) => p.path.toLowerCase().includes(needle)) : sitemapCache;
        return result({ count: pages.length, pages });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
