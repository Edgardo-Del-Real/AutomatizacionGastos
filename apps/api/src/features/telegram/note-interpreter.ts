import { z } from "zod";

export type InterpretedNote = {
  amount: number;
  category: string | null;
  product: string | null;
};

export interface NoteInterpreter {
  /** Never throws. null = fall back to today's deterministic behavior. */
  interpret(note: string): Promise<InterpretedNote | null>;
}

/**
 * Normalizes a Spanish/Argentine amount representation to a positive finite
 * number, or null when it cannot be interpreted. Strip whitespace and currency
 * symbols first; disambiguate thousands vs decimal separators by position;
 * apply the "mil"/"k" multiplier.
 */
export function normalizeAmountString(value: string): number | null {
  const cleaned = value
    .trim()
    .replace(/[\s$€]/g, "")
    .replace(/^(ars|usd)/i, "");

  const multiplier = cleaned.match(/^(\d*)\s*(mil|k)$/i);
  if (multiplier !== null) {
    const base = multiplier[1] === "" ? 1 : Number(multiplier[1]);
    const result = base * 1000;
    return Number.isFinite(result) && result > 0 ? result : null;
  }

  // Both separators present: the LAST one is the decimal marker.
  if (/[.,].*[.,]/.test(cleaned)) {
    const dotIndex = cleaned.lastIndexOf(".");
    const commaIndex = cleaned.lastIndexOf(",");
    const decimalSeparator = dotIndex > commaIndex ? "." : ",";
    const thousandsSeparator = decimalSeparator === "." ? "," : ".";
    const normalized = cleaned.replaceAll(thousandsSeparator, "").replace(decimalSeparator, ".");
    const amount = Number(normalized);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  }

  // Single separator: 3-digit groups are thousands; otherwise decimal.
  const thousands = cleaned.match(/^\d{1,3}([.,]\d{3})+$/);
  if (thousands !== null) {
    const amount = Number(cleaned.replaceAll(/[.,]/g, ""));
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  }
  const decimal = cleaned.match(/^\d+([.,]\d{1,2})$/);
  if (decimal !== null) {
    const amount = Number(cleaned.replace(",", "."));
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  }

  const integer = cleaned.match(/^\d+$/);
  if (integer !== null) {
    const amount = Number(cleaned);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  }

  return null;
}

const llmAmount = z.union([z.number(), z.string()]).transform((value) => normalizeAmountString(String(value)));

export const interpretedNoteSchema = z
  .object({
    amount: llmAmount,
    category: z.string().trim().min(1).max(60).nullable(),
    product: z.string().trim().max(200).nullable().optional(),
  })
  .refine((data) => data.amount !== null && Number.isFinite(data.amount) && data.amount > 0);

export const SYSTEM_PROMPT = [
  "Respondé SOLO con un objeto JSON: {\"amount\": number|null, \"category\": string|null, \"product\": string|null}.",
  "No agregues texto ni campos extra.",
  "NUNCA inventes un monto: usá null cuando el mensaje no tiene monto.",
  "Todo es en pesos argentinos (ARS): ignorá símbolos o nombres de moneda ($, usd, €) y no conviertas.",
  "\"1.234,50\" y \"1234,50\" significan 1234.50; \"1234.5\" significa 1234.5; \"5 mil\" o \"cinco mil\" significan 5000 — devolvé el número.",
  "\"category\" es la categoría más probable (ej: \"Supermercado\", \"Transporte\"), máximo 60 caracteres, null si no estás seguro.",
  "\"product\" es el producto o servicio concreto si se menciona, máximo 200 caracteres, si no null.",
].join(" ");

export class GroqNoteInterpreter implements NoteInterpreter {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: {
    apiKey: string;
    model: string;
    baseUrl: string;
    timeoutMs: number;
    fetchImpl?: typeof fetch;
  }) {
    this.apiKey = deps.apiKey;
    this.model = deps.model;
    this.baseUrl = deps.baseUrl;
    this.timeoutMs = deps.timeoutMs;
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  async interpret(note: string): Promise<InterpretedNote | null> {
    try {
      const response = await this.fetchImpl(this.baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: note },
          ],
          temperature: 0,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        return null;
      }

      const data: unknown = await response.json();
      if (typeof data !== "object" || data === null) {
        return null;
      }
      const content = (data as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        return null;
      }

      const payload: unknown = JSON.parse(content);
      const result = interpretedNoteSchema.safeParse(payload);
      if (!result.success) {
        return null;
      }
      // The refine guarantees a finite positive amount; the guard below is a
      // belt-and-braces narrowing that keeps the client's contract total.
      if (result.data.amount === null) {
        return null;
      }

      return {
        amount: result.data.amount,
        category: result.data.category,
        product: result.data.product ?? null,
      };
    } catch {
      return null;
    }
  }
}