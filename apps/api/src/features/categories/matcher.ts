export type KeywordRule = {
  keyword: string;
  category: string;
  createdAt: Date;
};

/**
 * Length-preserving normalization: lowercase + per-character accent fold.
 * The output length equals the input length, so callers can slice values
 * out of the ORIGINAL text at the same indices found on the normalized text
 * (D3).
 */
export function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .split("")
    .map((char) => char.normalize("NFD").charAt(0))
    .join("");
}

const WORD_CHARS = "a-z0-9";

function boundaryRegex(keyword: string): RegExp {
  return new RegExp(`(?:^|[^${WORD_CHARS}])${escapeRegExp(keyword)}(?![${WORD_CHARS}])`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches a note against the owner's keyword rules. Rules are ordered by
 * `createdAt ASC, keyword ASC` — oldest-learned wins (D4). Matching is
 * diacritic-insensitive and word-boundary based. Returns the category name
 * of the first matching rule, or null when no rule matches.
 */
export function matchCategory(note: string, rules: KeywordRule[]): string | null {
  const normalized = normalizeForMatch(note);
  const ordered = [...rules].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.keyword.localeCompare(b.keyword),
  );
  for (const rule of ordered) {
    if (boundaryRegex(rule.keyword).test(normalized)) {
      return rule.category;
    }
  }
  return null;
}

/**
 * Curated Spanish stopwords (articles, prepositions, conjunctions, pronouns,
 * generic spending verbs and time filler) stored in normalized form. Words
 * shorter than 3 chars are dropped by length anyway, so only 3+ char stopwords
 * need to live here.
 */
const SPANISH_STOPWORDS = new Set([
  // articles and determiners
  "el", "la", "los", "las", "un", "una", "unos", "unas", "lo", "al", "del",
  "este", "esta", "estos", "estas", "ese", "esa", "esos", "esas",
  "aquel", "aquella", "aquellos", "aquellas",
  "mi", "mis", "tu", "tus", "su", "sus", "nuestro", "nuestra", "nuestros", "nuestras",
  // prepositions
  "ante", "bajo", "cabe", "con", "contra", "desde", "durante", "entre",
  "hacia", "hasta", "mediante", "para", "por", "segun", "sin", "so", "sobre",
  "tras", "via",
  // conjunctions
  "pero", "aunque", "como", "porque", "pues",
  // pronouns
  "yo", "te", "ti", "le", "les", "se", "nos", "vos", "el", "ella", "ello",
  "ellos", "ellas", "quien", "quienes", "algo", "nada", "alguien",
  // generic spending verbs
  "compre", "compra", "comprar", "compro", "comprado", "comprando",
  "fui", "fue", "ir", "voy",
  "pague", "pago", "pagar", "pagado", "pagando",
  "gaste", "gasto", "gastar", "gastado", "gastando",
  "tengo", "tuve", "tener", "tenia", "necesito", "hice", "hacer", "hizo", "hecho",
  "estoy", "estaba", "estuvo", "estar", "ando", "anda", "andar", "quiero", "quise",
  "dejo", "dejar", "deje", "lleve", "llevar", "llevo", "puse", "poner", "pongo",
  // time and filler words
  "hoy", "ayer", "ya", "muy", "mas", "bien", "siempre", "nunca", "ahora",
  "despues", "entonces", "tambien", "solo",
  "otro", "otra", "otros", "otras", "todo", "toda", "todos", "todas",
]);

/**
 * Extracts the most informative keywords from a spending note. Tokens are
 * normalized (lowercase + accent fold), stopwords and tokens without letters
 * or shorter than 3 chars are dropped, and the LAST significant words win
 * (Spanish usually puts the informative nouns late in the phrase). Returns up
 * to `max` unique normalized keywords; empty when nothing significant remains.
 */
export function significantKeywords(note: string, max = 3): string[] {
  const filtered: string[] = [];
  for (const token of note.trim().split(/\s+/)) {
    const word = normalizeForMatch(token);
    if (!/[a-z]/i.test(word)) continue;
    if (word.length < 3) continue;
    if (SPANISH_STOPWORDS.has(word)) continue;
    filtered.push(word);
  }

  // Keep the LAST occurrence of each keyword, then slice the trailing `max`.
  const reversed: string[] = [];
  const seen = new Set<string>();
  for (let i = filtered.length - 1; i >= 0; i -= 1) {
    const word = filtered[i];
    if (word === undefined || seen.has(word)) continue;
    seen.add(word);
    reversed.push(word);
  }
  reversed.reverse();
  return reversed.slice(Math.max(0, reversed.length - max));
}