const appOrigin = process.env.APP_ORIGIN ?? "http://localhost:3000";

export const env = {
  port: Number(process.env.API_PORT ?? process.env.AUTH_PROXY_PORT ?? 8787),
  appOrigin,
  apiOrigin: process.env.API_ORIGIN ?? `http://localhost:${process.env.API_PORT ?? 8787}`,
  /** URL registrada no GitHub OAuth App — deve passar pelo Next (/api → Elysia) */
  oauthCallbackUrl:
    process.env.OAUTH_CALLBACK_URL ?? `${appOrigin.replace(/\/$/, "")}/api/oauth/github/callback`,
  githubClientId: process.env.GITHUB_CLIENT_ID ?? "",
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
  githubScopes: (process.env.GITHUB_SCOPES ?? "repo read:user user:email")
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean)
};
