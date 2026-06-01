# Git Curriculo

Monorepo para analise de perfil GitHub e geracao de curriculo ATS personalizado por vaga.

## Stack

- **Web:** Next.js 15 (App Router) + React + Zustand + Tailwind
- **API:** Bun + Elysia (OAuth GitHub, sync, ATS, curriculo, PDF)
- **Desktop:** Tauri 2 (webview Next.js)
- **Pacotes:** `@gitcurriculo/core` (dominio) + `@gitcurriculo/ui` (Atomic Design)

## Rodar localmente

1. Instale dependencias:

```bash
bun install
```

2. Configure OAuth GitHub na API (`apps/api/.env`):

```bash
cp apps/api/.env.example apps/api/.env
```

Preencha `GITHUB_CLIENT_ID` e `GITHUB_CLIENT_SECRET` do [GitHub Developer Settings](https://github.com/settings/developers).

No OAuth App, defina **Authorization callback URL** exatamente como:

```
http://localhost:3000/api/oauth/github/callback
```

(Reinicie `bun run dev:api` apos editar o `.env`.)

3. Suba API e web (terminais separados):

```bash
bun run dev:api
bun run dev:web
```

4. Acesse http://localhost:3000

## Desktop (Tauri)

```bash
bun run dev:desktop
```

Build estatico do Next para Tauri:

```bash
$env:TAURI_BUILD="1"; bun run --filter @gitcurriculo/web build
bun run --filter @gitcurriculo/desktop build
```

## Fluxo principal

1. Login GitHub via popup (`/api/oauth/github/start`)
2. Sync GitHub (local SQLite no browser ou JSON no Tauri)
3. Cole a vaga e gere blueprint ATS + curriculo (DeepSeek obrigatorio)
4. Exporte Markdown ou PDF

## Estrutura

```
apps/
  api/       # Elysia
  web/       # Next.js
  desktop/   # Tauri
packages/
  core/
  ui/
```

## Testes

```bash
bun run test
```
