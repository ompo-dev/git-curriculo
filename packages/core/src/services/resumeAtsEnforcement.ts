import type { AtsAnalysis, JobSpec, ProjectEvidence } from "../schemas";
import { keywordInCorpus } from "../utils/keywordSynonyms";
import { filterMeaningfulAtsKeywords, normalizeKeyword, unique } from "../utils/text";
import { sanitizeVanityMetricsInMarkdown } from "../utils/resumeMetrics";
import { analyzeResumeQuality } from "./resumeQualityService";

/**
 * Aliases so para detectar presenca no curriculo (PT/EN, abreviacoes, libs relacionadas).
 * Nao inferem stack — so evitam falso "faltando" quando o termo ja esta la com outra forma.
 */
const PRESENCE_ALIASES: Record<string, string[]> = {
  testing: ["testing", "testes", "teste", "vitest", "playwright", "jest", "cypress", "e2e", "unitarios", "unitario"],
  js: ["js", "javascript"],
  typescript: ["typescript", "ts"],
  "hook form": ["hook form", "react hook form", "react-hook-form", "hookform"],
  "react hook form": ["hook form", "react hook form", "react-hook-form", "hookform"],
  zod: ["zod"],
  "server components": ["server components", "server component", "rsc", "react server components", "app router"],
  rsc: ["rsc", "server components", "server component", "app router"],
  tanstack: ["tanstack", "react query", "tanstack query", "@tanstack"],
  "tanstack query": ["tanstack", "react query", "tanstack query"],
  restful: ["restful", "rest", "api rest", "apis rest", "restful api"],
  rest: ["rest", "restful", "api rest"],
  metadata: ["metadata", "meta tags", "meta tag", "opengraph", "open graph", "generatemetadata", "json-ld", "json ld", "jsonld", "sitemap", "seo", "structured data"],
  "json-ld": ["json-ld", "json ld", "jsonld", "structured data", "dados estruturados"],
  jsonld: ["json-ld", "json ld", "jsonld", "structured data"],
  sitemap: ["sitemap", "site map"],
  websocket: ["websocket", "web socket"],
  web3: ["web3", "blockchain", "crypto", "carteira", "wallet"],
  viem: ["viem"],
  ethers: ["ethers", "ethers.js", "ethersjs"],
  fintech: ["fintech", "financeiro", "trading", "exchange", "cripto"],
  trading: ["trading", "tradingview", "exchange", "cripto", "fintech"],
  seo: ["seo", "search engine", "meta tags", "sitemap"],
  cache: ["cache", "caching", "redis"],
  performance: ["performance", "desempenho", "vitals", "lcp", "tti", "web vitals"],
  "core web vitals": ["core web vitals", "lcp", "cls", "inp", "web vitals"],
  lcp: ["lcp", "core web vitals", "web vitals"],
  cls: ["cls", "core web vitals"],
  inp: ["inp", "core web vitals"],
  i18n: ["i18n", "intl", "internacionalizacao", "internationalization", "next-intl"],
  intl: ["intl", "i18n", "internacionalizacao"],
  cva: ["cva", "class variance", "class-variance-authority"],
  "2fa": ["2fa", "two factor", "multifator", "mfa", "autenticacao multifator"],
  otp: ["otp", "one time password", "senha unica"],
  passkeys: ["passkeys", "passkey", "webauthn"],
  wcag: ["wcag", "acessibilidade", "accessibility", "a11y"],
  acessibilidade: ["acessibilidade", "accessibility", "wcag", "a11y"],
  xss: ["xss", "cross site scripting"],
  csrf: ["csrf", "cross site request"],
  shadcn: ["shadcn", "shadcn ui", "shadcn/ui"],
  radix: ["radix", "radix ui", "@radix"],
  tradingview: ["tradingview", "trading view", "lightweight charts"],
  "lightweight charts": ["lightweight charts", "lightweight-charts", "tradingview"],
  "chart.js": ["chart.js", "chartjs", "charts"],
  csp: ["csp", "content security policy"],
  sentry: ["sentry", "@sentry"],
  logrocket: ["logrocket"],
  datadog: ["datadog"],
  figma: ["figma", "wireframe", "wireframes", "prototipo", "prototipos", "ux ui"],
  exchange: ["exchange", "trading", "webhook", "pagamentos", "cripto", "fintech"],
  kpi: ["kpi", "metricas", "metrics", "analytics", "dashboard", "datadog"],
  axios: ["axios"],
  tailwind: ["tailwind", "tailwindcss", "tailwind css"],
  css: ["css", "scss", "sass", "tailwind"],
  react: ["react", "reactjs", "react.js"],
  "next.js": ["next.js", "nextjs", "next js"],
  nextjs: ["next.js", "nextjs", "next js"],
  "app router": ["app router", "next.js", "nextjs", "rsc"]
};

const NEXTJS_IMPLIED = new Set([
  "rsc",
  "server components",
  "server component",
  "metadata",
  "seo",
  "sitemap",
  "json-ld",
  "jsonld",
  "app router"
]);

const JS_IMPLIED = ["javascript", "typescript", "js", "ts", "tsx", "jsx"];

function resumeHasJs(corpus: string): boolean {
  return JS_IMPLIED.some(token => keywordInCorpus(token, corpus));
}

function resumeHasNextJs(corpus: string): boolean {
  return (
    keywordInCorpus("next.js", corpus) ||
    keywordInCorpus("nextjs", corpus) ||
    keywordInCorpus("app router", corpus)
  );
}

function variantsForPresence(keyword: string): string[] {
  const norm = normalizeKeyword(keyword);
  if (!norm) return [];
  const aliases = PRESENCE_ALIASES[norm] ?? [];
  return unique([norm, ...aliases.map(normalizeKeyword)]).filter(Boolean);
}

export function keywordPresentInResume(resumeMarkdown: string, keyword: string): boolean {
  const corpus = normalizeKeyword(resumeMarkdown);
  if (variantsForPresence(keyword).some(variant => keywordInCorpus(variant, corpus))) {
    return true;
  }
  const norm = normalizeKeyword(keyword);
  if (resumeHasNextJs(corpus) && NEXTJS_IMPLIED.has(norm)) {
    return true;
  }
  if ((norm === "js" || norm === "javascript") && resumeHasJs(corpus)) {
    return true;
  }
  return false;
}

/** Extrai keywords das linhas "repo: kw1, kw2" retornadas pela IA. */
export function enrichEvidencedKeywords(ats: AtsAnalysis): string[] {
  const tokens = new Set(ats.evidencedKeywords.map(normalizeKeyword).filter(Boolean));

  for (const line of ats.evidence) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const rest = line.slice(colon + 1);
    for (const part of rest.split(/[,;|/]/)) {
      const token = normalizeKeyword(part);
      if (token.length >= 2) tokens.add(token);
    }
  }

  return unique([...tokens]);
}

function keywordMentionedInEvidence(keyword: string, evidence: string[]): boolean {
  const normLine = normalizeKeyword(evidence.join(" "));
  return variantsForPresence(keyword).some(v => normLine.includes(normalizeKeyword(v)));
}

function filterSuggestions(ats: AtsAnalysis, resumeMarkdown: string, gaps: string[]): string[] {
  const blockIfPresent: Array<{ pattern: RegExp; keywords: string[] }> = [
    { pattern: /vitest|playwright|testing library|testes (?:unit|e2e)/i, keywords: ["vitest", "playwright", "testing library", "e2e"] },
    { pattern: /wcag|acessibilidade/i, keywords: ["wcag", "acessibilidade"] },
    { pattern: /2fa|otp|passkeys|multifator/i, keywords: ["2fa", "otp", "passkeys"] },
    { pattern: /web3|viem|ethers|blockchain|criptomoedas/i, keywords: ["web3", "viem", "ethers"] },
    { pattern: /figma|wireframe|virtualiza/i, keywords: ["figma", "wireframe", "virtualiz"] },
    { pattern: /chart\.?js|tradingview|lightweight charts/i, keywords: ["chart.js", "tradingview", "lightweight charts"] },
    { pattern: /json.?ld|structured data|dados estruturados/i, keywords: ["json-ld", "json ld", "jsonld"] }
  ];

  return ats.suggestions.filter(suggestion => {
    const norm = normalizeKeyword(suggestion);

    for (const block of blockIfPresent) {
      if (!block.pattern.test(suggestion)) continue;
      if (block.keywords.some(kw => keywordPresentInResume(resumeMarkdown, kw))) return false;
    }

    if (/web3|viem|ethers|tradingview|chart\.js|demo de dashboard|criptomoedas|adicionar experiencia com web3/i.test(suggestion)) {
      return false;
    }

    for (const kw of ats.unavailableKeywords) {
      const n = normalizeKeyword(kw);
      if (n.length >= 3 && norm.includes(n)) return false;
    }

    for (const kw of [...ats.evidencedKeywords, ...gaps, ...ats.matchedKeywords]) {
      const n = normalizeKeyword(kw);
      if (n.length < 3 || !norm.includes(n)) continue;
      if (keywordPresentInResume(resumeMarkdown, kw)) return false;
    }
    return true;
  }).slice(0, 6);
}

function filterAiEvidenceLines(evidence: string[]): string[] {
  return evidence.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (/^\d+\/\d+ bullets|Aderencia \(|Personalizacao \(|Verbos de acao|Estrutura:|Credibilidade de metricas:/i.test(trimmed)) {
      return true;
    }
    if (/^[a-z0-9_-]+:\s/i.test(trimmed)) return true;
    if (/^(Implementou|Usou|Construiu|Documentou|Configurou|Integrou|Desenvolveu|Implementou)/i.test(trimmed)) {
      return false;
    }
    return trimmed.length <= 90;
  });
}

/** Fonte da verdade para score, gaps, matched e unavailable — sobrescreve inconsistencias da IA. */
export function finalizeAtsAnalysis(
  ats: AtsAnalysis,
  resumeMarkdown?: string,
  jobKeywords?: string[],
  options?: {
    jobSpec?: JobSpec;
    projectEvidence?: ProjectEvidence[];
    jobFullText?: string;
  }
): AtsAnalysis {
  const evidencedKeywords = enrichEvidencedKeywords(ats);
  const evidenceText = ats.evidence.join(" ");

  const unavailableKeywords = ats.unavailableKeywords.filter(kw => {
    if (evidencedKeywords.some(e => normalizeKeyword(e) === normalizeKeyword(kw))) return false;
    if (keywordMentionedInEvidence(kw, ats.evidence)) return false;
    if (resumeMarkdown && keywordPresentInResume(resumeMarkdown, kw)) return false;
    return true;
  });

  if (!resumeMarkdown?.trim()) {
    return {
      ...ats,
      evidencedKeywords,
      unavailableKeywords,
      gapsInResume: [],
      score: ats.score
    };
  }

  const gapsInResume = filterMeaningfulAtsKeywords(
    findMissingEvidencedKeywords(evidencedKeywords, resumeMarkdown)
  );
  const gapSet = new Set(gapsInResume.map(normalizeKeyword));

  const evidencedPresent = evidencedKeywords.filter(kw => !gapSet.has(normalizeKeyword(kw)));

  const matchedKeywords = unique([
    ...(jobKeywords ?? []).filter(kw => keywordPresentInResume(resumeMarkdown, kw)),
    ...evidencedPresent,
    ...ats.matchedKeywords.filter(kw => keywordPresentInResume(resumeMarkdown, kw))
  ]).filter(kw => !gapSet.has(normalizeKeyword(kw)));

  const qualityReport = analyzeResumeQuality(resumeMarkdown, {
    jobSpec: options?.jobSpec,
    projectEvidence: options?.projectEvidence,
    jobFullText: options?.jobFullText
  });
  const keywordScore = computeEvidenceScore(evidencedKeywords, resumeMarkdown);
  const score = computeCompositeAtsScore(keywordScore, qualityReport.overallScore);

  const missingKeywords = filterMeaningfulAtsKeywords(
    unique([
      ...gapsInResume,
      ...(jobKeywords ?? []).filter(
        kw =>
          !keywordPresentInResume(resumeMarkdown, kw) &&
          !unavailableKeywords.some(u => normalizeKeyword(u) === normalizeKeyword(kw))
      )
    ]).filter(kw => !keywordPresentInResume(resumeMarkdown, kw))
  );

  const suggestions = unique([
    ...filterSuggestions({ ...ats, evidencedKeywords }, resumeMarkdown, gapsInResume),
    ...(qualityReport?.suggestions ?? []).filter(s =>
      filterSuggestions({ ...ats, suggestions: [s], evidencedKeywords }, resumeMarkdown, gapsInResume).length > 0
    )
  ]).slice(0, 8);

  const evidence = unique([
    ...filterAiEvidenceLines(ats.evidence),
    ...(qualityReport?.evidenceLines ?? [])
  ]).slice(0, 14);

  return {
    ...ats,
    evidencedKeywords,
    unavailableKeywords,
    gapsInResume,
    matchedKeywords,
    missingKeywords,
    score,
    keywordScore,
    qualityScore: qualityReport?.overallScore,
    qualityReport,
    suggestions,
    evidence: evidence.length > 0 ? evidence : [evidenceText.slice(0, 200)]
  };
}

export function reconcileAtsWithResume(
  ats: AtsAnalysis,
  resumeMarkdown: string,
  jobKeywords?: string[],
  options?: {
    jobSpec?: JobSpec;
    projectEvidence?: ProjectEvidence[];
  }
): AtsAnalysis {
  return finalizeAtsAnalysis(ats, resumeMarkdown, jobKeywords, options);
}

export function computeCompositeAtsScore(keywordScore: number, qualityScore: number): number {
  return Math.round(keywordScore * 0.42 + qualityScore * 0.58);
}

export function findMissingEvidencedKeywords(
  keywords: string[],
  resumeMarkdown: string
): string[] {
  return unique(keywords.map(normalizeKeyword).filter(Boolean)).filter(
    kw => !keywordPresentInResume(resumeMarkdown, kw)
  );
}

export function computeEvidenceScore(evidencedKeywords: string[], resumeMarkdown: string): number {
  const keys = unique(evidencedKeywords.map(normalizeKeyword).filter(Boolean));
  if (keys.length === 0) return 0;
  const present = keys.filter(kw => keywordPresentInResume(resumeMarkdown, kw)).length;
  return Math.round((present / keys.length) * 100);
}

export function evidenceHintsForKeywords(
  evidence: string[],
  keywords: string[]
): string[] {
  return evidence.filter(line => {
    const normLine = normalizeKeyword(line);
    return keywords.some(kw =>
      variantsForPresence(kw).some(variant => normLine.includes(normalizeKeyword(variant)))
    );
  });
}

export function repoNameMatchesAllowed(projectTitle: string, allowedRepoNames: string[]): boolean {
  const titleNorm = normalizeKeyword(projectTitle);
  return allowedRepoNames.some(repo => {
    const repoNorm = normalizeKeyword(repo);
    return (
      titleNorm === repoNorm ||
      titleNorm.startsWith(`${repoNorm} `) ||
      titleNorm.startsWith(repoNorm) ||
      titleNorm.includes(repoNorm)
    );
  });
}

export function extractRepoFromEvidenceLine(line: string): string | null {
  const match = line.match(/^([^:]+):/);
  return match ? match[1]!.trim() : null;
}

export function filterEvidenceByRepos(evidence: string[], repoNames?: string[]): string[] {
  if (!repoNames?.length) return evidence;
  return evidence.filter(line => {
    const repo = extractRepoFromEvidenceLine(line);
    if (!repo) return false;
    return repoNameMatchesAllowed(repo, repoNames);
  });
}

/** Remove projetos fora da selecao na secao ## Projetos. */
export function enforceResumeProjectSelection(
  markdown: string,
  allowedRepoNames: string[]
): string {
  if (!allowedRepoNames.length) return markdown;

  const sectionRe = /(^##\s+(?:Projetos|Projects)[^\n]*\n)([\s\S]*?)(?=\n##\s|$)/im;
  const match = markdown.match(sectionRe);
  if (!match) return markdown;

  const [full, header, body = ""] = match;
  const parts = body.split(/(?=^###\s)/m);
  const kept: string[] = [];

  for (const part of parts) {
    if (!part.trim() || !/^###\s/m.test(part)) continue;
    const titleLine = part.match(/^###\s+([^\n]+)/)?.[1] ?? "";
    const repoToken = titleLine.split(/\s[—\-|]/)[0]?.trim() ?? titleLine;
    if (repoNameMatchesAllowed(repoToken, allowedRepoNames)) {
      kept.push(part);
    }
  }

  if (kept.length === 0) return markdown;

  return markdown.replace(full, `${header}${kept.join("").trimEnd()}\n`);
}

/** Linha so com tecnologias em negrito separadas por virgula — keyword dump. */
function isKeywordDumpLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("-") || trimmed.startsWith("#")) return false;
  if (/^stack\s*:/i.test(trimmed)) return true;

  const boldTerms = trimmed.match(/\*\*[^*]+\*\*/g) ?? [];
  const commaCount = (trimmed.match(/,/g) ?? []).length;

  if (boldTerms.length >= 4 && commaCount >= 3) return true;
  if (boldTerms.length >= 3 && commaCount >= 2 && trimmed.length < 320) {
    const withoutBold = trimmed.replace(/\*\*[^*]+\*\*/g, "").replace(/[,|\s]/g, "");
    return withoutBold.length < 20;
  }
  return false;
}

/** Remove linhas de listagem de keywords apenas na secao ## Projetos. */
export function stripKeywordDumpLines(markdown: string): string {
  const sectionRe = /(^##\s+(?:Projetos|Projects)[^\n]*\n)([\s\S]*?)(?=\n##\s|$)/im;
  const match = markdown.match(sectionRe);
  if (!match) return markdown;

  const [full, header, body = ""] = match;
  const cleanedBody = body
    .split("\n")
    .filter(line => !isKeywordDumpLine(line))
    .join("\n");

  return markdown.replace(full, `${header}${cleanedBody}`);
}

function buildSummaryFallback(profilePrompt?: string): string {
  if (!profilePrompt?.trim()) {
    return "Engenheiro de software com experiencia em desenvolvimento web moderno, arquitetura front-end, performance e entrega de valor em produtos digitais.";
  }

  const text = profilePrompt.trim().replace(/\s+/g, " ");
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 3);
  const excerpt = sentences.join(" ").slice(0, 650);
  return excerpt || text.slice(0, 450);
}

/** Garante secao ## Resumo (sobre o candidato) — nunca omitir. */
export function ensureResumeSummarySection(
  markdown: string,
  profilePrompt?: string
): string {
  if (/^##\s+(?:Resumo|Summary|Sobre)\b/im.test(markdown)) {
    return markdown;
  }

  const lines = markdown.split("\n");
  let insertAt = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (/^##\s+/i.test(trimmed)) {
      insertAt = i;
      break;
    }
  }

  const summary = buildSummaryFallback(profilePrompt);
  const block = ["## Resumo", "", summary, ""];

  lines.splice(insertAt, 0, ...block);
  return lines.join("\n");
}

/** Menciona empresa/titulo da vaga no Resumo quando ausente. */
export function ensureJobPersonalization(markdown: string, jobSpec?: JobSpec): string {
  if (!jobSpec?.company?.trim()) return markdown;
  if (keywordPresentInResume(markdown, jobSpec.company)) return markdown;

  const company = jobSpec.company.trim();
  const titlePart = jobSpec.title?.trim()
    ? ` para a vaga de ${jobSpec.title.trim()}`
    : "";
  const injection = `Candidato com interesse na **${company}**${titlePart}. `;

  const sectionRe = /(^##\s+(?:Resumo|Summary)[^\n]*\n)([\s\S]*?)(?=\n##\s|$)/im;
  const match = markdown.match(sectionRe);
  if (!match) return markdown;

  const [full, header, body = ""] = match;
  return markdown.replace(full, `${header}${injection}${body.trimStart()}\n`);
}

export function sanitizeResumeMarkdown(
  markdown: string,
  options?: { allowedProjectRepos?: string[]; profilePrompt?: string; jobSpec?: JobSpec }
): string {
  let result = ensureResumeSummarySection(markdown, options?.profilePrompt);
  if (options?.jobSpec) {
    result = ensureJobPersonalization(result, options.jobSpec);
  }
  result = sanitizeVanityMetricsInMarkdown(result);
  result = stripKeywordDumpLines(result);
  if (options?.allowedProjectRepos?.length) {
    result = enforceResumeProjectSelection(result, options.allowedProjectRepos);
  }
  return result.trimEnd() + "\n";
}

