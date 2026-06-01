import "./load-env";

import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";

import { env } from "./lib/env";
import { apiRoutes } from "./routes/api";
import { oauthRoutes } from "./routes/oauth";

const app = new Elysia()
  .use(
    cors({
      origin: env.appOrigin,
      credentials: true
    })
  )
  .use(
    swagger({
      path: "/docs",
      documentation: {
        info: { title: "Git Curriculo API", version: "0.2.0" }
      }
    })
  )
  .get("/health", () => ({ ok: true }))
  .use(oauthRoutes)
  .use(apiRoutes);

const isDirectBunEntry =
  typeof Bun !== "undefined" &&
  ((import.meta as ImportMeta & { main?: boolean }).main ?? false) === true;

if (isDirectBunEntry) {
  app.listen(env.port);
  console.log(`[api] running on ${env.apiOrigin}`);
  console.log(`[api] app origin: ${env.appOrigin}`);
  console.log(`[api] oauth callback: ${env.oauthCallbackUrl}`);
  console.log(
    `[api] github oauth: ${env.githubClientId && env.githubClientSecret ? "configured" : "MISSING - check .env (repo root)"}`
  );
}

export type App = typeof app;
export default app;
