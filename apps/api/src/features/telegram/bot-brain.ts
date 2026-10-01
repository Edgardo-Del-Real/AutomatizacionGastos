import { z } from "zod";
import { QUERY_TYPES, type QueryExecutionResult, type QueryType } from "./query.types";

/**
 * v2 intent taxonomy (spec bot-brain "Intent Taxonomy"): the three-intent
 * classification surface — query (with query-type phrasings), greeting and
 * off_topic — plus the static-help intent. The 11 removed intents
 * (register_expense, lifecycle, category CRUD, savings rule, capabilities)
 * fail the envelope enum and degrade to null.
 */
export const BOT_INTENTS = [
  "query",
  "query_recent",
  "query_balance",
  "query_month",
  "query_planned",
  "greeting",
  "off_topic",
  "help",
] as const;

export type BotIntent = (typeof BOT_INTENTS)[number];

/**
 * Transitional intent union: telegram.service.ts and the category executor
 * still consume the removed intents until the Phase 3/8 rewrites land. The
 * runtime contract is the 8-intent `BOT_INTENTS` enum above — a response
 * carrying a legacy intent fails the zod schema and degrades to null; this
 * type only keeps the transitional consumers compiling.
 */
export type LegacyBotIntent =
  | BotIntent
  | "register_expense"
  | "correct_amount"
  | "correct_category"
  | "associate_keyword"
  | "create_category"
  | "delete_category"
  | "rename_category"
  | "create_savings_rule"
  | "capabilities"
  | "mark_paid"
  | "delete_expense";

/**
 * Transitional conversation-envelope TYPE: the service still consumes the
 * legacy fields (category, dialog_action, then_reassign, shared, new_name)
 * until Phase 3. The runtime contract is `conversationEnvelopeSchema` below —
 * it accepts ONLY `{intent, amount, note, query_type?}` and rejects every
 * legacy key via `z.never()`, so a brain response carrying them degrades to
 * null. This type narrows to the schema shape when the service rewrites.
 */
export type ConversationEnvelope = {
  intent: LegacyBotIntent;
  amount: number | null;
  category: string | null;
  note: string | null;
  /** Discriminator for the `query` intent; absent for every other intent. */
  query_type?: QueryType | null;
  /** Target name for `rename_category`; null for every other intent. */
  new_name?: string | null;
  /** Dialog-state classification (legacy — schema-rejected in v2). */
  dialog_action?: "resolve" | "abandon" | null;
  /** Mixed-intent flag (legacy — schema-rejected in v2). */
  then_reassign?: boolean;
  /** SHARED-registration signal (legacy — schema-rejected in v2). */
  shared?: boolean;
};

export type BotAction =
  | "registered"
  | "asked_amount"
  | "asked_category"
  | "asked_registration"
  | "redirected"
  | "answered"
  | "none"
  | "created"
  | "deleted"
  | "renamed"
  | "capabilities"
  | "asked_movement"
  | "created_reassigned"
  | "marked_paid"
  | "deleted_movement";

export type CategoryCommandErrorCode =
  | "duplicate"
  | "not_found"
  | "otro_forbidden"
  | "savings_forbidden"
  | "reserved"
  | "unknown";

export type ExecutionResult = {
  /**
   * Transitional: the service still emits legacy intents until Phase 3; the
   * v2 contract narrows this to `BotIntent` when the service rewrites. The
   * brain's `reply` never invents facts absent from the result.
   */
  intent: LegacyBotIntent;
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
  /** Savings-split facts (D7): carried when a registration split applied. */
  gross_amount?: number | null;
  net_amount?: number | null;
  savings_amount?: number | null;
  /** Planned-query facts (D7): carried when the planned executor answered. */
  planned_month?: string | null;
  planned_total?: number | null;
  /** Planned-registration fact (D11): true when the expense was registered previsto. */
  planned?: boolean;
  /**
   * Registration-collection fact: which field the `asked_registration` action
   * is asking ("amount" or "category"). The reply MUST ask exactly that field
   * and never invent the other one.
   */
  asked_field?: "amount" | "category" | null;
  /**
   * CR-5 merged-reply fact: true when a register-during-dialog message
   * abandoned an open dialog AND registered the new message in one reply. The
   * reply MUST confirm both facts in the same message without contradicting
   * itself.
   */
  abandoned_dialog?: boolean;
};

/**
 * v2 vestige context (spec bot-brain "Bot Brain Port"): the brain never
 * consumes dialog context anymore — every flow is button-driven. The port
 * signature keeps the optional `context?` argument per spec, but the service
 * never passes meaningful state in the final design. The pre-v2 dialog-context
 * union is gone with the dialog machinery.
 */
export type InterpretContext = { state: "idle" };

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

/**
 * v2 interpret envelope contract (spec bot-brain "Interpret Envelope
 * Contract"): `{intent, amount, note, query_type?}`. `intent` is one of the
 * eight v2 intents; `amount` accepts number or string and normalizes via
 * `normalizeAmountString`; `note` is a trimmed string ≤ 200 chars or null;
 * `query` REQUIRES `query_type`. Every legacy key (`category`, `new_name`,
 * `dialog_action`, `then_reassign`, `shared`, `planned`) is rejected via
 * `z.never()` — presence degrades the response to null — and the 11 removed
 * intents fail the enum. The call uses temperature 0 + JSON mode.
 */
export const conversationEnvelopeSchema = z
  .object({
    intent: z.enum(BOT_INTENTS),
    amount: llmAmount.nullable(),
    note: z.string().trim().min(1).max(200).nullable().default(null),
    query_type: z.enum(QUERY_TYPES).nullable().default(null),
    // Legacy keys: presence MUST fail the schema (zod strips unknown keys
    // silently, so a merely removed field could never produce the mandated
    // degradation). `planned` was already rejected pre-v2; the dialog, CRUD,
    // shared and category surfaces are rejected the same way.
    category: z.never().optional(),
    new_name: z.never().optional(),
    dialog_action: z.never().optional(),
    then_reassign: z.never().optional(),
    shared: z.never().optional(),
    planned: z.never().optional(),
  })
  .refine((data) => data.intent !== "query" || data.query_type !== null, "query intent requires a query_type");

export const replyEnvelopeSchema = z.object({ reply: z.string().trim().min(1).max(400) });

export type ChatMessage = { role: "user" | "assistant"; content: string };

export const INTERPRET_SYSTEM_PROMPT = [
  'Respondé SOLO con un objeto JSON con exactamente estas claves: {"intent": string, "amount": number|null, "note": string|null, "query_type": string|null}.',
  'No agregues texto ni campos extra. Los campos "category", "new_name", "dialog_action", "then_reassign", "shared" y "planned" NO existen: nunca los incluyas.',
  '"intent" es exactamente UNA de: "query", "query_recent", "query_balance", "query_month", "query_planned", "greeting", "off_topic", "help".',
  'Para consultas sobre los datos del dueño usá "query" con su "query_type": "categories" (qué categorías tiene/disponibles), "recent" (últimos movimientos), "balance" (saldo, "cuánto me queda", "cuál es mi saldo"), "month" (resumen del mes), "savings" (cuánto ahorró este mes: "cuánto ahorré", "cuánto ahorré este mes"), "planned" (gastos fijos previstos del mes que viene: "cuánto tengo previsto", "gastos fijos previstos", "cuánto voy a gastar el mes que viene").',
  '"query_recent", "query_balance", "query_month" y "query_planned" se mantienen por compatibilidad: preferí "query".',
  '"query_type" es null para cualquier intent que no sea "query".',
  "NUNCA inventes un monto: usá null cuando el mensaje no tiene monto.",
  'Todo es en pesos argentinos (ARS): ignorá símbolos o nombres de moneda ($, usd, €) y no conviertas.',
  '"1.234,50" y "1234,50" significan 1234.50; "1234.5" significa 1234.5; "5 mil" o "cinco mil" significan 5000 — devolvé el número.',
  '"note" es la descripción concreta del gasto o ingreso, máximo 200 caracteres, null si no hay.',
  'El bot NUNCA registra movimientos desde texto libre: la captura es por botones del menú (➕ Nuevo gasto, 📅 Gasto previsto, ➕ Ingreso, 👥 Compartido). Un mensaje con monto o con intención de registrar no es un intent: es "off_topic".',
  "El bot NUNCA crea, renombra ni borra categorías, NUNCA infiere tipos de captura (real, previsto, ingreso, compartido) y NUNCA decide acciones destructivas (borrar gastos, marcar pagado): todo eso es por botones. Si el mensaje lo pide, clasificalo \"off_topic\" — nunca lo ejecutes.",
  'Preguntas sobre lo que el bot SABE hacer (¿podes borrar categorías?, ¿qué sabés hacer?, ¿qué podes hacer?) son "help": ayuda estática, NUNCA off_topic.',
  'off_topic es para mensajes sin relación con gastos: clasificalo, NUNCA lo respondas como charla general.',
  'Los saludos ("hola", "buenas", "qué tal", "cómo andás") son "greeting": un saludo cálido, NO off_topic.',
].join(" ");

export const FEW_SHOTS: readonly ChatMessage[] = [
  { role: "user", content: "cuánto gasté este mes?" },
  {
    role: "assistant",
    content: '{"intent":"query","amount":null,"note":null,"query_type":"month"}',
  },
  { role: "user", content: "cuales son las categorias disponibles" },
  {
    role: "assistant",
    content: '{"intent":"query","amount":null,"note":null,"query_type":"categories"}',
  },
  { role: "user", content: "ultimos movimientos" },
  {
    role: "assistant",
    content: '{"intent":"query","amount":null,"note":null,"query_type":"recent"}',
  },
  { role: "user", content: "cuanto me queda" },
  {
    role: "assistant",
    content: '{"intent":"query","amount":null,"note":null,"query_type":"balance"}',
  },
  { role: "user", content: "cuánto ahorré este mes?" },
  {
    role: "assistant",
    content: '{"intent":"query","amount":null,"note":null,"query_type":"savings"}',
  },
  { role: "user", content: "cuánto tengo previsto?" },
  {
    role: "assistant",
    content: '{"intent":"query_planned","amount":null,"note":null}',
  },
  { role: "user", content: "hola, cómo andás?" },
  { role: "assistant", content: '{"intent":"greeting","amount":null,"note":null}' },
  { role: "user", content: "que lindo día" },
  { role: "assistant", content: '{"intent":"off_topic","amount":null,"note":null}' },
  { role: "user", content: "quiero registrar un gasto" },
  { role: "assistant", content: '{"intent":"off_topic","amount":null,"note":null}' },
];

export const REPLY_SYSTEM_PROMPT = [
  "Escribís la respuesta del bot a su dueño, en español rioplatense, con voseo cálido.",
  "Recibís SOLO el JSON del resultado ejecutado y respondés con un objeto JSON: {\"reply\": string}.",
  "NUNCA afirmes un dato que no esté en el resultado: si amount es null no menciones montos.",
  "Máximo 2 oraciones, sin markdown.",
  "Según action: answered = respondé la consulta usando SOLO los datos del campo query (query_type y sus valores), sin inventar montos, categorías ni fechas; none = no se ejecutó nada — guiá al dueño; redirected = todavía no se puede — decilo con honestidad.",
  "Si intent es greeting: respondé con un saludo cálido de una línea orientado a gastos.",
  "Si ok es false y viene message, transmití ese error de forma amable y honesta sin inventar causas.",
].join(" ");

/**
 * v2 — the Groq client implementing the BotBrain port (spec bot-brain "Bot
 * Brain Port"): the ONLY LLM surface the bot consumes, used ONLY for idle
 * query/greeting classification and query replies — never for capture or
 * editing. The dialog context argument is a vestige: it is never embedded in
 * the prompt (the dialog machinery is gone).
 */
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

  async interpret(message: string, context?: InterpretContext): Promise<ConversationEnvelope | null> {
    // The context argument is the spec-mandated vestige: the v2 brain never
    // embeds it in the prompt. Kept (and ignored) so the port signature stays
    // stable while the service transitions.
    void context;
    const payload = await this.chat(INTERPRET_SYSTEM_PROMPT, [...FEW_SHOTS, { role: "user", content: message }]);
    if (payload === null) {
      return null;
    }
    const result = conversationEnvelopeSchema.safeParse(payload);
    // The narrow schema output is the v2 envelope; the wide transitional type
    // keeps the service compiling until Phase 3 (the runtime contract is the
    // schema — legacy keys/intents already degrade to null).
    return result.success ? (result.data as unknown as ConversationEnvelope) : null;
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