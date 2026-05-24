export interface RepoSyncProgressItem {
  repoName: string;
  percent: number;
  status: "pending" | "running" | "done" | "error";
  phaseLabel: string;
  commits: number;
  pullRequests: number;
}

export interface SyncProgress {
  overallPercent: number;
  currentRepo: string | null;
  currentRepoPercent: number;
  phase: "idle" | "listing_repos" | "syncing_repo" | "analyzing_repo" | "complete" | "error";
  phaseLabel: string;
  reposTotal: number;
  reposCompleted: number;
  repoProgress: RepoSyncProgressItem[];
}

export interface SyncStatus {
  stage: "idle" | "running" | "success" | "error";
  lastRunAt: string | null;
  syncedRepos: number;
  syncedCommits: number;
  syncedPullRequests: number;
  syncedIssues: number;
  errorMessage: string | null;
  progress: SyncProgress;
}

export const emptySyncProgress = (): SyncProgress => ({
  overallPercent: 0,
  currentRepo: null,
  currentRepoPercent: 0,
  phase: "idle",
  phaseLabel: "Aguardando",
  reposTotal: 0,
  reposCompleted: 0,
  repoProgress: []
});

export interface DeviceFlowStartResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface DeviceFlowTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}