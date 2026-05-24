import Cookies from "js-cookie";

import { SettingsSchema, type Settings } from "../schemas";

export class LocalStateStorage {
  constructor(
    private readonly localStorageKey = "git-curriculo:settings",
    private readonly cookieThemeKey = "gc_theme",
    private readonly cookieOnboardingKey = "gc_onboarding",
    private readonly cookieSyncKey = "gc_last_sync"
  ) {}

  loadSettings(): Settings {
    const raw = localStorage.getItem(this.localStorageKey);
    if (!raw) {
      return SettingsSchema.parse({});
    }

    try {
      return SettingsSchema.parse(JSON.parse(raw));
    } catch {
      return SettingsSchema.parse({});
    }
  }

  saveSettings(settings: Settings): void {
    const parsed = SettingsSchema.parse(settings);
    localStorage.setItem(this.localStorageKey, JSON.stringify(parsed));

    if (parsed.lastSyncAt) {
      Cookies.set(this.cookieSyncKey, parsed.lastSyncAt, { sameSite: "strict" });
    }
  }

  setTheme(theme: "light" | "dark"): void {
    Cookies.set(this.cookieThemeKey, theme, { sameSite: "strict" });
  }

  getTheme(): "light" | "dark" | undefined {
    const value = Cookies.get(this.cookieThemeKey);
    if (value === "light" || value === "dark") {
      return value;
    }
    return undefined;
  }

  setOnboardingComplete(): void {
    Cookies.set(this.cookieOnboardingKey, "1", { sameSite: "strict" });
  }

  isOnboardingComplete(): boolean {
    return Cookies.get(this.cookieOnboardingKey) === "1";
  }
}