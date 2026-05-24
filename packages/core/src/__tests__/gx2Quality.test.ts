import { describe, expect, it } from "vitest";

import { analyzeResumeQuality } from "../services/resumeQualityService";
import { ensureJobPersonalization } from "../services/resumeAtsEnforcement";
import { ResumeService } from "../services/resumeService";

const gx2Job = `Front End Developer (React/Next) | Mid-Level
Overview da oportunidade:
plataforma de cripto moedas, trading, exchanges
Responsabilidades e atribuições:
Desenvolver interfaces ricas e responsivas com Next.js (App Router), React 19 e TypeScript;
Implementar dashboards financeiros com visualização de dados em tempo real;
Integrar o front end com APIs RESTful via Axios, utilizando React Query para cache;
Colaborar com UX/UI designers na tradução de wireframes e protótipos Figma em interfaces funcionais.
Habilidades que você precisa ter:
Experiência com React e TypeScript;
Recado da GX2:
Somos a GX2`;

describe("GX2 job quality", () => {
  it("parses responsibilities and scores role adherence above zero", () => {
    const svc = new ResumeService();
    const jobSpec = svc.parseJobText(gx2Job);
    const md = `# Maicon
## Resumo
Engenheiro Front-End com React, Next.js, TypeScript e fintech.

## Experiência
- Desenvolvi interfaces com React e Next.js e caching com Axios

## Projetos
- Integracao exchange webhook`;

    const personalized = ensureJobPersonalization(md, jobSpec);
    const report = analyzeResumeQuality(personalized, { jobSpec, jobFullText: gx2Job });

    expect(jobSpec.company).toBe("GX2");
    expect(jobSpec.responsibilities.length).toBeGreaterThan(0);
    expect(personalized).toContain("GX2");
    expect(report.roleAdherencePct).toBeGreaterThan(0);
    expect(report.personalizationPct).toBeGreaterThanOrEqual(80);
  });
});
