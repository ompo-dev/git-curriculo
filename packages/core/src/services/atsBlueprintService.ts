import type { AtsAnalysis, AtsBlueprint, JobSpec } from "../schemas";
import { filterMeaningfulAtsKeywords, normalizeKeyword, unique } from "../utils/text";

export interface BlueprintGenerationOptions {
  jobSpec: JobSpec;
  resumeRepoNames?: string[];
  omitSkillsRule?: boolean;
  customRules?: string;
  extraRules?: string;
}

/** Converte blueprint JSON em regras de geracao — fonte da verdade para o curriculo. */
export function blueprintToGenerationRules(
  blueprint: AtsBlueprint,
  options: BlueprintGenerationOptions
): string {
  const { jobSpec, resumeRepoNames, omitSkillsRule, customRules, extraRules } = options;
  const projectEvidence = blueprint.keywordEvidence.filter(entry =>
    resumeRepoNames?.length
      ? resumeRepoNames.some(repo => normalizeKeyword(entry.source).includes(normalizeKeyword(repo)))
      : true
  );
  const experienceEvidence = blueprint.keywordEvidence.filter(
    entry => !projectEvidence.includes(entry)
  );

  const lines = [
    "=== ATS BLUEPRINT v1 (encaixe 100% — nao desvie deste plano) ===",
    blueprint.targetCompany ? `Empresa alvo: ${blueprint.targetCompany}` : "",
    `Titulo alvo: ${blueprint.targetTitle}`,
    blueprint.iteration > 0 ? `Iteracao: ${blueprint.iteration}` : "",
    "",
    "CHECKLIST OBRIGATORIO — cada termo DEVE aparecer literalmente no curriculo:",
    blueprint.evidencedKeywords.join(", ") || "(nenhum)",
    omitSkillsRule
      ? "Inclua nos bullets de Experiencia ou Projetos (NAO ha secao Skills)."
      : "Inclua na secao Skills OU bullets de Experiencia/Projetos.",
    "",
    blueprint.summaryGuidance ? `RESUMO: ${blueprint.summaryGuidance}` : "",
    "",
    blueprint.generationRules.length > 0
      ? ["REGRAS DE GERACAO:", ...blueprint.generationRules.map(rule => `- ${rule}`)].join("\n")
      : "",
    projectEvidence.length > 0
      ? [
          "",
          resumeRepoNames?.length
            ? `MAPEAMENTO → PROJETOS (${resumeRepoNames.join(", ")}):`
            : "MAPEAMENTO → PROJETOS:",
          ...projectEvidence.slice(0, 18).map(entry => `- ${entry.source}: ${entry.keyword} — ${entry.hint}`)
        ].join("\n")
      : "",
    experienceEvidence.length > 0
      ? [
          "",
          "MAPEAMENTO → EXPERIENCIA (nao criar projetos para estes):",
          ...experienceEvidence.slice(0, 12).map(entry => `- ${entry.source}: ${entry.keyword} — ${entry.hint}`)
        ].join("\n")
      : "",
    blueprint.restrictions.length > 0
      ? ["", "RESTRICOES:", ...blueprint.restrictions.map(rule => `- ${rule}`)].join("\n")
      : "",
    blueprint.metricRules.length > 0
      ? ["", "METRICAS:", ...blueprint.metricRules.map(rule => `- ${rule}`)].join("\n")
      : "",
    blueprint.unavailableKeywords.length > 0
      ? `\nNAO INVENTAR (sem base nos dossies): ${blueprint.unavailableKeywords.join(", ")}`
      : "",
    jobSpec.company && !blueprint.targetCompany
      ? `\nEmpresa alvo: ${jobSpec.company} — mencione no ## Resumo.`
      : "",
    resumeRepoNames?.length
      ? `\nSecao ## Projetos: EXCLUSIVAMENTE ${resumeRepoNames.join(", ")}.`
      : ""
  ].filter(Boolean);

  return [lines.join("\n"), customRules?.trim(), extraRules?.trim()].filter(Boolean).join("\n\n");
}

export function blueprintToPromptBlock(blueprint: AtsBlueprint): string {
  return [
    "=== ATS BLUEPRINT ===",
    "",
    "CHECKLIST OBRIGATORIO:",
    blueprint.evidencedKeywords.join(", ") || "(nenhuma)",
    "",
    "NAO INVENTAR:",
    blueprint.unavailableKeywords.join(", ") || "(nenhuma)"
  ].join("\n");
}

/** Estado inicial do ATS antes de gerar o curriculo (blueprint criado, ainda nao avaliado). */
export function atsAnalysisFromBlueprint(blueprint: AtsBlueprint): AtsAnalysis {
  const evidenced = filterMeaningfulAtsKeywords(blueprint.evidencedKeywords);
  return {
    score: 0,
    matchedKeywords: [],
    missingKeywords: evidenced,
    suggestions: blueprint.generationRules.slice(0, 6),
    evidence: [
      "Blueprint ATS criado — gerando curriculo alinhado ao plano...",
      ...blueprint.keywordEvidence.slice(0, 6).map(entry => `${entry.source}: ${entry.keyword} — ${entry.hint}`)
    ],
    evidencedKeywords: evidenced,
    gapsInResume: evidenced,
    unavailableKeywords: blueprint.unavailableKeywords,
    blueprint
  };
}

/** Atualiza blueprint com feedback da avaliacao para proxima iteracao. */
export function updateBlueprintFromEvaluation(
  blueprint: AtsBlueprint,
  evaluation: AtsAnalysis
): AtsBlueprint {
  const gaps = filterMeaningfulAtsKeywords(
    unique([...evaluation.gapsInResume, ...evaluation.missingKeywords])
  );
  const newRules = unique([
    ...blueprint.generationRules,
    ...evaluation.suggestions.slice(0, 4).map(s => `[iter ${blueprint.iteration + 1}] ${s}`)
  ]).slice(0, 12);

  if (gaps.length > 0) {
    newRules.push(`Incluir obrigatoriamente no curriculo: ${gaps.slice(0, 12).join(", ")}`);
  }

  return {
    ...blueprint,
    iteration: blueprint.iteration + 1,
    generationRules: newRules,
    evidencedKeywords: unique([
      ...blueprint.evidencedKeywords,
      ...evaluation.evidencedKeywords
    ])
  };
}

export function attachBlueprintToAnalysis(
  analysis: AtsAnalysis,
  blueprint: AtsBlueprint
): AtsAnalysis {
  return { ...analysis, blueprint };
}
