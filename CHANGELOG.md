# Changelog

All notable changes to this project are documented here.

## 0.6.2

- `flarum_dev` now guides extensions to be compatible with user text-resize controls from day one. The frontend reference documents the reading-size and UI-scale contract (the `--lr-text-scale` / `--lr-ui-scale` CSS custom properties and the `FontSizer-text` / `FontSizer-ui` opt-in classes used by the Font Sizer extension), framed as a general accessibility pattern that does nothing when no such control is installed. It also warns about the `1em`-versus-`rem` pitfall, so a heading doesn't get accidentally shrunk. Reference content only; no configuration change.

## 0.6.1

- Stronger `flarum_dev` guidance so the AI is less likely to ship an extension with a subtle bug. The reference now covers cross-database portability (Flarum runs on MySQL, MariaDB, PostgreSQL, and SQLite, and the standard CI tests all of them), including the kind of query that passes on MySQL but fails only on PostgreSQL, and how PostgreSQL aborts a whole transaction on the first failed statement. It also adds: explicit permission gating on every endpoint (deny by default), a frontend export-naming pitfall that can break bundles, relabeling notifications that aren't about a discussion, practical test-setup helpers, community-health files for published extensions, and a reminder that the git tag (not a commit titled "Release") is what actually publishes. No configuration change; this is reference content only.

## 0.6.0

- Extension-development reference, built in. A new `flarum_dev` tool gives the AI a curated reference for building or reviewing a Flarum 2.0 extension: scaffolding and architecture, `composer.json`, the TypeScript frontend, backend (API resources/models/migrations), i18n, testing, static analysis & CI, and releasing. It combines the conventions the official docs establish, the de-facto FriendsOfFlarum standard, and patterns that prevent real production bugs (fail-closed API fields, lazy-chunk-safe frontend extends, atomic record creation, the PHPStan and testing setup, and more). Ask for the whole reference or narrow it to one area with a `topic` (scaffold, composer, frontend, backend, i18n, testing, quality-ci, release). It is static guidance that never touches your forum or its key, so it works in any mode, including read-only and without an API key. On by default; turn it off with `FLARUM_DEV=0`.

## 0.5.3

- Fixed: raw API calls made with `flarum_request` that send a body (for example saving a setting like the forum's custom CSS, or any non-standard endpoint that takes a JSON payload) could fail with a server error. The body was being wrapped twice, so the forum rejected it before doing anything. It is now unwrapped correctly, so these writes go through. Everyday actions through the typed tools (creating and editing discussions, posts, users, moderation, and so on) were never affected.

## 0.4.0

- Official Flarum 2.0 docs, built in. The AI can now search and read the official documentation at docs.flarum.org/2.x while it works on your forum, so it can check how a setting, permission, or feature is meant to work before changing anything. Three new tools: `flarum_docs_search` (find the right page), `flarum_docs_get` (read a full page), and `flarum_docs_list` (browse what pages exist). It reads the live documentation, so answers always reflect the current 2.0 docs without any update on your side. These only read the public docs (never your forum or its key), so they work even in read-only mode and without an API key. On by default; turn them off with `FLARUM_DOCS=0`.

## 0.3.0

- Extension management (opt-in). When you set `FLARUM_EXTENSIONS=1` and your forum has the official `flarum/extension-manager` installed, the AI can search Packagist for extensions, check whether one is compatible before installing, install/update/remove extensions, enable or disable them, and run bulk updates, all over the API (the manager runs Composer on the server). It is off by default because installing or removing extensions is far more powerful than ordinary content edits, so it needs an explicit opt-in on top of write mode and an admin key. New tools: `flarum_ext_search`, `flarum_ext_tasks`, `flarum_ext_why_not`, `flarum_ext_install`, `flarum_ext_update`, `flarum_ext_remove`, `flarum_ext_toggle`, `flarum_ext_check_updates`, `flarum_ext_bulk_update`, `flarum_ext_configure_composer`. Long-running installs are handled whether your forum runs jobs in the background (it waits for the result) or inline.

## 0.2.2

- Send a descriptive `User-Agent` (`mcp-for-flarum/<version> (+repo)`) on every request to your forum, overridable with `FLARUM_USER_AGENT`. Forums behind Cloudflare or a WAF often reject requests with a generic/empty user-agent (Cloudflare error 1010) before they reach Flarum; an identifiable UA avoids the default rules and lets admins allowlist the tool by name. Added a "Behind Cloudflare or a WAF" section to the README.

## 0.2.0

Safety and ergonomics for pointing it at real forums.

- Read-only mode (`FLARUM_MODE=read` or `READ_ONLY=1`): refuses every mutating request at the client chokepoint (so even the raw `flarum_request` can't write), and hides the write tools.
- Fail-closed HTTP: binds `127.0.0.1` by default and refuses to expose a non-localhost interface unless `MCP_AUTH_TOKEN` is set.
- Token-friendly output: `flarum_list`/`flarum_search` truncate long fields by default and default to 20 results (max 50); added sparse fieldsets (`fields`) and a `maxFieldChars` control across list/get/search.

## 0.1.0

Initial release.

- Model Context Protocol server for Flarum, covering the whole JSON:API surface.
- Generic tools: `flarum_list`, `flarum_get`, `flarum_create`, `flarum_update`, `flarum_delete`, `flarum_request`.
- Convenience tools: `flarum_whoami`, `flarum_search`, `flarum_create_discussion`, `flarum_reply`.
- Two transports: stdio (default, for local clients via `npx`) and Streamable HTTP (`--http`, for hosting).
- Optional bearer-token auth for the HTTP transport (`MCP_AUTH_TOKEN`).
- Docker image for hosted deployments.
