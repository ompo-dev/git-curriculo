import { describe, expect, it } from "bun:test";

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

  it("parseJobText extrai titulo e keywords da vaga", () => {
    const service = new ResumeService();
    const jobSpec = service.parseJobText(
      "Frontend Engineer\nReact TypeScript\nResponsabilidades: construir UI"
    );
    expect(jobSpec.title.length).toBeGreaterThan(0);
    expect(jobSpec.keywords.length).toBeGreaterThan(0);
  });

  it("parseJobText extrai empresa e cargo de vaga do LinkedIn", () => {
    const service = new ResumeService();
    const jobSpec = service.parseJobText(
      [
        "act digital",
        "React Developer",
        "act digital · Lisboa e Região (Híbrido)",
        "",
        "About the Role:",
        "We are looking for a React Developer...",
        "Responsibilities:",
        "Collaborate closely with backend, product, and UX/UI teams"
      ].join("\n")
    );

    expect(jobSpec.title.toLowerCase()).toContain("react");
    expect(jobSpec.company?.toLowerCase()).toContain("act");
  });

  it("nao usa 'Sobre a Empresa' como nome da empresa", () => {
    const service = new ResumeService();
    const jobSpec = service.parseJobText(
      [
        "Desenvolvedor Front-End",
        "Sobre a Empresa",
        "Zanc Acessoria Nacional de Cobranca",
        "Responsabilidades:",
        "- Construir interfaces com React"
      ].join("\n")
    );

    expect(jobSpec.company?.toLowerCase()).not.toContain("sobre a empresa");
    expect(jobSpec.company?.toLowerCase()).toContain("zanc");
  });
});
