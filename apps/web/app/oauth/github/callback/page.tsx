import { redirect } from "next/navigation";

/** Redireciona callback legado do GitHub para a rota da API via rewrite Next. */
export default async function LegacyGitHubOAuthCallbackPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") qs.set(key, value);
    else if (Array.isArray(value)) value.forEach((item) => qs.append(key, item));
  }
  const query = qs.toString();
  redirect(`/api/oauth/github/callback${query ? `?${query}` : ""}`);
}
