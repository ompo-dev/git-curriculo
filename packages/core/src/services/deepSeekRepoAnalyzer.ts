import { z } from "zod";

import type { IssueSnapshot, LanguageStat, RepoAnalysisSummary, RepoSnapshot } from "../schemas";
import { unique } from "../utils/text";
import type { AnalyzedCommit, AnalyzedPullRequest } from "./repoAnalysisService";
import { buildRepoAnalysisSummary, filterSubstantiveBullets } from "./repoAnalysisService";
import {
  computeRepoMetrics,
  enrichAnalysisWithMegaSummary,
  inferRepoOrganization
} from "./repoMegaSummaryService";

const KeyContributionSchema = z.object({
  type: z.enum(["commit", "pull_request", "issue", "contribution"]),
  reference: z.string(),
  title: z.string(),
  what: z.string(),
  how: z.string().default(""),
  why: z.string().default(""),
  impact: z.string().default(""),
  technologies: z.array(z.string()).default([]),
  metrics: z.string().optional()
});

const MegaDossierSchema = z.object({
  megaSummary: z.string().default(""),
  purpose: z.string().default(""),
  repoOrganization: z.string().default(""),
  architectureAnalysis: z.string().default(""),
  contributionOverview: z.string().default(""),
  narrative: z.string().default(""),
  technologies: z.array(z.string()).default([]),
  architectureSignals: z.array(z.string()).default([]),
  quantifiedImpacts: z.array(z.string()).default([]),
  highlights: z.array(z.string()).default([]),
  engineeringInsights: z.array(z.string()).default([]),
  keyContributions: z.array(KeyContributionSchema).default([])
});

const DeepSeekRepoAnalysisSchema = z.object({
  repoSummary: z.string().default(""),
  technologies: z.array(z.string()).default([]),
  architectureSignals: z.array(z.string()).default([]),
  quantifiedImpacts: z.array(z.string()).default([]),
  highlights: z.array(z.string()).default([]),
  engineeringInsights: z.array(z.string()).default([]),
  commits: z
    .array(
      z.object({
        sha: z.string(),
        analysisSummary: z.string(),
        technologies: z.array(z.string()).default([]),
        impactSignals: z.array(z.string()).default([])
      })
    )
    .default([]),
  pullRequests: z
    .array(
      z.object({
        number: z.number(),
        analysisSummary: z.string(),
        technologies: z.array(z.string()).default([]),
        impactSignals: z.array(z.string()).default([])
      })
    )
    .default([])
});

export interface DeepSeekRepoAnalyzerOptions {
  apiKey: string;
  model?: string;
  endpoint?: string;
}

export interface DeepSeekRepoAnalysisInput {
  repo: RepoSnapshot;
  commits: AnalyzedCommit[];
  pullRequests: AnalyzedPullRequest[];
  issues: IssueSnapshot[];
  languages: LanguageStat[];
}

export interface DeepSeekRepoAnalysisResult {
  commits: AnalyzedCommit[];
  pullRequests: AnalyzedPullRequest[];
  summary: RepoAnalysisSummary;
}

const COMMIT_CHUNK_SIZE = 80;
const PR_CHUNK_SIZE = 40;
const SINGLE_CALL_MAX_ITEMS = 100;

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export class DeepSeekRepoAnalyzer {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;

  constructor(options: DeepSeekRepoAnalyzerOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? "deepseek-chat";
    this.endpoint = options.endpoint ?? "https://api.deepseek.com/v1/chat/completions";
  }

  async analyzeRepository(input: DeepSeekRepoAnalysisInput): Promise<DeepSeekRepoAnalysisResult> {
    const totalItems = input.commits.length + input.pullRequests.length;

    if (totalItems <= SINGLE_CALL_MAX_ITEMS) {
      const corpus = this.buildCorpus(input);
      const parsed = await this.callDeepSeek(corpus, input.repo.name, "analise completa");
      const merged = this.mergeAnalysis(input, parsed);
      return this.finalizeWithMegaDossier(input, merged);
    }

    const aggregated: z.infer<typeof DeepSeekRepoAnalysisSchema> = {
      repoSummary: "",
      technologies: [],
      architectureSignals: [],
      quantifiedImpacts: [],
      highlights: [],
      engineeringInsights: [],
      commits: [],
      pullRequests: []
    };

    const commitChunks = chunkArray(input.commits, COMMIT_CHUNK_SIZE);
    for (let i = 0; i < commitChunks.length; i += 1) {
      const chunk = commitChunks[i];
      if (!chunk || chunk.length === 0) continue;
      const corpus = this.buildCorpus({
        ...input,
        commits: chunk,
        pullRequests: [],
        issues: i === 0 ? input.issues : []
      });
      const parsed = await this.callDeepSeek(
        corpus,
        input.repo.name,
        `commits lote ${i + 1}/${commitChunks.length} (${chunk.length} itens)`
      );
      aggregated.commits.push(...parsed.commits);
      aggregated.technologies.push(...parsed.technologies);
      aggregated.architectureSignals.push(...parsed.architectureSignals);
      aggregated.quantifiedImpacts.push(...parsed.quantifiedImpacts);
      aggregated.highlights.push(...parsed.highlights);
      aggregated.engineeringInsights.push(...parsed.engineeringInsights);
      if (parsed.repoSummary.trim()) {
        aggregated.repoSummary = aggregated.repoSummary
          ? `${aggregated.repoSummary}\n${parsed.repoSummary}`
          : parsed.repoSummary;
      }
    }

    const prChunks = chunkArray(input.pullRequests, PR_CHUNK_SIZE);
    for (let i = 0; i < prChunks.length; i += 1) {
      const chunk = prChunks[i];
      if (!chunk || chunk.length === 0) continue;
      const corpus = this.buildCorpus({
        ...input,
        commits: [],
        pullRequests: chunk,
        issues: []
      });
      const parsed = await this.callDeepSeek(
        corpus,
        input.repo.name,
        `PRs lote ${i + 1}/${prChunks.length} (${chunk.length} itens)`
      );
      aggregated.pullRequests.push(...parsed.pullRequests);
      aggregated.technologies.push(...parsed.technologies);
      aggregated.architectureSignals.push(...parsed.architectureSignals);
      aggregated.quantifiedImpacts.push(...parsed.quantifiedImpacts);
      aggregated.highlights.push(...parsed.highlights);
      aggregated.engineeringInsights.push(...parsed.engineeringInsights);
    }

    aggregated.technologies = unique(aggregated.technologies);
    aggregated.architectureSignals = unique(aggregated.architectureSignals);
    aggregated.quantifiedImpacts = unique(aggregated.quantifiedImpacts).slice(0, 20);
    aggregated.highlights = unique(aggregated.highlights).slice(0, 12);
    aggregated.engineeringInsights = unique(aggregated.engineeringInsights).slice(0, 12);

    if (commitChunks.length + prChunks.length > 1) {
      aggregated.repoSummary = await this.consolidateRepoSummary(
        input.repo.name,
        aggregated.repoSummary,
        aggregated.highlights,
        aggregated.engineeringInsights
      );
    }

    return this.finalizeWithMegaDossier(input, this.mergeAnalysis(input, aggregated));
  }

  private async finalizeWithMegaDossier(
    input: DeepSeekRepoAnalysisInput,
    partial: DeepSeekRepoAnalysisResult
  ): Promise<DeepSeekRepoAnalysisResult> {
    try {
      const mega = await this.generateMegaDossier(input, partial);
      const summary: RepoAnalysisSummary = enrichAnalysisWithMegaSummary(
        {
          ...partial.summary,
          narrative: mega.narrative || partial.summary.narrative,
          purpose: mega.purpose || partial.summary.purpose,
          repoOrganization: mega.repoOrganization || partial.summary.repoOrganization,
          architectureAnalysis: mega.architectureAnalysis || partial.summary.architectureAnalysis,
          contributionOverview: mega.contributionOverview || partial.summary.contributionOverview,
          megaSummary: mega.megaSummary,
          keyContributions:
            mega.keyContributions.length > 0 ? mega.keyContributions : partial.summary.keyContributions,
          technologies: unique([...partial.summary.technologies, ...mega.technologies]).slice(0, 40),
          architectureSignals: unique([
            ...partial.summary.architectureSignals,
            ...mega.architectureSignals
          ]),
          quantifiedImpacts: unique([
            ...partial.summary.quantifiedImpacts,
            ...mega.quantifiedImpacts
          ]).slice(0, 20),
          highlights: filterSubstantiveBullets(
            mega.highlights.length > 0 ? mega.highlights : partial.summary.highlights
          ),
          engineeringInsights:
            mega.engineeringInsights.length > 0
              ? mega.engineeringInsights
              : partial.summary.engineeringInsights,
          metricsSnapshot:
            partial.summary.metricsSnapshot ??
            computeRepoMetrics({
              commits: partial.commits,
              pullRequests: partial.pullRequests,
              issues: input.issues
            })
        },
        {
          repo: input.repo,
          commits: partial.commits,
          pullRequests: partial.pullRequests,
          issues: input.issues,
          partial: partial.summary
        }
      );

      return { ...partial, summary };
    } catch {
      return {
        ...partial,
        summary: enrichAnalysisWithMegaSummary(partial.summary, {
          repo: input.repo,
          commits: partial.commits,
          pullRequests: partial.pullRequests,
          issues: input.issues,
          partial: partial.summary
        })
      };
    }
  }

  private buildMegaDigest(
    input: DeepSeekRepoAnalysisInput,
    partial: DeepSeekRepoAnalysisResult
  ): string {
    const metrics = computeRepoMetrics({
      commits: partial.commits,
      pullRequests: partial.pullRequests,
      issues: input.issues
    });
    const org = inferRepoOrganization(partial.commits);

    const commitDigest = partial.commits
      .filter(c => c.analysisSummary || c.message)
      .slice(0, 120)
      .map(c => {
        const delta = c.additions !== undefined ? `+${c.additions}/-${c.deletions ?? 0}` : "";
        const summary = c.analysisSummary || c.message.split("\n")[0] || "";
        return `COMMIT|${c.sha.slice(0, 10)}|${delta}|${summary.slice(0, 220)}`;
      });

    const prDigest = partial.pullRequests
      .filter(pr => pr.analysisSummary || pr.title)
      .slice(0, 80)
      .map(pr => {
        const delta =
          pr.additions !== undefined
            ? `+${pr.additions}/-${pr.deletions ?? 0}|${pr.changedFiles ?? 0}files`
            : "";
        const summary = pr.analysisSummary || pr.title;
        return `PR|#${pr.number}|${delta}|${summary.slice(0, 220)}`;
      });

    return [
      `REPO|${input.repo.fullName}`,
      `DESC|${input.repo.description ?? ""}`,
      `ORG|${org}`,
      `METRICS|commits=${metrics.totalCommits}|prs=${metrics.totalPullRequests}|merged=${metrics.mergedPullRequests}|lines+=${metrics.linesAdded ?? 0}|lines-=${metrics.linesDeleted ?? 0}|files=${metrics.filesTouched ?? 0}`,
      `TECH|${partial.summary.technologies.join(", ")}`,
      `ARCH|${partial.summary.architectureSignals.join(", ")}`,
      `IMPACTS|${partial.summary.quantifiedImpacts.join(" | ")}`,
      "",
      "## COMMITS ANALISADOS",
      ...commitDigest,
      "",
      "## PRS ANALISADOS",
      ...prDigest
    ].join("\n");
  }

  private async generateMegaDossier(
    input: DeepSeekRepoAnalysisInput,
    partial: DeepSeekRepoAnalysisResult
  ): Promise<z.infer<typeof MegaDossierSchema>> {
    const digest = this.buildMegaDigest(input, partial);

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.25,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "Voce e um arquiteto de software senior produzindo analises tecnicas de repositorios GitHub.",
              "Crie um resumo denso sobre PROBLEMAS resolvidos, SOLUCOES encontradas, MELHORIAS implementadas e RESULTADOS.",
              "PROIBIDO: contadores (541 commits), listas Stack:/Padroes:, estatisticas vazias, texto generico.",
              "OBRIGATORIO: narrativa concreta derivada dos commits/PRs — o que estava quebrado/limitado, o que foi feito, qual impacto.",
              "Responda APENAS JSON valido no schema solicitado."
            ].join("\n")
          },
          {
            role: "user",
            content: [
              `Gere analise completa do repositorio "${input.repo.name}".`,
              "JSON:",
              `{`,
              `  "megaSummary": "3-6 paragrafos: problemas reais resolvidos, solucoes implementadas, melhorias e resultados (SEM contadores)",`,
              `  "purpose": "qual problema de negocio/tecnico o projeto ataca",`,
              `  "repoOrganization": "como o codigo esta organizado e por que essa estrutura ajuda",`,
              `  "architectureAnalysis": "decisoes arquiteturais e trade-offs observados nas entregas",`,
              `  "contributionOverview": "sintese narrativa das contribuicoes: o que voce resolveu e melhorou (NAO '541 commits')",`,
              `  "narrative": "visao executiva focada em solucoes entregues",`,
              `  "technologies": ["stack usada nas solucoes"],`,
              `  "architectureSignals": ["decisoes arquiteturais concretas"],`,
              `  "quantifiedImpacts": ["resultados mensuraveis: % reducao, tempo, usuarios — PROIBIDO linhas/arquivos brutos"],`,
              `  "highlights": ["bullets: Problema → Solucao → Resultado"],`,
              `  "engineeringInsights": ["por que escolheu abordagem X, o que melhorou"],`,
              `  "keyContributions": [{`,
              `    "type": "commit|pull_request|issue|contribution",`,
              `    "reference": "sha ou #numero",`,
              `    "title": "...",`,
              `    "what": "problema ou necessidade",`,
              `    "how": "solucao implementada",`,
              `    "why": "motivacao/contexto",`,
              `    "impact": "resultado/impacto mensuravel (%, tempo, escala — NUNCA linhas ou arquivos brutos)",`,
              `    "technologies": [],`,
              `    "metrics": ""`,
              `  }]`,
              `}`,
              "",
              digest
            ].join("\n")
          }
        ]
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Erro DeepSeek mega dossier (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? "{}";
    return MegaDossierSchema.parse(JSON.parse(content) as unknown);
  }

  private buildCorpus(input: DeepSeekRepoAnalysisInput): string {
    const langLines = input.languages
      .sort((a, b) => b.bytes - a.bytes)
      .map(l => `${l.language}:${l.bytes}b`)
      .join(", ");

    const commitLines = input.commits.map(c => {
      const files = c.filesChanged.slice(0, 16).join(",");
      const delta =
        c.additions !== undefined ? `+${c.additions}/-${c.deletions ?? 0}` : "";
      const summary = c.analysisSummary ? `|SUMMARY:${c.analysisSummary.slice(0, 120)}` : "";
      const msg = c.message.replace(/\s+/g, " ").slice(0, 320);
      return `COMMIT|${c.sha.slice(0, 12)}|${c.committedAt.slice(0, 10)}|${delta}|${files}${summary}|${msg}`;
    });

    const prLines = input.pullRequests.map(pr => {
      const body = (pr.body ?? "").replace(/\s+/g, " ").slice(0, 500);
      const delta =
        pr.additions !== undefined
          ? `+${pr.additions}/-${pr.deletions ?? 0}|${pr.changedFiles ?? 0}files`
          : "";
      const labels = pr.labels.join(",");
      const summary = pr.analysisSummary ? `|SUMMARY:${pr.analysisSummary.slice(0, 120)}` : "";
      return `PR|#${pr.number}|${pr.state}|${pr.mergedAt ? "merged" : "open"}|${delta}|${labels}${summary}|${pr.title}|${body}`;
    });

    const issueLines = input.issues.map(
      i => `ISSUE|#${i.number}|${i.state}|${i.title.replace(/\s+/g, " ").slice(0, 180)}`
    );

    return [
      `REPO|${input.repo.fullName}`,
      `DESC|${(input.repo.description ?? "").replace(/\s+/g, " ").slice(0, 500)}`,
      `PRIMARY_LANG|${input.repo.language ?? "n/a"}`,
      `LANG_BYTES|${langLines || "n/a"}`,
      `COUNTS|commits=${input.commits.length}|prs=${input.pullRequests.length}|issues=${input.issues.length}`,
      "",
      "## COMMITS (analise TODOS — nao omita nenhum)",
      ...commitLines,
      "",
      "## PULL REQUESTS (analise TODOS — nao omita nenhum)",
      ...prLines,
      "",
      "## ISSUES",
      ...issueLines
    ].join("\n");
  }

  private async callDeepSeek(
    corpus: string,
    repoName: string,
    phaseLabel: string
  ): Promise<z.infer<typeof DeepSeekRepoAnalysisSchema>> {
    const system = [
      "Voce e um engenheiro senior especialista em analise de repositorios GitHub.",
      "Analise TODOS os commits e PRs fornecidos — nao pule nenhum.",
      "FOQUE em PROBLEMAS resolvidos, SOLUCOES implementadas, MELHORIAS feitas e RESULTADOS.",
      "PROIBIDO usar bullets de metadados: contadores (X commits analisados), listas Stack:/Padroes:, ou estatisticas vazias.",
      "Cada analysisSummary de commit/PR DEVE seguir: Problema/Necessidade → Solucao (como) → Resultado/Impacto.",
      "Cada highlight DEVE descrever uma entrega real, nunca estatisticas do repositorio.",
      "Responda APENAS JSON valido, sem markdown, no schema solicitado.",
      "Para cada commit e PR listado, retorne entrada correspondente com sha ou number exatos.",
      "Nao invente dados ausentes — derive conclusoes apenas do corpus fornecido."
    ].join("\n");

    const user = [
      `Analise do repositorio "${repoName}" — fase: ${phaseLabel}.`,
      "Retorne JSON:",
      `{`,
      `  "repoSummary": "narrativa sobre problemas resolvidos e solucoes entregues (NAO contadores)",`,
      `  "technologies": ["stack usada nas solucoes"],`,
      `  "architectureSignals": ["decisoes arquiteturais observadas nas entregas"],`,
      `  "quantifiedImpacts": ["resultados mensuraveis reais: %, tempo, volume, economia"],`,
      `  "highlights": ["bullets no formato: Problema X → Solucao Y → Resultado Z"],`,
      `  "engineeringInsights": ["decisoes tecnicas: por que escolheu abordagem A em vez de B"],`,
      `  "commits": [{ "sha": "prefixo sha", "analysisSummary": "Problema: ... Solucao: ... Resultado: ...", "technologies": [], "impactSignals": [] }],`,
      `  "pullRequests": [{ "number": 1, "analysisSummary": "Problema: ... Solucao: ... Resultado: ...", "technologies": [], "impactSignals": [] }]`,
      `}`,
      "",
      corpus
    ].join("\n");

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Erro DeepSeek repo analysis (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? "{}";
    const json = JSON.parse(content) as unknown;
    return DeepSeekRepoAnalysisSchema.parse(json);
  }

  private async consolidateRepoSummary(
    repoName: string,
    partialSummaries: string,
    highlights: string[],
    insights: string[]
  ): Promise<string> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Consolide analises parciais de um repositorio em um unico paragrafo tecnico coerente. Responda JSON: { \"repoSummary\": \"...\" }"
          },
          {
            role: "user",
            content: [
              `Repositorio: ${repoName}`,
              "Resumos parciais:",
              partialSummaries.slice(0, 8000),
              "",
              "Destaques:",
              highlights.join("\n"),
              "",
              "Insights:",
              insights.join("\n")
            ].join("\n")
          }
        ]
      })
    });

    if (!response.ok) {
      return partialSummaries.slice(0, 1200);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? "{}";
    try {
      const parsed = JSON.parse(content) as { repoSummary?: string };
      return parsed.repoSummary?.trim() || partialSummaries.slice(0, 1200);
    } catch {
      return partialSummaries.slice(0, 1200);
    }
  }

  private mergeAnalysis(
    input: DeepSeekRepoAnalysisInput,
    ai: z.infer<typeof DeepSeekRepoAnalysisSchema>
  ): DeepSeekRepoAnalysisResult {
    const commitByShaPrefix = new Map(ai.commits.map(c => [c.sha.toLowerCase(), c]));
    const prByNumber = new Map(ai.pullRequests.map(pr => [pr.number, pr]));

    const commits = input.commits.map(commit => {
      const prefix = commit.sha.slice(0, 12).toLowerCase();
      const match =
        commitByShaPrefix.get(prefix) ??
        [...commitByShaPrefix.entries()].find(([key]) => commit.sha.toLowerCase().startsWith(key))?.[1];
      if (!match) return commit;
      return {
        ...commit,
        analysisSummary: match.analysisSummary || commit.analysisSummary,
        technologies: [...new Set([...commit.technologies, ...match.technologies])],
        impactSignals: [...new Set([...commit.impactSignals, ...match.impactSignals])]
      };
    });

    const pullRequests = input.pullRequests.map(pr => {
      const match = prByNumber.get(pr.number);
      if (!match) return pr;
      return {
        ...pr,
        analysisSummary: match.analysisSummary || pr.analysisSummary,
        technologies: [...new Set([...pr.technologies, ...match.technologies])],
        impactSignals: [...new Set([...pr.impactSignals, ...match.impactSignals])]
      };
    });

    const baseSummary = buildRepoAnalysisSummary({
      repoName: input.repo.name,
      commits,
      pullRequests,
      description: input.repo.description
    });

    const summary: RepoAnalysisSummary = {
      ...baseSummary,
      technologies: [...new Set([...baseSummary.technologies, ...ai.technologies])].slice(0, 40),
      architectureSignals: [...new Set([...baseSummary.architectureSignals, ...ai.architectureSignals])],
      quantifiedImpacts: [...new Set([...baseSummary.quantifiedImpacts, ...ai.quantifiedImpacts])].slice(0, 20),
      highlights: filterSubstantiveBullets(
        ai.highlights.length > 0 ? ai.highlights : baseSummary.highlights
      ),
      narrative: ai.repoSummary,
      engineeringInsights: ai.engineeringInsights,
      keyContributions: [],
      deepAnalyzedCommits: commits.filter(c => c.filesChanged.length > 0 || c.analysisSummary.length > 0).length,
      deepAnalyzedPullRequests: pullRequests.filter(
        pr => (pr.changedFiles ?? 0) > 0 || Boolean(pr.body) || Boolean(pr.analysisSummary)
      ).length
    };

    return { commits, pullRequests, summary };
  }
}
