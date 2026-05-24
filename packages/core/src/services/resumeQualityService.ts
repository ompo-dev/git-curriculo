import type { JobSpec, ProjectEvidence } from "../schemas";
import { keywordInCorpus } from "../utils/keywordSynonyms";
import { buildJobKeywordPool, normalizeKeyword, stripAccents } from "../utils/text";
import {
  bulletHasMeaningfulMetric,
  filterMeaningfulImpactSignals,
  isVanityMetricText
} from "../utils/resumeMetrics";

export interface ResumeBullet {
  text: string;
  section: string;
  lineIndex: number;
}

export interface QualityDimension {
  id: string;
  label: string;
  score: number;
  status: "ok" | "warning" | "critical";
  issues: string[];
}

export interface ResumeQualityReport {
  overallScore: number;
  bulletsWithMetrics: number;
  totalBullets: number;
  metricPct: number;
  actionVerbPct: number;
  roleAdherencePct: number;
  personalizationPct: number;
  dimensions: QualityDimension[];
  weakBullets: string[];
  suggestions: string[];
  evidenceLines: string[];
}

const ACTION_VERBS =
  /\b(desenvolvi|implementei|liderei|criei|construi|construí|otimizei|automatizei|migrei|refatorei|projetei|integrei|configurei|estabeleci|coordenei|entreguei|reduzi|aumentei|eliminei|estruturei|padronizei|documentei|testei|arquitetei|concebi|desenhei|modelei|resolvi|corrigi|deployei|publiquei|monitorei|escalei|modernizei|containerizei|dockerizei|containerizei|lancei|negociei|mentorei|capacitei|treinei|analisei|diagnostiquei|prototipei|validei|auditei|segurei|protegi|acelerei|simplifiquei|unifiquei|centralizei|decentralizei|orquestrei|planejei|priorizei|negociei)\b/i;

const THIRD_PERSON =
  /\b(desenvolveu|implementou|criou|liderou|construiu|otimizou|automatizou|migrou|refatorou|projetou|integrou|configurou|entregou|reduziu|aumentou|eliminou|estruturou|documentou|testou|arquitetou|concebeu|resolveu|corrigiu|publicou|monitorou|escalou|lançou|lancou)\b/i;

const WEAK_START =
  /^(inclus[aã]o|ado[cç][aã]o|reorganiz|concep[cç][aã]o|participa[cç][aã]o|respons[aá]vel|atividades|aux[ií]lio|suporte|utilizando|usando|com foco|trabalho com|desenvolvimento de|cria[cç][aã]o de|implementa[cç][aã]o de|gerenciamento de|manuten[cç][aã]o de)\b/i;

const GERUND_START = /^[a-záàâãéêíóôõúç]+(ando|endo|indo)\b/i;

const VAGUE_PHRASES =
  /\b(utilizando|usando|com foco em|trabalhando com|respons[aá]vel por|atua[cç][aã]o em|experi[eê]ncia com|conhecimento em|familiaridade com)\b/i;

const GRAMMAR_ISSUES: Array<{ pattern: RegExp; message: string }> = [
  { pattern: THIRD_PERSON, message: "Terceira pessoa detectada — use primeira pessoa (Desenvolvi, Implementei)" },
  { pattern: /\s{2,}/, message: "Espacos duplos" },
  { pattern: /\.\.\./, message: "Reticencias evitadas em curriculo profissional" },
  { pattern: /\bvc\b|\bvoce\b/i, message: "Linguagem informal ('voce') — use tom profissional" },
  { pattern: /\betc\.?\b/i, message: "'etc.' evita especificidade — detalhe a entrega" },
  { pattern: /\bstuff\b|\bthings\b/i, message: "Termo vago em ingles" }
];

export function extractBulletsFromMarkdown(markdown: string): ResumeBullet[] {
  const lines = markdown.split("\n");
  let section = "Geral";
  const bullets: ResumeBullet[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const heading = line.match(/^##\s+(.+)/);
    if (heading) {
      section = heading[1]!.trim();
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.+)/);
    if (bullet?.[1]?.trim()) {
      bullets.push({
        text: bullet[1].replace(/\*\*/g, "").trim(),
        section,
        lineIndex: i
      });
    }
  }

  return bullets;
}

export function bulletHasQuantifiableImpact(text: string): boolean {
  return bulletHasMeaningfulMetric(text);
}

export function bulletHasActionVerb(text: string): boolean {
  return ACTION_VERBS.test(text.trim());
}

export function bulletStartsWeak(text: string): boolean {
  const cleaned = text.trim();
  return WEAK_START.test(cleaned) || GERUND_START.test(cleaned);
}

export function detectGrammarIssues(text: string): string[] {
  const issues: string[] = [];
  for (const rule of GRAMMAR_ISSUES) {
    if (rule.pattern.test(text)) issues.push(rule.message);
  }
  return issues;
}

function extractSection(markdown: string, names: string[]): string {
  const targets = new Set(names.map(name => stripAccents(name.trim())));
  const lines = markdown.split("\n");
  const out: string[] = [];
  let capture = false;

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)/);
    if (heading) {
      capture = targets.has(stripAccents(heading[1]!.trim()));
      continue;
    }
    if (capture) out.push(line);
  }

  return out.join("\n");
}

function termPresentInResume(resumeMarkdown: string, term: string): boolean {
  const norm = normalizeKeyword(term);
  if ((norm === "js" || norm === "javascript") && keywordInCorpus("typescript", normalizeKeyword(resumeMarkdown))) {
    return true;
  }
  return keywordInCorpus(norm, normalizeKeyword(resumeMarkdown));
}

const SUSPICIOUS_ROUND_PCT = /\b(?:100|90|85|80|70|60|55|50|45|40|35|30|25|20|15|10|5)\s*%/;

function scoreFromPct(pct: number, ok: number, warn: number): number {
  if (pct >= ok) return 100;
  if (pct >= warn) return Math.round(50 + ((pct - warn) / (ok - warn)) * 50);
  return Math.round((pct / warn) * 50);
}

function statusFromScore(score: number): "ok" | "warning" | "critical" {
  if (score >= 75) return "ok";
  if (score >= 50) return "warning";
  return "critical";
}

function computeRoleAdherence(
  resumeMarkdown: string,
  jobSpec?: JobSpec,
  jobFullText?: string
): number {
  if (!jobSpec) return 80;

  const terms = uniqueTerms([
    ...buildJobKeywordPool(jobSpec, jobFullText ?? jobSpec.summary),
    ...jobSpec.responsibilities.slice(0, 10)
  ]).slice(0, 35);

  if (terms.length === 0) return 75;

  const matched = terms.filter(term => termPresentInResume(resumeMarkdown, term)).length;
  return Math.round((matched / terms.length) * 100);
}

function uniqueTerms(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const norm = normalizeKeyword(item);
    if (norm.length < 3 || seen.has(norm)) continue;
    seen.add(norm);
    out.push(item);
  }
  return out.slice(0, 25);
}

function computePersonalization(
  markdown: string,
  jobSpec?: JobSpec
): { score: number; issues: string[] } {
  const issues: string[] = [];
  let points = 0;
  const max = 5;

  const summary = extractSection(markdown, ["Resumo", "Summary", "Sobre"]);
  const headline = markdown.split("\n").find(l => l.trim() && !l.startsWith("#"))?.trim() ?? "";

  if (jobSpec?.title) {
    const titleTokens = jobSpec.title
      .split(/[^a-zA-Z0-9+#]+/)
      .map(t => normalizeKeyword(t))
      .filter(t => t.length > 3);
    const corpus = normalizeKeyword(`${headline} ${summary}`);
    const titleHits = titleTokens.filter(t => corpus.includes(t)).length;
    if (titleHits >= Math.min(2, titleTokens.length)) points += 1;
    else issues.push("Headline/Resumo nao refletem o titulo da vaga");
  } else {
    points += 1;
  }

  if (jobSpec?.company) {
    if (termPresentInResume(markdown, jobSpec.company)) points += 1;
    else issues.push(`Empresa alvo (${jobSpec.company}) nao mencionada no curriculo`);
  } else {
    points += 1;
  }

  if (summary.replace(/\*\*/g, "").trim().length >= 100) points += 1;
  else issues.push("Resumo curto demais — personalize para a vaga");

  const skillsInSummary = (summary.match(/\*\*[^*]+\*\*/g) ?? []).length;
  if (skillsInSummary <= 9) points += 1;
  else issues.push("Resumo com excesso de tecnologias — integre em frases naturais (max 8-9 techs em negrito)");

  const jobKeywords = jobSpec
    ? uniqueTerms([...jobSpec.requiredSkills, ...jobSpec.keywords]).slice(0, 12)
    : [];
  if (jobKeywords.length === 0) {
    points += 1;
  } else {
    const corpus = normalizeKeyword(`${summary} ${headline}`);
    const hits = jobKeywords.filter(kw => corpus.includes(normalizeKeyword(kw))).length;
    if (hits >= Math.ceil(jobKeywords.length * 0.35)) points += 1;
    else issues.push("Poucas keywords da vaga no Resumo/Headline");
  }

  return { score: Math.round((points / max) * 100), issues };
}

function countSuspiciousRoundMetrics(bullets: ResumeBullet[]): number {
  return bullets.filter(b => SUSPICIOUS_ROUND_PCT.test(b.text.replace(/\*\*/g, ""))).length;
}

function detectConsecutivePatternIssues(bullets: ResumeBullet[]): string[] {
  const issues: string[] = [];
  let sameStart = 0;
  let prevStart = "";

  for (const bullet of bullets) {
    const start = bullet.text.slice(0, 12).toLowerCase();
    if (start === prevStart) {
      sameStart += 1;
      if (sameStart >= 2) {
        issues.push(`Bullets consecutivos com mesmo inicio: "${start}..."`);
      }
    } else {
      sameStart = 0;
    }
    prevStart = start;
  }

  const lengths = bullets.map(b => b.text.length);
  if (lengths.length >= 4) {
    const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.filter(len => Math.abs(len - avg) > avg * 0.85).length;
    if (variance >= Math.ceil(lengths.length * 0.5)) {
      issues.push("Bullets com comprimentos muito inconsistentes — padronize entre 80-160 caracteres");
    }
  }

  return issues.slice(0, 5);
}

function collectAvailableMetrics(projectEvidence?: ProjectEvidence[]): string[] {
  if (!projectEvidence?.length) return [];
  const signals: string[] = [];
  for (const project of projectEvidence) {
    signals.push(...filterMeaningfulImpactSignals(project.quantifiedImpactSignals).slice(0, 4));
    if (project.pullRequestCount > 0) {
      signals.push(`${project.repoName}: ${project.mergedPullRequestCount || project.pullRequestCount} PRs entregues`);
    }
  }
  return [...new Set(signals)].slice(0, 20);
}

export function analyzeResumeQuality(
  markdown: string,
  options?: {
    jobSpec?: JobSpec;
    projectEvidence?: ProjectEvidence[];
    jobFullText?: string;
  }
): ResumeQualityReport {
  const bullets = extractBulletsFromMarkdown(markdown);
  const experienceBullets = bullets.filter(b =>
    /experi[eê]ncia|experience/i.test(b.section)
  );
  const projectBullets = bullets.filter(b => /projetos|projects/i.test(b.section));
  const substantiveBullets = [...experienceBullets, ...projectBullets];
  const allSubstantive = substantiveBullets.length > 0 ? substantiveBullets : bullets;

  const withMetrics = allSubstantive.filter(b => bulletHasMeaningfulMetric(b.text));
  const withVerbs = allSubstantive.filter(b => bulletHasActionVerb(b.text));
  const vanityBullets = allSubstantive
    .filter(b => isVanityMetricText(b.text))
    .map(b => b.text.slice(0, 120));
  const weakBullets = allSubstantive
    .filter(
      b =>
        !bulletHasMeaningfulMetric(b.text) &&
        (bulletStartsWeak(b.text) || VAGUE_PHRASES.test(b.text) || isVanityMetricText(b.text))
    )
    .map(b => b.text.slice(0, 120));

  const totalBullets = allSubstantive.length;
  const metricPct = totalBullets > 0 ? Math.round((withMetrics.length / totalBullets) * 100) : 0;
  const actionVerbPct = totalBullets > 0 ? Math.round((withVerbs.length / totalBullets) * 100) : 0;

  const grammarIssues: string[] = [];
  for (const bullet of allSubstantive) {
    grammarIssues.push(...detectGrammarIssues(bullet.text));
  }
  const uniqueGrammar = [...new Set(grammarIssues)].slice(0, 8);

  const roleAdherencePct = computeRoleAdherence(
    markdown,
    options?.jobSpec,
    options?.jobFullText
  );
  const personalization = computePersonalization(markdown, options?.jobSpec);
  const consistencyIssues = detectConsecutivePatternIssues(allSubstantive);
  const suspiciousMetrics = countSuspiciousRoundMetrics(allSubstantive);
  const credibilityScore = Math.max(
    0,
    100 - Math.round((suspiciousMetrics / Math.max(allSubstantive.length, 1)) * 120)
  );

  const quantScore = scoreFromPct(metricPct, 70, 45);
  const verbScore = scoreFromPct(actionVerbPct, 60, 35);
  const grammarScore = Math.max(0, 100 - uniqueGrammar.length * 12);
  const consistencyScore = Math.max(0, 100 - consistencyIssues.length * 18);
  const roleScore = scoreFromPct(roleAdherencePct, 65, 40);
  const personalizationScore = personalization.score;

  const dimensions: QualityDimension[] = [
    {
      id: "credibility",
      label: "Credibilidade de metricas",
      score: credibilityScore,
      status: statusFromScore(credibilityScore),
      issues:
        suspiciousMetrics >= 3
          ? [
              `${suspiciousMetrics} bullets com percentuais redondos (100%, 80%, 70%...) — use apenas numeros com evidencia real nos dossies`
            ]
          : []
    },
    {
      id: "quantifiedImpact",
      label: "Impacto quantificado",
      score: quantScore,
      status: statusFromScore(quantScore),
      issues:
        metricPct < 70
          ? [
              `Apenas ${withMetrics.length}/${totalBullets} bullets com metricas reais (${metricPct}%) — meta: 70%+`,
              ...(vanityBullets.length > 0
                ? [`Metricas invalidas (linhas/arquivos brutos): ${vanityBullets.slice(0, 2).join("; ")}`]
                : []),
              ...weakBullets.slice(0, 2).map(b => `Bullet fraco: "${b}..."`)
            ]
          : vanityBullets.length > 0
            ? [`Metricas de vaidade detectadas: ${vanityBullets.slice(0, 2).join("; ")}`]
            : []
    },
    {
      id: "actionVerbs",
      label: "Verbos de acao",
      score: verbScore,
      status: statusFromScore(verbScore),
      issues:
        actionVerbPct < 60
          ? [`${withVerbs.length}/${totalBullets} bullets com verbo forte (${actionVerbPct}%) — use Desenvolvi, Implementei, Otimizei...`]
          : []
    },
    {
      id: "grammar",
      label: "Gramatica e voz",
      score: grammarScore,
      status: statusFromScore(grammarScore),
      issues: uniqueGrammar
    },
    {
      id: "bulletConsistency",
      label: "Consistencia de bullets",
      score: consistencyScore,
      status: statusFromScore(consistencyScore),
      issues: consistencyIssues
    },
    {
      id: "roleAdherence",
      label: "Aderencia a vaga",
      score: roleScore,
      status: statusFromScore(roleScore),
      issues:
        roleAdherencePct < 65
          ? [`Experiencia cobre ${roleAdherencePct}% das keywords/responsabilidades da vaga`]
          : []
    },
    {
      id: "personalization",
      label: "Personalizacao",
      score: personalizationScore,
      status: statusFromScore(personalizationScore),
      issues: personalization.issues
    }
  ];

  const overallScore = Math.round(
    quantScore * 0.24 +
      verbScore * 0.16 +
      grammarScore * 0.12 +
      consistencyScore * 0.1 +
      roleScore * 0.18 +
      personalizationScore * 0.12 +
      credibilityScore * 0.08
  );

  const suggestions: string[] = [];
  if (metricPct < 70) {
    suggestions.push(
      `Reescreva bullets com impacto real: % de reducao, tempo economizado, escala de usuarios, PRs/features entregues. PROIBIDO citar linhas/arquivos brutos (ex: '8558 linhas', '1979 arquivos'). So use linhas se for comparativo (de X para Y, -60%). Atual: ${metricPct}%.`
    );
    const metrics = collectAvailableMetrics(options?.projectEvidence);
    if (metrics.length > 0) {
      suggestions.push(`Metricas disponiveis nos dossies: ${metrics.slice(0, 4).join("; ")}`);
    }
  }
  if (actionVerbPct < 60) {
    suggestions.push("Inicie bullets com verbos fortes na primeira pessoa: Desenvolvi, Implementei, Otimizei, Automatizei.");
  }
  if (vanityBullets.length > 0) {
    suggestions.push(
      `Remova metricas de vaidade (linhas/arquivos brutos): ${vanityBullets.slice(0, 2).join(" | ")}`
    );
  }
  if (weakBullets.length > 0) {
    suggestions.push(
      `Bullets fracos detectados — transforme entregas em resultado: ${weakBullets.slice(0, 2).join(" | ")}`
    );
  }
  if (uniqueGrammar.length > 0) {
    suggestions.push(`Corrija gramatica/voz: ${uniqueGrammar.slice(0, 3).join("; ")}`);
  }
  if (suspiciousMetrics >= 3) {
    suggestions.push(
      "Evite percentuais redondos inventados (100%, 80%, 70%). Use metricas verificaveis dos dossies ou remova o numero."
    );
  }
  if (personalization.issues.length > 0) {
    suggestions.push(`Personalize para a vaga: ${personalization.issues.slice(0, 2).join("; ")}`);
  }
  if (roleAdherencePct < 65 && options?.jobSpec?.responsibilities.length) {
    suggestions.push(
      `Incorpore responsabilidades da vaga em Experiencia: ${options.jobSpec.responsibilities.slice(0, 2).join(" | ")}`
    );
  }

  const sectionsPresent: string[] = [];
  if (/^##\s+(Resumo|Summary)/im.test(markdown)) sectionsPresent.push("Resumo");
  if (/^##\s+(Experiencia|Experiência|Experience)/im.test(markdown)) sectionsPresent.push("Experiencia");
  if (/^##\s+(Projetos|Projects)/im.test(markdown)) sectionsPresent.push("Projetos");
  if (/^##\s+(Contato|Contact)/im.test(markdown)) sectionsPresent.push("Contato");

  const roleMax = 20;
  const roleActual = Math.round((roleAdherencePct / 100) * roleMax);

  const evidenceLines = [
    `${withMetrics.length}/${totalBullets} bullets com metricas`,
    `Aderencia (${roleActual}/${roleMax})`,
    `Personalizacao (${personalizationScore}%)`,
    `Verbos de acao (${actionVerbPct}%)`,
    `Estrutura: ${sectionsPresent.join(", ") || "incompleta"}`,
    ...dimensions
      .filter(d => d.status !== "ok")
      .slice(0, 3)
      .map(d => `${d.label}: ${d.score}%`)
  ];

  return {
    overallScore,
    bulletsWithMetrics: withMetrics.length,
    totalBullets,
    metricPct,
    actionVerbPct,
    roleAdherencePct,
    personalizationPct: personalizationScore,
    dimensions,
    weakBullets: weakBullets.slice(0, 8),
    suggestions: suggestions.slice(0, 8),
    evidenceLines
  };
}
