/**
 * The `flarum_dev` tool: a development reference for building and reviewing
 * Flarum 2.0 extensions, served to the AI agent a developer is working with
 * through this MCP.
 *
 * Unlike flarum_docs_* (which proxies the official docs live), this is curated
 * guidance: the conventions the official docs establish, the de-facto
 * FriendsOfFlarum standard, and patterns that prevent the bugs that actually
 * bite in production. It is intentionally general (no vendor-specific
 * branding/naming) so it applies to any Flarum 2.0 extension.
 *
 * Content is static, so this tool needs no forum connection or API key and is
 * safe in read-only mode.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const TITLE = "Flarum 2.0 extension development reference";

const INTRO =
  "A development reference for building and reviewing a Flarum 2.0 extension. It covers the " +
  "conventions the official docs establish, the de-facto FriendsOfFlarum standard, and patterns " +
  "that prevent real production bugs. Use `flarum_docs_search`/`flarum_docs_get` for the authoritative " +
  "API reference; use this for the conventions and judgement the docs don't spell out. " +
  "Pass a `topic` to narrow to one section.";

const SECTIONS: Record<string, { title: string; body: string }> = {
  scaffold: {
    title: "Scaffold & architecture",
    body: `- **Extenders only.** Everything an extension does goes through declarative \`Extend\\*\` extenders (PHP) and the JS \`extend()\`/\`override()\` API. This is the compatibility guarantee: staying inside extenders is what lets a future Flarum minor not break you. Never edit core or another extension's internals to get an effect.
- **Three layers**: backend (OO PHP + Laravel components, dependency injection), the JSON:API public API, and the Mithril.js frontend SPA. A feature often touches all three (DB structure → API field → frontend display).
- **Standard layout**: \`extend.php\` (the extender list), \`src/\` (PHP, PSR-4), \`js/src/\` (TS/ESM source) with \`js/dist/\` committed, \`less/\`, \`locale/en.yml\`, \`migrations/\`, \`tests/\`, \`.github/workflows/\`, \`phpstan.neon\`, \`composer.json\`, \`README.md\`, \`LICENSE\`.
- **Use \`flarum-cli\`** to scaffold and to add/maintain infra: \`flarum-cli init\`, then \`flarum-cli infra backendTesting | frontendTesting | phpstan | githubActions\`. It keeps you aligned with the current conventions; record what it manages in \`extra.flarum-cli.modules\`.
- **Drop the \`autoload\` block entirely** for a JS-only extension (no \`src/\` PHP) instead of leaving a PSR-4 mapping pointing at a non-existent directory.
- **Community-health files** for anything published: \`.github/ISSUE_TEMPLATE\`, \`PULL_REQUEST_TEMPLATE.md\`, \`SECURITY.md\`, \`FUNDING.yml\`. If you maintain several extensions, a shared \`<org>/.github\` repo lets them all inherit one set instead of copying per-repo. Credit the upstream in the README when porting a 1.x extension.`,
  },
  composer: {
    title: "composer.json",
    body: `- \`type\` MUST be \`flarum-extension\`; \`require\` \`flarum/core: ^2.0\` and an explicit \`php\` constraint (keep it in sync with the README).
- **No \`version\` field** — version comes from git tags (Packagist reads tags).
- \`extra.flarum-extension\`: \`title\`, \`category\`, \`icon\`; \`optional-dependencies\` (array of extension IDs your code soft-integrates with) and also list those in \`require-dev\` so tests can enable them. Declare \`migrations: migrations\` when present.
- \`require-dev\`: \`flarum/testing: ^2.0\` and \`flarum/phpstan: ^2.0\` (+ any optional-dep packages exercised in tests).
- \`scripts\` + \`scripts-descriptions\`: \`test\` (→ \`test:unit\` + \`test:integration\`), \`test:unit\`, \`test:integration\`, \`test:setup\`, \`analyse:phpstan\`, \`clear-cache:phpstan\`.
- \`autoload-dev\` PSR-4 maps \`<Vendor>\\<Ext>\\Tests\\\` → \`tests/\`.
- While Flarum 2.0 is pre-stable, add \`"minimum-stability": "beta"\` (or \`dev\`) + \`"prefer-stable": true\` so dev deps resolve.
- **Porting a 1.x extension?** Add \`"replace": { "<old/package>": "*" }\` so the original package name resolves to your fork, and credit the original in the README.`,
  },
  frontend: {
    title: "Frontend (TypeScript / Mithril)",
    body: `- **TypeScript + ESM** under \`js/src/\`, with \`js/forum.js\`/\`js/admin.js\` as one-line re-export shims. Toolchain: \`flarum-webpack-config ^3\`, \`flarum-tsconfig ^2\`, \`typescript ^5\`, webpack 5.
- **Commit \`js/dist/\`** (so installs need no build step); gitignore \`node_modules\`, \`dist-typings\`, \`dist/*.map\`. The build transpiles via babel/preset-typescript (not tsc), so pure type-only edits leave \`dist\` byte-identical — verify that when bumping TS.
- **Lazy-chunk-safe extends**: extend components by **string path** (\`extend('flarum/forum/components/CommentPost', 'headerItems', ...)\`) with a type-only \`import type\`, not a runtime \`import\` of the component — a runtime import forces the component (and its chunk) eager and breaks code-splitting.
- **Read boot data in initializers from \`app.data\`/the payload**, not \`app.forum\` — \`app.forum\` isn't built yet when initializers run.
- **Resolve translations at render time**, never at module load (a top-level \`app.translator.trans(...)\` freezes to the English fallback).
- **Integrating with another extension's component** (e.g. FoF widgets): resolve its base classes at initializer time via the registry (\`flarum.reg.get('ext-id', ...)\`), not a top-level \`ext:\` import, to avoid load-order crashes.
- **Sanitize before \`m.trust()\`**: run any user/admin-supplied HTML through DOMPurify; prefer \`textContent\` over \`innerHTML\`; scope theme CSS classes so states don't bleed; make aria-labels translatable.
- **Prefer render-driven processing** (component \`oncreate\`/\`onupdate\`) over \`setInterval\` DOM polling.
- **\`autoExportLoader\` mangles exported names that contain digits** (a top-level \`export const pad2 = …\` can be re-exported as \`twoDigits\`/something unexpected). A single bad export doesn't just break your bundle — it can break *other* extensions' bundles loaded after yours. Avoid digits in exported identifier names, and verify the built bundle actually exports what you expect.
- **Non-discussion notifications group under the forum title** ("Flarum") by default. If your extension emits notifications that aren't about a discussion, override \`NotificationList\` content to relabel them per-extension, or they'll all bucket together confusingly.`,
  },
  backend: {
    title: "Backend (API resources, models, migrations)",
    body: `- **Fail-closed serializer/resource fields**: any per-request boolean shipped on a broadly-fetched resource (e.g. \`ForumResource\` fields on every forum response) should wrap \`can()\`/attribute reads in try/catch and degrade to \`false\` — a throwing field must not 500 the whole boot payload. Don't \`resolve()\` services inside a field closure; inject via the resource constructor.
- **No side effects on GET / serialization**: never do a write while serializing a read. Move state-changing work to an explicit POST route.
- **Gate every endpoint explicitly**: \`assertCan\`/\`assertRegistered\`/\`assertAdmin\` in endpoint authorization, and define abilities via \`Access\\Policy\` rather than ad-hoc checks. On a private forum, scope list/index queries behind the \`viewForum\` permission so a guest can't enumerate rows. Default to deny; make a new capability opt-in via a seeded permission, not implicitly available.
- **Atomic multi-row creation**: when creating a parent + its first child (ticket+first reply, discussion+first post), do it in one transaction (and take a row lock if a rate/quota check must be TOCTOU-safe) so a failure can't leave an orphan.
- **Models**: add \`@property\`/\`@property-read\` PHPDoc for columns and relationships (PHPStan needs it, and it documents the schema); use \`$casts\` (not the deprecated \`$dates\`); type relationship methods.
- **Migrations** portable + idempotent: \`createTableIfNotExists\`/\`addColumns\`; wrap FK drops in try/catch instead of probing \`information_schema\` (which doesn't exist on SQLite/Postgres); chunk backfills; race-safe unique indexes; seed permissions via migration.
- **Write portable queries — the reusable CI runs MySQL, MariaDB, PostgreSQL *and* SQLite.** MySQL is lenient where Postgres is strict, so a query that's green locally on MySQL can 500 only on the Postgres CI job. Concretely: do **not** \`distinct()\` a \`SELECT *\` that pulls a model with a JSON column (e.g. \`users.preferences\`) — Postgres has no equality operator for \`json\` and fails with \`SQLSTATE 42883\`; an \`EXISTS\`-style \`whereHas\`/\`orWhereHas\` filter never duplicates rows, so it needs no \`distinct()\` in the first place. Let \`$casts\` bind booleans rather than comparing a boolean column to \`0\`/\`1\` literals; don't rely on implicit row order or MySQL's loose \`GROUP BY\`. When you must diverge per driver, branch on \`$connection->getDriverName()\`.
- **Postgres aborts the entire transaction on the first failed statement** (\`SQLSTATE 25P02\`, "current transaction is aborted"): every later query in that transaction fails until rollback. So a \`try/catch\` around a DB call *inside* a write transaction is a trap — it swallows the real error while the transaction is already poisoned, and the *next* query is the one that 500s, masking the true cause (find the first exception in \`storage/logs/flarum-*.log\`). Keep best-effort or optional work (notification-recipient lookups, audit logging, analytics) **out** of the write transaction, not merely wrapped in try/catch.
- **Request-scoped state, never static properties** — static request state corrupts under persistent runtimes (FrankenPHP/Swoole/Octane). Read cookies via PSR-7, not \`$_COOKIE\`; set \`Secure\` only on HTTPS.
- **Settings**: \`Extend\\Settings\` with \`->default()\` + \`->serializeToForum()\` (camelCase frontend key); keep server-only settings unserialized. Consider a default-true **kill-switch** setting so the behaviour can be neutralised without disabling the extension.
- **Prefer the model store on the frontend** (\`app.store.find\`/\`createRecord().save()\`) over raw requests, so caching and reactivity work.`,
  },
  i18n: {
    title: "Internationalization",
    body: `- **Every user-facing string is a translation key** across all four layers: frontend (\`app.translator.trans\`/JSX \`tx\`), API exceptions, validation/rate-limit messages, and email blade templates. Inject \`TranslatorInterface\` where needed.
- Namespace keys under \`<vendor>-<ext>.{forum,admin,api}\`; use placeholders (\`{name}\`, \`{count}\`). Ship \`locale/en.yml\` only — other languages are community-contributed.
- **Gotchas**: no angle brackets (\`<tag>\`) in en.yml values (breaks the translator → raw key / blank page); \`user\` is a reserved translator param (use \`{name}\` or a User model + \`{username}\`); keep server-only validation keys out of the frontend bundle.`,
  },
  testing: {
    title: "Testing",
    body: `- Use \`flarum/testing: ^2.0\` (PHPUnit 12). Layout: \`tests/{unit,integration,fixtures}\`, \`tests/integration/setup.php\`, and \`phpunit.unit.xml\` (\`processIsolation="false"\`) + \`phpunit.integration.xml\` (\`processIsolation="true"\`). Keep \`backupGlobals\`/\`backupStaticProperties\` as the docs show. Use PHP 8 attributes (\`#[Test]\`), not docblock annotations.
- **Integration tests are the highest-value coverage**: hit your API endpoints through the middleware stack as different actors (guest / member / staff / admin) to lock in permissions, visibility scoping, create/update/delete, and error codes. They are the automated form of "I tested it on the forum".
- In \`TestCase\`, do all setup — \`extension()\`, \`extend()\`, \`prepareDatabase()\`, \`setting()\` — **before** the app boots (the first \`app()\`/\`send()\`/\`database()\` call boots it; later setup is silently ignored).
- Seed rows in \`prepareDatabase()\` keyed by model class (the harness uses factories), and get ready-made actors from the \`RetrievesAuthorizedUsers\` trait (\`normalUser()\`, admin id 1) so a permissions test is a few lines. Use \`ConsoleTestCase\` for \`Extend\\Console\` commands.
- **Unit tests** for pure logic (validators, permission helpers) via Mockery — mock only the few interactions under test. Needing lots of mocks is a smell to extract smaller functions.
- Frontend logic: Jest via \`@flarum/jest-config\` where it earns its keep.
- **Testing-environment notes**: the test harness defaults to SQLite; point it at MySQL/MariaDB with \`DB_DRIVER\`/\`DB_*\` env vars + \`composer test:setup\` if that matches production. An unauthenticated POST is rejected by Flarum's CSRF guard (HTTP 400) before the auth gate (401) — for "a guest can't write" assert rejection + that nothing was persisted, not a specific status code.
- **The reusable backend CI runs the full database matrix** (MySQL 5.7/8.0, MariaDB, PostgreSQL, SQLite — each with and without a table prefix) across several PHP versions. Passing locally on one database is **not** the same as green: the classic failure is code that works on MySQL but 500s only on Postgres (see Backend → portable queries). If you can't run Postgres/SQLite locally, treat CI as the portability gate; to reproduce a Postgres-only failure, run the suite against a throwaway Postgres container with \`DB_DRIVER=pgsql\` and read the first exception from \`storage/logs/flarum-*.log\`.`,
  },
  "quality-ci": {
    title: "Static analysis, formatting & CI",
    body: `- **PHPStan**: \`flarum/phpstan: ^2.0\`; \`phpstan.neon\` includes \`vendor/flarum/phpstan/extension.neon\`, \`level: 6\`, paths \`extend.php\`+\`src\`, exclude \`*.blade.php\`, \`databaseMigrationsPath: ['migrations']\`. It boots the app for symbol resolution (so it needs the test DB env) and benefits from \`--memory-limit=1G\`.
  - First-run recipe to reach zero: add \`@property\` docblocks to models; declare extended attributes with \`Extend\\Model(...)->cast(...)\`; you cannot narrow an \`object $model\` lifecycle-hook parameter in the signature (PHP contravariance), so add an inline \`/** @var <Model> $model */\` at the top of the body; in a \`scope(Builder $query)\` add \`/** @var \\Illuminate\\Database\\Eloquent\\Builder<<Model>> $query */\` so soft-delete builder methods (\`withTrashed()\`) resolve; type \`$dates\` and notification-blueprint params.
- **Formatting**: Prettier via the shared \`@flarum/prettier-config\` (\`"prettier": "@flarum/prettier-config"\` in package.json) + \`format\`/\`format-check\` scripts. (PHP style is left to PHPStan; no PHP-CS-Fixer.)
- **CI**: reuse the framework workflows instead of hand-rolling. \`.github/workflows/backend.yml\` → \`flarum/framework/.github/workflows/REUSABLE_backend.yml@2.x\` (\`enable_backend_testing: true\`, \`enable_phpstan: true\`). \`.github/workflows/frontend.yml\` → \`REUSABLE_frontend.yml@2.x\` (\`enable_prettier: true\`, \`enable_typescript\` if you ship the typings scripts, \`enable_bundlewatch: false\`, \`js_package_manager\`, \`main_git_branch\`). The frontend workflow builds/commits \`dist\` so it never goes stale.
- Add an \`.editorconfig\` (lf, utf-8, 4-space; 2-space for md/yml).`,
  },
  release: {
    title: "Releasing",
    body: `- A README with a clear description and a LICENSE (MIT or similar for a public extension; \`proprietary\` for a private/site-specific one). Tag releases with SemVer (\`git tag vX.Y.Z\` && \`git push --tags\`); submit once to Packagist, then enable auto-update so future releases are just commit/tag/push.
- **The tag is the release** — Packagist publishes from the git tag, so a commit merely *titled* "Release vX.Y.Z" with no actual tag ships nothing. Cut (and push) the real tag, and a GitHub Release if you announce there. A version bump isn't done until the tag exists on the remote.
- **Write release notes for the people who install the extension** (forum admins), not for developers: describe what the user experiences, in plain language. The release/tag body can serve as the changelog.
- Commit messages: imperative subject; body that explains the root cause, the fix, and how you verified it. Keep them honest about what was and wasn't tested.`,
  },
};

const TOPIC_KEYS = Object.keys(SECTIONS) as [string, ...string[]];

function render(topic?: string): string {
  if (topic && topic !== "all") {
    const s = SECTIONS[topic];
    if (s) return `# ${TITLE}\n\n## ${s.title}\n\n${s.body}\n`;
  }
  const all = Object.values(SECTIONS)
    .map((s) => `## ${s.title}\n\n${s.body}`)
    .join("\n\n");
  return `# ${TITLE}\n\n${INTRO}\n\n${all}\n`;
}

/** Register the static extension-development reference tool. Needs no forum/API key. */
export function registerDevTools(server: McpServer): void {
  server.registerTool(
    "flarum_dev",
    {
      title: "Flarum extension development reference",
      description:
        "A development reference for building or reviewing a Flarum 2.0 extension: scaffolding and " +
        "architecture, composer.json, the TypeScript frontend, backend (API resources/models/migrations), " +
        "i18n, testing, static analysis & CI, and releasing. Combines the conventions the official docs " +
        "establish, the de-facto FriendsOfFlarum standard, and patterns that prevent real production bugs " +
        "(fail-closed API fields, lazy-chunk-safe extends, atomic creation, the PHPStan/testing setup). " +
        "Consult it before scaffolding, when adding a feature, or when reviewing extension code. " +
        "Pair with flarum_docs_search/flarum_docs_get for the authoritative API reference. " +
        "Omit `topic` for the full reference, or pass one to narrow it.",
      inputSchema: {
        topic: z
          .enum([...TOPIC_KEYS, "all"])
          .optional()
          .describe(
            "Section to return: scaffold, composer, frontend, backend, i18n, testing, " +
              "quality-ci, release (or 'all' / omit for the full reference).",
          ),
      },
    },
    async ({ topic }) => ({
      content: [{ type: "text" as const, text: render(topic) }],
    }),
  );
}
