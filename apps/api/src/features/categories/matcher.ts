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

/**
 * Word-boundary regex for a keyword on normalized text (diacritic-folded,
 * lowercase). Exported so the savings slice reuses the same matching
 * semantics for savings-rule keywords (D4).
 */
export function boundaryRegex(keyword: string): RegExp {
  return new RegExp(`(?:^|[^${WORD_CHARS}])${escapeRegExp(keyword)}(?![${WORD_CHARS}])`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

function isVowel(char: string): boolean {
  return VOWELS.has(char);
}

/**
 * Invariant Spanish words that MUST never fold (research §7.2): Lucene's
 * SpanishPluralStemmer list plus the app-specific stressed-singular additions
 * that the -ces/-is/-s rules would otherwise mangle (dios, frances, interes,
 * autobus, cortes, ...). Stored in folded (lowercase, accent-stripped) form.
 */
const PLURAL_EXCLUSIONS: ReadonlySet<string> = new Set([
  // Lucene SpanishPluralStemmer invariant list (accents folded).
  "abrebotellas", "abrecartas", "abrelatas", "afueras", "albatros", "albricias",
  "aledanos", "alexis", "alicates", "analisis", "andurriales", "antitesis",
  "anicos", "apendicitis", "apocalipsis", "arcoiris", "aries", "bilis",
  "boletus", "boris", "brindis", "cactus", "canutas", "caries", "cascanueces",
  "cascarrabias", "ciempies", "cifosis", "cortaplumas", "corpus", "cosmos",
  "cosquillas", "creces", "crisis", "cuatrocientas", "cuatrocientos",
  "cuelgacapas", "cuentacuentos", "cuentapasos", "cumpleanos", "doscientas",
  "doscientos", "dosis", "enseres", "entonces", "esponsales", "estatus",
  "exequias", "fauces", "forceps", "fotosintesis", "gafas", "gafotas",
  "gargaras", "gris", "honorarios", "ictus", "jueves", "lapsus", "lavacoches",
  "lavaplatos", "limpiabotas", "lunes", "maitines", "martes", "mondadientes",
  "novecientas", "novecientos", "nupcias", "ochocientas", "ochocientos",
  "pais", "paris", "parabrisas", "paracaidas", "parachoques", "paraguas",
  "pararrayos", "pisapapeles", "piscis", "portaaviones", "portamaletas",
  "portamantas", "quinientas", "quinientos", "quitamanchas", "recogepelotas",
  "rictus", "rompeolas", "sacacorchos", "sacapuntas", "saltamontes",
  "salvavidas", "seis", "seiscientas", "seiscientos", "setecientas",
  "setecientos", "sintesis", "tenis", "tifus", "trabalenguas", "vacaciones",
  "venus", "versus", "viacrucis", "virus", "viveres", "volandas",
  // App-specific stressed-singular additions (research §7.1 analysis).
  "dios", "tres", "vals", "frances", "ingles", "interes", "compas", "atras",
  "demas", "ademas", "despues", "jamas", "estres", "marques", "cortes",
  "autobus", "miercoles", "viernes", "biceps",
]);

/**
 * Special-case plurals that fold by stripping "es" (research §5.3, adopted
 * from Lucene's SpanishPluralStemmer).
 */
const PLURAL_SPECIALS: ReadonlySet<string> = new Set([
  "yoes", "noes", "sies", "clubes", "faralaes", "albalaes", "itemes",
  "albumes", "sandwiches", "relojes", "bojes", "contrarreloj", "carcajes",
]);

/**
 * Conservative Spanish plural fold (research §5.2, Lucene
 * SpanishPluralStemmer model): length guard, exclusion list, special cases,
 * then 13 ordered rules applied at most once. Never re-folds its own output
 * ("meses"→"mes" must not become "me").
 */
export function foldSpanishPluralToken(token: string): string {
  if (token.length < 4) {
    return token; // rule 0: plural forms have at least 4 letters (monosyllables like mes stay)
  }
  if (PLURAL_EXCLUSIONS.has(token)) {
    return token; // rule 1: invariant words never fold
  }
  if (PLURAL_SPECIALS.has(token)) {
    return token.endsWith("es") ? token.slice(0, -2) : token; // rule 2
  }

  const charMinus2 = token[token.length - 2] ?? "";
  const last2 = token.slice(-2);
  const last3 = token.slice(-3);
  const charMinus4 = token[token.length - 4] ?? "";

  // Rule 3: consonant + s → drop the s (clips→clip, entrenuts→entrenut).
  if (token.endsWith("s") && !isVowel(charMinus2)) {
    return token.slice(0, -1);
  }
  // Rule 4: -ques / -guis / -gues → drop the s (parques→parque).
  if (/ques$/.test(token) || /guis$/.test(token) || /gues$/.test(token)) {
    return token.slice(0, -1);
  }
  // Rule 5: vowel + r + es → drop the es (amores→amor).
  if (last3 === "res" && isVowel(charMinus4)) {
    return token.slice(0, -2);
  }
  // Rule 6: vowel + (d|l|n|x) + es → drop the es (panes→pan, verdades→verdad).
  if (
    (last3 === "des" || last3 === "les" || last3 === "nes" || last3 === "xes") &&
    isVowel(charMinus4)
  ) {
    return token.slice(0, -2);
  }
  // Rule 7: (y|u) + es → drop the es (leyes→ley, convoyes→convoy).
  if (last2 === "yes" || last2 === "ues") {
    return token.slice(0, -2);
  }
  // Rule 8: (u|l|r|t|n) + ies → drop the es (jabalies→jabali).
  if (last3 === "ies" && /[ulrtn]/.test(charMinus4)) {
    return token.slice(0, -2);
  }
  // Rule 9: ...ses → drop the es (meses→mes, toses→tos). Must run before the
  // vowel+s fallback so "meses" folds to "mes", never "mese".
  if (last3 === "ses") {
    return token.slice(0, -2);
  }
  // Rule 10: vowel + is → final i becomes y, drop the s (jerseis→jersey).
  if (last2 === "is" && isVowel(token[token.length - 3] ?? "")) {
    return `${token.slice(0, -2)}y`;
  }
  // Rule 11: -dis → final i becomes y, drop the s (brandis→brandy).
  if (last3 === "dis") {
    return `${token.slice(0, -2)}y`;
  }
  // Rule 12: -ces → c becomes z, drop the es (luces→luz, voces→voz).
  if (last3 === "ces") {
    return `${token.slice(0, -3)}z`;
  }
  // Rule 13: vowel + s → drop the s (casas→casa, cafes→cafe, gastos→gasto).
  if (token.endsWith("s") && isVowel(charMinus2)) {
    return token.slice(0, -1);
  }
  return token;
}

/**
 * Tolerant normalization for matching: `normalizeForMatch` (lowercase +
 * accent fold, length-preserving) followed by a per-token conservative plural
 * fold. Tokens split on any non-alphanumeric run and rejoin with single
 * spaces. The literal `normalizeForMatch` and `boundaryRegex` exports stay
 * byte-identical — they are load-bearing for commands, dedupe, correction
 * scoring and index slicing (C14).
 */
export function normalizeForMatchTolerant(value: string): string {
  return normalizeForMatch(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0)
    .map(foldSpanishPluralToken)
    .join(" ");
}

/**
 * Matches a note against the owner's keyword rules. Rules are ordered by
 * `createdAt ASC, keyword ASC` — oldest-learned wins (D4). Matching is
 * diacritic-insensitive, word-boundary based, and folds singular/plural
 * variants on BOTH sides through `normalizeForMatchTolerant`. Returns the
 * category name of the first matching rule, or null when no rule matches.
 */
export function matchCategory(note: string, rules: KeywordRule[]): string | null {
  const normalized = normalizeForMatchTolerant(note);
  const ordered = [...rules].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.keyword.localeCompare(b.keyword),
  );
  for (const rule of ordered) {
    if (boundaryRegex(normalizeForMatchTolerant(rule.keyword)).test(normalized)) {
      return rule.category;
    }
  }
  return null;
}

