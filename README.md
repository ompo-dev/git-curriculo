# Git Curriculo MVP

Monorepo local com web app + extensao Chromium para analise de GitHub e geracao de curriculo ATS.

## Stack
- React + Vite
- Axios + Zod + Zustand + nuqs
- Tailwind + componentes em Atomic Design
- SQLite local (`sql.js`) + LocalStorage + Cookies
- Extensao Chromium (opcional para fluxo rapido em sites)

## Rodar localmente
1. `npm install`
2. Configure credenciais OAuth do GitHub para o web app:
   - copie `apps/web/.env.example` para `apps/web/.env`
   - preencha `GITHUB_CLIENT_ID` e `GITHUB_CLIENT_SECRET`
   - (alternativa) defina no terminal:
     - `$env:GITHUB_CLIENT_ID="seu_client_id"`
     - `$env:GITHUB_CLIENT_SECRET="seu_client_secret"`
3. Suba o web app: `npm run dev:web`
4. (Opcional) Suba a extensao: `npm run dev:extension`
5. O web app usa porta fixa `5173` (`strictPort=true`). Se a porta estiver ocupada, libere-a antes de subir.

## Login com GitHub no app web (standalone)
- Clique em `Entrar com GitHub` no web app.
- O app abre popup OAuth na mesma origem do Vite (porta padrao `5173`).
- Apos concluir, o token volta para o app e o sync pode iniciar.

## Geracao de curriculo ATS (dados reais)
- O campo `Contexto sobre voce` e salvo localmente e entra no prompt final.
- O motor usa snapshot GitHub + evidencias por projeto (commits, PRs, issues, linguagens e sinais quantificados em texto).
- Sem `DeepSeek API Key`, a geracao real e bloqueada com erro explicito (nao cai em mock silencioso).

## Extensao (opcional)
- A extensao serve como complemento para fluxo rapido em sites como LinkedIn:
  colar vaga, gerar curriculo e devolver rapidamente.
- Ela nao e dependencia para o login do app web.

## Observacoes de seguranca
- Token GitHub e chave DeepSeek podem ser criptografados localmente com passphrase (AES-GCM + PBKDF2).
- Revogue e regenere qualquer chave exposta em conversa ou log.
