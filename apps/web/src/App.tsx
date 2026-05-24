import React, { useEffect, useMemo, useRef, useState } from "react";
import { parseAsString, useQueryState } from "nuqs";
import { BookMarked, Check, ChevronDown, ChevronUp, Clipboard, Eye, FileText, GitBranch, GitMerge, GitPullRequest, Lock, Mail, MapPin, RefreshCw, Star, Users } from "lucide-react";
import sqlWasmBrowserUrl from "sql.js/dist/sql-wasm-browser.wasm?url";

import {
  BrowserSqliteStorage,
  DeepSeekResumeProvider,
  LocalStateStorage,
  MESSAGE_CONTRACTS,
  MetricsService,
  ResumeService,
  SecureStorage,
  SyncService,
  extractKeywords,
  normalizeKeyword,
  unique,
  type EncryptedSecret,
  type GitHubProfileSnapshot
} from "@gitcurriculo/core";
import { Button, GitHubLikeDashboardPage, Input, Textarea } from "@gitcurriculo/ui";

import { useAppStore } from "./store/useAppStore";

const AUTH_START_PATH = "/oauth/github/start";
// Chrome Web Store URL — fill in when published
const EXTENSION_INSTALL_URL = "";
// Served from apps/web/public/ — rebuilt by `npm run bundle-extension`
const EXTENSION_DOWNLOAD_URL = "/git-curriculo-extension.zip";
const SESSION_TOKEN_KEY = "git-curriculo:web:session-token";   // sessionStorage: cleared on tab close
const LOCAL_DEEPSEEK_KEY = "git-curriculo:web:deepseek-key";   // localStorage: persists across sessions
const LOCAL_PASSPHRASE_KEY = "git-curriculo:web:passphrase";   // localStorage: persists across sessions
const LOCAL_JOB_TEXT_KEY = "git-curriculo:web:job-text";
const LOCAL_PROFILE_PROMPT_KEY = "git-curriculo:web:profile-prompt";
const LOCAL_CUSTOM_RULES_KEY = "git-curriculo:web:custom-rules";

const resolveSecret = async (
  plain: string,
  encrypted: EncryptedSecret | null,
  passphrase: string,
  secureStorage: SecureStorage
): Promise<string> => {
  if (plain.trim().length > 0) return plain.trim();
  if (!encrypted) return "";
  if (!passphrase.trim()) {
    throw new Error("Informe a passphrase para desbloquear credenciais salvas.");
  }
  return secureStorage.decryptSecret(encrypted, passphrase);
};

// Synonym map so "ts" matches "typescript", "k8s" matches "kubernetes", etc.
// Keys and values are normalised (output of normalizeKeyword).
const TECH_SYNONYMS: Record<string, string[]> = {
  javascript: ["js", "ecmascript", "es6", "es2015", "es2020", "es2022", "react", "vue", "angular", "next", "nextjs"],
  typescript: ["ts"],
  react: ["reactjs", "jsx", "tsx", "next", "nextjs"],
  node: ["nodejs"],
  next: ["nextjs"],
  vue: ["vuejs"],
  angular: ["angularjs"],
  postgresql: ["postgres", "pg", "psql"],
  mongodb: ["mongo"],
  kubernetes: ["k8s"],
  docker: ["dockerfile", "container", "containerization"],
  git: ["github", "gitlab", "bitbucket", "versionamento", "repositorio"],
  // HTML is implied by any modern frontend framework or templating
  html: ["html5", "react", "reactjs", "jsx", "tsx", "vue", "angular", "next", "nextjs", "handlebars", "ejs", "pug"],
  // CSS is implied by any styling framework/tool
  css: ["css3", "sass", "scss", "stylus", "tailwind", "tailwindcss", "tachyons", "styled-components", "emotion"],
  // Tachyons is a utility-first CSS framework — equivalent to Tailwind/SCSS proficiency
  tachyons: ["tailwind", "tailwindcss", "css", "sass", "scss", "styled-components"],
  python: ["py", "django", "flask", "fastapi"],
  java: ["spring", "springboot"],
  cicd: ["github actions", "gitlab ci", "jenkins", "travis", "circle ci"],
  api: ["rest", "restful", "graphql", "grpc", "websocket", "webhook"],
  aws: ["amazon web services", "ec2", "s3", "lambda", "cloudfront"],
  gcp: ["google cloud"],
  sql: ["mysql", "sqlite", "mariadb", "mssql"],
  agile: ["scrum", "kanban", "sprint"],
  testing: ["jest", "vitest", "cypress", "playwright", "tdd", "bdd"],
  redis: ["cache", "caching"],
  linux: ["unix", "bash", "shell", "cli"],
};

function skillInText(skill: string, normText: string): boolean {
  if (normText.includes(skill)) return true;
  return (TECH_SYNONYMS[skill] ?? []).some(s => normText.includes(s));
}

// Extracts a broad keyword set from job description text.
function extractBroadKeywords(text: string): string[] {
  const norm = normalizeKeyword(text);
  const tech = extractKeywords(text);

  const extra = (norm.match(
    /\b(?:senior|junior|pleno|lead|lider|architect|engineer|engenheiro|developer|desenvolvedor|front.?end|back.?end|full.?stack|mobile|devops|cloud|agile|scrum|kanban|sprint|ci.?cd|deploy|pipeline|git|api|rest|graphql|microservice|monolito|design.?system|component|pwa|ssr|seo|performance|acessibilidade|accessibility|responsiv|escalabilidade|scalab|observabilidade|monitoring|logging|testing|unit|integration|e2e|refactor|code.?review|docker|container|linux|clean.?code|solid|dry|kiss|tdd|bdd|comunicacao|lideranca|autonomia|proatividade|colaboracao|problem.?solving|qualidade|seguranca)\b/g
  ) ?? []);

  const stopwords = new Set([
    "para","com","que","uma","mais","dos","das","nas","nos","aos","pelo","pela",
    "seus","suas","from","with","and","the","are","will","this","that","our",
    "all","not","can","tem","ser","seu","sua","por","ter","vai","ele","ela",
    "todo","como","sobre","vaga","buscamos","voce","entre","cada","deve","isso",
    "outro","pois","bem","sido","esta","fazer","fica","sempre","muito","tambem",
    "sendo","quando","ainda","mesmo","qual","quem","onde","type","util","area",
  ]);
  const words = norm.match(/\b[a-z][a-z0-9]{3,}\b/g) ?? [];
  const freq = new Map<string, number>();
  for (const w of words) {
    if (!stopwords.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const frequent = [...freq.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([w]) => w);

  return unique([...tech, ...extra, ...frequent]).slice(0, 80);
}

// Dynamic dimension weights based on what the job actually demands.
// Senior/lead role → achievements matter more. Metrics-driven → metrics weight up.
// Many required skills → keyword coverage matters more.
function computeJobWeights(jobFullText: string, requiredCount: number) {
  const j = normalizeKeyword(jobFullText);
  const isSenior = /\b(?:senior|lead|lider|principal|staff|arquiteto|gerente|manager|head|coordenador)\b/.test(j);
  const isMetricsDriven = /\b(?:okr|kpi|conversao|receita|roi|cac|ltv|mrr|reducao|crescimento|resultado|performance)\b/.test(j);
  const manySkills = requiredCount >= 7;
  // Base: kw=40, achieve=25, role=20, struct=15 (sum=100)
  let kw = 40, ach = 25, rol = 20, str = 15;
  if (isSenior)        { ach += 5;  kw  -= 5; }
  if (isMetricsDriven) { ach += 5;  str -= 5; }
  if (manySkills)      { kw  += 5;  rol -= 5; }
  if (str < 10)        { ach -= (10 - str); str = 10; }
  return { kw, ach, rol, str };
}

// ─── Multi-dimensional ATS scoring ────────────────────────────────────────────
// Weights per dimension are dynamic (see computeJobWeights) and sum to 100.
function scoreMarkdownAgainstJob(
  markdownText: string,
  requiredSkills: string[],
  allKeywords: string[],
  jobFullText = ""
): { score: number; matchedKeywords: string[]; missingKeywords: string[]; suggestions: string[]; evidence: string[] } {
  const W = computeJobWeights(jobFullText, requiredSkills.length);
  const norm = normalizeKeyword(markdownText);
  const lines = markdownText.split("\n");
  const bulletLines = lines.filter(l => /^\s*[-*•]/.test(l));

  // ── 1. KEYWORD COVERAGE (W.kw pts) ──────────────────────────────────
  const normRequired = unique(requiredSkills.map(normalizeKeyword));
  const normAll = unique([...normRequired, ...allKeywords.map(normalizeKeyword)]);

  const matchedAll = normAll.filter(kw => skillInText(kw, norm));
  const missingAll = normAll.filter(kw => !skillInText(kw, norm));
  const reqMatched = normRequired.filter(s => skillInText(s, norm));
  const reqCoverage = reqMatched.length / Math.max(normRequired.length, 1);

  const optCount = Math.max(normAll.length - normRequired.length, 0);
  const optMatched = Math.max(matchedAll.length - reqMatched.length, 0);
  const optCoverage = optCount > 0 ? optMatched / optCount : 1;

  const bulletText = normalizeKeyword(bulletLines.join(" "));
  const reqInBullets = normRequired.filter(s => skillInText(s, bulletText)).length;
  const contextRatio = normRequired.length > 0 ? reqInBullets / normRequired.length : 1;

  // Scale sub-weights proportionally to W.kw
  const kwRaw = reqCoverage * (W.kw * 0.625) + optCoverage * (W.kw * 0.25) + contextRatio * (W.kw * 0.125);
  const kwScore = Math.round(kwRaw);

  // ── 2. ACHIEVEMENT QUALITY (W.ach pts) ──────────────────────────────
  // Metrics are a bonus: baseline is W.ach * 0.5 for having detailed bullets; full score at ~50% ratio
  const bulletsWithMetrics = bulletLines.filter(l => /\d+/.test(l));
  const metricRatio = bulletLines.length > 0 ? bulletsWithMetrics.length / bulletLines.length : 0;
  const baselineAch = W.ach * 0.5; // everyone gets 50% for having bullets at all
  const metricBonus = Math.min(W.ach * 0.5, metricRatio * W.ach);
  const achievementScore = bulletLines.length > 0 ? Math.round(baselineAch + metricBonus) : 0;

  // ── 3. ROLE FIT (W.rol pts) ─────────────────────────────────────────
  let roleKwScore = 0;
  if (jobFullText) {
    const jobKws = extractBroadKeywords(jobFullText);
    const jobKwMatched = jobKws.filter(kw => skillInText(normalizeKeyword(kw), norm));
    roleKwScore = Math.round((jobKwMatched.length / Math.max(jobKws.length, 1)) * W.rol);
  } else {
    roleKwScore = Math.round(reqCoverage * W.rol);
  }

  // Seniority is only a bonus — not having it never penalizes (relevant for junior roles)
  const seniorityMatches = (markdownText.match(
    /\b(?:senior|sr\.|lead|lider|principal|staff|arquiteto|architect|tech lead|coordenador|gerente)\b/gi
  ) ?? []).length;
  const seniorityBonus = Math.min(5, seniorityMatches * 2);

  const roleScore = Math.min(W.rol + 5, roleKwScore + seniorityBonus);

  // ── 4. STRUCTURE (W.str pts) ────────────────────────────────────────
  const hasSummary    = /##\s*(?:resumo|summary|perfil|sobre)/i.test(markdownText);
  const hasExperience = /##\s*(?:experi[eê]ncia|experience|historico)/i.test(markdownText);
  const hasSkillsSec  = /##\s*(?:skills|habilidades|tecnologias|competencias|stack)/i.test(markdownText);
  const hasContact    = /(?:@[a-z]|linkedin\.com|github\.com|\(\d{2}\)\s*\d|\+55)/i.test(markdownText);
  const hasProjects   = /##\s*(?:projetos|projects)/i.test(markdownText);
  const hasThirdPerson = /\b(?:desenvolveu|implementou|liderou|criou|otimizou|refatorou|conduziu|melhorou|reduziu|automatizou)\b/i.test(markdownText);

  const sectionPoints = ((hasSummary ? 3 : 0) + (hasExperience ? 3 : 0) + (hasSkillsSec ? 2 : 0)
    + (hasContact ? 3 : 0) + (hasProjects ? 2 : 0)); // max 13 out of 13
  const formatScore = Math.min(W.str, Math.round((sectionPoints / 13) * W.str));

  // ── TOTAL ────────────────────────────────────────────────────────────
  const score = Math.min(100, Math.max(0, kwScore + achievementScore + roleScore + formatScore));

  // ── SUGGESTIONS (ordered by score impact) ────────────────────────────
  const suggestions: string[] = [];
  const reqMissing = normRequired.filter(s => !skillInText(s, norm));
  if (reqMissing.length > 0)
    suggestions.push(`Skills obrigatorias ausentes: ${reqMissing.slice(0, 5).join(", ")}`);
  // Only show optional/extra missing keywords that aren't already listed as required
  const extraMissing = missingAll.filter(k => !reqMissing.includes(k));
  if (extraMissing.length > 0)
    suggestions.push(`Keywords desejadas ausentes: ${extraMissing.slice(0, 4).join(", ")}`);
  if (contextRatio < 0.5 && normRequired.length > 0 && reqMissing.length === 0)
    suggestions.push("Skills da vaga pouco contextualizadas nos bullets de experiencia");
  if (!hasSummary) suggestions.push("Adicione ## Resumo com posicionamento direto para esta vaga");
  if (!hasProjects) suggestions.push("Adicione ## Projetos com projetos relevantes para a vaga");

  // ── EVIDENCE — score breakdown per dimension ─────────────────────────
  const evidence = [
    `Keywords (${kwScore}/${W.kw}): ${reqMatched.length}/${normRequired.length} obrigatorias · ${optMatched}/${optCount} opcionais · ${reqInBullets} em bullets de exp.`,
    `Conquistas (${achievementScore}/${W.ach}): ${bulletsWithMetrics.length}/${bulletLines.length} bullets com metricas`,
    `Aderencia (${roleScore}/${W.rol}): ${roleKwScore} cobertura vocab. vaga · ${seniorityMatches} sinais de senioridade`,
    `Estrutura (${formatScore}/${W.str}): ${[hasSummary && "Resumo", hasExperience && "Exp", hasSkillsSec && "Skills", hasContact && "Contato", hasProjects && "Projetos"].filter(Boolean).join(" · ") || "incompleta"}`,
  ];

  return { score, matchedKeywords: matchedAll, missingKeywords: missingAll.slice(0, 25), suggestions: suggestions.slice(0, 6), evidence };
}

function downloadText(fileName: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function renderInline(text: string): string {
  const S = "color:var(--gc-accent);text-decoration:underline;text-underline-offset:2px";

  function esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  type Pat = { re: RegExp; toHtml: (m: RegExpMatchArray) => string };
  const patterns: Pat[] = [
    // Markdown links [label](url) — must come first so email/url patterns never see the href
    {
      re: /\[([^\]]+)\]\((https?:\/\/[^)]+|mailto:[^)]+)\)/,
      toHtml: m => `<a href="${m[2]!}" target="_blank" rel="noopener noreferrer" style="${S}">${esc(m[1]!)}</a>`
    },
    { re: /\*\*(.+?)\*\*/, toHtml: m => `<strong>${esc(m[1]!)}</strong>` },
    { re: /\*(.+?)\*/, toHtml: m => `<em>${esc(m[1]!)}</em>` },
    { re: /`(.+?)`/, toHtml: m => esc(m[1]!) },
    {
      re: /https?:\/\/[^\s<>"&)]+/,
      toHtml: m => `<a href="${m[0]}" target="_blank" rel="noopener noreferrer" style="${S}">${esc(m[0])}</a>`
    },
    {
      re: /(?:github\.com|linkedin\.com)\/[\w\-./#?=&%]+/,
      toHtml: m => `<a href="https://${m[0]}" target="_blank" rel="noopener noreferrer" style="${S}">${esc(m[0])}</a>`
    },
    {
      re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
      toHtml: m => `<a href="mailto:${m[0]}" style="${S}">${esc(m[0])}</a>`
    },
  ];

  let out = "";
  let rem = text;
  while (rem.length > 0) {
    let best: { index: number; m: RegExpMatchArray; p: Pat } | null = null;
    for (const p of patterns) {
      const m = rem.match(p.re);
      if (m && m.index !== undefined && (!best || m.index < best.index)) {
        best = { index: m.index, m, p };
      }
    }
    if (!best) { out += esc(rem); break; }
    if (best.index > 0) out += esc(rem.slice(0, best.index));
    out += best.p.toHtml(best.m);
    rem = rem.slice(best.index + best.m[0].length);
  }
  return out;
}

function MarkdownPreview({ content }: { content: string }) {
  const lines = content.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.startsWith("# ")) {
      nodes.push(
        <h1 key={i} className="text-xl font-bold text-[var(--gc-text)] mb-0.5 mt-0">
          {line.slice(2)}
        </h1>
      );
    } else if (line.startsWith("## ")) {
      nodes.push(
        <h2 key={i} className="text-[15px] font-bold text-[var(--gc-text)] border-b border-[var(--gc-border)] pb-1 mt-5 mb-2">
          {line.slice(3)}
        </h2>
      );
    } else if (line.startsWith("### ")) {
      nodes.push(
        <h3 key={i} className="text-[12px] font-semibold text-[var(--gc-text)] mt-2.5 mb-0.5">
          {line.slice(4)}
        </h3>
      );
    } else if (/^[-*•] /.test(line)) {
      const bullets: string[] = [];
      while (i < lines.length && /^[-*•] /.test(lines[i] ?? "")) {
        bullets.push((lines[i] ?? "").replace(/^[-*•] /, ""));
        i++;
      }
      nodes.push(
        <ul key={`ul-${i}`} className="my-0.5 space-y-0.5 pl-4">
          {bullets.map((b, j) => (
            <li
              key={j}
              className="text-[12px] text-[var(--gc-text)] leading-snug list-disc marker:text-[var(--gc-text-muted)]"
              dangerouslySetInnerHTML={{ __html: renderInline(b) }}
            />
          ))}
        </ul>
      );
      continue;
    } else if (line.trim()) {
      nodes.push(
        <p
          key={i}
          className="text-[12px] text-[var(--gc-text)] leading-snug mb-0.5"
          dangerouslySetInnerHTML={{ __html: renderInline(line) }}
        />
      );
    } else {
      nodes.push(<div key={i} className="h-1" />);
    }

    i++;
  }

  return (
    <div
      className="font-sans px-6 py-5"
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}
    >
      {nodes}
    </div>
  );
}

export default function App(): JSX.Element {
  const [jobText, setJobText] = useState(() => localStorage.getItem(LOCAL_JOB_TEXT_KEY) ?? "");
  const [profilePrompt, setProfilePrompt] = useState(() => localStorage.getItem(LOCAL_PROFILE_PROMPT_KEY) ?? "");
  const [githubToken, setGithubToken] = useState(() => sessionStorage.getItem(SESSION_TOKEN_KEY) ?? "");
  const [deepseekApiKey, setDeepseekApiKey] = useState(() => localStorage.getItem(LOCAL_DEEPSEEK_KEY) ?? "");
  const [passphrase, setPassphrase] = useState(() => localStorage.getItem(LOCAL_PASSPHRASE_KEY) ?? "");
  const [showSecrets, setShowSecrets] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [customRules, setCustomRules] = useState(() => localStorage.getItem(LOCAL_CUSTOM_RULES_KEY) ?? "");
  const [streamingMarkdown, setStreamingMarkdown] = useState("");
  const [editedMarkdown, setEditedMarkdown] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [copiedMd, setCopiedMd] = useState(false);
  const [previewMode, setPreviewMode] = useState<"raw" | "preview">("raw");
  const [view, setView] = useQueryState("view", parseAsString.withDefault("dashboard"));

  const authPopupRef = useRef<Window | null>(null);
  const popupWatcherRef = useRef<number | null>(null);
  const loginStartedAtRef = useRef<number | null>(null);

  const {
    snapshot,
    metrics,
    ats,
    resume,
    syncStatus,
    loading,
    error,
    setSnapshot,
    setMetrics,
    setAts,
    setResume,
    setSyncStatus,
    setLoading,
    setError
  } = useAppStore();

  const secureStorage = useMemo(() => new SecureStorage(), []);
  const localStateStorage = useMemo(() => new LocalStateStorage(), []);
  const sqliteStorage = useMemo(
    () =>
      new BrowserSqliteStorage({
        locateFile: () => sqlWasmBrowserUrl
      }),
    []
  );
  const syncService = useMemo(() => new SyncService(), []);
  const metricsService = useMemo(() => new MetricsService(), []);

  const clearPopupWatcher = (): void => {
    if (popupWatcherRef.current !== null) {
      window.clearInterval(popupWatcherRef.current);
      popupWatcherRef.current = null;
    }
  };

  useEffect(() => {
    const init = async (): Promise<void> => {
      const settings = localStateStorage.loadSettings();

      // Auto-decrypt encrypted GitHub token using the persisted passphrase (localStorage)
      const currentPassphrase = localStorage.getItem(LOCAL_PASSPHRASE_KEY) ?? "";
      if (currentPassphrase && !sessionStorage.getItem(SESSION_TOKEN_KEY) && settings.githubTokenEncrypted) {
        try {
          const decrypted = await secureStorage.decryptSecret(settings.githubTokenEncrypted, currentPassphrase);
          setGithubToken(decrypted);
          sessionStorage.setItem(SESSION_TOKEN_KEY, decrypted);
        } catch {
          setStatusMessage("Nao foi possivel decriptar o token salvo com a passphrase atual.");
        }
      }

      await sqliteStorage.init();
      const dbSnapshot = await sqliteStorage.getLatestSnapshot();
      if (dbSnapshot) {
        setSnapshot(dbSnapshot);
        setMetrics(
          metricsService.computeProfileMetrics({
            profileSnapshot: dbSnapshot,
            windowMonths: 24
          })
        );
      }

      if (settings.lastSyncAt) setLastSyncAt(settings.lastSyncAt);
    };

    void init();
    return () => clearPopupWatcher();
  }, [
    localStateStorage,
    metricsService,
    secureStorage,
    setMetrics,
    setSnapshot,
    sqliteStorage
  ]);

  useEffect(() => {
    if (githubToken.trim()) {
      sessionStorage.setItem(SESSION_TOKEN_KEY, githubToken);
    } else {
      sessionStorage.removeItem(SESSION_TOKEN_KEY);
    }
  }, [githubToken]);

  useEffect(() => {
    if (deepseekApiKey.trim()) {
      localStorage.setItem(LOCAL_DEEPSEEK_KEY, deepseekApiKey);
    } else {
      localStorage.removeItem(LOCAL_DEEPSEEK_KEY);
    }
  }, [deepseekApiKey]);

  useEffect(() => {
    if (passphrase.trim()) {
      localStorage.setItem(LOCAL_PASSPHRASE_KEY, passphrase);
    } else {
      localStorage.removeItem(LOCAL_PASSPHRASE_KEY);
    }
  }, [passphrase]);

  useEffect(() => {
    localStorage.setItem(LOCAL_JOB_TEXT_KEY, jobText);
  }, [jobText]);

  useEffect(() => {
    localStorage.setItem(LOCAL_PROFILE_PROMPT_KEY, profilePrompt);
  }, [profilePrompt]);

  useEffect(() => {
    localStorage.setItem(LOCAL_CUSTOM_RULES_KEY, customRules);
  }, [customRules]);

  const syncGitHubDataWithToken = async (tokenValue?: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const settings = localStateStorage.loadSettings();
      const token = tokenValue
        ? tokenValue
        : await resolveSecret(githubToken, settings.githubTokenEncrypted, passphrase, secureStorage);

      if (!token) throw new Error("Faca login com GitHub para sincronizar.");

      const since = settings.lastSyncAt ?? undefined;
      setStatusMessage(since ? `Buscando dados novos desde ${new Date(since).toLocaleDateString("pt-BR")}...` : "Sincronizacao inicial (24 meses)...");

      const incrementalSnapshot = await syncService.runManualSync({ token, since });
      const existingSnapshot = snapshot ?? (await sqliteStorage.getLatestSnapshot());
      const finalSnapshot = existingSnapshot
        ? syncService.mergeSnapshots(existingSnapshot, incrementalSnapshot)
        : incrementalSnapshot;

      const profileMetrics = metricsService.computeProfileMetrics({
        profileSnapshot: finalSnapshot,
        windowMonths: 24
      });

      await sqliteStorage.saveSnapshot(finalSnapshot);
      setSnapshot(finalSnapshot);
      setMetrics(profileMetrics);
      setSyncStatus(syncService.getLastSyncStatus());

      const now = new Date().toISOString();
      const updatedSettings = localStateStorage.loadSettings();
      updatedSettings.lastSyncAt = now;
      localStateStorage.saveSettings(updatedSettings);
      setLastSyncAt(now);

      const status = syncService.getLastSyncStatus();
      setStatusMessage(`+${status.syncedCommits} commits, +${status.syncedPullRequests} PRs, +${status.syncedIssues} issues em ${status.syncedRepos} repos atualizados.`);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Erro de sincronizacao.");
      setSyncStatus(syncService.getLastSyncStatus());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handler = (event: MessageEvent<unknown>): void => {
      if (!event.data || typeof event.data !== "object") return;

      const payload = event.data as {
        type?: string;
        token?: string;
        error?: string;
        payload?: { token?: string };
      };

      if (event.origin === window.location.origin) {
        if (payload.type === "GITHUB_AUTH_SUCCESS" && payload.token) {
          clearPopupWatcher();
          authPopupRef.current?.close();
          authPopupRef.current = null;
          loginStartedAtRef.current = null;
          setGithubToken(payload.token);
          setLoading(false);
          setStatusMessage("Login GitHub concluido. Sincronizando automaticamente...");
          void syncGitHubDataWithToken(payload.token);
          return;
        }

        if (payload.type === "GITHUB_AUTH_ERROR") {
          clearPopupWatcher();
          authPopupRef.current?.close();
          authPopupRef.current = null;
          loginStartedAtRef.current = null;
          setLoading(false);
          setError(payload.error ?? "Falha no login com GitHub.");
          return;
        }
      }

      // Optional token bridge from extension.
      if (payload.type === MESSAGE_CONTRACTS.AUTH_EXPORT_TOKEN && payload.payload?.token) {
        setGithubToken(payload.payload.token);
        setStatusMessage("Token recebido da extensao.");
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [setError]);

  const loginWithGitHub = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    const width = 560;
    const height = 720;
    const left = Math.max(0, window.screenX + Math.round((window.outerWidth - width) / 2));
    const top = Math.max(0, window.screenY + Math.round((window.outerHeight - height) / 2));

    const popup = window.open(
      AUTH_START_PATH,
      "github-oauth-login",
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );

    if (!popup) {
      setLoading(false);
      setError("Popup bloqueado pelo navegador. Permita popups para continuar.");
      return;
    }

    authPopupRef.current = popup;
    loginStartedAtRef.current = Date.now();
    setStatusMessage("Popup de login do GitHub aberto...");
    clearPopupWatcher();
    popupWatcherRef.current = window.setInterval(() => {
      if (loginStartedAtRef.current && Date.now() - loginStartedAtRef.current > 90_000) {
        clearPopupWatcher();
        authPopupRef.current?.close();
        authPopupRef.current = null;
        loginStartedAtRef.current = null;
        setLoading(false);
        setError("Tempo limite do login GitHub. Tente novamente.");
        return;
      }

      if (!authPopupRef.current || authPopupRef.current.closed) {
        clearPopupWatcher();
        authPopupRef.current = null;
        loginStartedAtRef.current = null;
        setLoading(false);
      }
    }, 500);
  };

  const persistSecrets = async (): Promise<void> => {
    if (!passphrase) {
      setError("Defina uma passphrase para persistir segredos com criptografia local.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const settings = localStateStorage.loadSettings();
      settings.githubTokenEncrypted = githubToken
        ? await secureStorage.encryptSecret(githubToken, passphrase)
        : settings.githubTokenEncrypted;
      settings.deepseekApiKeyEncrypted = deepseekApiKey
        ? await secureStorage.encryptSecret(deepseekApiKey, passphrase)
        : settings.deepseekApiKeyEncrypted;
      localStateStorage.saveSettings(settings);
      setStatusMessage("Credenciais persistidas com AES-GCM + PBKDF2 no navegador local.");
    } catch (persistError) {
      setError(persistError instanceof Error ? persistError.message : "Falha ao salvar segredos.");
    } finally {
      setLoading(false);
    }
  };

  const clearLocalSecrets = (): void => {
    setGithubToken("");
    setDeepseekApiKey("");
    setPassphrase("");
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    localStorage.removeItem(LOCAL_DEEPSEEK_KEY);
    localStorage.removeItem(LOCAL_PASSPHRASE_KEY);

    const settings = localStateStorage.loadSettings();
    settings.githubTokenEncrypted = null;
    settings.deepseekApiKeyEncrypted = null;
    localStateStorage.saveSettings(settings);
    setStatusMessage("Segredos removidos do estado atual e do armazenamento local.");
  };

  const analyzeAndGenerateResume = async (extraRules?: string): Promise<void> => {
    const isFirstGeneration = !resume; // capture before reset — regeneration keeps current ATS until streaming updates
    setLoading(true);
    setIsStreaming(true);
    setError(null);
    setStreamingMarkdown("");
    setEditedMarkdown("");
    setResume(null);
    if (isFirstGeneration) setAts(null);
    try {
      if (!snapshot || !metrics) {
        throw new Error("Execute a sincronizacao do GitHub antes de gerar curriculo.");
      }
      if (!jobText.trim()) {
        throw new Error("Cole o texto da vaga para gerar analise ATS.");
      }

      const settings = localStateStorage.loadSettings();
      const resolvedDeepseekApiKey = await resolveSecret(
        deepseekApiKey,
        settings.deepseekApiKeyEncrypted,
        passphrase,
        secureStorage
      );
      if (!resolvedDeepseekApiKey) {
        throw new Error(
          "Informe a DeepSeek API Key para gerar curriculo real com base nos seus projetos."
        );
      }

      const resumeService = new ResumeService(
        new DeepSeekResumeProvider({ apiKey: resolvedDeepseekApiKey })
      );

      const jobSpec = resumeService.parseJobText(jobText);

      // Pre-build the keyword pool once so the streaming callback is cheap
      const allAtsKeywords = unique([
        ...jobSpec.requiredSkills,
        ...jobSpec.preferredSkills,
        ...jobSpec.keywords,
        ...extractKeywords(jobSpec.summary),
        ...extractKeywords(jobSpec.responsibilities.join(" "))
      ]).map(normalizeKeyword);

      // Step 1 — initial ATS from GitHub profile only on first generation
      if (isFirstGeneration) {
        const initialAts = metricsService.computeAtsScore({ jobSpec, profileMetrics: metrics });
        setAts(initialAts);
      }

      // Step 2 — stream the resume; update ATS live from the building text
      let lastAtsLen = 0;
      // Auto-rules derived from the job spec — injected on every generation to maximize first-pass quality
      const autoAtsRules = [
        "OTIMIZACAO ATS AUTOMATICA — aplique em toda geracao sem excecao:",
        `Skills obrigatorias da vaga — mencione em bullets de experiencia SOMENTE se o candidato tem experiencia real e comprovada com elas (nao invente): ${jobSpec.requiredSkills.join(", ")}`,
        `Skills desejadas — mencione apenas onde o candidato realmente as utilizou: ${jobSpec.preferredSkills.slice(0, 8).join(", ")}`,
        "Pelo menos 70% dos bullets devem conter numeros concretos derivados de dados reais (commits, PRs, tempo, escala real). PROIBIDO inventar numeros.",
        "Varie a estrutura dos bullets: resultado em destaque, tecnologia em foco, contexto/problema, descricao arquitetural (maximo 35% iniciando com verbo).",
      ].join("\n");

      const generatedResume = await resumeService.streamResume(
        {
          jobSpec,
          profileSnapshot: snapshot,
          profilePrompt,
          customRules: [autoAtsRules, extraRules?.trim(), customRules.trim()].filter(Boolean).join("\n\n") || undefined,
          locale: "pt-BR"
        },
        (accumulated) => {
          setStreamingMarkdown(accumulated);
          // Throttle ATS refresh: recompute every 400 chars to avoid excessive renders
          if (accumulated.length - lastAtsLen >= 400) {
            lastAtsLen = accumulated.length;
            const live = scoreMarkdownAgainstJob(accumulated, jobSpec.requiredSkills, allAtsKeywords, jobText);
            setAts({ ...live, evidence: ["Analise ao vivo — curriculo em construcao..."] });
          }
        }
      );

      // Step 3 — final ATS pass on the complete, clean resume text
      const cleanMd = generatedResume.rawMarkdown ?? "";
      const nonEmptyLines = cleanMd.split("\n").filter(l => l.trim()).length;
      const finalAts = scoreMarkdownAgainstJob(cleanMd, jobSpec.requiredSkills, allAtsKeywords, jobText);
      setAts(finalAts);

      setResume(generatedResume);
      setStreamingMarkdown(cleanMd);
      setEditedMarkdown(cleanMd);
      await sqliteStorage.saveMetrics(new Date().toISOString(), finalAts);
      await sqliteStorage.saveResume(new Date().toISOString(), generatedResume);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Erro ao gerar curriculo.");
    } finally {
      setLoading(false);
      setIsStreaming(false);
    }
  };

  const regenerateWithAts = (): void => {
    if (!ats || !jobText.trim()) return;
    // Snapshot current state — revert if the regeneration produces a worse score
    const scoreFloor = ats.score;
    const markdownFloor = editedMarkdown;
    const atsFloor = ats;
    const svc = new ResumeService();
    const jobSpec = svc.parseJobText(jobText);

    // Parse current dimension scores from evidence to find the actual bottlenecks
    const evConquistas = ats.evidence.find(e => e.includes("bullets com metricas")) ?? "";
    const metricMatch = evConquistas.match(/(\d+)\/(\d+) bullets com metricas/);
    const bulletsWithNums = metricMatch ? parseInt(metricMatch[1]!) : 0;
    const totalBullets   = metricMatch ? parseInt(metricMatch[2]!) : 1;
    const metricPct = Math.round(bulletsWithNums / Math.max(totalBullets, 1) * 100);

    const evRole = ats.evidence.find(e => e.includes("Aderencia")) ?? "";
    const roleNums = evRole.match(/Aderencia \((\d+)\/(\d+)\)/);
    const roleActual = roleNums ? parseInt(roleNums[1]!) : 0;
    const roleMax    = roleNums ? parseInt(roleNums[2]!) : 20;

    const lines: string[] = [
      `=== REESCRITA CIRURGICA PARA MAXIMIZAR ATS — score atual: ${ats.score}/100 ===`,
      `Meta obrigatoria: ${Math.min(100, ats.score + 20)}+ pontos. Aplique TODAS as regras abaixo sem excecao:`,
      "",
    ];
    let n = 1;

    // Gap 1 — Metrics (usually the biggest delta)
    if (metricPct < 65) {
      lines.push(
        `${n++}. METRICAS [impacto maximo no score — PRIORIDADE 1]:`,
        `   Atual: ${metricPct}% (${bulletsWithNums}/${totalBullets} bullets com numeros). Meta: 70%+.`,
        `   Reescreva bullets vagos adicionando numeros REAIS derivados dos dados do perfil (contagem de componentes criados, repos, PRs, tempo economizado estimavel).`,
        `   PROIBIDO inventar percentuais ou volumes sem base nos dados reais fornecidos.`,
        `   Formato: [o que foi feito] com [tecnologia] — resultado em [numero real ou estimavel com base]`,
        "",
      );
    }

    // Gap 2 — Role fit
    if (roleActual < Math.round(roleMax * 0.65)) {
      const responsibilities = jobSpec.responsibilities.slice(0, 5).join(" | ");
      lines.push(
        `${n++}. ADERENCIA A VAGA [gap de ${roleMax - roleActual} pontos]:`,
        `   Use vocabulario direto das responsabilidades do JD em bullets de experiencia.`,
        responsibilities
          ? `   Responsabilidades-chave da vaga: ${responsibilities}`
          : `   Foco da vaga: ${jobSpec.summary.slice(0, 200)}`,
        "",
      );
    }

    // Gap 3 — Missing keywords
    if (ats.missingKeywords.length > 0) {
      lines.push(
        `${n++}. KEYWORDS AUSENTES — inclua organicamente em bullets (NAO apenas na secao Skills):`,
        `   ${ats.missingKeywords.slice(0, 14).join(", ")}`,
        "",
      );
    }

    // Structural gaps
    const structureEv = ats.evidence.find(e => e.includes("Estrutura")) ?? "";
    if (!structureEv.includes("Resumo"))  lines.push(`${n++}. Adicione ## Resumo posicionando explicitamente para esta vaga.`);
    if (!structureEv.includes("Projetos")) lines.push(`${n++}. Adicione ## Projetos destacando 2-3 projetos relevantes para a vaga.`);

    lines.push(
      "",
      `${n}. REGRAS ABSOLUTAS DE INTEGRIDADE:`,
      "   - USE O CURRICULO ATUAL ABAIXO COMO BASE — nao reescreva do zero, apenas edite cirurgicamente",
      "   - Mantenha todas as empresas, datas, cargos e tecnologias reais",
      "   - ZERO invencao de metricas, experiencias ou tecnologias ausentes no perfil",
      "   - Numeros so se derivaveis de dados reais (contagem de componentes, repos, PRs reais)",
      "",
      "=== CURRICULO ATUAL — EDITE ESTE, NAO IGNORE ===",
      editedMarkdown,
      "=== FIM DO CURRICULO ATUAL ==="
    );

    // Use setTimeout(0) to read state after React flushes the generation updates
    void analyzeAndGenerateResume(lines.join("\n")).then(() => {
      setTimeout(() => {
        const newAts = useAppStore.getState().ats;
        if (!newAts || newAts.score < scoreFloor) {
          setEditedMarkdown(markdownFloor);
          setStreamingMarkdown(markdownFloor);
          setAts(atsFloor);
        }
      }, 0);
    });
  };

  const reanalyzeAts = (): void => {
    if (!jobText.trim() || !editedMarkdown) return;
    const svc = new ResumeService();
    const jobSpec = svc.parseJobText(jobText);
    const allKeywords = unique([
      ...jobSpec.requiredSkills,
      ...jobSpec.preferredSkills,
      ...jobSpec.keywords,
      ...extractKeywords(jobSpec.summary),
      ...extractKeywords(jobSpec.responsibilities.join(" "))
    ]).map(normalizeKeyword);
    const result = scoreMarkdownAgainstJob(editedMarkdown, jobSpec.requiredSkills, allKeywords, jobText);
    setAts(result);
  };

  const copyMarkdown = async (): Promise<void> => {
    const content = editedMarkdown || streamingMarkdown || (resume ? new ResumeService().exportMarkdown(resume) : "");
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopiedMd(true);
    setTimeout(() => setCopiedMd(false), 2000);
  };

  const exportPdf = async (): Promise<void> => {
    if (!resume) return;
    const service = new ResumeService();
    // Use editedMarkdown so the PDF mirrors exactly what the user sees in the preview
    const markdown = editedMarkdown || resume.rawMarkdown || service.exportMarkdown(resume);
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yyyy = now.getFullYear();
    const safeName = resume.fullName.replace(/[<>:"/\\|?*]/g, "").trim();
    const parsedTitle = new ResumeService().parseJobText(jobText).title;
    const safeJob = parsedTitle.replace(/[<>:"/\\|?*]/g, "").trim().slice(0, 50);
    const docTitle = `${safeName} - ${safeJob} - ${dd}-${mm}-${yyyy}`;
    const filename = `${docTitle}.pdf`;
    downloadBlob(
      filename,
      await service.exportMarkdownPdf(markdown, {
        title: docTitle,
        author: resume.fullName,
        subject: "Curriculo",
        creator: resume.fullName,
        keywords: resume.atsKeywords.join(", "),
        description: resume.summary.slice(0, 300)
      })
    );
  };

  const isLoggedIn = githubToken.trim().length > 0;

  const LANG_COLORS: Record<string, string> = {
    TypeScript: "#3178c6", JavaScript: "#f1e05a", Python: "#3572a5",
    CSS: "#563d7c", HTML: "#e34c26", Rust: "#dea584", Go: "#00add8",
    Java: "#b07219", "C++": "#f34b7d", "C#": "#178600", Vue: "#41b883",
    Shell: "#89e051", Ruby: "#701516", Swift: "#f05138", Kotlin: "#a97bff",
    Dart: "#00b4ab", PHP: "#4f5d95", Scala: "#c22d40"
  };

  const topLangs = metrics?.topLanguages.slice(0, 5) ?? [];
  const topRepos = snapshot?.repos
    .slice()
    .sort((a, b) => b.stargazersCount - a.stargazersCount)
    .slice(0, 6) ?? [];

  const sidebar = (
    <div className="space-y-4">
      {/* On mobile: avatar + name side by side. On desktop: avatar full-width stacked */}
      <div className="flex items-center gap-4 lg:block lg:space-y-4">
        {snapshot?.user?.avatarUrl ? (
          <img
            src={snapshot.user.avatarUrl}
            alt={snapshot.user.login}
            className="h-16 w-16 shrink-0 rounded-full border border-[var(--gc-border)] sm:h-20 sm:w-20 lg:h-auto lg:w-full"
          />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[var(--gc-canvas-subtle)] text-2xl font-bold text-[var(--gc-text)] sm:h-20 sm:w-20 lg:aspect-square lg:h-auto lg:w-full lg:text-4xl">
            {(snapshot?.user?.login ?? "?").slice(0, 2).toUpperCase()}
          </div>
        )}

        {snapshot?.user ? (
          <div className="min-w-0 flex-1 lg:hidden">
            {snapshot.user.name ? (
              <h1 className="truncate text-base font-semibold text-[var(--gc-text)]">{snapshot.user.name}</h1>
            ) : null}
            <p className="truncate text-sm font-light text-[var(--gc-text-muted)]">{snapshot.user.login}</p>
          </div>
        ) : null}
      </div>

      {snapshot?.user ? (
        <>
          <div className="hidden lg:block">
            {snapshot.user.name ? (
              <h1 className="text-xl font-semibold text-[var(--gc-text)]">{snapshot.user.name}</h1>
            ) : null}
            <p className="text-xl font-light text-[var(--gc-text-muted)]">{snapshot.user.login}</p>
            {snapshot.user.bio ? (
              <p className="mt-2 text-sm text-[var(--gc-text)]">{snapshot.user.bio}</p>
            ) : null}
          </div>
          <div className="lg:hidden">
            {snapshot.user.bio ? (
              <p className="text-sm text-[var(--gc-text)]">{snapshot.user.bio}</p>
            ) : null}
          </div>

          <div className="space-y-1 text-sm text-[var(--gc-text)]">
            {snapshot.user.location ? (
              <div className="flex items-center gap-2">
                <MapPin size={14} className="text-[var(--gc-text-muted)]" />
                <span>{snapshot.user.location}</span>
              </div>
            ) : null}
            {snapshot.user.email ? (
              <div className="flex items-center gap-2">
                <Mail size={14} className="text-[var(--gc-text-muted)]" />
                <span>{snapshot.user.email}</span>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <Users size={14} className="text-[var(--gc-text-muted)]" />
              <span>
                <strong>{snapshot.user.followers}</strong>{" "}
                <span className="text-[var(--gc-text-muted)]">seguidores</span>
                {" · "}
                <strong>{snapshot.user.following}</strong>{" "}
                <span className="text-[var(--gc-text-muted)]">seguindo</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <BookMarked size={14} className="text-[var(--gc-text-muted)]" />
              <strong>{snapshot.user.publicRepos}</strong>{" "}
              <span className="text-[var(--gc-text-muted)]">repositorios publicos</span>
            </div>
          </div>
          <hr className="border-[var(--gc-border)]" />
        </>
      ) : null}

      {/* Credentials */}
      <div>
        <button
          type="button"
          onClick={() => setShowSecrets((v) => !v)}
          className="flex w-full items-center justify-between text-sm font-semibold text-[var(--gc-text)]"
        >
          <span className="flex items-center gap-1.5">
            <Lock size={13} />
            Credenciais
          </span>
          {showSecrets ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {showSecrets ? (
          <div className="mt-3 space-y-2">
            <div>
              <label className="mb-1 block text-xs text-[var(--gc-text-muted)]">DeepSeek API Key</label>
              <Input type="password" autoComplete="off" value={deepseekApiKey} onChange={(e) => setDeepseekApiKey(e.target.value)} placeholder="sk-..." />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--gc-text-muted)]">Passphrase local</label>
              <Input type="password" autoComplete="off" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="Para criptografia local" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--gc-text-muted)]">Token GitHub</label>
              <Input type="password" autoComplete="off" value={githubToken} onChange={(e) => setGithubToken(e.target.value)} placeholder="Preenchido pelo login" />
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => void persistSecrets()} disabled={loading}>Salvar criptografado</Button>
              <Button variant="secondary" size="sm" onClick={clearLocalSecrets} disabled={loading}>Limpar tudo</Button>
            </div>
          </div>
        ) : null}
      </div>

      <hr className="border-[var(--gc-border)]" />

      {/* Sync */}
      <div className="space-y-2">
        <p className="text-xs text-[var(--gc-text-muted)]">
          {lastSyncAt
            ? <>Atualizado em <strong className="text-[var(--gc-text)]">{new Date(lastSyncAt).toLocaleString("pt-BR")}</strong></>
            : "Nenhuma sincronizacao ainda"}
        </p>
        {!isLoggedIn ? (
          <Button className="w-full" size="sm" onClick={() => void loginWithGitHub()} disabled={loading}>
            Entrar com GitHub
          </Button>
        ) : (
          <Button variant="secondary" className="w-full" size="sm" onClick={() => void syncGitHubDataWithToken()} disabled={loading}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            {loading ? "Atualizando..." : lastSyncAt ? "Buscar novidades" : "Sincronizar agora"}
          </Button>
        )}
        {statusMessage ? <p className="text-xs text-[var(--gc-text-muted)]">{statusMessage}</p> : null}
        {error ? <p className="text-xs text-[var(--gc-danger)]">{error}</p> : null}
      </div>
    </div>
  );

  const tabLabels: Record<string, string> = { overview: "Visao geral", curriculo: "Gerar Curriculo" };

  const main = (
    <div>
      {/* Tab nav — GitHub underline style */}
      <div className="border-b border-[var(--gc-border)]">
        <nav className="-mb-px flex">
          {Object.entries(tabLabels).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => void setView(key)}
              className={[
                "flex items-center gap-1.5 border-b-2 px-4 py-3 text-sm transition-colors",
                view === key
                  ? "border-[#fd8c73] font-semibold text-[var(--gc-text)]"
                  : "border-transparent text-[var(--gc-text-muted)] hover:border-[var(--gc-border)] hover:text-[var(--gc-text)]"
              ].join(" ")}
            >
              {label}
              {key === "overview" && snapshot ? (
                <span className="rounded-full bg-[var(--gc-border-muted)] px-2 py-0.5 text-xs font-semibold text-[var(--gc-text-muted)]">
                  {snapshot.repos.length}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-6">
        {view === "curriculo" ? (
          /* ── Gerar Curriculo tab ── */
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-semibold text-[var(--gc-text)]">Contexto sobre voce</label>
              <Textarea
                value={profilePrompt}
                onChange={(e) => setProfilePrompt(e.target.value)}
                placeholder="Senior Frontend, foco em performance, arquitetura de design systems, lideranca tecnica..."
                className="min-h-[80px]"
                disabled={isStreaming}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-[var(--gc-text)]">Texto da vaga</label>
              <Textarea
                value={jobText}
                onChange={(e) => setJobText(e.target.value)}
                placeholder="Cole a descricao completa da vaga aqui..."
                className="min-h-[140px]"
                disabled={isStreaming}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-[var(--gc-text)]">
                Regras e ajustes
                <span className="ml-2 text-xs font-normal text-[var(--gc-text-muted)]">opcional — instrucoes especificas para o modelo</span>
              </label>
              <Textarea
                value={customRules}
                onChange={(e) => setCustomRules(e.target.value)}
                placeholder={"Exemplos:\n- Foque apenas em Front-End, nao mencione Back-End\n- Destaque mais o projeto gymrats\n- Resumo deve ter no maximo 3 linhas\n- Nao mencione a experiencia na Tegma\n- Mencione React 18 e Next.js 14 explicitamente"}
                className="min-h-[90px] font-mono text-xs"
                disabled={isStreaming}
              />
            </div>
            <Button
              onClick={() => void analyzeAndGenerateResume()}
              disabled={loading || !snapshot}
              className="w-full"
            >
              {isStreaming ? (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Gerando curriculo...
                </span>
              ) : "Gerar Curriculo ATS"}
            </Button>

            {/* ATS analysis — updates live during streaming, final pass when complete */}
            {ats ? (
              <div className="rounded-md border border-[var(--gc-border)] bg-[var(--gc-surface)] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--gc-text)]">
                    Analise ATS
                    {isStreaming ? (
                      <span className="flex items-center gap-1 text-[10px] font-normal text-[var(--gc-accent)]">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--gc-accent)]" />
                        atualizando...
                      </span>
                    ) : null}
                  </h3>
                  <span className={[
                    "rounded-full px-3 py-0.5 text-sm font-bold",
                    ats.score >= 70 ? "bg-[var(--gc-badge-success-bg)] text-[var(--gc-badge-success-text)]"
                      : ats.score >= 40 ? "bg-[var(--gc-badge-warning-bg)] text-[var(--gc-badge-warning-text)]"
                      : "bg-[var(--gc-badge-danger-bg)] text-[var(--gc-badge-danger-text)]"
                  ].join(" ")}>
                    Score: {ats.score}/100
                  </span>
                </div>
                {ats.matchedKeywords.length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs text-[var(--gc-text-muted)]">Keywords atendidas</p>
                    <div className="flex flex-wrap gap-1">
                      {ats.matchedKeywords.slice(0, 12).map((kw) => (
                        <span key={kw} className="rounded-full bg-[var(--gc-badge-success-bg)] px-2 py-0.5 text-xs text-[var(--gc-badge-success-text)]">{kw}</span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {ats.missingKeywords.length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs text-[var(--gc-text-muted)]">Lacunas identificadas</p>
                    <div className="flex flex-wrap gap-1">
                      {ats.missingKeywords.slice(0, 10).map((kw) => (
                        <span key={kw} className="rounded-full bg-[var(--gc-badge-danger-bg)] px-2 py-0.5 text-xs text-[var(--gc-badge-danger-text)]">{kw}</span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {ats.suggestions.length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs text-[var(--gc-text-muted)]">Sugestoes</p>
                    <ul className="space-y-1">
                      {ats.suggestions.map((s) => (
                        <li key={s} className="text-xs text-[var(--gc-text)]">· {s}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {ats.evidence.length > 0 ? (
                  <div className="rounded bg-[var(--gc-canvas-subtle)] px-3 py-2">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--gc-text-muted)]">Evidencias</p>
                    <ul className="space-y-0.5">
                      {ats.evidence.map((e) => (
                        <li key={e} className="text-[11px] text-[var(--gc-text-muted)]">• {e}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {!isStreaming && ats.score < 100 ? (
                  <div className="border-t border-[var(--gc-border)] pt-3">
                    <button
                      onClick={regenerateWithAts}
                      disabled={loading}
                      className="flex items-center gap-1.5 rounded-md border border-[var(--gc-border)] bg-[var(--gc-canvas-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--gc-text)] transition-colors hover:bg-[var(--gc-btn-default-hover)] disabled:opacity-40"
                    >
                      <RefreshCw size={12} />
                      Refazer curriculo corrigindo lacunas ATS
                    </button>
                    <p className="mt-1 text-[10px] text-[var(--gc-text-subtle)]">
                      {ats.missingKeywords.length > 0
                        ? `Gera nova versao priorizando as ${ats.missingKeywords.length} palavras-chave ausentes`
                        : "Gera nova versao com foco em melhorar cobertura e especificidade tecnica"}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Streaming / final preview panel */}
            {(streamingMarkdown || editedMarkdown) ? (() => {
              const displayContent = editedMarkdown || streamingMarkdown;
              const estimatedPages = Math.max(1, Math.ceil(
                displayContent.split("\n").filter(l => l.trim()).length / 52
              ));
              return (
                <div className="rounded-md border border-[var(--gc-border)] bg-[var(--gc-surface)]">
                  {/* Toolbar */}
                  <div className="flex items-center gap-2 border-b border-[var(--gc-border)] px-3 py-2">
                    {isStreaming ? (
                      <span className="flex items-center gap-1.5 text-xs text-[var(--gc-accent)]">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--gc-accent)]" />
                        Gerando...
                      </span>
                    ) : (
                      <>
                        <div className="flex overflow-hidden rounded border border-[var(--gc-border)] text-xs">
                          <button
                            onClick={() => setPreviewMode("raw")}
                            className={["flex items-center gap-1 px-2.5 py-1 transition-colors", previewMode === "raw" ? "bg-[var(--gc-btn-default-hover)] font-semibold text-[var(--gc-text)]" : "text-[var(--gc-text-muted)] hover:text-[var(--gc-text)]"].join(" ")}
                          >
                            <FileText size={11} /> Markdown
                          </button>
                          <button
                            onClick={() => setPreviewMode("preview")}
                            className={["flex items-center gap-1 border-l border-[var(--gc-border)] px-2.5 py-1 transition-colors", previewMode === "preview" ? "bg-[var(--gc-btn-default-hover)] font-semibold text-[var(--gc-text)]" : "text-[var(--gc-text-muted)] hover:text-[var(--gc-text)]"].join(" ")}
                          >
                            <Eye size={11} /> Preview
                          </button>
                        </div>
                        <span className="text-[11px] text-[var(--gc-text-subtle)]">
                          ~{estimatedPages} {estimatedPages === 1 ? "pagina" : "paginas"}
                        </span>
                        <div className="ml-auto flex items-center gap-3">
                          {editedMarkdown !== streamingMarkdown ? (
                            <button
                              onClick={reanalyzeAts}
                              className="flex items-center gap-1 text-xs text-[var(--gc-attention)] hover:underline"
                              title="Re-analisar keywords ATS com o texto editado"
                            >
                              <RefreshCw size={11} />
                              Re-analisar ATS
                            </button>
                          ) : null}
                          <button
                            onClick={() => void copyMarkdown()}
                            className="flex items-center gap-1 text-xs text-[var(--gc-accent)] hover:underline"
                          >
                            {copiedMd ? <Check size={12} /> : <Clipboard size={12} />}
                            {copiedMd ? "Copiado!" : "Copiar MD"}
                          </button>
                          <button
                            onClick={() => void exportPdf()}
                            disabled={!resume}
                            className="flex items-center gap-1 text-xs text-[var(--gc-accent)] hover:underline disabled:opacity-40"
                          >
                            Baixar PDF
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  {/* Content */}
                  <div className="max-h-[680px] overflow-y-auto">
                    {isStreaming ? (
                      <pre className="whitespace-pre-wrap px-4 py-4 font-mono text-xs leading-relaxed text-[var(--gc-text)]">
                        {streamingMarkdown}
                        <span className="animate-pulse">▋</span>
                      </pre>
                    ) : previewMode === "preview" ? (
                      <MarkdownPreview content={editedMarkdown} />
                    ) : (
                      <textarea
                        value={editedMarkdown}
                        onChange={(e) => setEditedMarkdown(e.target.value)}
                        spellCheck={false}
                        className="w-full resize-none bg-transparent px-4 py-4 font-mono text-xs leading-relaxed text-[var(--gc-text)] outline-none"
                        style={{ minHeight: "420px" }}
                      />
                    )}
                  </div>
                </div>
              );
            })() : null}
          </div>
        ) : (
          /* ── Overview tab ── */
          <div className="space-y-6">
            {/* Activity summary */}
            {metrics ? (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-[var(--gc-border)] bg-[var(--gc-surface)] px-4 py-3 text-sm">
                <span className="flex items-center gap-1.5 text-[var(--gc-text-muted)]">
                  <GitBranch size={14} />
                  <strong className="text-[var(--gc-text)]">{metrics.totalCommits}</strong> commits
                </span>
                <span className="flex items-center gap-1.5 text-[var(--gc-text-muted)]">
                  <GitPullRequest size={14} />
                  <strong className="text-[var(--gc-text)]">{metrics.totalPullRequests}</strong> PRs
                  <span className="hidden text-xs sm:inline">({metrics.mergedPullRequests} merged)</span>
                </span>
                <span className="flex items-center gap-1.5 text-[var(--gc-text-muted)]">
                  <GitMerge size={14} />
                  <strong className="text-[var(--gc-text)]">{metrics.activeRepos}</strong> repos ativos
                </span>
                <span className="ml-auto text-xs text-[var(--gc-text-muted)]">
                  <span className="hidden sm:inline">ultimos </span>{metrics.windowMonths}m
                </span>
              </div>
            ) : null}

            {/* Language bar */}
            {topLangs.length > 0 ? (
              <div>
                <h2 className="mb-3 text-sm font-semibold text-[var(--gc-text)]">Linguagens</h2>
                <div className="mb-2 flex h-2 w-full overflow-hidden rounded-full">
                  {topLangs.map((lang) => (
                    <div
                      key={lang.language}
                      style={{ width: `${(lang.share * 100).toFixed(1)}%`, backgroundColor: LANG_COLORS[lang.language] ?? "#8b949e" }}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {topLangs.map((lang) => (
                    <span key={lang.language} className="flex items-center gap-1 text-xs text-[var(--gc-text)]">
                      <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: LANG_COLORS[lang.language] ?? "#8b949e" }} />
                      {lang.language}
                      <span className="text-[var(--gc-text-muted)]">{(lang.share * 100).toFixed(1)}%</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Repo cards */}
            {topRepos.length > 0 ? (
              <div>
                <h2 className="mb-3 text-sm font-semibold text-[var(--gc-text)]">Repositorios populares</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {topRepos.map((repo) => (
                    <div key={repo.id} className="flex flex-col gap-2 rounded-md border border-[var(--gc-border)] bg-[var(--gc-surface)] p-4">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-semibold text-[var(--gc-accent)] break-all">{repo.name}</span>
                        <span className="shrink-0 rounded-full border border-[var(--gc-border)] px-2 py-0.5 text-[10px] text-[var(--gc-text-muted)]">
                          {repo.private ? "Private" : "Public"}
                        </span>
                      </div>
                      {repo.description ? (
                        <p className="text-xs text-[var(--gc-text-muted)] line-clamp-2">{repo.description}</p>
                      ) : null}
                      <div className="mt-auto flex items-center gap-3 text-xs text-[var(--gc-text-muted)]">
                        {repo.language ? (
                          <span className="flex items-center gap-1">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: LANG_COLORS[repo.language] ?? "#8b949e" }} />
                            {repo.language}
                          </span>
                        ) : null}
                        {repo.stargazersCount > 0 ? (
                          <span className="flex items-center gap-1"><Star size={11} />{repo.stargazersCount}</span>
                        ) : null}
                        {repo.forksCount > 0 ? (
                          <span className="flex items-center gap-1"><GitBranch size={11} />{repo.forksCount}</span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              !snapshot ? (
                <div className="rounded-md border border-dashed border-[var(--gc-border)] px-8 py-12 text-center">
                  <p className="text-sm text-[var(--gc-text-muted)]">
                    {isLoggedIn ? "Clique em Buscar novidades para carregar seu perfil GitHub." : "Faca login com GitHub para comecar."}
                  </p>
                  {!isLoggedIn ? (
                    <Button className="mt-4" onClick={() => void loginWithGitHub()} disabled={loading}>
                      Entrar com GitHub
                    </Button>
                  ) : null}
                </div>
              ) : null
            )}

            {/* Actions summary */}
            {snapshot?.actions && snapshot.actions.totalRuns > 0 ? (
              <div>
                <h2 className="mb-3 text-sm font-semibold text-[var(--gc-text)]">GitHub Actions</h2>
                <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-md border border-[var(--gc-border)] bg-[var(--gc-surface)] px-4 py-3 text-xs">
                  <span><strong className="text-[var(--gc-text)]">{snapshot.actions.totalRuns}</strong> <span className="text-[var(--gc-text-muted)]">runs</span></span>
                  <span><strong className="text-[var(--gc-success)]">{snapshot.actions.successRuns}</strong> <span className="text-[var(--gc-text-muted)]">success</span></span>
                  <span><strong className="text-[var(--gc-danger)]">{snapshot.actions.failedRuns}</strong> <span className="text-[var(--gc-text-muted)]">failed</span></span>
                  <span><strong className="text-[var(--gc-text-muted)]">{snapshot.actions.cancelledRuns}</strong> <span className="text-[var(--gc-text-muted)]">cancelled</span></span>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <GitHubLikeDashboardPage
      user={snapshot?.user}
      extensionUrl={EXTENSION_INSTALL_URL || undefined}
      extensionDownloadUrl={EXTENSION_DOWNLOAD_URL || undefined}
      sidebar={sidebar}
      main={main}
    />
  );
}
