/**
 * MCP prompts: reusable, user-invokable workflows that front-load the right
 * sequence of this server's tools. Where the server `instructions` are a
 * passive standing nudge, a prompt is an explicit "do it this way" the user
 * picks, so the orchestration (consult `flarum_dev` first, confirm via
 * `flarum_docs`, then implement/review against the contracts) is baked in
 * rather than left to chance.
 *
 * These are about extension development, so they lean on `flarum_dev`; register
 * them only when that reference tool is enabled.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const userMessage = (text: string) => ({
  messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
});

/** Register the extension-development prompts. Pair with `flarum_dev`/`flarum_docs`. */
export function registerExtensionPrompts(server: McpServer): void {
  server.registerPrompt(
    "build-flarum-extension",
    {
      title: "Build a Flarum 2.0 extension",
      description:
        "Scaffold and implement a new Flarum 2.0 extension the right way, consulting the built-in " +
        "flarum_dev reference and live flarum_docs at each step so it follows the conventions and " +
        "compatibility contracts from the start.",
      argsSchema: {
        summary: z
          .string()
          .describe("What the extension should do (the feature, in a sentence or two)."),
      },
    },
    ({ summary }) =>
      userMessage(
        `I want to build a Flarum 2.0 extension: ${summary}\n\n` +
          "Follow this workflow and do not skip steps. Prefer the MCP's tools over assumptions about Flarum:\n" +
          "1. Call `flarum_dev` (topic `scaffold`, then `composer`) to lay out the structure, and `flarum_docs_search` for any extender or endpoint you'll use.\n" +
          "2. Implement the feature across the layers it needs (backend API resource/model/migration, the JSON:API, the Mithril frontend), consulting the matching `flarum_dev` topics (`backend`, `frontend`) and following every contract.\n" +
          "3. If it does background work, stores files, or caches, consult `flarum_dev` topic `scaling` and honor queue-driver portability (correct under sync/database/redis/Horizon), Redis/cache, and multi-server file storage. If it touches realtime, audit, widgets, or the sitemap, consult `integrations` and use the soft-dependence pattern so it works with AND without those extensions.\n" +
          "4. Make every user-facing string translatable (`flarum_dev` topic `i18n`).\n" +
          "5. Add the testing/CI/PHPStan stack (`flarum_dev` topics `testing` and `quality-ci`) and make sure it passes on the full database matrix (MySQL, MariaDB, PostgreSQL, SQLite), not just one DB.\n" +
          "6. Prepare the release per topic `release`.\n" +
          "As you go, state which `flarum_dev` topics you consulted and which contracts you applied.",
      ),
  );

  server.registerPrompt(
    "review-flarum-extension",
    {
      title: "Review a Flarum 2.0 extension",
      description:
        "Audit an existing Flarum 2.0 extension against the canonical flarum_dev contracts, topic by " +
        "topic, reporting concrete violations with file:line and fixes.",
      argsSchema: {
        target: z
          .string()
          .optional()
          .describe("Path or package of the extension to review (defaults to the current working directory)."),
      },
    },
    ({ target }) =>
      userMessage(
        `Review the Flarum 2.0 extension ${target ? `at ${target}` : "in the current working directory"} against the canonical contracts.\n\n` +
          "For each area below, call `flarum_dev` for that topic, check the code against it, and report concrete violations with `file:line` and a fix. Use `flarum_docs` to confirm any API/extender behavior rather than assuming:\n" +
          "- `scaffold` / `composer`: structure, composer.json, no stray autoload, license.\n" +
          "- `backend`: fail-closed API fields, no writes on the GET path, atomic creation, explicit permission gating, and cross-database-portable queries.\n" +
          "- `frontend`: lazy-chunk-safe string-path extends, sanitize before `m.trust()`, render-time i18n, the autoExportLoader naming pitfall.\n" +
          "- `scaling`: queue-driver portability, cache as non-authoritative, multi-server file storage.\n" +
          "- `integrations`: soft-dependence for realtime/audit/widgets/sitemap (works with and without each).\n" +
          "- `i18n`, `testing`, `quality-ci`, `release`.\n" +
          "Prioritize correctness bugs (anything that 500s on PostgreSQL, or breaks under a real queue or multi-server stack) over style.",
      ),
  );

  server.registerPrompt(
    "check-flarum-compatibility",
    {
      title: "Check Flarum extension production-stack compatibility",
      description:
        "Focused audit of whether an extension works on a real production stack (database/Redis queues, " +
        "Horizon, multi-server file sync) and with the optional ecosystem extensions (realtime, audit, " +
        "widgets, sitemap), per the flarum_dev `scaling` and `integrations` contracts.",
      argsSchema: {
        target: z
          .string()
          .optional()
          .describe("Path or package of the extension to check (defaults to the current working directory)."),
      },
    },
    ({ target }) =>
      userMessage(
        `Audit the Flarum 2.0 extension ${target ? `at ${target}` : "in the current working directory"} for production-stack and ecosystem compatibility.\n\n` +
          "Call `flarum_dev` topics `scaling` and `integrations`, then verify the code honors every contract and report each violation with `file:line` and the corrected pattern:\n" +
          "- Queue-driver portability: every job is correct under the `sync` default (runs inline), `database`, and `redis`/Horizon — pass IDs not models and re-fetch, idempotent and retry-safe handlers, no request-scoped state, sensible `tries`/`timeout`/`backoff`.\n" +
          "- Redis / cache: shared across nodes and non-authoritative (recompute on miss), namespaced keys; never the filesystem or static memory for shared state.\n" +
          "- Multi-server file storage: no local-path assumptions; a declared `Extend\\Filesystem` disk an admin can repoint at S3; public URLs via the disk.\n" +
          "- Optional integrations: soft-dependence (suggest, never require; `Conditional`/`whenExtensionEnabled` and `flarum.reg.get`), and the feature works with AND without flarum/realtime, flarum/audit, fof/forum-widgets-core, and fof/sitemap.\n" +
          "Confirm it also works on a stock single-box forum with no Redis, no worker, and no optional extensions installed.",
      ),
  );
}
