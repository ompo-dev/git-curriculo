// Self-contained background service worker — ZERO imports, everything inline.
// Any import (even a tiny helper) creates a chunk dependency that Opera GX fails to fetch.

// OAuth credentials injected at build time via Vite env replacement
const GITHUB_CLIENT_ID = (import.meta.env.VITE_GITHUB_CLIENT_ID ?? "").trim();
const GITHUB_CLIENT_SECRET = (import.meta.env.VITE_GITHUB_CLIENT_SECRET ?? "").trim();

const MSG = {
  AUTH_GITHUB_LOGIN_REQUEST: "AUTH_GITHUB_LOGIN_REQUEST",
} as const;

interface LoginPayload {
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
}

function buildAuthorizeUrl(clientId: string, scopes: string[], redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(" "),
    state,
    prompt: "select_account",
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

function extractCode(callbackUrl: string): { code: string | null; state: string | null; error: string | null } {
  try {
    const url = new URL(callbackUrl);
    return {
      code: url.searchParams.get("code"),
      state: url.searchParams.get("state"),
      error: url.searchParams.get("error"),
    };
  } catch {
    return { code: null, state: null, error: "invalid_callback_url" };
  }
}

async function exchangeCodeForToken(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  const data = await res.json() as { access_token?: string; error?: string; error_description?: string };
  if (data.error) throw new Error(data.error_description ?? data.error);
  if (!data.access_token) throw new Error("No access_token in response");
  return data.access_token;
}

async function loginWithGitHub(payload: LoginPayload): Promise<string> {
  const clientId = (payload.clientId ?? GITHUB_CLIENT_ID).trim();
  const clientSecret = (payload.clientSecret ?? GITHUB_CLIENT_SECRET).trim();

  if (!clientId || !clientSecret) {
    throw new Error("OAuth GitHub nao configurado. Defina VITE_GITHUB_CLIENT_ID e VITE_GITHUB_CLIENT_SECRET.");
  }

  const scopes = payload.scopes ?? ["repo", "read:user", "user:email"];
  const redirectUri = chrome.identity.getRedirectURL("github-callback");
  const state = crypto.randomUUID();

  const authorizeUrl = buildAuthorizeUrl(clientId, scopes, redirectUri, state);

  const callbackUrl = await chrome.identity.launchWebAuthFlow({ url: authorizeUrl, interactive: true });
  if (!callbackUrl) throw new Error("Fluxo de autenticacao cancelado.");

  const { code, state: returnedState, error } = extractCode(callbackUrl);
  if (error) throw new Error(error);
  if (returnedState !== state) throw new Error("State OAuth invalido.");
  if (!code) throw new Error("GitHub nao retornou o code de autorizacao.");

  return exchangeCodeForToken(code, clientId, clientSecret, redirectUri);
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("Git Curriculo extension installed.");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== MSG.AUTH_GITHUB_LOGIN_REQUEST) return;

  void loginWithGitHub((message.payload ?? {}) as LoginPayload)
    .then((token) => sendResponse({ ok: true, token }))
    .catch((err: unknown) =>
      sendResponse({ ok: false, error: err instanceof Error ? err.message : "Falha no login." })
    );

  return true; // keep message channel open for async response
});
