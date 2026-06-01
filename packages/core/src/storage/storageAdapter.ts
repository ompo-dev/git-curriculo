import type { AtsAnalysis, GitHubProfileSnapshot, ResumeDocument } from "../schemas";

export interface StorageAdapter {
  init(): Promise<void>;
  getLatestSnapshot(): Promise<GitHubProfileSnapshot | null>;
  saveSnapshot(snapshot: GitHubProfileSnapshot): Promise<void>;
  saveMetrics(capturedAt: string, analysis: AtsAnalysis): Promise<void>;
  saveResume(capturedAt: string, resume: ResumeDocument): Promise<void>;
  getPersistWarning?(): string | null;
}
