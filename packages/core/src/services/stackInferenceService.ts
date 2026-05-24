import type { GitHubProfileSnapshot } from "../schemas";
import { normalizeKeyword, unique } from "../utils/text";

/** Filtra snapshot por repos selecionados para secao Projetos do curriculo. */
export function filterSnapshotByRepos(
  snapshot: GitHubProfileSnapshot,
  repoNames?: string[]
): GitHubProfileSnapshot {
  if (!repoNames || repoNames.length === 0) return snapshot;
  const allowed = new Set(repoNames);

  return {
    ...snapshot,
    repos: snapshot.repos.filter(r => allowed.has(r.name)),
    commits: snapshot.commits.filter(c => allowed.has(c.repoName)),
    pullRequests: snapshot.pullRequests.filter(pr => allowed.has(pr.repoName)),
    issues: snapshot.issues.filter(i => allowed.has(i.repoName)),
    languages: snapshot.languages.filter(l => allowed.has(l.repoName)),
    repoAnalyses: (snapshot.repoAnalyses ?? []).filter(a => allowed.has(a.repoName))
  };
}

/** Tecnologias extraidas do sync — commits, PRs, analises IA, linguagens. Sem inferencia mock. */
export function collectObservedTechnologies(snapshot: GitHubProfileSnapshot): string[] {
  const techs = new Set<string>();

  for (const repo of snapshot.repos) {
    if (repo.language) techs.add(normalizeKeyword(repo.language));
  }

  for (const lang of snapshot.languages) {
    techs.add(normalizeKeyword(lang.language));
  }

  for (const commit of snapshot.commits) {
    for (const tech of commit.technologies ?? []) {
      techs.add(normalizeKeyword(tech));
    }
  }

  for (const pr of snapshot.pullRequests) {
    for (const tech of pr.technologies ?? []) {
      techs.add(normalizeKeyword(tech));
    }
  }

  for (const analysis of snapshot.repoAnalyses ?? []) {
    for (const tech of analysis.technologies) {
      techs.add(normalizeKeyword(tech));
    }
    for (const signal of analysis.architectureSignals) {
      techs.add(normalizeKeyword(signal));
    }
  }

  return unique([...techs]).filter(Boolean);
}

/** Relatorio factual por repo — so dados do sync/analise, sem regex mock. */
export function buildProfileFactsReport(snapshot: GitHubProfileSnapshot): string {
  const byRepo = new Map<string, Set<string>>();

  const add = (repoName: string, value: string): void => {
    const norm = normalizeKeyword(value);
    if (!norm || norm.length < 2) return;
    const set = byRepo.get(repoName) ?? new Set<string>();
    set.add(norm);
    byRepo.set(repoName, set);
  };

  for (const repo of snapshot.repos) {
    if (repo.language) add(repo.name, repo.language);
    if (repo.description) add(repo.name, repo.description);
  }

  for (const commit of snapshot.commits) {
    for (const tech of commit.technologies ?? []) add(commit.repoName, tech);
    if (commit.analysisSummary) add(commit.repoName, commit.analysisSummary.slice(0, 120));
  }

  for (const pr of snapshot.pullRequests) {
    for (const tech of pr.technologies ?? []) add(pr.repoName, tech);
  }

  for (const analysis of snapshot.repoAnalyses ?? []) {
    for (const tech of analysis.technologies) add(analysis.repoName, tech);
    for (const h of analysis.highlights.slice(0, 3)) add(analysis.repoName, h.slice(0, 100));
  }

  const oldestRepos = snapshot.repos
    .slice()
    .sort(
      (a, b) =>
        new Date(a.pushedAt ?? a.updatedAt).getTime() -
        new Date(b.pushedAt ?? b.updatedAt).getTime()
    )
    .slice(0, 5)
    .map(r => r.name);

  const lines = [
    "DADOS REAIS DO GITHUB (commits, PRs, analises IA — unica fonte de evidencia):",
    ...[...byRepo.entries()]
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, 20)
      .map(([repo, techs]) => `- ${repo}: ${[...techs].slice(0, 15).join(", ")}`)
  ];

  if (oldestRepos.length > 0) {
    lines.push(`\nRepos mais antigos (historico): ${oldestRepos.join(", ")}`);
  }

  return lines.join("\n");
}
