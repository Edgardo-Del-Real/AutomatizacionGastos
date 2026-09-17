import { z } from "zod";
import { QUERY_TYPES, type QueryExecutionResult, type QueryType } from "./query.types";

export const BOT_INTENTS = [
  "register_expense",
  "correct_amount",
  "correct_category",
  "query",
  "query_recent",
  "query_balance",
  "query_month",
  "associate_keyword",
  "create_category",
  "delete_category",
  "rename_category",
  "capabilities",
  "help",
  "off_topic",
] as const;

export type BotIntent = (typeof BOT_INTENTS)[number];

export type ConversationEnvelope = {
  intent: BotIntent;
  amount: number | null;
  category: string | null;
  note: string | null;
  /** Discriminator for the `query` intent; absent for every other intent. */
  query_type?: QueryType | null;
  /** Target name for `rename_category`; null for every other intent. */
  new_name?: string | null;
};

export type BotAction =
  | "registered"
  | "asked_amount"
  | "asked_category"
  | "redirected"
  | "answered"
  | "none"
  | "created"
  | "deleted"
  | "renamed"
  | "capabilities";

export type CategoryCommandErrorCode = "duplicate" | "not_found" | "otro_forbidden" | "unknown";

export type ExecutionResult = {
  intent: BotIntent;
  ok: boolean;
  action: BotAction;
  amount: number | null;
  category: string | null;
  note: string | null;
  query_type?: QueryType | null;
  query?: QueryExecutionResult | null;
  new_name?: string | null;
  /** Human-readable error to transmit when ok is false. */
  message?: string | null;
  /** Machine discriminator for the fixed fallback template when ok is false. */
  error?: CategoryCommandErrorCode | null;
};

/** Fase-2 stub: category-blind this slice — callers pass nothing, client ignores it. */
export type InterpretContext = { categories?: readonly string[] };

export interface BotBrain {
  /** Never throws. null = degrade to the deterministic flow. */
  interpret(message: string, context?: InterpretContext): Promise<ConversationEnvelope | null>;
  /** Never throws. null = degrade to the fixed reply-text template. */
  reply(result: ExecutionResult): Promise<string | null>;
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

const llmAmount = z
  .union([z.number(), z.string()])
  .transform((value) => normalizeAmountString(String(value)))
  .refine((value) => value !== null, "present-but-invalid amount"); // explicit JSON null passes via .nullable()

export const conversationEnvelopeSchema = z
  .object({
    intent: z.enum(BOT_INTENTS),
    amount: llmAmount.nullable(),
    category: z.string().trim().min(1).max(60).nullable(),
    note: z.string().trim().min(1).max(200).nullable(),
    query_type: z.enum(QUERY_TYPES).nullable().default(null),
    new_name: z.string().trim().min(1).max(60).nullable().default(null),
  })
  .refine(
    (data) =>
      data.intent !== "register_expense" || data.amount === null || (data.amount > 0 && Number.isFinite(data.amount)),
  ) // belt-and-braces, mirrors today's schema
  .refine((data) => data.intent !== "query" || data.query_type !== null, "query intent requires a query_type");

export const replyEnvelopeSchema = z.object({ reply: z.string().trim().min(1).max(400) });

export type ChatMessage = { role: "user" | "assistant"; content: string };

export const INTERPRET_SYSTEM_PROMPT = [
  'Respondé SOLO con un objeto JSON con exactamente estas claves: {"intent": string, "amount": number|null, "category": string|null, "note": string|null, "query_type": string|null, "new_name": string|null}.',
  "No agregues texto ni campos extra.",
  '"intent" es exactamente UNA de: "register_expense" (cualquier movimiento de dinero, gasto o ingreso), "correct_amount", "correct_category", "query", "query_recent", "query_balance", "query_month", "associate_keyword", "create_category", "delete_category", "rename_category", "capabilities", "help", "off_topic".',
  "Si el mensaje tiene señal de gasto (verbo de gasto, $ o un monto) usá register_expense, aunque no tenga monto.",
  "NUNCA inventes un monto: usá null cuando el mensaje no tiene monto.",
  'Todo es en pesos argentinos (ARS): ignorá símbolos o nombres de moneda ($, usd, €) y no conviertas.',
  '"1.234,50" y "1234,50" significan 1234.50; "1234.5" significa 1234.5; "5 mil" o "cinco mil" significan 5000 — devolvé el número.',
  '"category" es una sugerencia de categoría (ej: "Supermercado", "Transporte"), máximo 60 caracteres, null si no estás seguro.',
  '"note" es la descripción concreta del gasto o ingreso, máximo 200 caracteres, null si no hay.',
  'Para preguntas sobre los datos del dueño usá "query" con su "query_type": "categories" (qué categorías tiene/disponibles), "recent" (últimos movimientos), "balance" (saldo, "cuánto me queda", "cuál es mi saldo"), "month" (resumen del mes).',
  '"query_recent", "query_balance" y "query_month" se mantienen por compatibilidad: preferí "query".',
  '"query_type" es null para cualquier intent que no sea "query".',
  'Para crear, borrar o renombrar categorías usá "create_category", "delete_category" o "rename_category": "create_category" y "delete_category" llevan el nombre en "category"; "rename_category" lleva el nombre actual en "category" y el nuevo en "new_name". "new_name" es null salvo en "rename_category".',
  'Para preguntas sobre lo que el bot SABE hacer (¿podes borrar categorías?, ¿qué sabés hacer?, ¿qué podes hacer?) usá "capabilities": es una pregunta de capacidades, NUNCA la trates como off_topic ni dejes la acción vacía.',
  'off_topic es para mensajes sin relación con gastos: clasificalo, NUNCA lo respondas como charla general.',
].join(" ");

export const FEW_SHOTS: readonly ChatMessage[] = [
  { role: "user", content: "gaste 5 mil en el super" },
  {
    role: "assistant",
    content: '{"intent":"register_expense","amount":5000,"category":"Supermercado","note":"super"}',
  },
  { role: "user", content: "compre mercaderia" },
  {
    role: "assistant",
    content: '{"intent":"register_expense","amount":null,"category":"Supermercado","note":"mercaderia"}',
  },
  { role: "user", content: "cuánto gasté este mes?" },
  {
    role: "assistant",
    content: '{"intent":"query","amount":null,"category":null,"note":null,"query_type":"month"}',
  },
  { role: "user", content: "cuales son las categorias disponibles" },
  {
    role: "assistant",
    content: '{"intent":"query","amount":null,"category":null,"note":null,"query_type":"categories"}',
  },
  { role: "user", content: "que categorias tengo" },
  {
    role: "assistant",
    content: '{"intent":"query","amount":null,"category":null,"note":null,"query_type":"categories"}',
  },
  { role: "user", content: "ultimos movimientos" },
  {
    role: "assistant",
    content: '{"intent":"query","amount":null,"category":null,"note":null,"query_type":"recent"}',
  },
  { role: "user", content: "cuanto me queda" },
  {
    role: "assistant",
    content: '{"intent":"query","amount":null,"category":null,"note":null,"query_type":"balance"}',
  },
  { role: "user", content: "hola, cómo andás?" },
  { role: "assistant", content: '{"intent":"off_topic","amount":null,"category":null,"note":null}' },
  { role: "user", content: "de ahora en más uber va a transporte" },
  { role: "assistant", content: '{"intent":"associate_keyword","amount":null,"category":null,"note":null}' },
  { role: "user", content: "creá una categoria llamada mascotas" },
  {
    role: "assistant",
    content:
      '{"intent":"create_category","amount":null,"category":"mascotas","note":null,"query_type":null,"new_name":null}',
  },
  { role: "user", content: "borra la categoria viajes" },
  {
    role: "assistant",
    content:
      '{"intent":"delete_category","amount":null,"category":"viajes","note":null,"query_type":null,"new_name":null}',
  },
  { role: "user", content: "renombra super a supermercado" },
  {
    role: "assistant",
    content:
      '{"intent":"rename_category","amount":null,"category":"super","note":null,"query_type":null,"new_name":"supermercado"}',
  },
  { role: "user", content: "podes borrar categorias?" },
  {
    role: "assistant",
    content:
      '{"intent":"capabilities","amount":null,"category":null,"note":null,"query_type":null,"new_name":null}',
  },
  { role: "user", content: "5000" },
  { role: "assistant", content: '{"intent":"correct_amount","amount":5000,"category":null,"note":null}' },
];

export const REPLY_SYSTEM_PROMPT = [
  "Escribís la respuesta del bot a su dueño, en español rioplatense, con voseo cálido.",
  "Recibís SOLO el JSON del resultado ejecutado y respondés con un objeto JSON: {\"reply\": string}.",
  "NUNCA afirmes un dato que no esté en el resultado: si amount es null no menciones montos.",
  "Máximo 2 oraciones, sin markdown.",
  "Según action: registered = el movimiento se guardó o actualizó — confirmalo con los datos presentes; asked_amount = el monto es ambiguo — pedí el número exacto sin afirmar cuál es el correcto; asked_category = el movimiento quedó guardado en la categoría — ofrecé reasignarla; answered = respondé la consulta usando SOLO los datos del campo query (query_type y sus valores), sin inventar montos, categorías ni fechas; redirected = todavía no se puede — decilo con honestidad; none = no se ejecutó nada — guiá al dueño; created = la categoría se creó — confirmalo con category; deleted = la categoría se borró — confirmalo con category; renamed = la categoría se renombró — confirmá category a new_name; capabilities = enumerá lo que el bot puede hacer (registrar gastos, corregir, consultar categorías/últimos movimientos/saldo/resumen del mes, crear/borrar/renombrar categorías, asociar palabras, ayuda).",
  "Si ok es false y viene message, transmití ese error de forma amable y honesta sin inventar causas.",
].join(" ");

export class GroqBotBrain implements BotBrain {
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

  /**
   * Single-attempt chat completion in JSON mode. Returns the parsed payload,
   * or null on every failure class (HTTP error, 429, timeout, non-JSON,
   * missing content). Never throws.
   */
  private async chat(systemPrompt: string, messages: readonly ChatMessage[]): Promise<unknown> {
    try {
      const response = await this.fetchImpl(this.baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "system", content: systemPrompt }, ...messages],
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

      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async interpret(message: string): Promise<ConversationEnvelope | null> {
    const payload = await this.chat(INTERPRET_SYSTEM_PROMPT, [...FEW_SHOTS, { role: "user", content: message }]);
    if (payload === null) {
      return null;
    }
    const result = conversationEnvelopeSchema.safeParse(payload);
    return result.success ? result.data : null;
  }

  async reply(result: ExecutionResult): Promise<string | null> {
    const payload = await this.chat(REPLY_SYSTEM_PROMPT, [{ role: "user", content: JSON.stringify(result) }]);
    if (payload === null) {
      return null;
    }
    const parsed = replyEnvelopeSchema.safeParse(payload);
    return parsed.success ? parsed.data.reply : null;
  }
}