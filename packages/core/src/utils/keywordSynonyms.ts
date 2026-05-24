import { normalizeKeyword } from "./text";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Match simples por token — sem dicionario hardcoded de sinonimos. */
export function keywordInCorpus(keyword: string, corpus: string): boolean {
  const norm = normalizeKeyword(keyword);
  const normCorpus = normalizeKeyword(corpus);
  if (norm.length < 2) return false;

  if (norm.length <= 5) {
    const re = new RegExp(`(?:^|[\\s,/(\\[\\-])${escapeRegex(norm)}(?:$|[\\s,/)\\]\\-])`);
    return re.test(` ${normCorpus} `);
  }

  return normCorpus.includes(norm);
}

export function expandKeywordVariants(keyword: string): string[] {
  const norm = normalizeKeyword(keyword);
  return norm ? [norm] : [];
}
