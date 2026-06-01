import { z } from "zod";

import {
  attachBlueprintToAnalysis,
  atsAnalysisFromBlueprint,
  blueprintToPromptBlock
} from "./atsBlueprintService";
import {
  AtsAnalysisSchema,
  AtsBlueprintSchema,
  type AtsAnalysis,
  type AtsBlueprint,
  type GitHubProfileSnapshot,
  type JobSpec
} from "../schemas";
import { normalizeKeyword, unique, buildJobKeywordPool, isJsonParseError, parseAiJsonContent } from "../utils/text";
import { buildProfileEvidenceCorpus } from "./atsEvidenceService";
import {
  buildAllProjectEvidence,
  collectSnapshotTechnologies
} from "./projectProfileService";
import {
  buildProfileFactsReport,
  filterSnapshotByRepos
} from "./stackInferenceService";
import { formatRepoDossier } from "./repoMegaSummaryService";
import { finalizeAtsAnalysis } from "./resumeAtsEnforcement";

function coerceStringArray(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.flatMap(coerceStringArray).filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["items", "points", "list", "entries", "lines", "evidence"]) {
      if (key in obj) return coerceStringArray(obj[key]);
    }
    return Object.entries(obj).flatMap(([key, entry]) => {
      const parts = coerceStringArray(entry);
      if (parts.length === 0) return [];
      if (parts.length === 1) return [`${key}: ${parts[0]}`];
      return parts.map(part => `${key}: ${part}`);
    });
  }
  return [];
}

function coerceScore(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(100, Math.max(0, Math.round(value)));
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/[^\d.]/g, ""));
    if (Number.isFinite(parsed)) return Math.min(100, Math.max(0, Math.round(parsed)));
  }
  return 0;
}

function coerceString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.content === "string") return obj.content;
    if (typeof obj.hint === "string") return obj.hint;
  }
  return String(value);
}

function unwrapAiJson(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const obj = value as Record<string, unknown>;
  for (const key of ["data", "result", "analysis", "ats", "blueprint", "response"]) {
    const nested = obj[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return unwrapAiJson(nested);
    }
  }
  return obj;
}

const stringArrayField = z.preprocess(coerceStringArray, z.array(z.string()));

const AiAtsBlueprintResponseSchema = z.object({
  version: z.preprocess(value => (value == null ? 1 : value), z.union([z.literal(1), z.number()])).transform(() => 1 as const),
  targetCompany: z.preprocess(coerceString, z.string()).optional(),
  targetTitle: z.preprocess(coerceString, z.string()),
  requiredKeywords: stringArrayField.default([]),
  evidencedKeywords: stringArrayField.default([]),
  unavailableKeywords: stringArrayField.default([]),
  summaryGuidance: z.preprocess(coerceString, z.string()).default(""),
  generationRules: stringArrayField.default([]),
  keywordEvidence: z
    .preprocess(
      value => {
        if (!Array.isArray(value)) return [];
        return value
          .map(entry => {
            if (typeof entry === "string") {
              const colon = entry.indexOf(":");
              if (colon < 0) return { keyword: entry, source: "profile", hint: entry };
              return {
                keyword: entry.slice(colon + 1).trim() || entry,
                source: entry.slice(0, colon).trim() || "profile",
                hint: entry
              };
            }
            if (entry && typeof entry === "object") {
              const obj = entry as Record<string, unknown>;
              return {
                keyword: coerceString(obj.keyword ?? obj.term ?? obj.tech),
                source: coerceString(obj.source ?? obj.repo ?? "profile"),
                hint: coerceString(obj.hint ?? obj.evidence ?? obj.description)
              };
            }
            return null;
          })
          .filter(Boolean);
      },
      z.array(
        z.object({
          keyword: z.string(),
          source: z.string(),
          hint: z.string()
        })
      )
    )
    .default([]),
  restrictions: stringArrayField.default([]),
  metricRules: stringArrayField.default([])
});

const AiAtsEvaluationResponseSchema = z.object({
  score: z.preprocess(coerceScore, z.number().min(0).max(100)),
  keywordScore: z.preprocess(coerceScore, z.number().min(0).max(100)).optional(),
  qualityScore: z.preprocess(coerceScore, z.number().min(0).max(100)).optional(),
  matchedKeywords: stringArrayField.default([]),
  missingKeywords: stringArrayField.default([]),
  evidencedKeywords: stringArrayField.default([]),
  gapsInResume: stringArrayField.default([]),
  unavailableKeywords: stringArrayField.default([]),
  suggestions: stringArrayField.default([]),
  evidence: stringArrayField.default([])
});

export interface AiAtsAnalyzerOptions {
  apiKey: string;
  model?: string;
  endpoint?: string;
}

export interface AiAtsProfileInput {
  jobSpec: JobSpec;
  jobFullText: string;
  profileSnapshot: GitHubProfileSnapshot;
  profilePrompt?: string;
  resumeRepoNames?: string[];
  existingBlueprint?: AtsBlueprint;
  /** Instrucoes do campo "Regras e ajustes" — incorporadas no blueprint. */
  customRules?: string;
}

export interface AiAtsResumeInput extends AiAtsProfileInput {
  resumeMarkdown: string;
  coverLetterMarkdown?: string;
  blueprint: AtsBlueprint;
}

export interface AiAtsProfileResult {
  ats: AtsAnalysis;
  blueprint: AtsBlueprint;
  promptBlock: string;
}

function buildProjectContextBlock(
  snapshot: GitHubProfileSnapshot,
  repoNames?: string[]
): string {
  const filtered = filterSnapshotByRepos(snapshot, repoNames);
  const evidence = buildAllProjectEvidence(filtered, { repoNames });

  return evidence
    .slice(0, repoNames?.length ? 8 : 12)
    .map(item => {
      if (item.contextDossier?.trim()) {
        return item.contextDossier.slice(0, 2200);
      }
      const analysis = snapshot.repoAnalyses?.find(a => a.repoName === item.repoName);
      if (analysis) {
        return formatRepoDossier(analysis).slice(0, 1800);
      }
      return [
        `### ${item.repoName}`,
        item.summary,
        `Stack: ${item.technologies.slice(0, 12).join(", ")}`,
        item.evidence.slice(0, 4).map(e => `- ${e}`).join("\n")
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

function extractBenefitsFromJobText(jobFullText: string): string[] {
  const lines = jobFullText
    .replace(/\r/g, "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
  const start = lines.findIndex(line => /(benef[ií]cios|o que oferecemos|benefits|perks)/i.test(line));
  if (start < 0) return [];

  const collected: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!line) continue;
    if (/(responsabilidades?|requisitos?|qualifica[cç][oõ]es|skills?|sobre a empresa|about)/i.test(line)) {
      break;
    }
    const parsed = line
      .split(/;+/)
      .map(item => item.replace(/^[-*•]\s*/, "").trim())
      .filter(item => item.length > 2);
    for (const item of parsed) {
      if (collected.length >= 8) break;
      collected.push(item);
    }
    if (collected.length >= 8) break;
  }
  return collected;
}

function buildAiAtsContext(input: AiAtsProfileInput): string {
  const profilePrompt = input.profilePrompt?.trim() ?? "";
  const allStack = collectSnapshotTechnologies(input.profileSnapshot);
  const factsReport = buildProfileFactsReport(input.profileSnapshot);
  const resumeRepos = input.resumeRepoNames?.filter(Boolean);
  const allProjectsBlock = buildProjectContextBlock(input.profileSnapshot);
  const resumeProjectsBlock = resumeRepos?.length
    ? buildProjectContextBlock(input.profileSnapshot, resumeRepos)
    : "";
  const benefits = extractBenefitsFromJobText(input.jobFullText);

  return [
    "=== VAGA ===",
    `Titulo: ${input.jobSpec.title}`,
    input.jobSpec.company ? `Empresa: ${input.jobSpec.company}` : "",
    `Resumo: ${input.jobSpec.summary.slice(0, 800)}`,
    input.jobSpec.responsibilities.length > 0
      ? `Responsabilidades:\n${input.jobSpec.responsibilities.slice(0, 12).map(r => `- ${r}`).join("\n")}`
      : "",
    input.jobSpec.requiredSkills.length > 0
      ? `Obrigatorias: ${input.jobSpec.requiredSkills.join(", ")}`
      : "",
    input.jobSpec.preferredSkills.length > 0
      ? `Desejaveis: ${input.jobSpec.preferredSkills.join(", ")}`
      : "",
    benefits.length > 0 ? `Beneficios: ${benefits.join(" | ")}` : "",
    "",
    "=== TEXTO COMPLETO DA VAGA ===",
    input.jobFullText.slice(0, 6000),
    "",
    "=== CONTEXTO PESSOAL DO CANDIDATO ===",
    profilePrompt || "(nao informado)",
    "",
    "=== TECNOLOGIAS OBSERVADAS (sync GitHub) ===",
    allStack.join(", "),
    "",
    factsReport,
    "",
    "=== PROJETOS GITHUB — dossies completos (todos os repos) ===",
    allProjectsBlock.slice(0, 10000),
    resumeProjectsBlock
      ? `\n=== PROJETOS SELECIONADOS PARA SECAO PROJETOS DO CURRICULO ===\n${resumeProjectsBlock.slice(0, 8000)}`
      : "\n=== PROJETOS NO CURRICULO ===\nUsar dossies acima (nenhum repo filtrado).",
    input.customRules?.trim()
      ? [
          "",
          "=== REGRAS E AJUSTES DO CANDIDATO (prioridade maxima no blueprint) ===",
          input.customRules.trim(),
          "Inclua estas instrucoes em generationRules e restrictions quando aplicavel."
        ].join("\n")
      : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function toBlueprint(
  raw: z.infer<typeof AiAtsBlueprintResponseSchema>,
  jobSpec: JobSpec,
  iteration = 0
): AtsBlueprint {
  return AtsBlueprintSchema.parse({
    version: 1,
    targetCompany: raw.targetCompany || jobSpec.company,
    targetTitle: raw.targetTitle || jobSpec.title,
    requiredKeywords: unique(raw.requiredKeywords.map(normalizeKeyword)),
    evidencedKeywords: unique(raw.evidencedKeywords.map(normalizeKeyword)),
    unavailableKeywords: unique(raw.unavailableKeywords.map(normalizeKeyword)),
    summaryGuidance: raw.summaryGuidance,
    generationRules: raw.generationRules.slice(0, 10),
    keywordEvidence: raw.keywordEvidence.slice(0, 20),
    restrictions: raw.restrictions.slice(0, 8),
    metricRules:
      raw.metricRules.length > 0
        ? raw.metricRules.slice(0, 6)
        : [
            "Minimo 70% dos bullets com impacto verificavel nos dossies",
            "Proibido percentuais redondos inventados (100%, 80%, 70%)",
            "Proibido contagem bruta de linhas/arquivos sem comparativo"
          ],
    iteration
  });
}

function toAtsAnalysis(raw: z.infer<typeof AiAtsEvaluationResponseSchema>): AtsAnalysis {
  return AtsAnalysisSchema.parse({
    score: raw.score,
    matchedKeywords: unique(raw.matchedKeywords.map(normalizeKeyword)),
    missingKeywords: unique(raw.missingKeywords.map(normalizeKeyword)),
    suggestions: raw.suggestions.slice(0, 8),
    evidence: raw.evidence.slice(0, 14),
    evidencedKeywords: unique(raw.evidencedKeywords.map(normalizeKeyword)),
    gapsInResume: unique(raw.gapsInResume.map(normalizeKeyword)),
    unavailableKeywords: unique(raw.unavailableKeywords.map(normalizeKeyword)),
    keywordScore: raw.keywordScore,
    qualityScore: raw.qualityScore
  });
}

export class AiAtsAnalyzer {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;

  constructor(options: AiAtsAnalyzerOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? "deepseek-chat";
    this.endpoint = options.endpoint ?? "https://api.deepseek.com/chat/completions";
  }

  async createAtsBlueprint(input: AiAtsProfileInput): Promise<AtsBlueprint> {
    const context = buildAiAtsContext(input);
    const raw = await this.callBlueprintAi(context, input.existingBlueprint);
    const iteration = input.existingBlueprint?.iteration ?? 0;
    return toBlueprint(raw, input.jobSpec, iteration);
  }

  async evaluateResumeAgainstBlueprint(input: AiAtsResumeInput): Promise<AtsAnalysis> {
    const context = buildAiAtsContext(input);
    const raw = await this.callEvaluationAi({
      context,
      blueprint: input.blueprint,
      resumeMarkdown: input.resumeMarkdown,
      coverLetterMarkdown: input.coverLetterMarkdown
    });

    const jobKeywords = buildJobKeywordPool(input.jobSpec, input.jobFullText);
    const filtered = filterSnapshotByRepos(input.profileSnapshot, input.resumeRepoNames);
    const projectEvidence = buildAllProjectEvidence(filtered, {
      repoNames: input.resumeRepoNames
    });

    const finalized = finalizeAtsAnalysis(toAtsAnalysis(raw), input.resumeMarkdown, jobKeywords, {
      jobSpec: input.jobSpec,
      projectEvidence,
      jobFullText: input.jobFullText
    });

    return attachBlueprintToAnalysis(finalized, input.blueprint);
  }

  async analyzeProfileForJob(input: AiAtsProfileInput): Promise<AiAtsProfileResult> {
    const blueprint = await this.createAtsBlueprint(input);
    const ats = atsAnalysisFromBlueprint(blueprint);
    return {
      ats,
      blueprint,
      promptBlock: blueprintToPromptBlock(blueprint)
    };
  }

  async analyzeResumeForJob(input: AiAtsResumeInput): Promise<AtsAnalysis> {
    return this.evaluateResumeAgainstBlueprint(input);
  }

  buildPromptBlock(blueprint: AtsBlueprint): string {
    return blueprintToPromptBlock(blueprint);
  }

  private async callBlueprintAi(
    context: string,
    existingBlueprint?: AtsBlueprint
  ): Promise<z.infer<typeof AiAtsBlueprintResponseSchema>> {
    try {
      return await this.callBlueprintAiOnce(context, existingBlueprint, false);
    } catch (error) {
      if (!isJsonParseError(error)) throw error;
      return this.callBlueprintAiOnce(context, existingBlueprint, true);
    }
  }

  private async callEvaluationAi(input: {
    context: string;
    blueprint: AtsBlueprint;
    resumeMarkdown: string;
    coverLetterMarkdown?: string;
  }): Promise<z.infer<typeof AiAtsEvaluationResponseSchema>> {
    try {
      return await this.callEvaluationAiOnce(input, false);
    } catch (error) {
      if (!isJsonParseError(error)) throw error;
      return this.callEvaluationAiOnce(input, true);
    }
  }

  private async callBlueprintAiOnce(
    context: string,
    existingBlueprint: AtsBlueprint | undefined,
    compact: boolean
  ): Promise<z.infer<typeof AiAtsBlueprintResponseSchema>> {
    const system = [
      "Voce simula um ATS perfeito. Leia a vaga e os dossies GitHub e retorne um BLUEPRINT JSON.",
      "O blueprint sera a fonte da verdade para gerar o curriculo — encaixe 100%.",
      "",
      "REGRAS:",
      "1. evidencedKeywords: requisitos da vaga COM evidencia real nos dossies ou contexto pessoal",
      "2. unavailableKeywords: requisitos SEM base nos dossies — NUNCA inventar no curriculo",
      "3. requiredKeywords: todas as keywords tecnicas da vaga (react, typescript, next.js, etc.)",
      "4. keywordEvidence: mapeie keyword → repo/fonte → hint curto (max 80 chars)",
      "5. generationRules: regras concretas para o gerador (ex: incluir shadcn nos bullets Room Company)",
      "6. summaryGuidance: como personalizar resumo para empresa/titulo da vaga",
      "7. restrictions: o que NAO fazer (inventar metricas, keyword dump, etc.)",
      "8. metricRules: regras de metricas verificaveis dos dossies",
      "9. NUNCA inclua palavras genericas de anuncio (pessoas, conhecimento, implementar, solucoes)",
      "10. Se houver REGRAS E AJUSTES DO CANDIDATO no contexto, replique-as em generationRules e restrictions",
      "11. Responda APENAS JSON valido"
    ].join("\n");

    const user = [
      existingBlueprint
        ? "Atualize o blueprint com base no feedback da iteracao anterior (mantenha o que ja funcionou)."
        : "Crie o blueprint ATS inicial para esta vaga.",
      "",
      "Retorne JSON EXATO:",
      "{",
      '  "version": 1,',
      '  "targetCompany": string,',
      '  "targetTitle": string,',
      '  "requiredKeywords": string[],',
      '  "evidencedKeywords": string[],',
      '  "unavailableKeywords": string[],',
      '  "summaryGuidance": string,',
      '  "generationRules": string[],',
      '  "keywordEvidence": [{ "keyword": string, "source": string, "hint": string }],',
      '  "restrictions": string[],',
      '  "metricRules": string[]',
      "}",
      compact ? "MODO COMPACTO: arrays curtos, strings breves." : "",
      existingBlueprint ? `\n=== BLUEPRINT ANTERIOR ===\n${JSON.stringify(existingBlueprint).slice(0, 4000)}` : "",
      "",
      context.slice(0, compact ? 8000 : 12000)
    ]
      .filter(Boolean)
      .join("\n");

    return this.postJson(system, user, AiAtsBlueprintResponseSchema);
  }

  private async callEvaluationAiOnce(
    input: {
      context: string;
      blueprint: AtsBlueprint;
      resumeMarkdown: string;
      coverLetterMarkdown?: string;
    },
    compact: boolean
  ): Promise<z.infer<typeof AiAtsEvaluationResponseSchema>> {
    const system = [
      "Voce e um avaliador ATS. Compare o CURRICULO gerado contra o BLUEPRINT ATS (fonte da verdade).",
      "NAO rederive keywords do zero — avalie aderencia ao blueprint.",
      "",
      "REGRAS:",
      "1. score: aderencia geral curriculo vs blueprint (0-100)",
      "2. keywordScore: % de evidencedKeywords do blueprint presentes no curriculo",
      "3. qualityScore: qualidade profissional (metricas, verbos, personalizacao)",
      "4. gapsInResume: keywords do blueprint evidenciadas mas AUSENTES no curriculo",
      "5. missingKeywords: lacunas vs blueprint (nao palavras genericas)",
      "6. unavailableKeywords: copie do blueprint — nao inventar",
      "7. suggestions: correcoes concretas para proxima iteracao",
      "8. evidence: max 10 linhas curtas com achados da avaliacao",
      "9. Responda APENAS JSON valido"
    ].join("\n");

    const user = [
      "Avalie o curriculo contra o blueprint abaixo.",
      "",
      "Retorne JSON EXATO:",
      "{",
      '  "score": number,',
      '  "keywordScore": number,',
      '  "qualityScore": number,',
      '  "matchedKeywords": string[],',
      '  "missingKeywords": string[],',
      '  "evidencedKeywords": string[],',
      '  "gapsInResume": string[],',
      '  "unavailableKeywords": string[],',
      '  "suggestions": string[],',
      '  "evidence": string[]',
      "}",
      compact ? "MODO COMPACTO." : "",
      "",
      "=== ATS BLUEPRINT (referencia) ===",
      JSON.stringify(input.blueprint).slice(0, compact ? 3000 : 5000),
      "",
      "=== CURRICULO GERADO ===",
      input.resumeMarkdown.slice(0, compact ? 6000 : 9000),
      input.coverLetterMarkdown
        ? `\n=== CARTA ===\n${input.coverLetterMarkdown.slice(0, 1500)}`
        : "",
      "",
      input.context.slice(0, compact ? 4000 : 6000)
    ]
      .filter(Boolean)
      .join("\n");

    return this.postJson(system, user, AiAtsEvaluationResponseSchema);
  }

  private async postJson<T extends z.ZodTypeAny>(
    system: string,
    user: string,
    schema: T
  ): Promise<z.infer<T>> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.15,
        max_tokens: 4096,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Erro DeepSeek ATS (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? "{}";
    const json = unwrapAiJson(parseAiJsonContent(content));
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `Resposta ATS invalida da IA: ${parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`
      );
    }
    return parsed.data;
  }
}

export { buildProfileEvidenceCorpus };
