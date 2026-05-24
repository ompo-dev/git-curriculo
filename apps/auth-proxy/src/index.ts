import axios from "axios";
import cors from "cors";
import express from "express";
import { randomBytes } from "node:crypto";

const app = express();

const port = Number(process.env.AUTH_PROXY_PORT ?? 8787);
const appOrigin = process.env.APP_ORIGIN ?? "http://localhost:5173";
const authProxyOrigin = process.env.AUTH_PROXY_ORIGIN ?? `http://localhost:${port}`;
const githubClientId = process.env.GITHUB_CLIENT_ID ?? "";
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET ?? "";
const githubScopes = (process.env.GITHUB_SCOPES ?? "repo read:user user:email")
  .split(" ")
  .map((item) => item.trim())
  .filter(Boolean);

const stateStore = new Map<string, number>();

const createState = (): string => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(18);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
};

const cleanupStates = (): void => {
  const now = Date.now();
  for (const [state, createdAt] of stateStore.entries()) {
    if (now - createdAt > 10 * 60 * 1000) {
      stateStore.delete(state);
    }
  }
};

app.use(cors({ origin: appOrigin }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/oauth/github/start", (req, res) => {
  if (!githubClientId || !githubClientSecret) {
    return res.status(500).send("OAuth GitHub nao configurado no auth proxy.");
  }

  cleanupStates();

  const redirectUri = `${authProxyOrigin}/oauth/github/callback`;
  const state = createState();
  stateStore.set(state, Date.now());

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", githubClientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", githubScopes.join(" "));
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("allow_signup", "true");

  const source = req.query.source;
  if (source === "extension") {
    authorizeUrl.searchParams.set("prompt", "select_account");
  }

  return res.redirect(authorizeUrl.toString());
});

app.get("/oauth/github/callback", async (req, res) => {
  const code = String(req.query.code ?? "");
  const state = String(req.query.state ?? "");
  const error = String(req.query.error ?? "");
  const errorDescription = String(req.query.error_description ?? "");

  if (error) {
    return res
      .status(400)
      .send(`<html><body><script>window.opener?.postMessage({type:'GITHUB_AUTH_ERROR',error:${JSON.stringify(errorDescription || error)}}, ${JSON.stringify(appOrigin)});window.close();</script>Falha OAuth: ${errorDescription || error}</body></html>`);
  }

  if (!code || !state || !stateStore.has(state)) {
    return res.status(400).send("Callback OAuth invalido.");
  }

  stateStore.delete(state);

  try {
    const tokenResponse = await axios.post<{
      access_token?: string;
      error?: string;
      error_description?: string;
      token_type?: string;
      scope?: string;
    }>(
      "https://github.com/login/oauth/access_token",
      new URLSearchParams({
        client_id: githubClientId,
        client_secret: githubClientSecret,
        code,
        redirect_uri: `${authProxyOrigin}/oauth/github/callback`
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

    const payload = {
      type: "GITHUB_AUTH_SUCCESS",
      token: tokenResponse.data.access_token
    };

    return res.send(`<!doctype html><html><body><script>
      (function(){
        var payload = ${JSON.stringify(payload)};
        if (window.opener) {
          window.opener.postMessage(payload, ${JSON.stringify(appOrigin)});
        }
        window.close();
      })();
    </script>Login concluido. Voce pode fechar esta janela.</body></html>`);
  } catch (oauthError) {
    const message = oauthError instanceof Error ? oauthError.message : "Erro no callback OAuth";
    return res
      .status(500)
      .send(`<html><body><script>window.opener?.postMessage({type:'GITHUB_AUTH_ERROR',error:${JSON.stringify(message)}}, ${JSON.stringify(appOrigin)});window.close();</script>Erro: ${message}</body></html>`);
  }
});

app.listen(port, () => {
  console.log(`[auth-proxy] running on ${authProxyOrigin}`);
  console.log(`[auth-proxy] app origin: ${appOrigin}`);
});
