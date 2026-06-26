# Changelog

All notable changes to this project are documented here.

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
