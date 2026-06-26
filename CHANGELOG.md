# Changelog

All notable changes to this project are documented here.

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
