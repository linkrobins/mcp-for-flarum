import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isLocalHost } from "../dist/http.js";

test("isLocalHost recognises local addresses only", () => {
  for (const h of ["127.0.0.1", "localhost", "::1"]) assert.equal(isLocalHost(h), true, h);
  for (const h of ["0.0.0.0", "example.com", "10.0.0.5", ""]) assert.equal(isLocalHost(h), false, h);
});

test("HTTP mode fails closed: refuses non-localhost bind without an auth token", () => {
  const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const env = {
    ...process.env,
    MCP_TRANSPORT: "http",
    HOST: "0.0.0.0",
    FLARUM_URL: "http://forum.test",
    PORT: "0",
  };
  delete env.MCP_AUTH_TOKEN;
  const r = spawnSync(process.execPath, [entry], { env, encoding: "utf8", timeout: 10_000 });
  assert.equal(r.status, 1, `expected exit 1, got ${r.status} (signal ${r.signal})`);
  assert.match(r.stderr, /Refusing to bind/);
});
