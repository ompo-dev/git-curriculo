import type { GitHubProfileSnapshot } from "../schemas";

export const buildSnapshotFixture = (): GitHubProfileSnapshot => ({
  capturedAt: "2026-05-20T10:00:00.000Z",
  user: {
    login: "octocat",
    name: "Octo Cat",
    bio: "Developer",
    email: "octo@example.com",
    location: "Sao Paulo",
    followers: 10,
    following: 5,
    publicRepos: 2,
    avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4"
  },
  repos: [
    {
      id: 1,
      name: "repo-1",
      fullName: "octocat/repo-1",
      private: false,
      description: "Repo 1",
      language: "TypeScript",
      stargazersCount: 3,
      forksCount: 1,
      openIssuesCount: 0,
      size: 120,
      defaultBranch: "main",
      updatedAt: "2026-05-10T10:00:00.000Z",
      pushedAt: "2026-05-10T10:00:00.000Z"
    },
    {
      id: 2,
      name: "repo-2",
      fullName: "octocat/repo-2",
      private: true,
      description: "Repo 2",
      language: "Python",
      stargazersCount: 4,
      forksCount: 2,
      openIssuesCount: 1,
      size: 90,
      defaultBranch: "main",
      updatedAt: "2026-04-10T10:00:00.000Z",
      pushedAt: "2026-04-10T10:00:00.000Z"
    }
  ],
  commits: [
    {
      sha: "a1",
      repoName: "repo-1",
      message: "feat: add react dashboard",
      committedAt: "2026-05-01T10:00:00.000Z",
      url: "https://github.com/octocat/repo-1/commit/a1"
    },
    {
      sha: "a2",
      repoName: "repo-2",
      message: "fix: update api integration",
      committedAt: "2026-04-01T10:00:00.000Z",
      url: "https://github.com/octocat/repo-2/commit/a2"
    }
  ],
  pullRequests: [
    {
      id: 101,
      repoName: "repo-1",
      number: 1,
      title: "feat: improve ui with tailwind",
      state: "closed",
      createdAt: "2026-05-01T10:00:00.000Z",
      updatedAt: "2026-05-02T10:00:00.000Z",
      mergedAt: "2026-05-02T10:00:00.000Z",
      url: "https://github.com/octocat/repo-1/pull/1"
    }
  ],
  issues: [
    {
      id: 201,
      repoName: "repo-2",
      number: 2,
      title: "bug: login",
      state: "closed",
      createdAt: "2026-03-01T10:00:00.000Z",
      updatedAt: "2026-03-02T10:00:00.000Z",
      closedAt: "2026-03-02T10:00:00.000Z",
      url: "https://github.com/octocat/repo-2/issues/2"
    }
  ],
  languages: [
    { repoName: "repo-1", language: "TypeScript", bytes: 2000 },
    { repoName: "repo-1", language: "JavaScript", bytes: 1200 },
    { repoName: "repo-2", language: "Python", bytes: 1500 }
  ],
  actions: {
    totalRuns: 10,
    successRuns: 7,
    failedRuns: 2,
    cancelledRuns: 1,
    mode: "limited"
  }
});