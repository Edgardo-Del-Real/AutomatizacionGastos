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
 * First token containing a letter ("$500" is not significant; "uber" is).
 */
export function firstSignificantWord(note: string): string | null {
  const tokens = note.trim().split(/\s+/);
  for (const token of tokens) {
    if (/[a-zà-ÿ]/i.test(token)) {
      return token;
    }
  }
  return null;
}