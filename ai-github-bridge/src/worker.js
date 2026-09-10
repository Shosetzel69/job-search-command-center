import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { handleRequest } from "./index.js";
import { createClaudeMcpHandler } from "./mcp.js";
import { handleAuthorization } from "./oauth-handler.js";

const mcpApiHandler = {
  fetch(request, env, ctx) {
    return createClaudeMcpHandler(env)(request, env, ctx);
  },
};

const defaultHandler = {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/authorize") return handleAuthorization(request, env);
    return handleRequest(request, env);
  },
};

export default new OAuthProvider({
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  apiRoute: "/mcp",
  apiHandler: mcpApiHandler,
  defaultHandler,
  allowPlainPKCE: false,
  accessTokenTTL: 3600,
  refreshTokenTTL: 2592000,
});
