import { create } from "zustand";

import { readLocalStorage, readSessionStorage, writeLocalStorage, writeSessionStorage } from "@/lib/browser-storage";

interface AuthState {
  githubToken: string;
  deepseekApiKey: string;
  passphrase: string;
  showSecrets: boolean;
  hydrated: boolean;
  hydrateFromBrowser: () => void;
  setGithubToken: (token: string) => void;
  setDeepseekApiKey: (key: string) => void;
  setPassphrase: (passphrase: string) => void;
  setShowSecrets: (show: boolean) => void;
}

const SESSION_TOKEN_KEY = "git-curriculo:web:session-token";
const LOCAL_DEEPSEEK_KEY = "git-curriculo:web:deepseek-key";
const LOCAL_PASSPHRASE_KEY = "git-curriculo:web:passphrase";

export const useAuthStore = create<AuthState>((set) => ({
  githubToken: "",
  deepseekApiKey: "",
  passphrase: "",
  showSecrets: false,
  hydrated: false,
  hydrateFromBrowser: () => {
    set({
      githubToken: readSessionStorage(SESSION_TOKEN_KEY),
      deepseekApiKey: readLocalStorage(LOCAL_DEEPSEEK_KEY),
      passphrase: readLocalStorage(LOCAL_PASSPHRASE_KEY),
      hydrated: true
    });
  },
  setGithubToken: (githubToken) => {
    writeSessionStorage(SESSION_TOKEN_KEY, githubToken);
    set({ githubToken });
  },
  setDeepseekApiKey: (deepseekApiKey) => {
    writeLocalStorage(LOCAL_DEEPSEEK_KEY, deepseekApiKey);
    set({ deepseekApiKey });
  },
  setPassphrase: (passphrase) => {
    writeLocalStorage(LOCAL_PASSPHRASE_KEY, passphrase);
    set({ passphrase });
  },
  setShowSecrets: (showSecrets) => set({ showSecrets })
}));
