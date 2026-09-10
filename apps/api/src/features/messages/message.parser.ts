import type { MovementType } from "@rita/contracts";

export type ParsedAmount = {
  amount: number;
  note: string | null;
};

const NUMBER_TOKEN_REGEX = /\d[\d.,]*/g;

const INCOME_KEYWORDS = ["ingreso", "cobro", "sueldo", "venta", "recibí", "depósito"];
// Latin-1 letter range so accented words (recibí, depósito) participate in boundary checks.
// Bare range without brackets: it is interpolated inside character classes ([^...], (?![...])).
const LETTER = "A-Za-zÀ-ÿ";
const INCOME_KEYWORD_REGEX = new RegExp(`(?:^|[^${LETTER}])(${INCOME_KEYWORDS.join("|")})(?![${LETTER}])`, "i");
const PLUS_PREFIXED_AMOUNT_REGEX = /\+\s*\d/;

export function classifyMovementType(body: string): MovementType {
  if (INCOME_KEYWORD_REGEX.test(body)) return "INCOME";
  if (PLUS_PREFIXED_AMOUNT_REGEX.test(body)) return "INCOME";
  return "EXPENSE";
}

export function parseAmount(body: string): number | null {
  const tokens = body.match(NUMBER_TOKEN_REGEX) ?? [];
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    if (token === undefined) continue;
    const amount = parseNumberToken(token);
    if (amount !== null) return amount;
  }
  return null;
}

export function extractNote(body: string): string | null {
  const tokens = body.match(NUMBER_TOKEN_REGEX) ?? [];
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    if (token === undefined) continue;
    if (parseNumberToken(token) === null) continue;
    const index = body.lastIndexOf(token);
    const cleaned = `${body.slice(0, index)}${body.slice(index + token.length)}`
      .replace(/\s{2,}/g, " ")
      .trim();
    return cleaned.length > 0 ? cleaned : null;
  }
  const trimmed = body.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseAmountAndNote(body: string): ParsedAmount | null {
  const amount = parseAmount(body);
  if (amount === null) return null;
  return { amount, note: extractNote(body) };
}

function parseNumberToken(token: string): number | null {
  if (/^\d{1,3}(?:\.\d{3})+$/.test(token)) return Number(token.replaceAll(".", ""));
  if (/^\d{1,3}(?:,\d{3})+$/.test(token)) return Number(token.replaceAll(",", ""));
  if (/^\d+$/.test(token)) return Number(token);
  return null;
}