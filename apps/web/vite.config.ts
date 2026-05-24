import axios from "axios";
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const DEFAULT_SCOPES = "repo read:user user:email";
const STATE_TTL_MS = 10 * 60 * 1000;
const stateStore = new Map<string, number>();

type OAuthEnv = {
  githubClientId: string;
  githubClientSecret: string;
  githubScopes: string;
};

const createState = (): string => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(18);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
};

const cleanupStates = (): void => {
  const now = Date.now();
  for (const [state, createdAt] of stateStore.entries()) {
    if (now - createdAt > STATE_TTL_MS) {
      stateStore.delete(state);
    }
  }
};

const getRequestOrigin = (req: IncomingMessage): string => {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol =
    typeof forwardedProto === "string" ? forwardedProto.split(",")[0]?.trim() || "http" : "http";
  const host = req.headers.host ?? "localhost:5173";
  return `${protocol}://${host}`;
};

const sendOAuthResult = (
  res: ServerResponse,
  origin: string,
  payload: { type: "GITHUB_AUTH_SUCCESS"; token: string } | { type: "GITHUB_AUTH_ERROR"; error: string },
  statusCode = 200
): void => {
  const encodedPayload = JSON.stringify(payload);
  const encodedOrigin = JSON.stringify(origin);
  const body = `<!doctype html><html><body><script>
    (function(){
      var payload = ${encodedPayload};
      if (window.opener) {
        window.opener.postMessage(payload, ${encodedOrigin});
      }
      window.close();
    })();
  </script>Autenticacao finalizada. Voce pode fechar esta janela.</body></html>`;

  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(body);
};

const handleOAuthStart = (req: IncomingMessage, res: ServerResponse, oauthEnv: OAuthEnv): boolean => {
  if (!req.url) return false;

  const requestUrl = new URL(req.url, getRequestOrigin(req));
  if (requestUrl.pathname !== "/oauth/github/start") return false;

  const { githubClientId, githubClientSecret } = oauthEnv;
  if (!githubClientId || !githubClientSecret) {
    sendOAuthResult(
      res,
      requestUrl.origin,
      {
        type: "GITHUB_AUTH_ERROR",
        error:
          "Configure GITHUB_CLIENT_ID e GITHUB_CLIENT_SECRET em apps/web/.env e reinicie o Vite."
      },
      500
    );
    return true;
  }

  cleanupStates();

  const state = createState();
  stateStore.set(state, Date.now());

  const redirectUri = `${requestUrl.origin}/oauth/github/callback`;
  const scopes = oauthEnv.githubScopes
    .split(" ")
    .map((value) => value.trim())
    .filter(Boolean);

  const authorizeUrl = new URL(GITHUB_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", githubClientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", scopes.join(" "));
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("allow_signup", "true");

  res.statusCode = 302;
  res.setHeader("Location", authorizeUrl.toString());
  res.end();
  return true;
};

const handleOAuthCallback = async (
  req: IncomingMessage,
  res: ServerResponse,
  oauthEnv: OAuthEnv
): Promise<boolean> => {
  if (!req.url) return false;

  const requestUrl = new URL(req.url, getRequestOrigin(req));
  if (requestUrl.pathname !== "/oauth/github/callback") return false;

  const code = requestUrl.searchParams.get("code") ?? "";
  const state = requestUrl.searchParams.get("state") ?? "";
  const error = requestUrl.searchParams.get("error") ?? "";
  const errorDescription = requestUrl.searchParams.get("error_description") ?? "";

  if (error) {
    sendOAuthResult(
      res,
      requestUrl.origin,
      { type: "GITHUB_AUTH_ERROR", error: errorDescription || error },
      400
    );
    return true;
  }

  if (!code || !state || !stateStore.has(state)) {
    sendOAuthResult(
      res,
      requestUrl.origin,
      { type: "GITHUB_AUTH_ERROR", error: "State OAuth invalido ou expirado. Tente novamente." },
      400
    );
    return true;
  }

  stateStore.delete(state);

  const { githubClientId, githubClientSecret } = oauthEnv;
  if (!githubClientId || !githubClientSecret) {
    sendOAuthResult(
      res,
      requestUrl.origin,
      {
        type: "GITHUB_AUTH_ERROR",
        error:
          "Configure GITHUB_CLIENT_ID e GITHUB_CLIENT_SECRET em apps/web/.env e reinicie o Vite."
      },
      500
    );
    return true;
  }

  try {
    const tokenResponse = await axios.post<{
      access_token?: string;
      error?: string;
      error_description?: string;
    }>(
      GITHUB_ACCESS_TOKEN_URL,
      new URLSearchParams({
        client_id: githubClientId,
        client_secret: githubClientSecret,
        code,
        redirect_uri: `${requestUrl.origin}/oauth/github/callback`
      }),
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded"
        },
        timeout: 30_000
      }
    );

    if (!tokenResponse.data.access_token) {
      throw new Error(tokenResponse.data.error_description ?? tokenResponse.data.error ?? "Token ausente");
    }

    sendOAuthResult(res, requestUrl.origin, {
      type: "GITHUB_AUTH_SUCCESS",
      token: tokenResponse.data.access_token
    });
    return true;
  } catch (oauthError) {
    const message = oauthError instanceof Error ? oauthError.message : "Falha na autenticacao GitHub.";
    sendOAuthResult(res, requestUrl.origin, { type: "GITHUB_AUTH_ERROR", error: message }, 500);
    return true;
  }
};

const githubOAuthPlugin = (oauthEnv: OAuthEnv): Plugin => {
  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const requestPath = req.url?.split("?")[0] ?? "";
    if (requestPath !== "/oauth/github/start" && requestPath !== "/oauth/github/callback") {
      next();
      return;
    }

    void (async () => {
      try {
        if (handleOAuthStart(req, res, oauthEnv)) return;
        if (await handleOAuthCallback(req, res, oauthEnv)) return;
        next();
      } catch (unhandledError) {
        const message =
          unhandledError instanceof Error ? unhandledError.message : "Falha inesperada no OAuth GitHub.";
        sendOAuthResult(res, getRequestOrigin(req), { type: "GITHUB_AUTH_ERROR", error: message }, 500);
      }
    })();
  };

  return {
    name: "github-oauth-local",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    }
  };
};

export default defineConfig(({ mode }) => {
  const appDir = fileURLToPath(new URL(".", import.meta.url));
  const appEnv = loadEnv(mode, appDir, "");
  const cwdEnv = loadEnv(mode, process.cwd(), "");
  const oauthEnv: OAuthEnv = {
    githubClientId: (
      process.env.GITHUB_CLIENT_ID ??
      appEnv.GITHUB_CLIENT_ID ??
      cwdEnv.GITHUB_CLIENT_ID ??
      ""
    ).trim(),
    githubClientSecret: (
      process.env.GITHUB_CLIENT_SECRET ??
      appEnv.GITHUB_CLIENT_SECRET ??
      cwdEnv.GITHUB_CLIENT_SECRET ??
      ""
    ).trim(),
    githubScopes: (
      process.env.GITHUB_SCOPES ??
      appEnv.GITHUB_SCOPES ??
      cwdEnv.GITHUB_SCOPES ??
      DEFAULT_SCOPES
    ).trim() || DEFAULT_SCOPES
  };

  return {
    server: {
      port: 5173,
      strictPort: true
    },
    preview: {
      port: 5173,
      strictPort: true
    },
    plugins: [react(), githubOAuthPlugin(oauthEnv)]
  };
});
