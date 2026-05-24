export const githubOAuthConfig = {
  clientId: (import.meta.env.VITE_GITHUB_CLIENT_ID ?? "").trim(),
  clientSecret: (import.meta.env.VITE_GITHUB_CLIENT_SECRET ?? "").trim()
};

export const isGitHubOAuthConfigured = (): boolean =>
  githubOAuthConfig.clientId.length > 0 && githubOAuthConfig.clientSecret.length > 0;