import { create } from "zustand";

import type { AtsBlueprint } from "@gitcurriculo/core";

import { readJsonLocalStorage, readLocalStorage, writeLocalStorage } from "@/lib/browser-storage";

interface ResumeEditorState {
  jobText: string;
  profilePrompt: string;
  customRules: string;
  regenerateNotes: string;
  coverRegenerateNotes: string;
  streamingMarkdown: string;
  editedMarkdown: string;
  resumeSourceMarkdown: string;
  aiAtsPromptBlock: string;
  atsBlueprint: AtsBlueprint | null;
  isStreaming: boolean;
  coverLetterMarkdown: string;
  isGeneratingCoverLetter: boolean;
  contentTab: "resume" | "cover-letter";
  previewMode: "raw" | "preview";
  copiedMd: boolean;
  resumeRepoNames: string[];
  hydrated: boolean;
  setJobText: (v: string) => void;
  setProfilePrompt: (v: string) => void;
  setCustomRules: (v: string) => void;
  setRegenerateNotes: (v: string) => void;
  setCoverRegenerateNotes: (v: string) => void;
  setStreamingMarkdown: (v: string) => void;
  setEditedMarkdown: (v: string) => void;
  setResumeSourceMarkdown: (v: string) => void;
  setAiAtsPromptBlock: (v: string) => void;
  setAtsBlueprint: (v: AtsBlueprint | null) => void;
  setIsStreaming: (v: boolean) => void;
  setCoverLetterMarkdown: (v: string) => void;
  setIsGeneratingCoverLetter: (v: boolean) => void;
  setContentTab: (v: "resume" | "cover-letter") => void;
  setPreviewMode: (v: "raw" | "preview") => void;
  setCopiedMd: (v: boolean) => void;
  setResumeRepoNames: (v: string[] | ((prev: string[]) => string[])) => void;
  hydrateFromBrowser: () => void;
}

const KEYS = {
  jobText: "git-curriculo:web:job-text",
  profilePrompt: "git-curriculo:web:profile-prompt",
  customRules: "git-curriculo:web:custom-rules",
  regenerateNotes: "git-curriculo:web:regenerate-notes",
  coverRegenerateNotes: "git-curriculo:web:cover-regenerate-notes",
  resumeRepos: "git-curriculo:resume-repos"
} as const;

export const useResumeStore = create<ResumeEditorState>((set) => ({
  jobText: "",
  profilePrompt: "",
  customRules: "",
  regenerateNotes: "",
  coverRegenerateNotes: "",
  streamingMarkdown: "",
  editedMarkdown: "",
  resumeSourceMarkdown: "",
  aiAtsPromptBlock: "",
  atsBlueprint: null,
  isStreaming: false,
  coverLetterMarkdown: "",
  isGeneratingCoverLetter: false,
  contentTab: "resume",
  previewMode: "raw",
  copiedMd: false,
  resumeRepoNames: [],
  hydrated: false,
  hydrateFromBrowser: () => {
    const repos = readJsonLocalStorage<unknown>(KEYS.resumeRepos, []);
    set({
      jobText: readLocalStorage(KEYS.jobText),
      profilePrompt: readLocalStorage(KEYS.profilePrompt),
      customRules: readLocalStorage(KEYS.customRules),
      regenerateNotes: readLocalStorage(KEYS.regenerateNotes),
      coverRegenerateNotes: readLocalStorage(KEYS.coverRegenerateNotes),
      resumeRepoNames: Array.isArray(repos)
        ? repos.filter((item): item is string => typeof item === "string")
        : [],
      hydrated: true
    });
  },
  setJobText: (jobText) => {
    writeLocalStorage(KEYS.jobText, jobText);
    set({ jobText });
  },
  setProfilePrompt: (profilePrompt) => {
    writeLocalStorage(KEYS.profilePrompt, profilePrompt);
    set({ profilePrompt });
  },
  setCustomRules: (customRules) => {
    writeLocalStorage(KEYS.customRules, customRules);
    set({ customRules });
  },
  setRegenerateNotes: (regenerateNotes) => {
    writeLocalStorage(KEYS.regenerateNotes, regenerateNotes);
    set({ regenerateNotes });
  },
  setCoverRegenerateNotes: (coverRegenerateNotes) => {
    writeLocalStorage(KEYS.coverRegenerateNotes, coverRegenerateNotes);
    set({ coverRegenerateNotes });
  },
  setStreamingMarkdown: (streamingMarkdown) => set({ streamingMarkdown }),
  setEditedMarkdown: (editedMarkdown) => set({ editedMarkdown }),
  setResumeSourceMarkdown: (resumeSourceMarkdown) => set({ resumeSourceMarkdown }),
  setAiAtsPromptBlock: (aiAtsPromptBlock) => set({ aiAtsPromptBlock }),
  setAtsBlueprint: (atsBlueprint) => set({ atsBlueprint }),
  setIsStreaming: (isStreaming) => set({ isStreaming }),
  setCoverLetterMarkdown: (coverLetterMarkdown) => set({ coverLetterMarkdown }),
  setIsGeneratingCoverLetter: (isGeneratingCoverLetter) => set({ isGeneratingCoverLetter }),
  setContentTab: (contentTab) => set({ contentTab }),
  setPreviewMode: (previewMode) => set({ previewMode }),
  setCopiedMd: (copiedMd) => set({ copiedMd }),
  setResumeRepoNames: (updater) =>
    set((state) => {
      const resumeRepoNames = typeof updater === "function" ? updater(state.resumeRepoNames) : updater;
      writeLocalStorage(KEYS.resumeRepos, JSON.stringify(resumeRepoNames));
      return { resumeRepoNames };
    })
}));
