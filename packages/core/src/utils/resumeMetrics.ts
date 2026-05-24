/**
 * Regras de metricas para curriculo: numeros de linhas/arquivos brutos NAO sao impacto.
 * Validos: reducao comparativa, %, tempo, escala de negocio, PRs/features entregues.
 */

const VALID_OPTIMIZATION =
  /\b(?:reduz(?:iu|ir|indo|ido|ição|icao)|diminu(?:iu|ir|indo)|cort(?:ou|ar|ando)|economiz(?:ou|ar|ando)|otimiz(?:ou|ar|ando)|melhor(?:ou|ar|ando))\b[\s\S]{0,100}?\b\d[\d.,]*\s*%/i;

const VALID_BEFORE_AFTER =
  /\bde\s+\d[\d.,]+\s*(?:para|a|→|->)\s*\d[\d.,]+/i;

const VANITY_LINE_COUNT =
  /\b(?:adicionando|estabelecendo|expandindo|incluindo|com)\s+\*?\*?\d[\d.,]*\*?\*?\s*linhas?\b/i;

const VANITY_LINE_TOTAL =
  /\*?\*?\d[\d.,]*\*?\*?\s*linhas?\s*(?:de\s+c[oó]digo|add|para|em)\b/i;

const VANITY_FILE_REORG =
  /\b(?:reorganiz\w*|consolid\w*)\s+\*?\*?\d[\d.,]*\*?\*?\s*arquivos?\b|\b\d[\d.,]*\s*arquivos?\s+reorganiz\w*\b/i;

const VANITY_DIFF =
  /\b(?:diff:?\s*)?\+?\d[\d.,]*\s*\/\s*-?\d[\d.,]*\s*linhas?\b/i;

const VANITY_RAW_LINES =
  /\b\d[\d.,]+\s*linhas?\b/i;

export function hasValidOptimizationMetric(text: string): boolean {
  const cleaned = text.replace(/\*\*/g, "");
  return VALID_OPTIMIZATION.test(cleaned) || VALID_BEFORE_AFTER.test(cleaned);
}

export function isVanityMetricText(text: string): boolean {
  const cleaned = text.replace(/\*\*/g, "").trim();
  if (!cleaned) return false;
  if (hasValidOptimizationMetric(cleaned)) return false;

  return (
    VANITY_LINE_COUNT.test(cleaned) ||
    VANITY_LINE_TOTAL.test(cleaned) ||
    VANITY_FILE_REORG.test(cleaned) ||
    VANITY_DIFF.test(cleaned) ||
    (VANITY_RAW_LINES.test(cleaned) && !hasValidOptimizationMetric(cleaned))
  );
}

export function filterMeaningfulImpactSignals(signals: string[]): string[] {
  return signals
    .map(s => s.trim())
    .filter(s => s.length > 0 && !isVanityMetricText(s) && !isVanityMetricText(stripVanityMetricPhrases(s)));
}

export function stripVanityMetricPhrases(text: string): string {
  let result = text;

  const replacements: Array<[RegExp, string]> = [
    [
      /\s*,?\s*(?:adicionando|estabelecendo|expandindo|incluindo)\s+\*?\*?\d[\d.,]*\*?\*?\s*linhas?(?:\s+de\s+c[oó]digo(?:\s+base)?)?(?:\s+para[^,.;]*)?/gi,
      ""
    ],
    [
      /\s*,?\s*(?:reduzindo|em)\s+\*?\*?\d[\d.,]*\*?\*?\s*arquivos?\s+reorganizados?/gi,
      ""
    ],
    [
      /\s*,?\s*reorganizando\s+\*?\*?\d[\d.,]*\*?\*?\s*arquivos?\s+e\s+consolidando/gi,
      ", reorganizando a estrutura do monorepo e consolidando"
    ],
    [/\s*,?\s*reorganizando\s+\*?\*?\d[\d.,]*\*?\*?\s*arquivos?/gi, ", reorganizando a estrutura do repositório"],
    [/\s*,?\s*expandindo\s+a\s+cobertura\s+em\s+\*?\*?\d[\d.,]*\*?\*?\s*linhas?[^,.;]*/gi, ""],
    [
      /\s*\*?\*?\d[\d.,]*\*?\*?\s*linhas?\s*(?:de\s+c[oó]digo(?:\s+base)?|para\s+[^,.;]+|em\s+[^,.;]+|t[eé]cnica)?/gi,
      ""
    ],
    [/\b(?:atualizando|removendo)[^,.;]*?\d[\d.,]+\s*linhas?[^,.;]*/gi, ""],
    [/\b(?:diff:?\s*)?\+?\d[\d.,]*\s*\/\s*-?\d[\d.,]*\s*linhas?\b/gi, ""]
  ];

  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement);
  }

  result = result
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\s+\./g, ".")
    .trim();

  if (result.endsWith(",")) result = result.slice(0, -1).trim();
  return result;
}

const MEANINGFUL_QUANT_PATTERNS: RegExp[] = [
  /\d+\s*%/,
  /\*\*[^*]*\d+[^*]*\*\*/,
  /\d+[\d.,]*\s*(?:min|mins|minutos|horas|h|dias|semanas|meses|s|ms|usu[aá]rios|users|clientes|componentes|m[oó]dulos|telas|p[aá]ginas|rotas|endpoints|testes|bugs|features|pr[s]?|squads|times|pessoas|views|stores|hooks|servi[cç]os|m[oó]dulos|pacotes|libs|bibliotecas)/i,
  /\bde\s+\d+[\d.,]*\s*(ms|s|min|%|usu[aá]rios|componentes|telas|rotas|endpoints)\s+para/i,
  /\bpara\s+\d+[\d.,]*/i,
  /\breduz/i,
  /\baument/i,
  /\belimin/i,
  /\botimiz/i,
  /\bcort/i,
  /\beconomiz/i,
  /\bdiminu/i,
  /\b\d+\s*(?:→|->|a)\s*\d+/i,
  /\b(cerca de|aproximadamente|mais de|at[eé])\s+\d+\s+pessoas/i,
  /\b(?:dezenas|centenas)\s+de\s+componentes/i
];

export function bulletHasMeaningfulMetric(text: string): boolean {
  const cleaned = stripVanityMetricPhrases(text.replace(/\*\*/g, "")).trim();
  if (cleaned.length < 8) return false;
  if (isVanityMetricText(cleaned)) return false;
  if (hasValidOptimizationMetric(cleaned)) return true;
  return MEANINGFUL_QUANT_PATTERNS.some(pattern => pattern.test(cleaned));
}

/** Remove percentuais redondos suspeitos (100%, 80%, 60%...) sem comparativo antes/depois. */
export function stripSuspiciousPercentClauses(text: string): string {
  if (hasValidOptimizationMetric(text)) return text;

  let result = text.replace(
    /,?\s*(?:resultando|reduzindo|aumentando|eliminando|garantindo|processando|melhorando|otimizando|acelerando|diminuindo|exibindo|cobrindo|documentando)[^,.;]*?(?:100|90|85|80|75|70|65|60|55|50|45|40|35|30|25|20|15|10|5)\s*%[^,.;]*/gi,
    ""
  );
  result = result.replace(
    /\*\*(?:100|90|85|80|75|70|65|60|55|50|45|40|35|30|25|20|15|10|5)\s*%\*\*/g,
    ""
  );
  result = result.replace(
    /\b(?:em|de|por|com)\s+(?:100|90|85|80|75|70|65|60|55|50|45|40|35|30|25|20|15|10|5)\s*%/gi,
    ""
  );
  return result
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\(\s*\)/g, "")
    .trim();
}

export function sanitizeVanityMetricsInMarkdown(markdown: string): string {
  const lines = markdown.split("\n");
  const output: string[] = [];

  for (const line of lines) {
    const bullet = line.match(/^([-*•]\s+)(.+)/);
    if (!bullet) {
      output.push(line);
      continue;
    }

    let body = bullet[2]!;
    if (isVanityMetricText(body) || /\b\d[\d.,]+\s*linhas?\b/i.test(body.replace(/\*\*/g, ""))) {
      body = stripVanityMetricPhrases(body);
    }
    body = stripSuspiciousPercentClauses(body);

    body = body.replace(/\s{2,}/g, " ").trim();
    if (body.length >= 20) {
      output.push(`${bullet[1]}${body}`);
    } else if (body.length > 0) {
      output.push(`${bullet[1]}${body}`);
    } else {
      output.push(line);
    }
  }

  return output.join("\n");
}
