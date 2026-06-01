import { describe, expect, it } from "bun:test";

import {
  atsAnalysisFromBlueprint,
  blueprintToGenerationRules,
  composeResumeGenerationRules,
  updateBlueprintFromEvaluation
} from "../services/atsBlueprintService";
import type { AtsBlueprint } from "../schemas";

const sampleBlueprint: AtsBlueprint = {
  version: 1,
  targetCompany: "GX2",
  targetTitle: "Front End Developer (React/Next)",
  requiredKeywords: ["react", "typescript", "next.js"],
  evidencedKeywords: ["react", "typescript", "tanstack", "shadcn"],
  unavailableKeywords: ["react 19", "wcag"],
  summaryGuidance: "Mencionar GX2 e integrar techs naturalmente.",
  generationRules: ["Incluir shadcn nos bullets da Room Company"],
  keywordEvidence: [
    { keyword: "react", source: "gymrats", hint: "monorepo Next.js + React" }
  ],
  restrictions: ["Nao inventar metricas"],
  metricRules: ["70% bullets com impacto verificavel"],
  iteration: 0
};

describe("ATS blueprint pipeline", () => {
  it("composes candidate rules before blueprint rules", () => {
    const rules = blueprintToGenerationRules(sampleBlueprint, {
      jobSpec: {
        title: sampleBlueprint.targetTitle,
        company: "GX2",
        summary: "",
        responsibilities: [],
        requiredSkills: [],
        preferredSkills: [],
        keywords: []
      },
      resumeRepoNames: ["gymrats"]
    });

    const composed = composeResumeGenerationRules(rules, "Nao mencione Tegma", "Extra pass");

    expect(composed.indexOf("Nao mencione Tegma")).toBeLessThan(composed.indexOf("ATS BLUEPRINT"));
    expect(composed).toContain("PRIORIDADE ABSOLUTA");
    expect(composed).toContain("Extra pass");
  });

  it("converts blueprint to generation rules with checklist", () => {
    const rules = blueprintToGenerationRules(sampleBlueprint, {
      jobSpec: {
        title: sampleBlueprint.targetTitle,
        company: "GX2",
        summary: "",
        responsibilities: [],
        requiredSkills: [],
        preferredSkills: [],
        keywords: []
      },
      resumeRepoNames: ["gymrats"]
    });

    expect(rules).toContain("ATS BLUEPRINT");
    expect(rules).toContain("shadcn");
    expect(rules).toContain("gymrats");
    expect(rules).not.toContain("pessoas");
  });

  it("creates pre-evaluation ATS state from blueprint", () => {
    const ats = atsAnalysisFromBlueprint(sampleBlueprint);
    expect(ats.score).toBe(0);
    expect(ats.evidencedKeywords).toContain("react");
    expect(ats.blueprint).toEqual(sampleBlueprint);
  });

  it("updates blueprint after evaluation for next iteration", () => {
    const updated = updateBlueprintFromEvaluation(sampleBlueprint, {
      score: 82,
      matchedKeywords: ["react"],
      missingKeywords: ["shadcn"],
      suggestions: ["Incluir shadcn explicitamente"],
      evidence: [],
      evidencedKeywords: ["react"],
      gapsInResume: ["shadcn"],
      unavailableKeywords: ["wcag"]
    });

    expect(updated.iteration).toBe(1);
    expect(updated.generationRules.some(rule => rule.includes("shadcn"))).toBe(true);
  });
});
