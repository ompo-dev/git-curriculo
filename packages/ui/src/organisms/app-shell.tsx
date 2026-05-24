import * as React from "react";
import { Check, Copy, Moon, Puzzle, Sun } from "lucide-react";
import { GitHubMark } from "../icons/github-mark";

export interface AppShellUser {
  login: string;
  name: string | null;
  avatarUrl?: string;
  publicRepos?: number;
  followers?: number;
}

function useTheme() {
  const [theme, setTheme] = React.useState<"dark" | "light">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("gc-theme") as "dark" | "light") ?? "dark";
    }
    return "dark";
  });

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("gc-theme", theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  return { theme, toggle };
}

function Inner({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8 ${className}`}
    >
      {children}
    </div>
  );
}

function getExtManagerUrl(): string {
  if (typeof navigator === "undefined") return "chrome://extensions/";
  const ua = navigator.userAgent;
  if (/OPR|Opera/.test(ua)) return "opera://extensions/";
  if (/Edg\//.test(ua)) return "edge://extensions/";
  if (/Firefox/.test(ua)) return "about:addons";
  return "chrome://extensions/";
}

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function AppShell({
  user,
  extensionUrl,
  extensionDownloadUrl,
  children,
}: {
  user?: AppShellUser;
  extensionUrl?: string;
  extensionDownloadUrl?: string;
  children: React.ReactNode;
}): JSX.Element {
  const { theme, toggle } = useTheme();
  const [showGuide, setShowGuide] = React.useState(false);
  const [downloaded, setDownloaded] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const extMgrUrl = React.useMemo(() => getExtManagerUrl(), []);
  const guideRef = React.useRef<HTMLDivElement>(null);

  // Close guide when clicking outside
  React.useEffect(() => {
    if (!showGuide) return;
    const onDown = (e: MouseEvent) => {
      if (guideRef.current && !guideRef.current.contains(e.target as Node)) {
        setShowGuide(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showGuide]);

  const handleExtClick = (e: React.MouseEvent): void => {
    if (extensionUrl) return;
    e.preventDefault();
    setShowGuide((v) => !v);
  };

  const copyExtUrl = (): void => {
    navigator.clipboard
      .writeText(extMgrUrl)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };

  return (
    <div className="min-h-screen bg-[var(--gc-bg)]">
      <header className="bg-[var(--gc-header)] border-b border-black/20">
        <Inner className="flex items-center gap-3 py-3">
          <div className="flex items-center gap-2 text-white">
            <GitHubMark size={26} className="shrink-0" />
            <span className="hidden text-sm font-semibold sm:inline">
              Git Curriculo
            </span>
          </div>

          <div className="flex-1" />

          {/* Extension button */}
          <div className="relative" ref={guideRef}>
            <a
              href={extensionUrl ?? "#"}
              target={extensionUrl ? "_blank" : undefined}
              rel="noopener noreferrer"
              aria-label="Instalar extensao no navegador"
              onClick={handleExtClick}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Puzzle size={15} />
              <span className="hidden text-xs sm:inline">Extensao</span>
            </a>

            {showGuide ? (
              <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-white/15 bg-[#1c2128] p-3.5 text-xs text-white shadow-2xl">
                <div className="mb-3 flex items-center justify-between gap-2">
                  {downloaded ? (
                    <p className="flex items-center gap-1.5 font-semibold text-green-400">
                      <Check size={13} />
                      Extensao baixada!
                    </p>
                  ) : (
                    <p className="font-semibold text-white/90">
                      Instalar extensao
                    </p>
                  )}
                  {extensionDownloadUrl && (
                    <button
                      onClick={() => {
                        triggerDownload(
                          extensionDownloadUrl,
                          "git-curriculo-extension.zip",
                        );
                        setDownloaded(true);
                      }}
                      className="shrink-0 rounded bg-white/10 px-2 py-0.5 text-[10px] text-white/70 transition-colors hover:bg-white/20 hover:text-white"
                    >
                      {downloaded ? "Baixar novamente" : "Baixar"}
                    </button>
                  )}
                </div>

                <ol className="space-y-3 text-white/75">
                  <li className="flex gap-2">
                    <span className="mt-px shrink-0 font-bold text-white">
                      1.
                    </span>
                    <span>
                      {extensionDownloadUrl ? (
                        <>
                          Aguarde o download do{" "}
                          <code className="rounded bg-white/10 px-1 py-px text-[10px]">
                            .zip
                          </code>{" "}
                          terminar e{" "}
                          <strong className="text-white">extraia</strong> a
                          pasta
                        </>
                      ) : (
                        <span className="italic text-white/50">
                          Extensao em desenvolvimento — download em breve
                        </span>
                      )}
                    </span>
                  </li>

                  <li className="flex gap-2">
                    <span className="mt-px shrink-0 font-bold text-white">
                      2.
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="mb-1">Abra o gerenciador de extensoes:</p>
                      <div className="flex items-center gap-1.5 rounded bg-white/5 px-2 py-1">
                        <code className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-white/90 font-mono">
                          {extMgrUrl}
                        </code>
                        <button
                          onClick={copyExtUrl}
                          title="Copiar URL"
                          className="shrink-0 rounded p-0.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                        >
                          {copied ? (
                            <Check size={11} className="text-green-400" />
                          ) : (
                            <Copy size={11} />
                          )}
                        </button>
                      </div>
                      <p className="mt-1 text-[10px] text-white/40">
                        Cole na barra de endereco do navegador
                      </p>
                    </div>
                  </li>

                  <li className="flex gap-2">
                    <span className="mt-px shrink-0 font-bold text-white">
                      3.
                    </span>
                    <span>
                      Ative o{" "}
                      <strong className="text-white">Modo desenvolvedor</strong>{" "}
                      (canto superior direito)
                    </span>
                  </li>

                  <li className="flex gap-2">
                    <span className="mt-px shrink-0 font-bold text-white">
                      4.
                    </span>
                    <span>
                      Clique em{" "}
                      <strong className="text-white">
                        Carregar sem compactacao
                      </strong>{" "}
                      e selecione a pasta extraida do zip
                    </span>
                  </li>
                </ol>

                <button
                  onClick={() => setShowGuide(false)}
                  className="mt-3 text-[10px] text-white/30 transition-colors hover:text-white/60"
                >
                  Fechar
                </button>
              </div>
            ) : null}
          </div>

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
