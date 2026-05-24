export interface SyncStatus {
  stage: "idle" | "running" | "success" | "error";
  lastRunAt: string | null;
  syncedRepos: number;
  syncedCommits: number;
  syncedPullRequests: number;
  syncedIssues: number;
  errorMessage: string | null;
}

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