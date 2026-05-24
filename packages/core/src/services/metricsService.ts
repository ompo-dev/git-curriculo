import {
  AtsAnalysisSchema,
  JobSpecSchema,
  ProfileMetricsSchema,
  type AtsAnalysis,
  type GitHubProfileSnapshot,
  type JobSpec,
  type ProfileMetrics
} from "../schemas";
import { extractKeywords, normalizeKeyword, unique } from "../utils/text";
import { keywordInCorpus } from "../utils/keywordSynonyms";
import { buildProfileEvidenceCorpus } from "./atsEvidenceService";

interface MetricsInput {
  profileSnapshot: GitHubProfileSnapshot;
  windowMonths?: number;
}

interface AtsInput {
  jobSpec: JobSpec;
  profileMetrics: ProfileMetrics;
  profileSnapshot?: GitHubProfileSnapshot;
}

export class MetricsService {
  computeProfileMetrics(input: MetricsInput): ProfileMetrics {
    const windowMonths = input.windowMonths ?? 24;

    const toDate = new Date(input.profileSnapshot.capturedAt);
    const fromDate = new Date(toDate);
    fromDate.setMonth(fromDate.getMonth() - windowMonths);

    const inWindow = (value: string): boolean => {
      const date = new Date(value);
      return date.getTime() >= fromDate.getTime() && date.getTime() <= toDate.getTime();
    };

    const commits = input.profileSnapshot.commits.filter((commit) => inWindow(commit.committedAt));
    const pullRequests = input.profileSnapshot.pullRequests.filter((pr) => inWindow(pr.updatedAt));
    const issues = input.profileSnapshot.issues.filter((issue) => inWindow(issue.updatedAt));

    const activeRepoNames = new Set<string>([
      ...commits.map((item) => item.repoName),
      ...pullRequests.map((item) => item.repoName),
      ...issues.map((item) => item.repoName)
    ]);

    const languageTotals = new Map<string, number>();
    for (const language of input.profileSnapshot.languages) {
      const current = languageTotals.get(language.language) ?? 0;
      languageTotals.set(language.language, current + language.bytes);
    }

    const languageTotalBytes = Array.from(languageTotals.values()).reduce((acc, value) => acc + value, 0);

    const topLanguages = Array.from(languageTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([language, bytes]) => ({
        language,
        bytes,
        share: languageTotalBytes === 0 ? 0 : bytes / languageTotalBytes
      }));

    const mergedPullRequests = pullRequests.filter((item) => item.mergedAt !== null).length;

    const highlights = unique(
      [
        `Contribuiu com ${commits.length} commits relevantes nos ultimos ${windowMonths} meses.`,
        `Participou de ${pullRequests.length} pull requests (${mergedPullRequests} merged).`,
        `Atuou em ${activeRepoNames.size} repositorios ativos nesse periodo.`,
        `Top linguagens: ${topLanguages
          .slice(0, 4)
          .map((item) => item.language)
          .join(", ") || "n/a"}.`
      ].filter(Boolean)
    );

    const skillsEvidence = unique([
      ...topLanguages.map((item) => item.language),
      ...extractKeywords(pullRequests.map((pr) => pr.title).join(" ")),
      ...extractKeywords(commits.map((commit) => commit.message).join(" "))
    ]);

    return ProfileMetricsSchema.parse({
      windowMonths,
      consideredFrom: fromDate.toISOString(),
      consideredTo: toDate.toISOString(),
      totalRepos: input.profileSnapshot.repos.length,
      activeRepos: activeRepoNames.size,
      totalCommits: commits.length,
      totalPullRequests: pullRequests.length,
      mergedPullRequests,
      totalIssues: issues.length,
      topLanguages,
      highlights,
      skillsEvidence
    });
  }

  computeAtsScore(input: AtsInput): AtsAnalysis {
    const jobSpec = JobSpecSchema.parse(input.jobSpec);

    const keywords = unique([
      ...jobSpec.requiredSkills,
      ...jobSpec.preferredSkills,
      ...jobSpec.keywords,
      ...extractKeywords(jobSpec.summary),
      ...extractKeywords(jobSpec.responsibilities.join(" "))
    ]).map(normalizeKeyword);

    const profileCorpus = input.profileSnapshot
      ? buildProfileEvidenceCorpus(input.profileSnapshot)
      : normalizeKeyword(
          [
            ...input.profileMetrics.skillsEvidence,
            ...input.profileMetrics.topLanguages.map(item => item.language),
            ...input.profileMetrics.highlights.join(" ")
          ].join(" ")
        );

    const matchedKeywords = unique(keywords.filter((keyword) => keywordInCorpus(keyword, profileCorpus)));
    const missingKeywords = unique(keywords.filter((keyword) => !keywordInCorpus(keyword, profileCorpus)));

    const weightRequired = Math.max(jobSpec.requiredSkills.length, 1);
    const requiredMatched = jobSpec.requiredSkills
      .map(normalizeKeyword)
      .filter((item) => keywordInCorpus(item, profileCorpus)).length;

    const optionalMatched = matchedKeywords.length - requiredMatched;

    const score = Math.min(
      100,
      Math.round((requiredMatched / weightRequired) * 70 + (optionalMatched / Math.max(keywords.length, 1)) * 30)
    );

    const suggestions = unique(
      [
        missingKeywords.length > 0
          ? `Incluir evidencias objetivas para: ${missingKeywords.slice(0, 6).join(", ")}.`
          : "Manter cobertura atual de palavras-chave da vaga.",
        "Quantificar impacto com metricas (tempo, custo, performance, escala).",
        "Priorizar projetos e PRs com aderencia direta aos requisitos da vaga.",
        input.profileMetrics.totalPullRequests < 5
          ? "Adicionar contribuicoes colaborativas (PRs revisadas e merged)."
          : "Evidenciar colaboracao entre times e code review."
      ].filter(Boolean)
    );

    const evidence = unique([
      ...input.profileMetrics.highlights,
      `Palavras-chave atendidas: ${matchedKeywords.slice(0, 8).join(", ") || "nenhuma"}.`
    ]);

    return AtsAnalysisSchema.parse({
      score,
      matchedKeywords,
      missingKeywords,
      suggestions,
      evidence,
      evidencedKeywords: matchedKeywords,
      gapsInResume: [],
      unavailableKeywords: missingKeywords
    });
  }
}