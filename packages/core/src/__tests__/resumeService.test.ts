import { describe, expect, it } from "vitest";

import { ResumeService } from "../services/resumeService";
import { buildSnapshotFixture } from "./fixtures";

describe("ResumeService", () => {
  it("falha sem provider quando fallback mock nao permitido", async () => {
    const service = new ResumeService();
    const snapshot = buildSnapshotFixture();

    await expect(
      service.generateResume({
        locale: "pt-BR",
        jobSpec: {
          title: "Frontend Engineer",
          summary: "React e TypeScript",
          responsibilities: ["Construir interfaces"],
          requiredSkills: ["react", "typescript"],
          preferredSkills: ["tailwind"],
          keywords: ["react", "typescript", "tailwind"]
        },
        profileSnapshot: snapshot
      })
    ).rejects.toThrow(/DeepSeek API Key obrigatoria/i);
  });

  it("gera fallback quando permitido e inclui projectEvidence", async () => {
    const service = new ResumeService(undefined, { allowMockFallback: true });
    const snapshot = buildSnapshotFixture();

    snapshot.commits.push({
      sha: "a3",
      repoName: "repo-1",
      message: "perf: reduziu requisicoes da API em 47%",
      committedAt: "2026-05-02T10:00:00.000Z",
      url: "https://github.com/octocat/repo-1/commit/a3",
      filesChanged: [],
      technologies: ["api"],
      impactSignals: ["reduziu requisicoes da API em 47%"]
    });

    const resume = await service.generateResume({
      locale: "pt-BR",
      profilePrompt: "Frontend com foco em performance",
      jobSpec: {
        title: "Frontend Engineer",
        summary: "React e TypeScript",
        responsibilities: ["Construir interfaces"],
        requiredSkills: ["react", "typescript"],
        preferredSkills: ["tailwind"],
        keywords: ["react", "typescript", "tailwind"]
      },
      profileSnapshot: snapshot
    });

    expect(resume.projectEvidence.length).toBeGreaterThan(0);
    expect(
      resume.projectEvidence.some((item) =>
        item.quantifiedImpactSignals.some((signal) => signal.includes("47%"))
      )
    ).toBe(true);
  });
});

