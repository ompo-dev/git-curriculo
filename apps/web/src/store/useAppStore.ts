import { create } from "zustand";

import type {
  AtsAnalysis,
  GitHubProfileSnapshot,
  ProfileMetrics,
  ResumeDocument,
  SyncStatus
} from "@gitcurriculo/core";
import { emptySyncProgress } from "@gitcurriculo/core";

interface AppState {
  snapshot: GitHubProfileSnapshot | null;
  metrics: ProfileMetrics | null;
  ats: AtsAnalysis | null;
  resume: ResumeDocument | null;
  syncStatus: SyncStatus;
  loading: boolean;
  error: string | null;
  setSnapshot: (snapshot: GitHubProfileSnapshot | null) => void;
  setMetrics: (metrics: ProfileMetrics | null) => void;
  setAts: (ats: AtsAnalysis | null) => void;
  setResume: (resume: ResumeDocument | null) => void;
  setSyncStatus: (status: SyncStatus) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

const initialSyncStatus: SyncStatus = {
  stage: "idle",
  lastRunAt: null,
  syncedRepos: 0,
  syncedCommits: 0,
  syncedPullRequests: 0,
  syncedIssues: 0,
  errorMessage: null,
  progress: emptySyncProgress()
};

export const useAppStore = create<AppState>((set) => ({
  snapshot: null,
  metrics: null,
  ats: null,
  resume: null,
  syncStatus: initialSyncStatus,
  loading: false,
  error: null,
  setSnapshot: (snapshot) => set({ snapshot }),
  setMetrics: (metrics) => set({ metrics }),
  setAts: (ats) => set({ ats }),
  setResume: (resume) => set({ resume }),
  setSyncStatus: (syncStatus) => set({ syncStatus }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error })
}));