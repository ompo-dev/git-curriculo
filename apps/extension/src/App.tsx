import { Moon, Sun, LogOut, ExternalLink, Send, CheckCircle2, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";

import { isGitHubOAuthConfigured } from "./oauthConfig";

const AUTH_GITHUB_LOGIN_REQUEST = "AUTH_GITHUB_LOGIN_REQUEST";
const AUTH_EXPORT_TOKEN = "AUTH_EXPORT_TOKEN";

const WEB_APP_URL = (import.meta.env.VITE_WEB_APP_URL as string | undefined)?.trim() || "http://localhost:5173";
const TOKEN_STORAGE_KEY = "gc_ext_token";

function GitHubMark({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 98 96"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="currentColor"
        d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"
      />
    </svg>
  );
}

function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    return (localStorage.getItem("gc-theme") as "dark" | "light") ?? "dark";
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("gc-theme", theme);
  }, [theme]);
  return { theme, toggle: () => setTheme(t => t === "dark" ? "light" : "dark") };
}

function loadStoredToken(): string {
  try { return localStorage.getItem(TOKEN_STORAGE_KEY) ?? ""; } catch { return ""; }
}

export default function App(): JSX.Element {
  const { theme, toggle } = useTheme();
  const [token, setToken] = useState<string>(loadStoredToken);
  const [githubUser, setGithubUser] = useState<{ login: string; avatarUrl: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setGithubUser(null); return; }
    void fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }
    })
      .then(r => r.ok ? r.json() as Promise<{ login: string; avatar_url: string }> : Promise.reject())
      .then(u => setGithubUser({ login: u.login, avatarUrl: u.avatar_url }))
      .catch(() => {
        try { localStorage.removeItem(TOKEN_STORAGE_KEY); } catch { /* noop */ }
        setToken("");
        setGithubUser(null);
      });
  }, [token]);

  const loginWithGitHub = async (): Promise<void> => {
    if (!isGitHubOAuthConfigured()) {
      setError("Configure VITE_GITHUB_CLIENT_ID e VITE_GITHUB_CLIENT_SECRET no .env da extensao.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await chrome.runtime.sendMessage({
        type: AUTH_GITHUB_LOGIN_REQUEST,
        payload: { scopes: ["repo", "read:user", "user:email"] }
      }) as { ok: boolean; token?: string; error?: string };
      if (!result?.ok || !result.token) throw new Error(result?.error ?? "Login cancelado.");
      try { localStorage.setItem(TOKEN_STORAGE_KEY, result.token); } catch { /* noop */ }
      setToken(result.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha no login.");
    } finally {
      setLoading(false);
    }
  };

  const sendTokenToSite = async (): Promise<void> => {
    if (!token) return;
    setSent(false);
    setError(null);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { type: AUTH_EXPORT_TOKEN, payload: { token } });
        setSent(true);
        setTimeout(() => setSent(false), 3000);
      } else {
        await chrome.tabs.create({ url: WEB_APP_URL });
      }
    } catch {
      await chrome.tabs.create({ url: WEB_APP_URL });
    }
  };

  const logout = (): void => {
    try { localStorage.removeItem(TOKEN_STORAGE_KEY); } catch { /* noop */ }
    setToken("");
    setGithubUser(null);
    setSent(false);
    setError(null);
  };

  const isConnected = !!token && !!githubUser;

  return (
    <div
      className="w-[360px] bg-[var(--gc-bg)] text-[var(--gc-text)]"
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}
    >
      <div className="flex items-center gap-2 border-b border-[var(--gc-border)] bg-[var(--gc-header)] px-4 py-3">
        <GitHubMark size={22} className="shrink-0 text-white" />
        <span className="flex-1 text-sm font-semibold text-white">Git Curriculo</span>
        <button
          onClick={toggle}
          className="flex h-7 w-7 items-center justify-center rounded text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>

      <div className="space-y-4 p-4">
        {isConnected ? (
          <div className="flex items-center gap-3 rounded-lg border border-[var(--gc-border)] bg-[var(--gc-canvas-subtle)] p-3">
            <img
              src={githubUser.avatarUrl}
              alt={githubUser.login}
              className="h-10 w-10 rounded-full border border-[var(--gc-border)]"
            />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-[var(--gc-text-muted)]">Conectado como</p>
              <p className="truncate text-sm font-semibold text-[var(--gc-text)]">@{githubUser.login}</p>
            </div>
            <button
              onClick={logout}
              title="Desconectar"
              className="shrink-0 rounded p-1.5 text-[var(--gc-text-muted)] transition-colors hover:bg-[var(--gc-border)] hover:text-[var(--gc-text)]"
            >
              <LogOut size={14} />
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--gc-border)] p-5 text-center">
            <GitHubMark size={32} className="mx-auto mb-2 text-[var(--gc-text-muted)]" />
            <p className="mb-3 text-xs text-[var(--gc-text-muted)]">
              Conecte sua conta GitHub para usar o Git Curriculo
            </p>
            <button
              onClick={() => void loginWithGitHub()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-md bg-[#24292f] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              {loading
                ? <Loader2 size={14} className="animate-spin" />
                : <GitHubMark size={14} />}
              {loading ? "Conectando..." : "Entrar com GitHub"}
            </button>
          </div>
        )}

        {isConnected && (
          <div className="space-y-2">
            <button
              onClick={() => void sendTokenToSite()}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-[var(--gc-border)] bg-[var(--gc-canvas-subtle)] px-3 py-2 text-sm font-medium text-[var(--gc-text)] transition-colors hover:bg-[var(--gc-btn-default-hover)]"
            >
              {sent
                ? <><CheckCircle2 size={14} className="text-green-500" />Token enviado ao site!</>
                : <><Send size={14} />Enviar token para o site</>}
            </button>
            <button
              onClick={() => chrome.tabs.create({ url: WEB_APP_URL })}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-[var(--gc-accent)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              <ExternalLink size={14} />
              Abrir Git Curriculo
            </button>
          </div>
        )}

        {!isConnected && (
          <button
            onClick={() => chrome.tabs.create({ url: WEB_APP_URL })}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-[var(--gc-border)] bg-[var(--gc-canvas-subtle)] px-3 py-2 text-sm text-[var(--gc-text-muted)] transition-colors hover:text-[var(--gc-text)]"
          >
            <ExternalLink size={13} />
            Abrir Git Curriculo
          </button>
        )}

        {error && (
          <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[11px] text-red-700">
            {error}
          </p>
        )}

        {!isGitHubOAuthConfigured() && (
          <p className="border-t border-[var(--gc-border)] pt-3 text-[10px] text-[var(--gc-text-muted)]">
            OAuth nao configurado — defina{" "}
            <code className="rounded bg-[var(--gc-canvas-subtle)] px-1">VITE_GITHUB_CLIENT_ID</code>{" "}
            no .env para habilitar login direto.
          </p>
        )}
      </div>
    </div>
  );
}
