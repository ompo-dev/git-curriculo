"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { GitHubMark } from "../icons/github-mark";
import { isTauri } from "./runtime-bridge";

export interface AppShellUser {
  login: string;
  name: string | null;
  avatarUrl?: string;
  publicRepos?: number;
  followers?: number;
}

function useTheme() {
  const [theme, setTheme] = React.useState<"dark" | "light">("dark");
  const hydratedRef = React.useRef(false);

  React.useEffect(() => {
    const stored = (localStorage.getItem("gc-theme") as "dark" | "light" | null) ?? "dark";
    hydratedRef.current = true;
    setTheme(stored);
    document.documentElement.setAttribute("data-theme", stored);
  }, []);

  React.useEffect(() => {
    if (!hydratedRef.current) return;
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("gc-theme", theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  return { theme, toggle };
}

function Inner({
  children,
  className = ""
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8 ${className}`}>{children}</div>
  );
}

export function AppShell({
  user,
  children
}: {
  user?: AppShellUser;
  children: React.ReactNode;
}): JSX.Element {
  const { theme, toggle } = useTheme();
  const desktop = typeof window !== "undefined" && isTauri();

  return (
    <div className="min-h-screen bg-[var(--gc-bg)]">
      <header className="border-b border-black/20 bg-[var(--gc-header)]">
        <Inner className="flex items-center gap-3 py-3">
          <div className="flex items-center gap-2 text-white">
            <GitHubMark size={26} className="shrink-0" />
            <span className="hidden text-sm font-semibold sm:inline">Git Curriculo</span>
            {desktop ? (
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/70">
                Desktop
              </span>
            ) : null}
          </div>

          <div className="flex-1" />

          <button
            onClick={toggle}
            aria-label="Toggle theme"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </Inner>
      </header>

      <main>
        <Inner className="py-6">{children}</Inner>
      </main>
    </div>
  );
}
