import type { GitHubProfileSnapshot, JobSpec } from "../schemas";
import { buildAllProjectEvidence, collectSnapshotTechnologies } from "./projectProfileService";
import { filterSnapshotByRepos } from "./stackInferenceService";
import { DeepSeekResumeProvider, ResumeService, type DeepSeekProviderOptions } from "./resumeService";

export interface GenerateCoverLetterInput {
  jobSpec: JobSpec;
  profileSnapshot: GitHubProfileSnapshot;
  deepseekApiKey: string;
  profilePrompt?: string;
  customRules?: string;
  resumeRepoNames?: string[];
  resumeMarkdown?: string;
  regenerateNotes?: string;
  locale?: string;
}

export class CoverLetterService {
  private createResumeService(apiKey: string): ResumeService {
    const provider = new DeepSeekResumeProvider({ apiKey } satisfies DeepSeekProviderOptions);
    return new ResumeService(provider);
  }

  async generateStream(
    input: GenerateCoverLetterInput,
    onChunk: (accumulated: string) => void
  ): Promise<string> {
    const service = this.createResumeService(input.deepseekApiKey);
    const filteredSnapshot = input.resumeRepoNames?.length
      ? filterSnapshotByRepos(input.profileSnapshot, input.resumeRepoNames)
      : input.profileSnapshot;

    const projectEvidence = buildAllProjectEvidence(filteredSnapshot);
    const allStackTechnologies = collectSnapshotTechnologies(filteredSnapshot);

    return service.streamCoverLetter(
      {
        jobSpec: input.jobSpec,
        profileSnapshot: filteredSnapshot,
        profilePrompt: input.profilePrompt ?? "",
        customRules: input.regenerateNotes
          ? `${input.customRules ?? ""}\n\nNotas de regeneracao:\n${input.regenerateNotes}`.trim()
          : input.customRules,
        resumeRepoNames: input.resumeRepoNames,
        resumeMarkdown: input.resumeMarkdown,
        locale: input.locale ?? "pt-BR"
      },
      onChunk
    );
  }
}
