import { normalizeForMatch } from "../categories/matcher";

export type TelegramCommand =
  | { type: "list" }
  | { type: "configurar" }
  | { type: "menu" }
  | { type: "start" }
  | { type: "ayuda" }
  | { type: "savings-rule"; keyword: string; percent: number }
  | { type: "savings-rule-invalid" };

const REGISTER_RE = /^\s*registrar\s+categoria\s*:\s*(.+?)\s*$/;
const RENAME_RE = /^\s*renombrar\s+categoria\s*:\s*(.+?)\s+a\s*:\s*(.+?)\s*$/;
const DELETE_CATEGORY_RE = /^\s*borrar\s+categoria\s*:\s*(.+?)\s*$/;
const ASSOCIATE_RE = /^\s*asociar\s+palabra\s*:\s*(.+?)\s+a\s+categoria\s*:\s*(.+?)\s*$/;
const LIST_RE = /^\s*listar\s+categorias\s*$/;
const CONFIGURAR_RE = /^\s*configurar\s+categorias\s*$/;
const MENU_RE = /^\s*menu\s*$/;
const START_RE = /^\s*start\s*$/;
const AYUDA_RE = /^\s*ayuda\s*$/;
const SAVINGS_RULE_RE = /^\s*registrar\s+ahorro\s*:\s*(.+?)\s+al\s+(-?\d+(?:[.,]\d+)?)%\s*$/;

/**
 * v2 — detection-only classifier for the legacy text category-CRUD commands
 * (design D8, spec telegram-bot "Bot Commands"): `registrar categoria:`,
 * `renombrar categoria:` and `asociar palabra:` MUST NOT be recognized as
 * commands anymore — a message carrying one gets the educational redirect to
 * the 🗂 Administrar categorías button and never creates or renames anything.
 * Returns the kind (never the values: detection-only, nothing is stripped or
 * executed). Same regexes and non-empty guards as the former command branches.
 */
export type LegacyCategoryCrud = { kind: "register" | "rename" | "associate" };

export function parseLegacyCategoryCrud(text: string): LegacyCategoryCrud | null {
  const syntaxNormalized = normalizeCommandSyntax(text);
  const normalized = normalizeForMatch(syntaxNormalized);

  const register = REGISTER_RE.exec(normalized);
  if (register !== null && register[1] !== undefined && register[1].length > 0) {
    return { kind: "register" };
  }

  const rename = RENAME_RE.exec(normalized);
  if (rename !== null) {
    return { kind: "rename" };
  }

  const associate = ASSOCIATE_RE.exec(normalized);
  if (associate !== null) {
    return { kind: "associate" };
  }

  return null;
}

/**
 * D12 — normalizes a leading `/` (bot-command syntax) and `_`→space before
 * the existing regexes match: "/menu" → "menu", "/listar_categorias" →
 * "listar categorias". Keeps the existing regexes as the single parser
 * surface for `/listar_categorias` and "listar categorias".
 */
function normalizeCommandSyntax(text: string): string {
  return text.replace(/^\//, "").replaceAll("_", " ");
}

/**
 * Recognizes the owner commands on accent- and case-insensitive text
 * (D3). Values are sliced from the ORIGINAL text at the indices found on the
 * normalized text, so spelling is preserved ("Café" stays "Café").
 * Returns null when the text is not a command (falls through to registration).
 */
export function parseCommand(text: string): TelegramCommand | null {
  // D12 — the leading `/` and `_` separators are normalized BEFORE matching;
  // value extraction slices from the syntax-normalized text so indices map 1:1.
  const syntaxNormalized = normalizeCommandSyntax(text);
  const normalized = normalizeForMatch(syntaxNormalized);

  if (CONFIGURAR_RE.test(normalized)) {
    return { type: "configurar" };
  }
  if (LIST_RE.test(normalized)) {
    return { type: "list" };
  }
  if (MENU_RE.test(normalized)) {
    return { type: "menu" };
  }
  // /start (always sent by Telegram when the user opens the bot) behaves as
  // the main menu — the first thing a new user sees are the action buttons.
  if (START_RE.test(normalized)) {
    return { type: "start" };
  }
  if (AYUDA_RE.test(normalized)) {
    return { type: "ayuda" };
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
      keyword: sliceFromOriginal(syntaxNormalized, normalized, savingsRule[1]!),
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