import { normalizeForMatch } from "../categories/matcher";

export type TelegramCommand =
  | { type: "register"; name: string }
  | { type: "rename"; from: string; to: string }
  | { type: "associate"; keyword: string; category: string }
  | { type: "list" }
  | { type: "configurar" }
  | { type: "savings-rule"; keyword: string; percent: number }
  | { type: "savings-rule-invalid" };

const REGISTER_RE = /^\s*registrar\s+categoria\s*:\s*(.+?)\s*$/;
const RENAME_RE = /^\s*renombrar\s+categoria\s*:\s*(.+?)\s+a\s*:\s*(.+?)\s*$/;
const DELETE_CATEGORY_RE = /^\s*borrar\s+categoria\s*:\s*(.+?)\s*$/;
const ASSOCIATE_RE = /^\s*asociar\s+palabra\s*:\s*(.+?)\s+a\s+categoria\s*:\s*(.+?)\s*$/;
const LIST_RE = /^\s*listar\s+categorias\s*$/;
const CONFIGURAR_RE = /^\s*configurar\s+categorias\s*$/;
const SAVINGS_RULE_RE = /^\s*registrar\s+ahorro\s*:\s*(.+?)\s+al\s+(-?\d+(?:[.,]\d+)?)%\s*$/;

/**
 * Recognizes the five owner commands on accent- and case-insensitive text
 * (D3). Values are sliced from the ORIGINAL text at the indices found on the
 * normalized text, so spelling is preserved ("Café" stays "Café").
 * Returns null when the text is not a command (falls through to registration).
 */
export function parseCommand(text: string): TelegramCommand | null {
  const normalized = normalizeForMatch(text);

  if (CONFIGURAR_RE.test(normalized)) {
    return { type: "configurar" };
  }
  if (LIST_RE.test(normalized)) {
    return { type: "list" };
  }

  const register = REGISTER_RE.exec(normalized);
  if (register !== null && register[1] !== undefined && register[1].length > 0) {
    return { type: "register", name: sliceFromOriginal(text, normalized, register[1]) };
  }

  const rename = RENAME_RE.exec(normalized);
  if (rename !== null) {
    return {
      type: "rename",
      from: sliceFromOriginal(text, normalized, rename[1]!),
      to: sliceFromOriginal(text, normalized, rename[2]!),
    };
  }

  const associate = ASSOCIATE_RE.exec(normalized);
  if (associate !== null) {
    return {
      type: "associate",
      keyword: sliceFromOriginal(text, normalized, associate[1]!),
      category: sliceFromOriginal(text, normalized, associate[2]!),
    };
  }

  const savingsRule = SAVINGS_RULE_RE.exec(normalized);
  if (savingsRule !== null) {
    const percent = Number(savingsRule[2]!.replace(",", "."));
    // D10: only 0 < percent <= 100 defines a rule; an out-of-range percent is
    // still a recognized command and is rejected (nothing stored, no fallthrough).
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      return { type: "savings-rule-invalid" };
    }
    return {
      type: "savings-rule",
      keyword: sliceFromOriginal(text, normalized, savingsRule[1]!),
      percent,
    };
  }

  return null;
}

/** normalizeForMatch is length-preserving, so normalized indices map 1:1 onto the original. */
function sliceFromOriginal(original: string, normalized: string, value: string): string {
  const index = normalized.indexOf(value);
  return original.slice(index, index + value.length);
}

/**
 * One setup-reply entry after command classification (design D11): plain names
 * and `registrar categoria: X` are CREATE entries (identical effect), while
 * delete/rename commands carry their own semantics. Execution happens in
 * `handleSetupReply` via the guarded CategoryService — never as literals.
 */
export type SetupBatchEntry =
  | { kind: "create"; name: string }
  | { kind: "delete"; name: string }
  | { kind: "rename"; from: string; to: string };

/**
 * Pure parser for a setup reply: splits on commas/newlines, then classifies
 * each token against the batch-command regexes (delete/rename) before falling
 * back to plain create names. Values are sliced from the ORIGINAL text so
 * spelling is preserved. Returns an empty array when nothing remains.
 */
export function parseSetupBatchCommand(body: string): SetupBatchEntry[] {
  const raw = body
    .split(/[\n,]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  return raw.map((token) => {
    const normalized = normalizeForMatch(token);

    const del = DELETE_CATEGORY_RE.exec(normalized);
    if (del !== null && del[1] !== undefined && del[1].length > 0) {
      return { kind: "delete", name: sliceFromOriginal(token, normalized, del[1]) };
    }

    const rename = RENAME_RE.exec(normalized);
    if (rename !== null) {
      return {
        kind: "rename",
        from: sliceFromOriginal(token, normalized, rename[1]!),
        to: sliceFromOriginal(token, normalized, rename[2]!),
      };
    }

    const register = REGISTER_RE.exec(normalized);
    if (register !== null && register[1] !== undefined && register[1].length > 0) {
      return { kind: "create", name: sliceFromOriginal(token, normalized, register[1]) };
    }

    return { kind: "create", name: token };
  });
}