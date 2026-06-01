import type { AtsAnalysis, GitHubProfileSnapshot, ResumeDocument, StorageAdapter } from "@gitcurriculo/core";

export class TauriStorageAdapter implements StorageAdapter {
  private dataDir: string | null = null;

  async init(): Promise<void> {
    const { appDataDir, join } = await import("@tauri-apps/api/path");
    const { exists, mkdir } = await import("@tauri-apps/plugin-fs");
    this.dataDir = await join(await appDataDir(), "git-curriculo");
    if (!(await exists(this.dataDir))) {
      await mkdir(this.dataDir, { recursive: true });
    }
  }

  private async readJson<T>(fileName: string): Promise<T | null> {
    if (!this.dataDir) await this.init();
    const { join } = await import("@tauri-apps/api/path");
    const { readTextFile, exists } = await import("@tauri-apps/plugin-fs");
    const path = await join(this.dataDir!, fileName);
    if (!(await exists(path))) return null;
    const raw = await readTextFile(path);
    return JSON.parse(raw) as T;
  }

  private async writeJson(fileName: string, value: unknown): Promise<void> {
    if (!this.dataDir) await this.init();
    const { join } = await import("@tauri-apps/api/path");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await join(this.dataDir!, fileName);
    await writeTextFile(path, JSON.stringify(value));
  }

  async getLatestSnapshot(): Promise<GitHubProfileSnapshot | null> {
    return this.readJson("snapshot.json");
  }

  async saveSnapshot(snapshot: GitHubProfileSnapshot): Promise<void> {
    await this.writeJson("snapshot.json", snapshot);
  }

  async saveMetrics(_capturedAt: string, analysis: AtsAnalysis): Promise<void> {
    await this.writeJson("metrics.json", analysis);
  }

  async saveResume(_capturedAt: string, resume: ResumeDocument): Promise<void> {
    await this.writeJson("resume.json", resume);
  }
}
