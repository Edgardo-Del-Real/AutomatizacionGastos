import { normalizeForMatch } from "../categories/matcher";

export type TelegramCommand =
  | { type: "register"; name: string }
  | { type: "rename"; from: string; to: string }
  | { type: "associate"; keyword: string; category: string }
  | { type: "list" }
  | { type: "configurar" };

const REGISTER_RE = /^\s*registrar\s+categoria\s*:\s*(.+?)\s*$/;
const RENAME_RE = /^\s*renombrar\s+categoria\s*:\s*(.+?)\s+a\s*:\s*(.+?)\s*$/;
const ASSOCIATE_RE = /^\s*asociar\s+palabra\s*:\s*(.+?)\s+a\s+categoria\s*:\s*(.+?)\s*$/;
const LIST_RE = /^\s*listar\s+categorias\s*$/;
const CONFIGURAR_RE = /^\s*configurar\s+categorias\s*$/;

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

  return null;
}

/** normalizeForMatch is length-preserving, so normalized indices map 1:1 onto the original. */
function sliceFromOriginal(original: string, normalized: string, value: string): string {
  const index = normalized.indexOf(value);
  return original.slice(index, index + value.length);
}