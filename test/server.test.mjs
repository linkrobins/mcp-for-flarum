import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createMcpServer, SERVER_INSTRUCTIONS } from "../dist/server.js";
import { FlarumClient } from "../dist/flarum-client.js";

// The server-level `instructions` are the strongest server-side lever for
// steering the connected AI toward flarum_dev. They must actually reach the
// client in the initialize response, not just exist as a constant. Guard both
// so a future refactor of the McpServer construction can't silently drop them.

test("SERVER_INSTRUCTIONS directs the AI to flarum_dev and the docs tools", () => {
  assert.ok(SERVER_INSTRUCTIONS.length > 0, "instructions must be non-empty");
  assert.ok(SERVER_INSTRUCTIONS.includes("flarum_dev"), "must point at flarum_dev");
  assert.ok(SERVER_INSTRUCTIONS.includes("flarum_docs"), "must point at the docs tools");
});

test("createMcpServer advertises the instructions over a real connection", async () => {
  const server = createMcpServer(new FlarumClient({ baseUrl: "http://forum.test" }));
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  assert.equal(client.getInstructions(), SERVER_INSTRUCTIONS);

  await client.close();
});
