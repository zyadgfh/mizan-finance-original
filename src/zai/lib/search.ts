// File: src/zai/lib/search.ts — Arabic-tolerant search normalization
export function normalizeArabic(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, "") // tashkeel
    .replace(/[إأآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}
export function matchesQuery(haystack: string, query: string): boolean {
  const q = normalizeArabic(query);
  if (!q) return true;
  return normalizeArabic(haystack).includes(q);
}
export function countMatches(text: string, query: string): number {
  const q = normalizeArabic(query);
  if (!q) return 0;
  const t = normalizeArabic(text);
  let n = 0, i = 0;
  while ((i = t.indexOf(q, i)) !== -1) { n++; i += q.length; }
  return n;
}
