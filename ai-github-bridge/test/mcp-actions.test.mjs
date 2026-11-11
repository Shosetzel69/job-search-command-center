import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const source = readFileSync(resolve(ROOT, "src/mcp.js"), "utf8");

test("MCP surface exposes no environment deployment dispatch", () => {
  assert.doesNotMatch(source, /dispatch_environment_deploy/);
  assert.doesNotMatch(source, /deploy-environment\.yml/);
  assert.doesNotMatch(source, /actions\/workflows\/.*\/dispatches/);
});
