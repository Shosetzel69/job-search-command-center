import test from "node:test";
import assert from "node:assert/strict";
import { createClaudeMcpServer } from "../src/mcp.js";

test("Claude MCP server registers the approved tool surface", async () => {
  const server = createClaudeMcpServer({});
  assert.ok(server);
  assert.equal(typeof server.registerTool, "function");
});
