export const normalizeKeyword = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9+#.\- ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const unique = (items: string[]): string[] => Array.from(new Set(items));

export const extractKeywords = (input: string): string[] => {
  const lowered = normalizeKeyword(input);

  const techPattern = /\b(?:react|vite|typescript|javascript|node|python|java|go|rust|sql|sqlite|postgres|docker|kubernetes|aws|azure|gcp|graphql|rest|axios|zod|zustand|tailwind|shadcn|ci\/cd|github actions|testing|vitest|jest|playwright|next\.js|nuqs)\b/g;
  const matches = lowered.match(techPattern) ?? [];

  return unique(matches.map((item) => item.trim()).filter(Boolean));
};