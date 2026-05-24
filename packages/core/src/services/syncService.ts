import axios, { AxiosInstance, AxiosResponse } from "axios";

import {
  GitHubProfileSnapshotSchema,
  type CommitSnapshot,
  type GitHubProfileSnapshot,
  type IssueSnapshot,
  type LanguageStat,
  type PullRequestSnapshot,
  type RepoSnapshot
} from "../schemas";
import type { SyncStatus } from "../types/domain";
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
}

interface ActionsRunsResponse {
  workflow_runs?: Array<{
    conclusion: string | null;
  }>;
}

export class SyncService {
  private status: SyncStatus = {
    stage: "idle",
    lastRunAt: null,
    syncedRepos: 0,
    syncedCommits: 0,
    syncedPullRequests: 0,
    syncedIssues: 0,
    errorMessage: null
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

    // Replace language entries for repos touched in this sync; keep rest
    const touchedRepos = new Set(incremental.repos.map((r) => r.name));
    const mergedLanguages = [
      ...existing.languages.filter((l) => !touchedRepos.has(l.repoName)),
      ...incremental.languages
    ];

    const merged: GitHubProfileSnapshot = {
      capturedAt: incremental.capturedAt,
      user: incremental.user,
      repos: Array.from(repoMap.values()),
      commits: Array.from(commitMap.values()),
      pullRequests: Array.from(prMap.values()),
      issues: Array.from(issueMap.values()),
      languages: mergedLanguages,
      actions: incremental.actions
    };

    return GitHubProfileSnapshotSchema.parse(merged);
  }

  async runManualSync(input: SyncInput): Promise<GitHubProfileSnapshot> {
    const since =
      input.since ??
      new Date(new Date().setMonth(new Date().getMonth() - 24)).toISOString();

    this.status = {
      ...this.status,
      stage: "running",
      errorMessage: null
    };

    const token = this.normalizeToken(input.token);
    if (!token) {
      throw new Error("Token GitHub vazio. Faca login novamente para gerar um token valido.");
    }

    try {
      const { client, userResponse } = await this.createAuthenticatedClient(token);
      const repos = await this.fetchRepos(client);

      // On incremental sync only process repos touched since last sync
      const sinceTime = new Date(since).getTime();
      const reposToProcess = input.since
        ? repos.filter((r) => {
            const updated = r.updatedAt ? new Date(r.updatedAt).getTime() : 0;
            const pushed = r.pushedAt ? new Date(r.pushedAt).getTime() : 0;
            return Math.max(updated, pushed) >= sinceTime;
          })
        : repos;

      const commits: CommitSnapshot[] = [];
      const pullRequests: PullRequestSnapshot[] = [];
      const issues: IssueSnapshot[] = [];
      const languages: LanguageStat[] = [];

      const actionsSummary = {
        totalRuns: 0,
        successRuns: 0,
        failedRuns: 0,
        cancelledRuns: 0,
        mode: "limited" as const
      };

      for (const repo of reposToProcess) {
        const repoName = repo.name;

        const repoCommits = await this.fetchRepoCommits(client, repo, userResponse.data.login, since);
        commits.push(...repoCommits.map((entry) => ({ ...entry, repoName })));

        const repoPullRequests = await this.fetchRepoPullRequests(client, repo, since);
        pullRequests.push(...repoPullRequests.map((entry) => ({ ...entry, repoName })));

        const repoIssues = await this.fetchRepoIssues(client, repo, since);
        issues.push(...repoIssues.map((entry) => ({ ...entry, repoName })));

        const repoLanguages = await this.fetchRepoLanguages(client, repo);
        languages.push(...repoLanguages.map((entry) => ({ ...entry, repoName })));

        const repoActions = await this.fetchRepoActions(client, repo);
        actionsSummary.totalRuns += repoActions.totalRuns;
        actionsSummary.successRuns += repoActions.successRuns;
        actionsSummary.failedRuns += repoActions.failedRuns;
        actionsSummary.cancelledRuns += repoActions.cancelledRuns;
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
        actions: actionsSummary
      };

      const parsedSnapshot = GitHubProfileSnapshotSchema.parse(snapshot);

      this.status = {
        stage: "success",
        lastRunAt: snapshot.capturedAt,
        syncedRepos: reposToProcess.length,
        syncedCommits: commits.length,
        syncedPullRequests: pullRequests.length,
        syncedIssues: issues.length,
        errorMessage: null
      };

      return parsedSnapshot;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        const message = "Token GitHub invalido ou expirado. Clique em 'Limpar segredos' e refaca o login.";
        this.status = {
          ...this.status,
          stage: "error",
          lastRunAt: new Date().toISOString(),
          errorMessage: message
        };
        throw new Error(message);
      }

      this.status = {
        ...this.status,
        stage: "error",
        lastRunAt: new Date().toISOString(),
        errorMessage: asAxiosErrorMessage(error)
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
      url: entry.html_url
    }));
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
      per_page: 50
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
        url: item.html_url
      }));
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

    for (let page = 1; page <= 10; page += 1) {
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
