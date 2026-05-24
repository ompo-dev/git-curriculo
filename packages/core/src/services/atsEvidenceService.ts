import type { GitHubProfileSnapshot } from "../schemas";
import { buildAllProjectEvidence } from "./projectProfileService";
import { normalizeKeyword } from "../utils/text";

/** Corpus textual do perfil GitHub — usado como contexto para IA ATS. */
export function buildProfileEvidenceCorpus(
  snapshot: GitHubProfileSnapshot,
  profilePrompt = ""
): string {
  const chunks: string[] = [profilePrompt];

  for (const repo of snapshot.repoAnalyses ?? []) {
    chunks.push(
      [
        repo.repoName,
        repo.narrative,
        repo.megaSummary,
        repo.purpose,
        repo.architectureAnalysis,
        ...repo.technologies,
        ...repo.architectureSignals,
        ...repo.highlights,
        ...repo.engineeringInsights,
        ...repo.keyContributions.flatMap(item => [
          item.title,
          item.what,
          item.how,
          item.why,
          item.impact,
          ...item.technologies
        ])
      ].join("\n")
    );
  }

  for (const project of buildAllProjectEvidence(snapshot)) {
    chunks.push(
      [
        project.repoName,
        project.summary,
        project.contextDossier,
        ...project.technologies,
        ...project.analyzedEvidence,
        ...project.evidence
      ].join("\n")
    );
  }

  for (const repo of snapshot.repos) {
    chunks.push([repo.name, repo.description ?? "", repo.language ?? ""].join(" "));
  }

  for (const commit of snapshot.commits) {
    chunks.push(
      [
        commit.repoName,
        commit.message,
        commit.analysisSummary,
        ...commit.technologies,
        ...commit.filesChanged
      ].join(" ")
    );
  }

  for (const pr of snapshot.pullRequests) {
    chunks.push(
      [pr.repoName, pr.title, pr.body ?? "", pr.analysisSummary, ...pr.technologies].join(" ")
    );
  }

  return normalizeKeyword(chunks.filter(Boolean).join("\n"));
}
