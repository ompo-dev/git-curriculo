import { create } from "zustand";

import type { AtsAnalysis, ResumeDocument, SyncStatus } from "@gitcurriculo/core";
import { emptySyncProgress } from "@gitcurriculo/core";

interface ExtensionState {
  token: string;
  passphrase: string;
  deepseekApiKey: string;
  ats: AtsAnalysis | null;
  resume: ResumeDocument | null;
  syncStatus: SyncStatus;
  loading: boolean;
  error: string | null;
  setField: (
    field: "token" | "passphrase" | "deepseekApiKey",
    value: string
  ) => void;
  setAts: (ats: AtsAnalysis | null) => void;
  setResume: (resume: ResumeDocument | null) => void;
  setSyncStatus: (status: SyncStatus) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

const initialStatus: SyncStatus = {
  stage: "idle",
  lastRunAt: null,
  syncedRepos: 0,
  syncedCommits: 0,
  syncedPullRequests: 0,
  syncedIssues: 0,
  errorMessage: null,
  progress: emptySyncProgress()
};

export const useExtensionStore = create<ExtensionState>((set) => ({
  token: "",
  passphrase: "",
  deepseekApiKey: "",
  ats: null,
  resume: null,
  syncStatus: initialStatus,
  loading: false,
  error: null,
  setField: (field, value) => set((state) => ({ ...state, [field]: value })),
  setAts: (ats) => set({ ats }),
  setResume: (resume) => set({ resume }),
  setSyncStatus: (syncStatus) => set({ syncStatus }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error })
}));
