# Changelog

All notable changes to this project are documented here.

## 0.1.0

Initial release.

- Model Context Protocol server for Flarum, covering the whole JSON:API surface.
- Generic tools: `flarum_list`, `flarum_get`, `flarum_create`, `flarum_update`, `flarum_delete`, `flarum_request`.
- Convenience tools: `flarum_whoami`, `flarum_search`, `flarum_create_discussion`, `flarum_reply`.
- Two transports: stdio (default, for local clients via `npx`) and Streamable HTTP (`--http`, for hosting).
- Optional bearer-token auth for the HTTP transport (`MCP_AUTH_TOKEN`).
- Docker image for hosted deployments.
