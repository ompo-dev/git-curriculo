import type {
  IssueSnapshot,
  KeyContribution,
  RepoAnalysisSummary,
  RepoMetricsSnapshot,
  RepoSnapshot
} from "../schemas";
import { unique } from "../utils/text";
import { filterMeaningfulImpactSignals, isVanityMetricText } from "../utils/resumeMetrics";
import type { AnalyzedCommit, AnalyzedPullRequest } from "./repoAnalysisService";
import {
  buildSubstantiveHighlights,
  filterSubstantiveBullets,
  isCounterOverview,
  isMetadataBullet
} from "./repoAnalysisService";

export interface MegaSummaryInput {
  repo: RepoSnapshot;
  commits: AnalyzedCommit[];
  pullRequests: AnalyzedPullRequest[];
  issues: IssueSnapshot[];
  partial?: {
    narrative?: string;
    technologies?: string[];
    architectureSignals?: string[];
    architectureAnalysis?: string;
    quantifiedImpacts?: string[];
    highlights?: string[];
    engineeringInsights?: string[];
  };
}

function scoreCommit(commit: AnalyzedCommit): number {
  return (
    (commit.additions ?? 0) +
    (commit.deletions ?? 0) +
    commit.filesChanged.length * 10 +
    commit.impactSignals.length * 20 +
    (commit.analysisSummary.length > 0 ? 15 : 0)
  );
}

function scorePullRequest(pr: AnalyzedPullRequest): number {
  return (
    (pr.additions ?? 0) +
    (pr.deletions ?? 0) +
    (pr.changedFiles ?? 0) * 10 +
    pr.impactSignals.length * 20 +
    (pr.mergedAt ? 25 : 0) +
    (pr.analysisSummary.length > 0 ? 15 : 0)
  );
}

export function computeRepoMetrics(input: {
  commits: AnalyzedCommit[];
  pullRequests: AnalyzedPullRequest[];
  issues: IssueSnapshot[];
}): RepoMetricsSnapshot {
  const linesAdded =
    input.commits.reduce((acc, c) => acc + (c.additions ?? 0), 0) +
    input.pullRequests.reduce((acc, pr) => acc + (pr.additions ?? 0), 0);
  const linesDeleted =
    input.commits.reduce((acc, c) => acc + (c.deletions ?? 0), 0) +
    input.pullRequests.reduce((acc, pr) => acc + (pr.deletions ?? 0), 0);
  const filesTouched = unique(
    input.commits.flatMap(c => c.filesChanged)
  ).length;

  const dates = [
    ...input.commits.map(c => c.committedAt),
    ...input.pullRequests.map(pr => pr.updatedAt)
  ].sort();

  return {
    totalCommits: input.commits.length,
    totalPullRequests: input.pullRequests.length,
    mergedPullRequests: input.pullRequests.filter(pr => pr.mergedAt).length,
    totalIssues: input.issues.length,
    linesAdded: linesAdded || undefined,
    linesDeleted: linesDeleted || undefined,
    filesTouched: filesTouched || undefined,
    activityFrom: dates[0],
    activityTo: dates[dates.length - 1]
  };
}

export function inferRepoOrganization(commits: AnalyzedCommit[]): string {
  const dirCounts = new Map<string, number>();

  for (const commit of commits) {
    for (const file of commit.filesChanged) {
      const parts = file.split("/").filter(Boolean);
      if (parts.length === 0) continue;

      const top = parts[0] ?? file;
      dirCounts.set(top, (dirCounts.get(top) ?? 0) + 1);

      if (parts.length >= 2) {
        const nested = `${parts[0]}/${parts[1]}`;
        dirCounts.set(nested, (dirCounts.get(nested) ?? 0) + 1);
      }
    }
  }

  const sorted = [...dirCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  if (sorted.length === 0) {
    return "Organizacao inferida indisponivel — nenhum caminho de arquivo capturado nos commits analisados.";
  }

  const hints: string[] = [];
  const topNames = sorted.map(([name]) => name.toLowerCase());
  if (topNames.some(n => n.includes("apps") || n.includes("packages"))) {
    hints.push("estrutura tipo monorepo (apps/packages)");
  }
  if (topNames.some(n => n.includes("src"))) {
    hints.push("codigo principal em src/");
  }
  if (topNames.some(n => n.includes("components") || n.includes("ui"))) {
    hints.push("camada de UI/componentes dedicada");
  }
  if (topNames.some(n => n.includes("api") || n.includes("server"))) {
    hints.push("camada backend/API separada");
  }

  const folders = sorted.map(([name, count]) => `${name} (${count} toques)`).join(", ");
  return hints.length > 0
    ? `Pastas mais ativas: ${folders}. Sinais: ${hints.join("; ")}.`
    : `Pastas mais ativas: ${folders}.`;
}

function buildKeyContributions(input: MegaSummaryInput): KeyContribution[] {
  const topCommits = [...input.commits].sort((a, b) => scoreCommit(b) - scoreCommit(a)).slice(0, 8);
  const topPrs = [...input.pullRequests].sort((a, b) => scorePullRequest(b) - scorePullRequest(a)).slice(0, 8);

  const fromCommits: KeyContribution[] = topCommits.map(commit => {
    const title = commit.message.split("\n")[0]?.slice(0, 160) ?? commit.sha;
    const parsed = title.match(/^(?:fix|feat|refactor|perf)\(?/i);
    return {
      type: "commit",
      reference: commit.sha.slice(0, 8),
      title,
      what: parsed
        ? commit.analysisSummary || `Problema/necessidade identificada no commit: ${title}`
        : commit.analysisSummary || title,
      how:
        commit.filesChanged.length > 0
          ? `Implementado alterando ${commit.filesChanged.slice(0, 5).join(", ")}${commit.technologies.length ? ` com ${commit.technologies.slice(0, 4).join(", ")}` : ""}`
          : commit.technologies.length > 0
            ? `Implementado com ${commit.technologies.join(", ")}`
            : "Implementacao registrada no historico de commits",
      why: commit.impactSignals[0] ?? commit.message.split("\n").slice(1).join(" ").trim().slice(0, 200),
      impact:
        filterMeaningfulImpactSignals(commit.impactSignals).slice(0, 2).join("; ") ||
        (commit.impactSignals[0] && !isVanityMetricText(commit.impactSignals[0])
          ? commit.impactSignals[0]
          : ""),
      technologies: commit.technologies,
      metrics: undefined
    };
  });

  const fromPrs: KeyContribution[] = topPrs.map(pr => ({
    type: "pull_request",
    reference: `#${pr.number}`,
    title: pr.title,
    what:
      pr.analysisSummary ||
      (pr.title.match(/^fix:/i)
        ? `Problema: ${pr.title.replace(/^fix:\s*/i, "")}`
        : pr.title.match(/^feat:/i)
          ? `Necessidade: ${pr.title.replace(/^feat:\s*/i, "")}`
          : pr.title),
    how:
      pr.changedFiles !== undefined
        ? `Solucao entregue em ${pr.changedFiles} arquivo(s)${pr.technologies.length ? ` usando ${pr.technologies.slice(0, 5).join(", ")}` : ""}`
        : pr.technologies.length > 0
          ? `Solucao com ${pr.technologies.join(", ")}`
          : "Solucao consolidada via pull request",
    why: pr.body?.slice(0, 240) ?? pr.impactSignals[0] ?? "Motivacao derivada do titulo e contexto do PR",
    impact:
      filterMeaningfulImpactSignals(pr.impactSignals).join("; ") ||
      (pr.mergedAt ? "Integrado na branch principal apos review" : "Contribuicao em andamento ou encerrada"),
    technologies: pr.technologies,
    metrics: undefined
  }));

  return [...fromPrs, ...fromCommits].slice(0, 16);
}

export function buildHeuristicMegaSummary(input: MegaSummaryInput): Partial<RepoAnalysisSummary> {
  const metricsSnapshot = computeRepoMetrics(input);
  const repoOrganization = inferRepoOrganization(input.commits);
  const keyContributions = buildKeyContributions(input);

  const technologies = unique([
    ...(input.partial?.technologies ?? []),
    ...input.commits.flatMap(c => c.technologies),
    ...input.pullRequests.flatMap(pr => pr.technologies)
  ]).slice(0, 30);

  const architectureSignals = unique([
    ...(input.partial?.architectureSignals ?? []),
    ...input.commits.flatMap(c => c.technologies),
    ...input.pullRequests.flatMap(pr => pr.technologies)
  ]).slice(0, 12);

  const quantifiedImpacts = filterMeaningfulImpactSignals(
    unique([
      ...(input.partial?.quantifiedImpacts ?? []),
      ...input.commits.flatMap(c => c.impactSignals),
      ...input.pullRequests.flatMap(pr => pr.impactSignals)
    ])
  ).slice(0, 12);

  const purpose =
    input.repo.description?.trim() ||
    `Projeto focado em resolver problemas reais de produto e engenharia registrados em commits e PRs.`;

  const substantive = buildSubstantiveHighlights(input.commits, input.pullRequests);
  const contributionOverview =
    substantive.length >= 2
      ? substantive.slice(0, 4).join(" ")
      : keyContributions
          .slice(0, 3)
          .map(item => item.what)
          .filter(Boolean)
          .join(" ");

  const architectureAnalysis =
    input.partial?.architectureAnalysis?.trim() ||
    (architectureSignals.length > 0
      ? `Decisoes de arquitetura observadas nas entregas: ${architectureSignals.join(", ")}. Tecnologias aplicadas nas solucoes: ${technologies.slice(0, 10).join(", ") || "nao inferidas"}.`
      : technologies.length > 0
        ? `Solucoes implementadas predominantemente com ${technologies.slice(0, 10).join(", ")}.`
        : undefined);

  const narrative =
    input.partial?.narrative?.trim() ||
    [purpose, contributionOverview, architectureAnalysis ?? ""].filter(Boolean).join(" ");

  const highlights = filterSubstantiveBullets([
    ...(input.partial?.highlights ?? []),
    ...substantive
  ]).slice(0, 12);

  const megaSummary = formatRepoDossier({
    repoName: input.repo.name,
    analyzedAt: new Date().toISOString(),
    technologies,
    architectureSignals,
    quantifiedImpacts,
    highlights,
    narrative,
    engineeringInsights: input.partial?.engineeringInsights ?? [],
    purpose,
    repoOrganization,
    architectureAnalysis,
    contributionOverview,
    megaSummary: "",
    keyContributions,
    metricsSnapshot,
    commitCount: metricsSnapshot.totalCommits,
    pullRequestCount: metricsSnapshot.totalPullRequests,
    deepAnalyzedCommits: input.commits.filter(c => c.filesChanged.length > 0 || c.analysisSummary).length,
    deepAnalyzedPullRequests: input.pullRequests.filter(
      pr => (pr.changedFiles ?? 0) > 0 || Boolean(pr.body) || Boolean(pr.analysisSummary)
    ).length
  });

  return {
    purpose,
    repoOrganization,
    architectureAnalysis,
    contributionOverview,
    megaSummary,
    keyContributions,
    metricsSnapshot,
    narrative,
    highlights
  };
}

export function formatRepoDossier(analysis: RepoAnalysisSummary): string {
  const sections: string[] = [`# REPOSITORIO: ${analysis.repoName}`];
  const substantiveHighlights = filterSubstantiveBullets(analysis.highlights);

  const narrative =
    analysis.megaSummary?.trim() && !isMetadataBullet(analysis.megaSummary)
      ? analysis.megaSummary.trim()
      : analysis.narrative?.trim() && !isMetadataBullet(analysis.narrative)
        ? analysis.narrative.trim()
        : "";

  if (narrative) {
    sections.push("## Resumo das solucoes e melhorias", narrative);
  }

  if (analysis.keyContributions.length > 0) {
    sections.push(
      "## Problemas resolvidos e entregas principais",
      analysis.keyContributions
        .map(item => {
          const lines = [
            `- [${item.type} ${item.reference}] ${item.title}`,
            `  Problema/necessidade: ${item.what}`,
            item.how ? `  Solucao (como): ${item.how}` : "",
            item.why ? `  Motivacao/contexto: ${item.why}` : "",
            item.impact && !isVanityMetricText(item.impact) ? `  Resultado/impacto: ${item.impact}` : "",
            item.technologies.length > 0 ? `  Tecnologias: ${item.technologies.join(", ")}` : ""
          ];
          return lines.filter(Boolean).join("\n");
        })
        .join("\n")
    );
  }

  if (substantiveHighlights.length > 0) {
    sections.push(
      "## Destaques tecnicos reais",
      substantiveHighlights.map(h => `- ${h}`).join("\n")
    );
  }

  if (analysis.engineeringInsights.length > 0) {
    sections.push(
      "## Decisoes de engenharia",
      filterSubstantiveBullets(analysis.engineeringInsights).map(i => `- ${i}`).join("\n")
    );
  }

  if (analysis.quantifiedImpacts.length > 0) {
    sections.push(
      "## Resultados mensuraveis",
      filterSubstantiveBullets(filterMeaningfulImpactSignals(analysis.quantifiedImpacts))
        .map(i => `- ${i}`)
        .join("\n")
    );
  }

  if (analysis.architectureAnalysis?.trim() && !isCounterOverview(analysis.architectureAnalysis)) {
    sections.push("## Arquitetura aplicada nas solucoes", analysis.architectureAnalysis.trim());
  }

  if (analysis.repoOrganization?.trim()) {
    sections.push("## Como o codigo esta organizado", analysis.repoOrganization.trim());
  }

  if (analysis.purpose?.trim() && !isMetadataBullet(analysis.purpose)) {
    sections.push("## Proposito do projeto", analysis.purpose.trim());
  }

  return sections.join("\n\n");
}

export function enrichAnalysisWithMegaSummary(
  base: RepoAnalysisSummary,
  input: MegaSummaryInput
): RepoAnalysisSummary {
  const heuristic = buildHeuristicMegaSummary({ ...input, partial: base });
  const merged: RepoAnalysisSummary = {
    ...base,
    purpose: heuristic.purpose ?? base.purpose,
    repoOrganization: heuristic.repoOrganization ?? base.repoOrganization,
    architectureAnalysis: heuristic.architectureAnalysis ?? base.architectureAnalysis,
    contributionOverview:
      heuristic.contributionOverview && !isCounterOverview(heuristic.contributionOverview)
        ? heuristic.contributionOverview
        : base.contributionOverview && !isCounterOverview(base.contributionOverview)
          ? base.contributionOverview
          : heuristic.contributionOverview,
    highlights:
      filterSubstantiveBullets(base.highlights).length > 0
        ? filterSubstantiveBullets(base.highlights)
        : (heuristic.highlights ?? []),
    keyContributions:
      base.keyContributions.length > 0 ? base.keyContributions : (heuristic.keyContributions ?? []),
    metricsSnapshot: base.metricsSnapshot ?? heuristic.metricsSnapshot,
    narrative: base.narrative ?? heuristic.narrative,
    megaSummary: base.megaSummary?.trim()
      ? base.megaSummary
      : formatRepoDossier({
          ...base,
          ...heuristic,
          keyContributions:
            base.keyContributions.length > 0 ? base.keyContributions : (heuristic.keyContributions ?? []),
          metricsSnapshot: base.metricsSnapshot ?? heuristic.metricsSnapshot
        } as RepoAnalysisSummary)
  };

  if (!merged.megaSummary?.trim()) {
    merged.megaSummary = formatRepoDossier(merged);
  }

  return merged;
}
