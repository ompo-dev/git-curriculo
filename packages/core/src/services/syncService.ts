import axios, { AxiosInstance, AxiosResponse } from "axios";

import {
  GitHubProfileSnapshotSchema,
  type CommitSnapshot,
  type GitHubProfileSnapshot,
  type IssueSnapshot,
  type LanguageStat,
  type PullRequestSnapshot,
  type RepoAnalysisSummary,
  type RepoSnapshot
} from "../schemas";
import {
  analyzeCommit,
  analyzePullRequest,
  buildRepoAnalysisSummary,
  type AnalyzedCommit,
  type AnalyzedPullRequest
} from "./repoAnalysisService";
import { DeepSeekRepoAnalyzer } from "./deepSeekRepoAnalyzer";
import { enrichAnalysisWithMegaSummary } from "./repoMegaSummaryService";
import { emptySyncProgress, type RepoSyncProgressItem, type SyncProgress, type SyncStatus } from "../types/domain";
import { mapPool } from "../utils/async";
import { asAxiosErrorMessage, withRetry } from "../utils/retry";

interface GitHubUserResponse {
  login: string;
  name: string | null;
  bio: string | null;
  email: string | null;
  location: string | null;
  followers: number;
  following: number;
  public_repos: number;
  avatar_url?: string;
}

interface GitHubRepoResponse {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  size: number;
  default_branch: string;
  updated_at: string;
  pushed_at: string | null;
  owner: {
    login: string;
  };
}

interface SyncInput {
  since?: string;
  token: string;
  deepseekApiKey?: string;
  onProgress?: (progress: SyncProgress) => void;
}

interface ActionsRunsResponse {
  workflow_runs?: Array<{
    conclusion: string | null;
  }>;
}

const GITHUB_DETAIL_CONCURRENCY = 5;

export class SyncService {
  private status: SyncStatus = {
    stage: "idle",
    lastRunAt: null,
    syncedRepos: 0,
    syncedCommits: 0,
    syncedPullRequests: 0,
    syncedIssues: 0,
    errorMessage: null,
    progress: emptySyncProgress()
  };

  getLastSyncStatus(): SyncStatus {
    return this.status;
  }

  mergeSnapshots(
    existing: GitHubProfileSnapshot,
    incremental: GitHubProfileSnapshot
  ): GitHubProfileSnapshot {
    const repoMap = new Map(existing.repos.map((r) => [r.id, r]));
    for (const repo of incremental.repos) repoMap.set(repo.id, repo);

    const commitMap = new Map(existing.commits.map((c) => [c.sha, c]));
    for (const commit of incremental.commits) commitMap.set(commit.sha, commit);

    const prMap = new Map(existing.pullRequests.map((pr) => [pr.id, pr]));
    for (const pr of incremental.pullRequests) prMap.set(pr.id, pr);

    const issueMap = new Map(existing.issues.map((i) => [i.id, i]));
    for (const issue of incremental.issues) issueMap.set(issue.id, issue);

    const touchedRepos = new Set(incremental.repos.map((r) => r.name));
    const mergedLanguages = [
      ...existing.languages.filter((l) => !touchedRepos.has(l.repoName)),
      ...incremental.languages
    ];

    const analysisMap = new Map((existing.repoAnalyses ?? []).map((a) => [a.repoName, a]));
    for (const analysis of incremental.repoAnalyses ?? []) {
      analysisMap.set(analysis.repoName, analysis);
    }

    const merged: GitHubProfileSnapshot = {
      capturedAt: incremental.capturedAt,
      user: incremental.user,
      repos: Array.from(repoMap.values()),
      commits: Array.from(commitMap.values()),
      pullRequests: Array.from(prMap.values()),
      issues: Array.from(issueMap.values()),
      languages: mergedLanguages,
      actions: incremental.actions,
      repoAnalyses: Array.from(analysisMap.values())
    };

    return GitHubProfileSnapshotSchema.parse(merged);
  }

  async runManualSync(input: SyncInput): Promise<GitHubProfileSnapshot> {
    const since =
      input.since ??
      new Date(new Date().setMonth(new Date().getMonth() - 24)).toISOString();

    const emit = (progress: SyncProgress): void => {
      this.status = { ...this.status, progress };
      input.onProgress?.(progress);
    };

    this.status = {
      ...this.status,
      stage: "running",
      errorMessage: null,
      progress: {
        ...emptySyncProgress(),
        phase: "listing_repos",
        phaseLabel: "Listando repositorios...",
        overallPercent: 1
      }
    };
    emit(this.status.progress);

    const token = this.normalizeToken(input.token);
    if (!token) {
      throw new Error("Token GitHub vazio. Faca login novamente para gerar um token valido.");
    }

    try {
      const { client, userResponse } = await this.createAuthenticatedClient(token);
      const repos = await this.fetchRepos(client);

      const sinceTime = new Date(since).getTime();
      const reposToProcess = input.since
        ? repos.filter((r) => {
            const updated = r.updatedAt ? new Date(r.updatedAt).getTime() : 0;
            const pushed = r.pushedAt ? new Date(r.pushedAt).getTime() : 0;
            return Math.max(updated, pushed) >= sinceTime;
          })
        : repos;

      const repoProgress: RepoSyncProgressItem[] = reposToProcess.map((repo) => ({
        repoName: repo.name,
        percent: 0,
        status: "pending",
        phaseLabel: "Aguardando",
        commits: 0,
        pullRequests: 0
      }));

      const updateRepoProgress = (
        repoName: string,
        patch: Partial<RepoSyncProgressItem>
      ): void => {
        const idx = repoProgress.findIndex((item) => item.repoName === repoName);
        if (idx >= 0) {
          repoProgress[idx] = { ...repoProgress[idx]!, ...patch };
        }
        const completed = repoProgress.filter((item) => item.status === "done").length;
        const running = repoProgress.find((item) => item.status === "running");
        const avgDone =
          repoProgress.reduce((acc, item) => acc + item.percent, 0) /
          Math.max(repoProgress.length, 1);
        emit({
          overallPercent: Math.min(99, Math.round(avgDone)),
          currentRepo: running?.repoName ?? null,
          currentRepoPercent: running?.percent ?? 0,
          phase: "syncing_repo",
          phaseLabel: running?.phaseLabel ?? "Sincronizando...",
          reposTotal: repoProgress.length,
          reposCompleted: completed,
          repoProgress: [...repoProgress]
        });
      };

      emit({
        overallPercent: 3,
        currentRepo: null,
        currentRepoPercent: 0,
        phase: "syncing_repo",
        phaseLabel: `${reposToProcess.length} repositorios para analisar`,
        reposTotal: reposToProcess.length,
        reposCompleted: 0,
        repoProgress
      });

      const commits: CommitSnapshot[] = [];
      const pullRequests: PullRequestSnapshot[] = [];
      const issues: IssueSnapshot[] = [];
      const languages: LanguageStat[] = [];
      const repoAnalyses: RepoAnalysisSummary[] = [];

      const actionsSummary = {
        totalRuns: 0,
        successRuns: 0,
        failedRuns: 0,
        cancelledRuns: 0,
        mode: "limited" as const
      };

      for (const repo of reposToProcess) {
        const repoName = repo.name;
        updateRepoProgress(repoName, {
          status: "running",
          percent: 5,
          phaseLabel: "Buscando commits..."
        });

        const rawCommits = await this.fetchRepoCommits(client, repo, userResponse.data.login, since);
        updateRepoProgress(repoName, { percent: 15, phaseLabel: `Detalhando ${rawCommits.length} commits...` });

        const analyzedCommits = await mapPool(
          rawCommits,
          GITHUB_DETAIL_CONCURRENCY,
          async (entry) => {
            const withRepo = { ...entry, repoName };
            const detail = await this.fetchCommitDetail(client, repo, entry.sha);
            return analyzeCommit(withRepo, detail ?? undefined);
          },
          (done, total) => {
            const commitProgress = 15 + Math.round((done / Math.max(total, 1)) * 30);
            updateRepoProgress(repoName, {
              percent: commitProgress,
              phaseLabel: `Detalhando commits (${done}/${total})`,
              commits: done
            });
          }
        );
        commits.push(...analyzedCommits);

        updateRepoProgress(repoName, { percent: 48, phaseLabel: "Buscando pull requests..." });
        const rawPullRequests = await this.fetchRepoPullRequests(client, repo, since);
        updateRepoProgress(repoName, { percent: 50, phaseLabel: `Detalhando ${rawPullRequests.length} PRs...` });

        const analyzedPullRequests = await mapPool(
          rawPullRequests,
          GITHUB_DETAIL_CONCURRENCY,
          async (entry) => {
            const withRepo = { ...entry, repoName };
            const detail = await this.fetchPullRequestDetail(client, repo, entry.number);
            return analyzePullRequest(withRepo, detail ?? undefined);
          },
          (done, total) => {
            const prProgress = 50 + Math.round((done / Math.max(total, 1)) * 25);
            updateRepoProgress(repoName, {
              percent: prProgress,
              phaseLabel: `Detalhando PRs (${done}/${total})`,
              pullRequests: done
            });
          }
        );
        pullRequests.push(...analyzedPullRequests);

        updateRepoProgress(repoName, { percent: 78, phaseLabel: "Buscando issues..." });
        const repoIssues = await this.fetchRepoIssues(client, repo, since);
        const repoIssuesWithName = repoIssues.map((entry) => ({ ...entry, repoName }));

        updateRepoProgress(repoName, { percent: 82, phaseLabel: "Buscando linguagens..." });
        const repoLanguages = await this.fetchRepoLanguages(client, repo);
        languages.push(...repoLanguages.map((entry) => ({ ...entry, repoName })));

        let finalCommits = analyzedCommits;
        let finalPullRequests = analyzedPullRequests;
        let repoSummary = buildRepoAnalysisSummary({
          repoName,
          commits: analyzedCommits,
          pullRequests: analyzedPullRequests,
          description: repo.description
        });

        issues.push(...repoIssuesWithName);

        if (input.deepseekApiKey?.trim()) {
          updateRepoProgress(repoName, {
            percent: 88,
            phaseLabel: `DeepSeek analisando ${analyzedCommits.length} commits + ${analyzedPullRequests.length} PRs...`
          });
          try {
            const ai = new DeepSeekRepoAnalyzer({ apiKey: input.deepseekApiKey.trim() });
            const enriched = await ai.analyzeRepository({
              repo,
              commits: analyzedCommits,
              pullRequests: analyzedPullRequests,
              issues: repoIssuesWithName,
              languages: repoLanguages.map(l => ({ ...l, repoName }))
            });
            finalCommits = enriched.commits;
            finalPullRequests = enriched.pullRequests;
            repoSummary = enriched.summary;

            const idxCommitStart = commits.length - analyzedCommits.length;
            commits.splice(idxCommitStart, analyzedCommits.length, ...finalCommits);
            const idxPrStart = pullRequests.length - analyzedPullRequests.length;
            pullRequests.splice(idxPrStart, analyzedPullRequests.length, ...finalPullRequests);
          } catch (aiError) {
            updateRepoProgress(repoName, {
              percent: 94,
              phaseLabel: `IA indisponivel — analise heuristica (${aiError instanceof Error ? aiError.message.slice(0, 80) : "erro"})`
            });
          }
        } else {
          updateRepoProgress(repoName, {
            percent: 92,
            phaseLabel: "DeepSeek nao configurada — analise heuristica de todos os itens"
          });
        }

        updateRepoProgress(repoName, { percent: 95, phaseLabel: "Consolidando dossie completo do projeto..." });
        repoSummary = enrichAnalysisWithMegaSummary(repoSummary, {
          repo,
          commits: finalCommits,
          pullRequests: finalPullRequests,
          issues: repoIssuesWithName,
          partial: repoSummary
        });

        repoAnalyses.push(repoSummary);

        const repoActions = await this.fetchRepoActions(client, repo);
        actionsSummary.totalRuns += repoActions.totalRuns;
        actionsSummary.successRuns += repoActions.successRuns;
        actionsSummary.failedRuns += repoActions.failedRuns;
        actionsSummary.cancelledRuns += repoActions.cancelledRuns;

        updateRepoProgress(repoName, {
          status: "done",
          percent: 100,
          phaseLabel: input.deepseekApiKey?.trim() ? "Analise completa com IA" : "Analise heuristica completa",
          commits: finalCommits.length,
          pullRequests: finalPullRequests.length
        });
      }

      const snapshot: GitHubProfileSnapshot = {
        capturedAt: new Date().toISOString(),
        user: {
          login: userResponse.data.login,
          name: userResponse.data.name,
          bio: userResponse.data.bio,
          email: userResponse.data.email,
          location: userResponse.data.location,
          followers: userResponse.data.followers,
          following: userResponse.data.following,
          publicRepos: userResponse.data.public_repos,
          avatarUrl: userResponse.data.avatar_url
        },
        repos,
        commits,
        pullRequests,
        issues,
        languages,
        actions: actionsSummary,
        repoAnalyses
      };

      const parsedSnapshot = GitHubProfileSnapshotSchema.parse(snapshot);

      emit({
        overallPercent: 100,
        currentRepo: null,
        currentRepoPercent: 100,
        phase: "complete",
        phaseLabel: "Analise completa",
        reposTotal: repoProgress.length,
        reposCompleted: repoProgress.length,
        repoProgress: repoProgress.map((item) => ({ ...item, percent: 100, status: "done" as const }))
      });

      this.status = {
        stage: "success",
        lastRunAt: snapshot.capturedAt,
        syncedRepos: reposToProcess.length,
        syncedCommits: commits.length,
        syncedPullRequests: pullRequests.length,
        syncedIssues: issues.length,
        errorMessage: null,
        progress: this.status.progress
      };

      return parsedSnapshot;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        const message = "Token GitHub invalido ou expirado. Clique em 'Limpar segredos' e refaca o login.";
        this.status = {
          ...this.status,
          stage: "error",
          lastRunAt: new Date().toISOString(),
          errorMessage: message,
          progress: {
            ...this.status.progress,
            phase: "error",
            phaseLabel: message
          }
        };
        throw new Error(message);
      }

      const message = asAxiosErrorMessage(error);
      this.status = {
        ...this.status,
        stage: "error",
        lastRunAt: new Date().toISOString(),
        errorMessage: message,
        progress: {
          ...this.status.progress,
          phase: "error",
          phaseLabel: message
        }
      };
      throw error;
    }
  }

  private normalizeToken(rawToken: string): string {
    return rawToken.trim().replace(/^token\s+/i, "").replace(/^bearer\s+/i, "");
  }

  private async createAuthenticatedClient(
    token: string
  ): Promise<{ client: AxiosInstance; userResponse: AxiosResponse<GitHubUserResponse> }> {
    const schemes: Array<"Bearer" | "token"> = ["Bearer", "token"];
    let lastAuthError: unknown = null;

    for (const scheme of schemes) {
      const client = this.createGitHubClient(token, scheme);
      try {
        const userResponse = await withRetry(() => client.get<GitHubUserResponse>("/user"), {
          retries: 1
        });
        return { client, userResponse };
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
          lastAuthError = error;
          continue;
        }
        throw error;
      }
    }

    throw lastAuthError ?? new Error("Falha ao autenticar no GitHub.");
  }

  private createGitHubClient(token: string, authScheme: "Bearer" | "token" = "Bearer"): AxiosInstance {
    return axios.create({
      baseURL: "https://api.github.com",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `${authScheme} ${token}`,
        "X-GitHub-Api-Version": "2022-11-28"
      },
      timeout: 30_000
    });
  }

  private async fetchRepos(client: AxiosInstance): Promise<RepoSnapshot[]> {
    const items = await this.paginate<GitHubRepoResponse>(client, "/user/repos", {
      visibility: "all",
      affiliation: "owner",
      sort: "updated",
      per_page: 100
    });

    return items.map((repo) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      private: repo.private,
      description: repo.description,
      language: repo.language,
      stargazersCount: repo.stargazers_count,
      forksCount: repo.forks_count,
      openIssuesCount: repo.open_issues_count,
      size: repo.size,
      defaultBranch: repo.default_branch,
      updatedAt: repo.updated_at,
      pushedAt: repo.pushed_at
    }));
  }

  private async fetchRepoCommits(
    client: AxiosInstance,
    repo: RepoSnapshot,
    login: string,
    since: string
  ): Promise<Omit<CommitSnapshot, "repoName">[]> {
    const entries = await this.paginate<{
      sha: string;
      html_url?: string;
      commit: {
        message: string;
        committer: {
          date: string;
        };
      };
    }>(client, `/repos/${repo.fullName}/commits`, {
      per_page: 100,
      since,
      author: login
    });

    return entries.map((entry) => ({
      sha: entry.sha,
      message: entry.commit.message,
      committedAt: entry.commit.committer.date,
      url: entry.html_url,
      filesChanged: [],
      technologies: [],
      impactSignals: []
    }));
  }

  private async fetchCommitDetail(
    client: AxiosInstance,
    repo: RepoSnapshot,
    sha: string
  ): Promise<{ additions: number; deletions: number; files: string[] } | null> {
    try {
      const response = await withRetry(() =>
        client.get<{
          stats?: { additions?: number; deletions?: number; total?: number };
          files?: Array<{ filename: string }>;
        }>(`/repos/${repo.fullName}/commits/${sha}`)
      );
      return {
        additions: response.data.stats?.additions ?? 0,
        deletions: response.data.stats?.deletions ?? 0,
        files: (response.data.files ?? []).map((file) => file.filename)
      };
    } catch {
      return null;
    }
  }

  private async fetchRepoPullRequests(
    client: AxiosInstance,
    repo: RepoSnapshot,
    since: string
  ): Promise<Omit<PullRequestSnapshot, "repoName">[]> {
    const entries = await this.paginate<{
      id: number;
      number: number;
      title: string;
      state: "open" | "closed";
      created_at: string;
      updated_at: string;
      merged_at: string | null;
      html_url: string;
    }>(client, `/repos/${repo.fullName}/pulls`, {
      state: "all",
      sort: "updated",
      direction: "desc",
      per_page: 100
    });

    return entries
      .filter((item) => new Date(item.updated_at).getTime() >= new Date(since).getTime())
      .map((item) => ({
        id: item.id,
        number: item.number,
        title: item.title,
        state: item.state,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        mergedAt: item.merged_at,
        url: item.html_url,
        labels: [],
        technologies: [],
        impactSignals: []
      }));
  }

  private async fetchPullRequestDetail(
    client: AxiosInstance,
    repo: RepoSnapshot,
    number: number
  ): Promise<{
    body: string | null;
    additions: number;
    deletions: number;
    changedFiles: number;
    labels: string[];
  } | null> {
    try {
      const response = await withRetry(() =>
        client.get<{
          body: string | null;
          additions?: number;
          deletions?: number;
          changed_files?: number;
          labels?: Array<{ name: string }>;
        }>(`/repos/${repo.fullName}/pulls/${number}`)
      );
      return {
        body: response.data.body,
        additions: response.data.additions ?? 0,
        deletions: response.data.deletions ?? 0,
        changedFiles: response.data.changed_files ?? 0,
        labels: (response.data.labels ?? []).map((label) => label.name)
      };
    } catch {
      return null;
    }
  }

  private async fetchRepoIssues(
    client: AxiosInstance,
    repo: RepoSnapshot,
    since: string
  ): Promise<Omit<IssueSnapshot, "repoName">[]> {
    const entries = await this.paginate<{
      id: number;
      number: number;
      title: string;
      state: "open" | "closed";
      created_at: string;
      updated_at: string;
      closed_at: string | null;
      html_url: string;
      pull_request?: unknown;
    }>(client, `/repos/${repo.fullName}/issues`, {
      state: "all",
      since,
      sort: "updated",
      direction: "desc",
      per_page: 100
    });

    return entries
      .filter((item) => !item.pull_request)
      .map((item) => ({
        id: item.id,
        number: item.number,
        title: item.title,
        state: item.state,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        closedAt: item.closed_at,
        url: item.html_url
      }));
  }

  private async fetchRepoLanguages(
    client: AxiosInstance,
    repo: RepoSnapshot
  ): Promise<Omit<LanguageStat, "repoName">[]> {
    const response = await withRetry(() =>
      client.get<Record<string, number>>(`/repos/${repo.fullName}/languages`)
    );

    return Object.entries(response.data).map(([language, bytes]) => ({ language, bytes }));
  }

  private async fetchRepoActions(
    client: AxiosInstance,
    repo: RepoSnapshot
  ): Promise<{ totalRuns: number; successRuns: number; failedRuns: number; cancelledRuns: number }> {
    try {
      const response = await withRetry(() =>
        client.get<ActionsRunsResponse>(`/repos/${repo.fullName}/actions/runs`, {
          params: { per_page: 20 }
        })
      );

      const runs = response.data.workflow_runs ?? [];
      const totalRuns = runs.length;
      const successRuns = runs.filter((run) => run.conclusion === "success").length;
      const failedRuns = runs.filter((run) => run.conclusion === "failure").length;
      const cancelledRuns = runs.filter((run) => run.conclusion === "cancelled").length;

      return { totalRuns, successRuns, failedRuns, cancelledRuns };
    } catch {
      return { totalRuns: 0, successRuns: 0, failedRuns: 0, cancelledRuns: 0 };
    }
  }

  private async paginate<T>(
    client: AxiosInstance,
    path: string,
    params: Record<string, string | number>
  ): Promise<T[]> {
    const output: T[] = [];

    for (let page = 1; page <= 100; page += 1) {
      const response = await withRetry(() =>
        client.get<T[]>(path, {
          params: {
            ...params,
            page
          }
        })
      );

      output.push(...response.data);
      if (response.data.length === 0 || response.data.length < Number(params.per_page ?? 100)) {
        break;
      }
    }

    return output;
  }
}
