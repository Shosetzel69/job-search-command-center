import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";
import { handleRequest, pemToPkcs8 } from "./index.js";

const REPOSITORY = "Shosetzel69/job-search-command-center";
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_RETURN_LINES = 400;
const textEncoder = new TextEncoder();

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlText(value) {
  return base64Url(textEncoder.encode(value));
}

function claudeActor(env) {
  if (!env.CLAUDE_GITHUB_APP_ID || !env.CLAUDE_GITHUB_INSTALLATION_ID || !env.CLAUDE_GITHUB_PRIVATE_KEY) {
    throw new Error("Claude GitHub App credentials are incomplete");
  }
  if ((env.GITHUB_REPOSITORY || REPOSITORY) !== REPOSITORY) {
    throw new Error("Repository allowlist configuration is invalid");
  }
  return {
    appId: env.CLAUDE_GITHUB_APP_ID,
    installationId: env.CLAUDE_GITHUB_INSTALLATION_ID,
    privateKey: env.CLAUDE_GITHUB_PRIVATE_KEY,
    userAgent: "jobsearch-claude-agent",
  };
}

async function signGitHubJwt(actor) {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(actor.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlText(JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(actor.appId) }));
  const unsigned = `${header}.${payload}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, textEncoder.encode(unsigned));
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

async function installationToken(env) {
  const actor = claudeActor(env);
  let jwt;
  try {
    jwt = await signGitHubJwt(actor);
  } catch {
    throw new Error("Claude GitHub App authentication could not be initialized");
  }
  const response = await fetch(`https://api.github.com/app/installations/${actor.installationId}/access_tokens`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": actor.userAgent,
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.token) throw new Error("Claude GitHub App authentication failed");
  return payload.token;
}

function assertClaudeAuthorization() {
  const auth = getMcpAuthContext();
  if (auth?.props?.actor !== "claude") throw new Error("MCP authorization is not valid for Claude");
}

async function callExistingBridge(env, path, method = "GET", body) {
  if (!env.CLAUDE_BRIDGE_TOKEN) throw new Error("Claude bridge credential is not configured");
  const request = new Request(`https://bridge.internal${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.CLAUDE_BRIDGE_TOKEN}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const response = await handleRequest(request, env);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || "Bridge request failed");
  return payload;
}

async function readRepositoryFile(env, path, ref, startLine, endLine) {
  const parts = path.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) throw new Error("Invalid repository path");
  const token = await installationToken(env);
  const encodedPath = parts.map(encodeURIComponent).join("/");
  const url = new URL(`https://api.github.com/repos/${REPOSITORY}/contents/${encodedPath}`);
  url.searchParams.set("ref", ref || "main");
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "jobsearch-claude-agent",
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || "GitHub file read failed");
  if (payload?.type !== "file" || payload?.encoding !== "base64" || typeof payload?.content !== "string") {
    throw new Error("Requested path is not a readable UTF-8 file");
  }
  if (Number(payload.size || 0) > MAX_FILE_BYTES) throw new Error("File is larger than the MCP read limit");

  let text;
  try {
    const binary = atob(payload.content.replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Requested file is not valid UTF-8 text");
  }

  const lines = text.split(/\r?\n/);
  const first = startLine || 1;
  const requestedEnd = endLine || first + MAX_RETURN_LINES - 1;
  const last = Math.min(requestedEnd, first + MAX_RETURN_LINES - 1, lines.length);
  if (first > lines.length) throw new Error("start_line is beyond the end of the file");
  return {
    path,
    ref: ref || "main",
    start_line: first,
    end_line: last,
    total_lines: lines.length,
    truncated: last < lines.length,
    content: lines.slice(first - 1, last).join("\n"),
  };
}

function ok(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function fail(error) {
  const message = error instanceof Error ? error.message : "Unexpected MCP tool error";
  return { content: [{ type: "text", text: message }], isError: true };
}

export function createClaudeMcpServer(env) {
  const server = new McpServer({ name: "Job Search GitHub - Claude", version: "0.2.0" });

  server.registerTool(
    "read_file",
    {
      description: "Read a UTF-8 file from the allowlisted job-search-command-center repository. Read-only.",
      inputSchema: {
        path: z.string().min(1).max(512),
        ref: z.string().min(1).max(128).optional(),
        start_line: z.number().int().positive().optional(),
        end_line: z.number().int().positive().optional(),
      },
    },
    async ({ path, ref, start_line, end_line }) => {
      try {
        assertClaudeAuthorization();
        if (end_line !== undefined && start_line !== undefined && end_line < start_line) throw new Error("end_line must be >= start_line");
        return ok(await readRepositoryFile(env, path, ref, start_line, end_line));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_issue",
    {
      description: "Read one GitHub issue from the allowlisted repository.",
      inputSchema: { issue_number: z.number().int().positive() },
    },
    async ({ issue_number }) => {
      try {
        assertClaudeAuthorization();
        return ok(await callExistingBridge(env, `/v1/issues/${issue_number}`));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "create_issue",
    {
      description: "Create an issue in the allowlisted repository as jobsearch-claude-agent[bot]. The ai-generated label is enforced server-side.",
      inputSchema: {
        title: z.string().min(1).max(256),
        body: z.string().max(60000).optional(),
        labels: z.array(z.string().min(1).max(50)).max(20).optional(),
      },
    },
    async ({ title, body, labels }) => {
      try {
        assertClaudeAuthorization();
        return ok(await callExistingBridge(env, "/v1/issues", "POST", { title, ...(body !== undefined ? { body } : {}), ...(labels !== undefined ? { labels } : {}) }));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "update_issue",
    {
      description: "Update title, body, state or labels of an issue in the allowlisted repository as jobsearch-claude-agent[bot].",
      inputSchema: {
        issue_number: z.number().int().positive(),
        title: z.string().min(1).max(256).optional(),
        body: z.string().max(60000).optional(),
        state: z.enum(["open", "closed"]).optional(),
        labels: z.array(z.string().min(1).max(50)).max(20).optional(),
      },
    },
    async ({ issue_number, ...changes }) => {
      try {
        assertClaudeAuthorization();
        return ok(await callExistingBridge(env, `/v1/issues/${issue_number}`, "PATCH", changes));
      } catch (error) {
        return fail(error);
      }
    },
  );

  return server;
}

export function createClaudeMcpHandler(env) {
  return createMcpHandler(() => createClaudeMcpServer(env));
}
