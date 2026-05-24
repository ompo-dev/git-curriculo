import type { CommitSnapshot, PullRequestSnapshot, RepoAnalysisSummary } from "../schemas";
import { extractKeywords, unique } from "../utils/text";
import { isVanityMetricText } from "../utils/resumeMetrics";

export interface CommitDetailPayload {
  additions: number;
  deletions: number;
  files: string[];
}

export interface PullRequestDetailPayload {
  body: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: string[];
}

export interface AnalyzedCommit extends CommitSnapshot {
  additions?: number;
  deletions?: number;
  filesChanged: string[];
  technologies: string[];
  impactSignals: string[];
  analysisSummary: string;
}

export interface AnalyzedPullRequest extends PullRequestSnapshot {
  body?: string | null;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  labels: string[];
  technologies: string[];
  impactSignals: string[];
  analysisSummary: string;
}

const ARCHITECTURE_PATTERNS: Array<{ signal: string; regex: RegExp }> = [
  { signal: "Microservices", regex: /\bmicro[- ]?services?\b/ },
  { signal: "Monolito", regex: /\bmonolith|monolito\b/ },
  { signal: "Clean Architecture", regex: /\bclean architecture\b/ },
  { signal: "Caching", regex: /\bcache|caching|redis\b/ },
  { signal: "API Design", regex: /\brest|restful|graphql|api\b/ },
  { signal: "CI/CD", regex: /\bci\/cd|github actions|pipeline\b/ },
  { signal: "Testing", regex: /\btest|vitest|jest|playwright|e2e\b/ },
  { signal: "Observabilidade", regex: /\bobservability|sentry|datadog\b/ },
  { signal: "Design System", regex: /\bdesign system|storybook|shadcn|radix\b/ },
  { signal: "Offline-First", regex: /\boffline.?first|indexeddb\b/ },
  { signal: "Server Components", regex: /\bserver components?|rsc\b/ },
  { signal: "Monorepo", regex: /\bmonorepo|turborepo|workspaces\b/ }
];

function extractArchitectureSignals(text: string): string[] {
  const joined = text.toLowerCase();
  return ARCHITECTURE_PATTERNS.filter(item => item.regex.test(joined)).map(item => item.signal);
}

function extractImpactSignals(text: string): string[] {
  const lines = text.split("\n");
  const impactRegex =
    /\b(?:reduz(?:iu|ir|ido)?|aument(?:ou|ar)?|otimiz(?:ou|ar)?|economiz(?:ou|ar)?|improv(?:e|ed)?)\b[\s\S]{0,50}?\b\d{1,4}(?:[.,]\d{1,2})?\s?%/i;
  const percentageRegex = /\b\d{1,4}(?:[.,]\d{1,2})?\s?%/;
  return unique(
    lines
      .map(l => l.trim())
      .filter(l => impactRegex.test(l) || percentageRegex.test(l))
      .map(l => (l.length > 160 ? `${l.slice(0, 157)}...` : l))
  ).slice(0, 6);
}

function inferTechnologies(text: string, files: string[] = []): string[] {
  const fromText = extractKeywords(text);
  const fromFiles = unique(
    files.flatMap(file => {
      const ext = file.split(".").pop()?.toLowerCase() ?? "";
      const map: Record<string, string[]> = {
        ts: ["typescript"],
        tsx: ["typescript", "react"],
        js: ["javascript"],
        jsx: ["javascript", "react"],
        vue: ["vue"],
        py: ["python"],
        go: ["go"],
        rs: ["rust"],
        sql: ["sql"]
      };
      const hints: string[] = [...(map[ext] ?? [])];
      if (file.includes("shadcn")) hints.push("shadcn");
      if (file.includes("tailwind")) hints.push("tailwind");
      if (file.includes("radix")) hints.push("radix");
      if (file.includes("docker")) hints.push("docker");
      if (file.includes("vitest")) hints.push("vitest");
      if (file.includes("playwright")) hints.push("playwright");
      return hints;
    })
  );
  return unique([...fromText, ...fromFiles]).slice(0, 20);
}

function parseConventionalTitle(title: string): { type: string; scope: string; desc: string } {
  const match = title.trim().match(/^(\w+)(?:\(([^)]*)\))?:\s*(.+)$/i);
  if (!match) return { type: "change", scope: "", desc: title.trim() };
  return {
    type: (match[1] ?? "change").toLowerCase(),
    scope: match[2]?.trim() ?? "",
    desc: (match[3] ?? title).trim()
  };
}

export function isMetadataBullet(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length < 20) return true;
  return (
    /^\d+\s+commits?\s+analisa/i.test(normalized) ||
    /^\d+\s+PRs?\s+analisa/i.test(normalized) ||
    /^Stack:/i.test(normalized) ||
    /^Padroes:/i.test(normalized) ||
    /^Impactos:/i.test(normalized) ||
    /commits analisados/i.test(normalized) ||
    /PRs analisados/i.test(normalized) ||
    /com detalhe de arquivos/i.test(normalized) ||
    /\b\d[\d.,]+\s*linhas?\b/i.test(normalized) ||
    /\b\d[\d.,]+\s*arquivos?\s+reorganiz/i.test(normalized) ||
    /\+\d[\d.,]*\/-?\d[\d.,]*\s*linhas/i.test(normalized) ||
    /^Diff:/i.test(normalized) ||
    /merged\)$/i.test(normalized) ||
    /^Projeto .+ com foco em entregas via commits/i.test(normalized)
  );
}

export function isCounterOverview(text: string): boolean {
  const normalized = text.trim();
  return (
    /\d+\s+commits?\s+analisa/i.test(normalized) &&
    (/\d+\s+PRs/i.test(normalized) || /\d+\s+pull requests/i.test(normalized))
  );
}

export function filterSubstantiveBullets(bullets: string[]): string[] {
  return unique(bullets.map(b => b.trim()).filter(b => b.length > 0 && !isMetadataBullet(b)));
}

function formatContributionInsight(
  item: AnalyzedCommit | AnalyzedPullRequest,
  kind: "commit" | "pull_request"
): string {
  const title =
    kind === "commit"
      ? (item as AnalyzedCommit).message.split("\n")[0]?.trim() ?? ""
      : (item as AnalyzedPullRequest).title.trim();
  const body =
    kind === "pull_request" ? ((item as AnalyzedPullRequest).body?.trim() ?? "") : "";
  const summary = item.analysisSummary?.trim() ?? "";

  if (summary && !isMetadataBullet(summary) && summary.length >= 40) {
    return summary;
  }

  const parsed = parseConventionalTitle(title);
  const techs = item.technologies.slice(0, 5).join(", ");
  const impact = item.impactSignals[0];
  const scopeHint = parsed.scope ? ` (${parsed.scope})` : "";

  if (parsed.type === "fix") {
    return `Problema: ${parsed.desc}${scopeHint}. Solução: correção implementada${techs ? ` com ${techs}` : ""}.${impact ? ` Resultado: ${impact}` : ""}`;
  }
  if (parsed.type === "feat") {
    return `Necessidade: ${parsed.desc}${scopeHint}. Solução: funcionalidade entregue${techs ? ` usando ${techs}` : ""}.${impact ? ` Resultado: ${impact}` : ""}`;
  }
  if (parsed.type === "refactor" || parsed.type === "perf") {
    return `Contexto: ${parsed.desc}${scopeHint}. Melhoria: ${parsed.type === "perf" ? "otimização de performance" : "refatoração"}${techs ? ` em ${techs}` : ""}.${impact ? ` Resultado: ${impact}` : ""}`;
  }
  if (body.length > 40) {
    return `Problema/contexto: ${body.slice(0, 160)}. Entrega: ${parsed.desc}${techs ? ` (${techs})` : ""}.`;
  }

  return `Entrega: ${parsed.desc}${techs ? ` — stack: ${techs}` : ""}${impact ? `. Impacto: ${impact}` : ""}`;
}

function scoreContribution(item: AnalyzedCommit | AnalyzedPullRequest): number {
  const isPr = "title" in item;
  let score = 0;
  if (item.analysisSummary && !isMetadataBullet(item.analysisSummary)) score += 30;
  score += item.impactSignals.filter(s => !isVanityMetricText(s)).length * 15;
  score += item.technologies.length * 3;
  if (isPr && (item as AnalyzedPullRequest).mergedAt) score += 20;
  if (isPr && (item as AnalyzedPullRequest).body && (item as AnalyzedPullRequest).body!.length > 80) {
    score += 15;
  }
  return score;
}

export function buildSubstantiveHighlights(
  commits: AnalyzedCommit[],
  pullRequests: AnalyzedPullRequest[]
): string[] {
  const ranked = [
    ...pullRequests.map(pr => ({
      kind: "pull_request" as const,
      item: pr,
      score: scoreContribution(pr)
    })),
    ...commits.map(commit => ({
      kind: "commit" as const,
      item: commit,
      score: scoreContribution(commit)
    }))
  ]
    .sort((a, b) => b.score - a.score)
    .slice(0, 24);

  return filterSubstantiveBullets(
    ranked.map(entry => formatContributionInsight(entry.item, entry.kind === "commit" ? "commit" : "pull_request"))
  ).slice(0, 12);
}

function summarizeCommit(message: string, detail?: CommitDetailPayload): string {
  const headline = message.split("\n")[0]?.trim() ?? message;
  const body = message.split("\n").slice(1).join(" ").trim();
  const parsed = parseConventionalTitle(headline);
  const techArea =
    detail && detail.files.length > 0
      ? ` Arquivos: ${detail.files.slice(0, 3).join(", ")}${detail.files.length > 3 ? "..." : ""}.`
      : "";

  if (parsed.type === "fix") {
    return `Problema: ${parsed.desc}. Solução: correção aplicada.${techArea}${body ? ` ${body.slice(0, 120)}` : ""}`.slice(
      0,
      320
    );
  }
  if (parsed.type === "feat") {
    return `Necessidade: ${parsed.desc}. Solução: feature implementada.${techArea}${body ? ` ${body.slice(0, 120)}` : ""}`.slice(
      0,
      320
    );
  }
  if (parsed.type === "refactor" || parsed.type === "perf") {
    return `Melhoria: ${parsed.desc}.${techArea}${body ? ` ${body.slice(0, 120)}` : ""}`.slice(0, 320);
  }

  if (body.length > 30) {
    return `Contexto: ${body.slice(0, 140)}. Entrega: ${parsed.desc}.${techArea}`.slice(0, 320);
  }

  return `Entrega: ${parsed.desc}.${techArea}`.slice(0, 320);
}

function summarizePullRequest(
  title: string,
  body: string | null | undefined,
  detail?: PullRequestDetailPayload
): string {
  const parsed = parseConventionalTitle(title);
  const bodyText = body?.trim() ?? "";
  const fileHint =
    detail && detail.changedFiles > 0
      ? ` Escopo: ${detail.changedFiles} arquivo(s), +${detail.additions}/-${detail.deletions}.`
      : "";

  if (parsed.type === "fix") {
    return `Problema: ${parsed.desc}. Solução: PR de correção.${fileHint}${bodyText ? ` ${bodyText.slice(0, 160)}` : ""}`.slice(
      0,
      320
    );
  }
  if (parsed.type === "feat") {
    return `Necessidade: ${parsed.desc}. Solução: PR de feature.${fileHint}${bodyText ? ` ${bodyText.slice(0, 160)}` : ""}`.slice(
      0,
      320
    );
  }
  if (bodyText.length > 40) {
    return `Problema/contexto: ${bodyText.slice(0, 180)}. Entrega: ${parsed.desc}.${fileHint}`.slice(0, 320);
  }

  return `Entrega: ${parsed.desc}.${fileHint}`.slice(0, 320);
}

export function analyzeCommit(
  commit: Omit<CommitSnapshot, "repoName"> & { repoName: string },
  detail?: CommitDetailPayload
): AnalyzedCommit {
  const files = detail?.files ?? [];
  const corpus = [commit.message, ...files].join("\n");
  const technologies = inferTechnologies(corpus, files);
  const impactSignals = extractImpactSignals(commit.message);

  return {
    ...commit,
    additions: detail?.additions,
    deletions: detail?.deletions,
    filesChanged: files,
    technologies,
    impactSignals,
    analysisSummary: summarizeCommit(commit.message, detail)
  };
}

export function analyzePullRequest(
  pr: Omit<PullRequestSnapshot, "repoName"> & { repoName: string },
  detail?: PullRequestDetailPayload
): AnalyzedPullRequest {
  const body = detail?.body ?? null;
  const corpus = [pr.title, body ?? ""].join("\n");
  const technologies = inferTechnologies(corpus);
  const impactSignals = extractImpactSignals(corpus);

  return {
    ...pr,
    body,
    additions: detail?.additions,
    deletions: detail?.deletions,
    changedFiles: detail?.changedFiles,
    labels: detail?.labels ?? [],
    technologies,
    impactSignals,
    analysisSummary: summarizePullRequest(pr.title, body, detail)
  };
}

export function buildRepoAnalysisSummary(input: {
  repoName: string;
  commits: AnalyzedCommit[];
  pullRequests: AnalyzedPullRequest[];
  description?: string | null;
}): RepoAnalysisSummary {
  const corpus = [
    input.description ?? "",
    ...input.commits.map(c => c.message),
    ...input.commits.map(c => c.analysisSummary),
    ...input.pullRequests.map(pr => pr.title),
    ...input.pullRequests.map(pr => pr.body ?? ""),
    ...input.pullRequests.map(pr => pr.analysisSummary)
  ].join("\n");

  const technologies = unique([
    ...input.commits.flatMap(c => c.technologies),
    ...input.pullRequests.flatMap(pr => pr.technologies),
    ...inferTechnologies(corpus)
  ]).slice(0, 24);

  const architectureSignals = extractArchitectureSignals(corpus);
  const quantifiedImpacts = unique([
    ...input.commits.flatMap(c => c.impactSignals),
    ...input.pullRequests.flatMap(pr => pr.impactSignals),
    ...extractImpactSignals(corpus)
  ]).slice(0, 12);

  const highlights = buildSubstantiveHighlights(input.commits, input.pullRequests);

  return {
    repoName: input.repoName,
    analyzedAt: new Date().toISOString(),
    technologies,
    architectureSignals,
    quantifiedImpacts,
    highlights,
    engineeringInsights: [],
    keyContributions: [],
    commitCount: input.commits.length,
    pullRequestCount: input.pullRequests.length,
    deepAnalyzedCommits: input.commits.filter(c => c.filesChanged.length > 0).length,
    deepAnalyzedPullRequests: input.pullRequests.filter(pr => (pr.changedFiles ?? 0) > 0 || Boolean(pr.body)).length
  };
}
