import { describe, expect, it } from "bun:test";

import { ensureSkillsSectionKeywords, finalizeAtsAnalysis } from "../services/resumeAtsEnforcement";
import { buildJobKeywordPool, filterMeaningfulAtsKeywords, isMeaningfulAtsKeyword } from "../utils/text";
import { ResumeService } from "../services/resumeService";

const gx2Job = `Front End Developer (React/Next) | Mid-Level
Overview da oportunidade:
plataforma de cripto moedas, trading, exchanges para pessoas com conhecimento em solucoes digitais
Responsabilidades e atribuições:
Desenvolver interfaces ricas e responsivas com Next.js (App Router), React 19 e TypeScript;
Implementar dashboards financeiros com visualização de dados em tempo real;
Integrar o front end com APIs RESTful via Axios, utilizando React Query para cache;
Colaborar com UX/UI designers na tradução de wireframes e protótipos Figma em interfaces funcionais.
Habilidades que você precisa ter:
Experiência com React e TypeScript;
Recado da GX2:
Somos a GX2`;

describe("ATS keyword filtering", () => {
  it("rejects generic job ad words as lacunas", () => {
    const noise = [
      "pessoas",
      "conhecimento",
      "solucoes",
      "operacoes",
      "real",
      "implementar",
      "desenvolvimento",
      "experiencia"
    ];
    for (const word of noise) {
      expect(isMeaningfulAtsKeyword(word)).toBe(false);
    }
  });

  it("keeps real tech and skill gaps", () => {
    expect(isMeaningfulAtsKeyword("shadcn")).toBe(true);
    expect(isMeaningfulAtsKeyword("acessibilidade")).toBe(true);
    expect(isMeaningfulAtsKeyword("react")).toBe(true);
    expect(isMeaningfulAtsKeyword("app router")).toBe(true);
    expect(isMeaningfulAtsKeyword("react 19")).toBe(true);
  });

  it("does not pollute job keyword pool with frequent boilerplate", () => {
    const svc = new ResumeService();
    const jobSpec = svc.parseJobText(gx2Job);
    const pool = buildJobKeywordPool(jobSpec, gx2Job);

    expect(pool).not.toContain("pessoas");
    expect(pool).not.toContain("conhecimento");
    expect(pool).not.toContain("solucoes");
    expect(pool).not.toContain("implementar");
    expect(pool.some(kw => kw.includes("react"))).toBe(true);
  });

  it("finalizeAtsAnalysis omits nonsense from missingKeywords", () => {
    const svc = new ResumeService();
    const jobSpec = svc.parseJobText(gx2Job);
    const jobKeywords = buildJobKeywordPool(jobSpec, gx2Job);
    const resume = `# Dev
## Resumo
React, Next.js, TypeScript, TanStack Query, Axios, Zod, Hook Form.

## Experiencia
- Desenvolvi interfaces com React e Next.js`;

    const ats = finalizeAtsAnalysis(
      {
        score: 80,
        matchedKeywords: ["react"],
        missingKeywords: ["pessoas", "conhecimento", "shadcn"],
        suggestions: [],
        evidence: [],
        evidencedKeywords: ["react", "typescript", "shadcn"],
        gapsInResume: [],
        unavailableKeywords: ["react 19", "wcag"]
      },
      resume,
      jobKeywords,
      { jobSpec, jobFullText: gx2Job }
    );

    expect(ats.missingKeywords).not.toContain("pessoas");
    expect(ats.missingKeywords).not.toContain("conhecimento");
    expect(filterMeaningfulAtsKeywords(ats.missingKeywords)).toEqual(ats.missingKeywords);
  });

  it("ensureSkillsSectionKeywords adds missing evidenced skills without duplicates", () => {
    const markdown = `# Dev
## Resumo
Resumo curto.

## Skills
- React
- TypeScript

## Experiencia
- Entreguei telas com React e TypeScript.`;

    const result = ensureSkillsSectionKeywords(markdown, ["react", "next.js", "typescript", "tanstack"]);

    expect(result).toContain("## Skills");
    expect(result).toContain("- Next.js");
    expect(result).toContain("- TanStack Query");
    expect((result.match(/- React/g) ?? []).length).toBe(1);
  });

  it("ensureSkillsSectionKeywords creates Skills section when missing", () => {
    const markdown = `# Dev
## Resumo
Resumo curto.

## Contato
- Email: dev@example.com`;

    const result = ensureSkillsSectionKeywords(markdown, ["next.js", "react hook form"]);

    expect(result).toContain("## Skills");
    expect(result).toContain("- Next.js");
    expect(result).toContain("- React Hook Form");
    expect(result.indexOf("## Skills")).toBeGreaterThan(result.indexOf("## Contato"));
  });
});
