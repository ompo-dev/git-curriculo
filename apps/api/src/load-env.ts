import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Carrega apps/api/.env mesmo quando o processo inicia na raiz do monorepo.
 * Deve ser o primeiro import de src/index.ts.
 */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
}

const currentDir =
  (import.meta as ImportMeta & { dir?: string }).dir ??
  (import.meta as ImportMeta & { dirname?: string }).dirname ??
  dirname(fileURLToPath(import.meta.url));

// Prefer raiz do monorepo (.env) e depois fallback para apps/api/.env
// 1) Quando rodando com --cwd apps/api, process.cwd() aponta para apps/api
loadEnvFile(resolve(process.cwd(), ".env"));

// 2) Raiz do monorepo: apps/api/src -> ../../../.env
loadEnvFile(resolve(currentDir, "..", "..", "..", ".env"));

// 3) Fallback legado: apps/api/.env
loadEnvFile(join(currentDir, "..", ".env"));
