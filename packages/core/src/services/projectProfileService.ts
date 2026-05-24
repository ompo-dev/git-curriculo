import type { GitHubProfileSnapshot, ProjectEvidence, RepoAnalysisSummary, RepoSnapshot } from "../schemas";
import { extractKeywords, unique } from "../utils/text";
import { filterMeaningfulImpactSignals, isVanityMetricText } from "../utils/resumeMetrics";
import { formatRepoDossier } from "./repoMegaSummaryService";
import { collectObservedTechnologies } from "./stackInferenceService";

export interface RepoProfile {
  repo: RepoSnapshot;
  repoName: string;
  fullName: string;
  languages: Array<{ language: string; bytes: number; share: number }>;
  commits: GitHubProfileSnapshot["commits"];
  pullRequests: GitHubProfileSnapshot["pullRequests"];
  issues: GitHubProfileSnapshot["issues"];
  technologies: string[];
  architectureSignals: string[];
  quantifiedImpactSignals: string[];
  commitCount: number;
  pullRequestCount: number;
  mergedPullRequestCount: number;
  issueCount: number;
  analysis?: RepoAnalysisSummary;
}

const ARCHITECTURE_PATTERNS: Array<{ signal: string; regex: RegExp }> = [
  { signal: "Microservices", regex: /\bmicro[- ]?services?\b/ },
  { signal: "Monolito", regex: /\bmonolith|monolito\b/ },
  { signal: "Clean Architecture", regex: /\bclean architecture\b/ },
  { signal: "Hexagonal", regex: /\bhexagonal\b/ },
  { signal: "Event-Driven", regex: /\bevent[- ]driven|eventos\b/ },
  { signal: "Caching", regex: /\bcache|caching|redis\b/ },
  { signal: "API Design", regex: /\brest|restful|graphql|api\b/ },
  { signal: "CI/CD", regex: /\bci\/cd|github actions|pipeline\b/ },
  { signal: "Testing", regex: /\btest|vitest|jest|playwright|e2e\b/ },
  { signal: "Observabilidade", regex: /\bobservability|sentry|datadog|logs|metrics|tracing\b/ },
  { signal: "Design System", regex: /\bdesign system|storybook|shadcn|radix\b/ },
  { signal: "Offline-First", regex: /\boffline.?first|indexeddb|service worker\b/ },
  { signal: "Server Components", regex: /\bserver components?|rsc\b/ },
  { signal: "Monorepo", regex: /\bmonorepo|turborepo|workspaces\b/ }
];

function extractArchitectureSignals(lines: string[]): string[] {
  const joined = lines.join(" ").toLowerCase();
  return ARCHITECTURE_PATTERNS.filter(item => item.regex.test(joined)).map(item => item.signal);
}

function extractQuantifiedImpacts(lines: string[]): string[] {
  const impactRegex =
    /\b(?:reduz(?:iu|ir|ido|icao)?|aument(?:ou|ar|ado)?|improv(?:ed|e|ement)?|otimiz(?:ed|ou|ar|acao)?|economiz(?:ou|ar|a)?|decrease(?:d)?|increase(?:d)?|save[ds]?|cut)\b[\s\S]{0,60}?\b\d{1,4}(?:[.,]\d{1,2})?\s?%/i;
  const percentageRegex = /\b\d{1,4}(?:[.,]\d{1,2})?\s?%/;
  const countImpactRegex =
    /\b(?:reduz(?:iu|ir|ido)?|aument(?:ou|ar)?|otimiz(?:ou|ar)?|economiz(?:ou|ar)?)\b[\s\S]{0,40}?\b\d{1,5}\b/i;
  return unique(
    lines
      .map(l => l.trim())
      .filter(l => impactRegex.test(l) || percentageRegex.test(l) || countImpactRegex.test(l))
      .map(l => (l.length > 180 ? `${l.slice(0, 177)}...` : l))
  );
}

function extractTechnicalImpactSignals(lines: string[]): string[] {
  const techImpactPatterns = [
    /\b(?:redis|cache|caching|zustand|indexeddb|offline.?first|websocket|lazy.?load|code.?split|bundle|tt[iy]|lcp|cls|vitest|playwright|docker|monorepo|design.?system|storybook|shadcn|radix|axios|rest|restful|seo|metadata|sentry|datadog|next\.?js|react.?query|tanstack)\b[\s\S]{0,80}/i
  ];
  return unique(
    lines
      .map(l => l.trim())
      .filter(l => techImpactPatterns.some(p => p.test(l)))
      .map(l => (l.length > 180 ? `${l.slice(0, 177)}...` : l))
  );
}

export function buildRepoProfile(
  snapshot: GitHubProfileSnapshot,
  repoName: string
): RepoProfile | null {
  const repo = snapshot.repos.find(r => r.name === repoName);
  if (!repo) return null;

  const commits = snapshot.commits
    .filter(c => c.repoName === repoName)
    .sort((a, b) => new Date(b.committedAt).getTime() - new Date(a.committedAt).getTime());
  const pullRequests = snapshot.pullRequests
    .filter(pr => pr.repoName === repoName)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const issues = snapshot.issues
    .filter(i => i.repoName === repoName)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const repoLanguages = snapshot.languages
    .filter(l => l.repoName === repoName)
    .sort((a, b) => b.bytes - a.bytes);
  const langTotal = repoLanguages.reduce((acc, l) => acc + l.bytes, 0);

  const evidenceLines = unique([
    ...pullRequests.map(pr => pr.title),
    ...commits.map(c => c.message),
    ...issues.map(i => i.title)
  ]);

  const technologies = unique(
    [
      repo.language ?? "",
      ...repoLanguages.map(l => l.language),
      ...commits.flatMap(c => c.technologies ?? []),
      ...pullRequests.flatMap(pr => pr.technologies ?? []),
      ...extractKeywords([repo.description ?? "", ...evidenceLines].join(" "))
    ].filter(Boolean)
  );

  const quantifiedImpactSignals = unique([
    ...filterMeaningfulImpactSignals(extractQuantifiedImpacts(evidenceLines)),
    ...filterMeaningfulImpactSignals(extractTechnicalImpactSignals(evidenceLines)),
    ...commits.flatMap(c => c.impactSignals ?? []),
    ...pullRequests.flatMap(pr => pr.impactSignals ?? [])
  ])
    .filter(s => !isVanityMetricText(s))
    .slice(0, 12);

  const analysis = snapshot.repoAnalyses?.find(item => item.repoName === repoName);

  return {
    repo,
    repoName: repo.name,
    fullName: repo.fullName,
    languages: repoLanguages.map(l => ({
      language: l.language,
      bytes: l.bytes,
      share: langTotal === 0 ? 0 : l.bytes / langTotal
    })),
    commits,
    pullRequests,
    issues,
    technologies: unique([...technologies, ...(analysis?.technologies ?? [])]),
    architectureSignals: unique([
      ...extractArchitectureSignals([repo.description ?? "", ...evidenceLines]),
      ...(analysis?.architectureSignals ?? [])
    ]),
    quantifiedImpactSignals: filterMeaningfulImpactSignals(
      unique([...quantifiedImpactSignals, ...(analysis?.quantifiedImpacts ?? [])])
    ).slice(0, 12),
    commitCount: commits.length,
    pullRequestCount: pullRequests.length,
    mergedPullRequestCount: pullRequests.filter(pr => pr.mergedAt).length,
    issueCount: issues.length,
    analysis
  };
}

export function buildAllProjectEvidence(
  snapshot: GitHubProfileSnapshot,
  options?: { repoNames?: string[] }
): ProjectEvidence[] {
  const repoFilter = options?.repoNames?.length ? new Set(options.repoNames) : null;

  return snapshot.repos
    .filter(repo => !repoFilter || repoFilter.has(repo.name))
    .map(repo => {
      const profile = buildRepoProfile(snapshot, repo.name);
      if (!profile) return null;

      const evidenceLines = unique([
        ...profile.pullRequests.map(pr => pr.title),
        ...profile.commits.map(c => c.message),
        ...profile.issues.map(i => i.title)
      ]).slice(0, 24);

      const analyzedEvidence = unique([
        ...profile.commits
          .map(c => c.analysisSummary?.trim())
          .filter((item): item is string => Boolean(item)),
        ...profile.pullRequests
          .map(pr => pr.analysisSummary?.trim())
          .filter((item): item is string => Boolean(item))
      ]).slice(0, 60);

      return {
        repoName: profile.repoName,
        fullName: profile.fullName,
        summary:
          profile.analysis?.narrative?.trim() ||
          profile.repo.description?.trim() ||
          `Projeto com ${profile.commitCount} commits e ${profile.pullRequestCount} PRs.`,
        technologies: profile.technologies.slice(0, 16),
        architectureSignals: profile.architectureSignals,
        commitCount: profile.commitCount,
        pullRequestCount: profile.pullRequestCount,
        mergedPullRequestCount: profile.mergedPullRequestCount,
        issueCount: profile.issueCount,
        quantifiedImpactSignals: profile.quantifiedImpactSignals,
        evidence: evidenceLines.slice(0, 20),
        engineeringInsights: profile.analysis?.engineeringInsights ?? [],
        analyzedEvidence,
        ...(profile.analysis?.narrative ? { narrative: profile.analysis.narrative } : {}),
        ...(profile.analysis ? { contextDossier: formatRepoDossier(profile.analysis) } : {})
      } satisfies ProjectEvidence;
    })
    .filter((item): item is ProjectEvidence => item !== null)
    .sort((a, b) => {
      const scoreA = a.commitCount + a.pullRequestCount * 2 + a.mergedPullRequestCount * 2;
      const scoreB = b.commitCount + b.pullRequestCount * 2 + b.mergedPullRequestCount * 2;
      return scoreB - scoreA;
    });
}

export function collectSnapshotTechnologies(snapshot: GitHubProfileSnapshot): string[] {
  const fromProjects = unique(buildAllProjectEvidence(snapshot).flatMap(item => item.technologies));
  const observed = collectObservedTechnologies(snapshot);
  return unique([...fromProjects, ...observed]).slice(0, 60);
}
