import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Elysia } from "elysia";

import { env } from "../lib/env";

const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_VERSION = 1;
const OAUTH_BRIDGE_KEY = "git-curriculo:web:oauth-bridge";

type OAuthStatePayload = {
  v: number;
  ts: number;
  nonce: string;
};

const encodeBase64Url = (value: string): string => Buffer.from(value, "utf8").toString("base64url");

const decodeBase64Url = (value: string): string | null => {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
};

const signStatePayload = (payloadBase64Url: string): string =>
  createHmac("sha256", env.githubClientSecret).update(payloadBase64Url).digest("base64url");

const createState = (): string => {
  const payload: OAuthStatePayload = {
    v: STATE_VERSION,
    ts: Date.now(),
    nonce: randomBytes(16).toString("base64url")
  };
  const payloadBase64Url = encodeBase64Url(JSON.stringify(payload));
  const signatureBase64Url = signStatePayload(payloadBase64Url);
  return `${payloadBase64Url}.${signatureBase64Url}`;
};

const validateState = (state: string): boolean => {
  if (!state || !env.githubClientSecret) return false;

  const parts = state.split(".");
  if (parts.length !== 2) return false;

  const payloadBase64Url = parts[0];
  const signatureBase64Url = parts[1];
  if (!payloadBase64Url || !signatureBase64Url) return false;

  const expectedSignatureBase64Url = signStatePayload(payloadBase64Url);

  try {
    const provided = Buffer.from(signatureBase64Url, "base64url");
    const expected = Buffer.from(expectedSignatureBase64Url, "base64url");

    if (provided.length !== expected.length) return false;
    if (!timingSafeEqual(provided, expected)) return false;
  } catch {
    return false;
  }

  const payloadRaw = decodeBase64Url(payloadBase64Url);
  if (!payloadRaw) return false;

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(payloadRaw) as OAuthStatePayload;
  } catch {
    return false;
  }

  if (payload.v !== STATE_VERSION) return false;
  if (!Number.isFinite(payload.ts)) return false;
  if (!payload.nonce || typeof payload.nonce !== "string") return false;

  const ageMs = Date.now() - payload.ts;
  if (ageMs < 0 || ageMs > STATE_TTL_MS) return false;

  return true;
};

const oauthNotConfiguredHtml = `<!doctype html><html><body style="font-family:system-ui;padding:1.5rem">
<h1>OAuth GitHub nao configurado</h1>
<p>Defina <code>GITHUB_CLIENT_ID</code> e <code>GITHUB_CLIENT_SECRET</code> em <code>apps/api/.env</code> e reinicie <code>bun run dev:api</code>.</p>
<p>No GitHub OAuth App, use como callback:<br><code>${env.oauthCallbackUrl}</code></p>
<script>
  (function () {
    var payload = { type: "GITHUB_AUTH_ERROR", error: "OAuth nao configurado na API" };
    try { localStorage.setItem(${JSON.stringify(OAUTH_BRIDGE_KEY)}, JSON.stringify({ ...payload, ts: Date.now() })); } catch {}
    try { window.opener?.postMessage(payload, ${JSON.stringify(env.appOrigin)}); } catch {}
    try { window.parent !== window && window.parent?.postMessage(payload, ${JSON.stringify(env.appOrigin)}); } catch {}
    try { window.close(); } catch {}
  })();
</script>
</body></html>`;

const htmlResponse = (html: string, status = 200): Response =>
  new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });

export const oauthRoutes = new Elysia({ prefix: "/oauth/github" })
  .get("/start", ({ redirect }) => {
    if (!env.githubClientId || !env.githubClientSecret) {
      return htmlResponse(oauthNotConfiguredHtml, 500);
    }

    const redirectUri = env.oauthCallbackUrl;
    const state = createState();

    const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", env.githubClientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("scope", env.githubScopes.join(" "));
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("allow_signup", "true");

    return redirect(authorizeUrl.toString());
  })
  .get("/callback", async ({ query, set }) => {
    const code = String(query.code ?? "");
    const state = String(query.state ?? "");
    const error = String(query.error ?? "");
    const errorDescription = String(query.error_description ?? "");

    if (error) {
      const payload = { type: "GITHUB_AUTH_ERROR", error: errorDescription || error };
      return htmlResponse(
        `<html><body><script>
          (function () {
            var payload = ${JSON.stringify(payload)};
            try { localStorage.setItem(${JSON.stringify(OAUTH_BRIDGE_KEY)}, JSON.stringify({ ...payload, ts: Date.now() })); } catch {}
            try { window.opener?.postMessage(payload, ${JSON.stringify(env.appOrigin)}); } catch {}
            try { window.parent !== window && window.parent?.postMessage(payload, ${JSON.stringify(env.appOrigin)}); } catch {}
            try { window.close(); } catch {}
          })();
        </script>Falha OAuth: ${errorDescription || error}</body></html>`
      );
    }

    if (!code || !validateState(state)) {
      set.status = 400;
      return "Callback OAuth invalido.";
    }

    try {
      const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          client_id: env.githubClientId,
          client_secret: env.githubClientSecret,
          code,
          redirect_uri: env.oauthCallbackUrl
        })
      });

      const tokenData = (await tokenResponse.json()) as {
        access_token?: string;
        error?: string;
        error_description?: string;
      };

      if (!tokenData.access_token) {
        throw new Error(tokenData.error_description ?? tokenData.error ?? "Token ausente");
      }

      const payload = { type: "GITHUB_AUTH_SUCCESS", token: tokenData.access_token };
      return htmlResponse(`<!doctype html><html><body><script>
        (function(){
          var payload = ${JSON.stringify(payload)};
          try { localStorage.setItem(${JSON.stringify(OAUTH_BRIDGE_KEY)}, JSON.stringify({ ...payload, ts: Date.now() })); } catch {}
          try { window.opener?.postMessage(payload, ${JSON.stringify(env.appOrigin)}); } catch {}
          try { window.parent !== window && window.parent?.postMessage(payload, ${JSON.stringify(env.appOrigin)}); } catch {}
          try { window.close(); } catch {}
        })();
      </script>Login concluido. Voce pode fechar esta janela.</body></html>`);
    } catch (oauthError) {
      const message = oauthError instanceof Error ? oauthError.message : "Erro no callback OAuth";
      const payload = { type: "GITHUB_AUTH_ERROR", error: message };
      return htmlResponse(
        `<html><body><script>
          (function () {
            var payload = ${JSON.stringify(payload)};
            try { localStorage.setItem(${JSON.stringify(OAUTH_BRIDGE_KEY)}, JSON.stringify({ ...payload, ts: Date.now() })); } catch {}
            try { window.opener?.postMessage(payload, ${JSON.stringify(env.appOrigin)}); } catch {}
            try { window.parent !== window && window.parent?.postMessage(payload, ${JSON.stringify(env.appOrigin)}); } catch {}
            try { window.close(); } catch {}
          })();
        </script>Erro: ${message}</body></html>`
      );
    }
  });
