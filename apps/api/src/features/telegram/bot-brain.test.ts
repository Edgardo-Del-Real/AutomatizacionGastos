import { describe, expect, it } from "vitest";
import {
  BOT_INTENTS,
  conversationEnvelopeSchema,
  FEW_SHOTS,
  GroqBotBrain,
  INTERPRET_SYSTEM_PROMPT,
  normalizeAmountString,
  replyEnvelopeSchema,
  REPLY_SYSTEM_PROMPT,
  type ExecutionResult,
} from "./bot-brain";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FetchCall = { input: string | URL | Request; init?: RequestInit };

function makeFetch(handler: (call: FetchCall) => Response | Promise<Response>): {
  fetchImpl: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input, init });
    return handler({ input, init });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function brainWith(fetchImpl: typeof fetch): GroqBotBrain {
  return new GroqBotBrain({
    apiKey: "test-key",
    model: "openai/gpt-oss-20b",
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    timeoutMs: 5000,
    fetchImpl,
  });
}

const OPENAI_SHAPE = { choices: [{ message: { content: "{}" } }] };

const SAMPLE_RESULT: ExecutionResult = {
  intent: "register_expense",
  ok: true,
  action: "registered",
  amount: 5000,
  category: "Supermercado",
  note: "gaste en el super",
};

describe("normalizeAmountString", () => {
  it.each([
    ["$ 1.234,50", 1234.5],
    ["1234,50", 1234.5],
    ["1234.5", 1234.5],
    ["1,234.50", 1234.5],
    ["1.234", 1234],
    ["5 mil", 5000],
    ["mil", 1000],
    ["2k", 2000],
    ["5000", 5000],
    ["10.000", 10000],
    ["$5000", 5000],
    ["usd 100", 100],
    ["€ 1.234,50", 1234.5],
    ["1.234,567", 1234.567],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeAmountString(input)).toBe(expected);
  });

  it.each(["abc", "", "0", "-5", "NaN"])("rejects %s as null", (input) => {
    expect(normalizeAmountString(input)).toBeNull();
  });
});

describe("conversationEnvelopeSchema", () => {
  it.each(BOT_INTENTS)("accepts the %s intent with a null amount, category and note", (intent) => {
    const result = conversationEnvelopeSchema.safeParse({
      intent,
      amount: null,
      category: null,
      note: null,
    });
    expect(result.success).toBe(true);
  });

  it("normalizes a Spanish string amount and keeps category and note", () => {
    const result = conversationEnvelopeSchema.safeParse({
      intent: "register_expense",
      amount: "1.234,50",
      category: "Supermercado",
      note: "pan",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBe(1234.5);
      expect(result.data.category).toBe("Supermercado");
      expect(result.data.note).toBe("pan");
    }
  });

  it('normalizes "5 mil" to 5000', () => {
    const result = conversationEnvelopeSchema.safeParse({
      intent: "register_expense",
      amount: "5 mil",
      category: "Supermercado",
      note: "gaste en el super",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBe(5000);
    }
  });

  it("accepts an explicit JSON null amount for register_expense", () => {
    const result = conversationEnvelopeSchema.safeParse({
      intent: "register_expense",
      amount: null,
      category: "Supermercado",
      note: "mercaderia",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBeNull();
    }
  });

  it.each([
    ["zero", { intent: "register_expense", amount: 0, category: null, note: null }],
    ["negative", { intent: "register_expense", amount: -5, category: null, note: null }],
    ["NaN", { intent: "register_expense", amount: Number.NaN, category: null, note: null }],
    ["abc string", { intent: "register_expense", amount: "abc", category: null, note: null }],
    ["missing amount key", { intent: "register_expense", category: null, note: null }],
  ])("rejects a present-but-invalid amount (%s)", (_label, payload) => {
    expect(conversationEnvelopeSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects an unknown intent", () => {
    const result = conversationEnvelopeSchema.safeParse({
      intent: "fly_to_moon",
      amount: null,
      category: null,
      note: null,
    });
    expect(result.success).toBe(false);
  });

  it.each([
    ["empty category", { intent: "register_expense", amount: 100, category: "", note: null }],
    ["whitespace category", { intent: "register_expense", amount: 100, category: "   ", note: null }],
    ["category over 60 chars", { intent: "register_expense", amount: 100, category: "c".repeat(61), note: null }],
    ["category exactly 60 chars", { intent: "register_expense", amount: 100, category: "c".repeat(60), note: null }],
    ["note over 200 chars", { intent: "register_expense", amount: 100, category: null, note: "n".repeat(201) }],
    ["note exactly 200 chars", { intent: "register_expense", amount: 100, category: null, note: "n".repeat(200) }],
    ["empty note", { intent: "register_expense", amount: 100, category: null, note: "" }],
  ])("bounds category and note: %s", (_label, payload) => {
    const result = conversationEnvelopeSchema.safeParse(payload);
    if (payload.category === "c".repeat(60) || payload.note === "n".repeat(200)) {
      expect(result.success).toBe(true);
    } else {
      expect(result.success).toBe(false);
    }
  });
});

describe("replyEnvelopeSchema", () => {
  it("accepts a trimmed non-empty reply", () => {
    const result = replyEnvelopeSchema.safeParse({ reply: "Listo, quedó registrado." });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reply).toBe("Listo, quedó registrado.");
    }
  });

  it("trims the reply", () => {
    const result = replyEnvelopeSchema.safeParse({ reply: "  Listo  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reply).toBe("Listo");
    }
  });

  it.each([
    ["empty", { reply: "" }],
    ["whitespace", { reply: "   " }],
    ["over 400 chars", { reply: "r".repeat(401) }],
    ["missing reply key", {}],
  ])("rejects %s", (_label, payload) => {
    expect(replyEnvelopeSchema.safeParse(payload).success).toBe(false);
  });

  it("accepts a reply of exactly 400 chars", () => {
    expect(replyEnvelopeSchema.safeParse({ reply: "r".repeat(400) }).success).toBe(true);
  });
});

describe("GroqBotBrain.interpret", () => {
  it("returns the envelope for a string amount payload (happy path)", async () => {
    const { fetchImpl, calls } = makeFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              content:
                '{"intent":"register_expense","amount":"5 mil","category":"Supermercado","note":"gaste en el super"}',
            },
          },
        ],
      }),
    );
    const brain = brainWith(fetchImpl);

    const result = await brain.interpret("gaste 5 mil en el super");

    expect(result).toEqual({
      intent: "register_expense",
      amount: 5000,
      category: "Supermercado",
      note: "gaste en el super",
    });
    expect(calls).toHaveLength(1);
  });

  it("returns the envelope for a numeric amount payload", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        choices: [{ message: { content: '{"intent":"off_topic","amount":null,"category":null,"note":null}' } }],
      }),
    );
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("hola, cómo andás?")).resolves.toEqual({
      intent: "off_topic",
      amount: null,
      category: null,
      note: null,
    });
  });

  it("posts to the base URL with the bearer key, model, temperature 0, JSON mode, few-shots and the message", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse(OPENAI_SHAPE));
    const brain = brainWith(fetchImpl);

    await brain.interpret("compre mercaderia");

    const call = calls[0];
    expect(call?.input).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(call?.init?.method).toBe("POST");
    const headers = call?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(String(call?.init?.body)) as {
      model: string;
      messages: { role: string; content: string }[];
      temperature: number;
      response_format: { type: string };
    };
    expect(body.model).toBe("openai/gpt-oss-20b");
    expect(body.messages[0]?.role).toBe("system");
    expect(body.messages[0]?.content).toBe(INTERPRET_SYSTEM_PROMPT);
    // The few-shots are interleaved between the system prompt and the message.
    expect(body.messages).toHaveLength(1 + FEW_SHOTS.length + 1);
    expect(body.messages[1]).toEqual(FEW_SHOTS[0]);
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "compre mercaderia" });
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(call?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([429, 500])("degrades to null on HTTP %s", async (status) => {
    const { fetchImpl } = makeFetch(() => jsonResponse({ error: "boom" }, status));
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("compre mercaderia")).resolves.toBeNull();
  });

  it("degrades to null when the body is not JSON", async () => {
    const { fetchImpl } = makeFetch(() => new Response("<html>oops</html>", { status: 200 }));
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("compre mercaderia")).resolves.toBeNull();
  });

  it("degrades to null when choices[0].message.content is not a string", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({ choices: [{ message: { content: 42 } }] }),
    );
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("compre mercaderia")).resolves.toBeNull();
  });

  it("degrades to null when choices is missing", async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({}));
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("compre mercaderia")).resolves.toBeNull();
  });

  it("degrades to null when the content is not valid JSON", async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({ choices: [{ message: { content: "not json" } }] }));
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("compre mercaderia")).resolves.toBeNull();
  });

  it("degrades to null when the payload fails the schema (unknown intent)", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        choices: [{ message: { content: '{"intent":"fly_to_moon","amount":null,"category":null,"note":null}' } }],
      }),
    );
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("compre mercaderia")).resolves.toBeNull();
  });

  it("degrades to null when the payload fails the schema (zero amount)", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        choices: [{ message: { content: '{"intent":"register_expense","amount":0,"category":null,"note":null}' } }],
      }),
    );
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("compre mercaderia")).resolves.toBeNull();
  });

  it("degrades to null when the fetch rejects with a timeout AbortError, passing an AbortSignal", async () => {
    const { fetchImpl, calls } = makeFetch(async () => {
      throw new DOMException("The operation was aborted due to timeout", "AbortError");
    });
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("compre mercaderia")).resolves.toBeNull();
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("degrades to null when the fetch rejects with a generic network error", async () => {
    const { fetchImpl } = makeFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("compre mercaderia")).resolves.toBeNull();
  });

  it("never makes more than one attempt", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse(OPENAI_SHAPE));
    const brain = brainWith(fetchImpl);

    await brain.interpret("compre mercaderia");

    expect(calls).toHaveLength(1);
  });
});

describe("GroqBotBrain.reply", () => {
  it("returns the reply text for a valid payload (happy path)", async () => {
    const { fetchImpl, calls } = makeFetch(() =>
      jsonResponse({ choices: [{ message: { content: '{"reply":"Listo, quedó registrado."}' } }] }),
    );
    const brain = brainWith(fetchImpl);

    const result = await brain.reply(SAMPLE_RESULT);

    expect(result).toBe("Listo, quedó registrado.");
    expect(calls).toHaveLength(1);
  });

  it("posts the executed result JSON as the only user message", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse(OPENAI_SHAPE));
    const brain = brainWith(fetchImpl);

    await brain.reply(SAMPLE_RESULT);

    const call = calls[0];
    const headers = call?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
    const body = JSON.parse(String(call?.init?.body)) as {
      messages: { role: string; content: string }[];
      temperature: number;
      response_format: { type: string };
    };
    expect(body.messages[0]).toEqual({ role: "system", content: REPLY_SYSTEM_PROMPT });
    expect(body.messages.at(-1)).toEqual({ role: "user", content: JSON.stringify(SAMPLE_RESULT) });
    expect(body.messages).toHaveLength(2);
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it.each([429, 500])("degrades to null on HTTP %s", async (status) => {
    const { fetchImpl } = makeFetch(() => jsonResponse({ error: "boom" }, status));
    const brain = brainWith(fetchImpl);

    await expect(brain.reply(SAMPLE_RESULT)).resolves.toBeNull();
  });

  it("degrades to null when the content is not valid JSON", async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({ choices: [{ message: { content: "not json" } }] }));
    const brain = brainWith(fetchImpl);

    await expect(brain.reply(SAMPLE_RESULT)).resolves.toBeNull();
  });

  it("degrades to null when the reply payload fails the schema (over 400 chars)", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({ choices: [{ message: { content: `{"reply":"${"r".repeat(401)}"}` } }] }),
    );
    const brain = brainWith(fetchImpl);

    await expect(brain.reply(SAMPLE_RESULT)).resolves.toBeNull();
  });

  it("degrades to null when the fetch rejects with a timeout AbortError", async () => {
    const { fetchImpl } = makeFetch(async () => {
      throw new DOMException("The operation was aborted due to timeout", "AbortError");
    });
    const brain = brainWith(fetchImpl);

    await expect(brain.reply(SAMPLE_RESULT)).resolves.toBeNull();
  });

  it("never makes more than one attempt", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse(OPENAI_SHAPE));
    const brain = brainWith(fetchImpl);

    await brain.reply(SAMPLE_RESULT);

    expect(calls).toHaveLength(1);
  });
});

describe("prompt goldens", () => {
  it("pins the interpret system prompt", async () => {
    await expect(INTERPRET_SYSTEM_PROMPT).toMatchFileSnapshot("./__goldens__/interpret-system-prompt.txt");
  });

  it("pins the interpret few-shots", async () => {
    await expect(JSON.stringify(FEW_SHOTS, null, 2)).toMatchFileSnapshot("./__goldens__/interpret-few-shots.json");
  });

  it("pins the reply system prompt", async () => {
    await expect(REPLY_SYSTEM_PROMPT).toMatchFileSnapshot("./__goldens__/reply-system-prompt.txt");
  });
});

describe("prompt contracts", () => {
  it("demands JSON-only output with ARS-only semantics and never-invent amounts", () => {
    expect(INTERPRET_SYSTEM_PROMPT).toContain("JSON");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("ARS");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("NUNCA inventes");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("1.234,50");
  });

  it("biases expense-signal messages to register_expense even without an amount", () => {
    expect(INTERPRET_SYSTEM_PROMPT).toContain("register_expense");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("señal de gasto");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("aunque no");
  });

  it("classifies off-topic and never answers as general chat", () => {
    expect(INTERPRET_SYSTEM_PROMPT).toContain("off_topic");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("charla general");
  });

  it("writes replies after the action from the executed result only", () => {
    expect(REPLY_SYSTEM_PROMPT).toContain("JSON");
    expect(REPLY_SYSTEM_PROMPT).toContain("resultado ejecutado");
    expect(REPLY_SYSTEM_PROMPT).toContain("voseo");
    expect(REPLY_SYSTEM_PROMPT).toContain("null");
    expect(REPLY_SYSTEM_PROMPT).toContain("registered");
    expect(REPLY_SYSTEM_PROMPT).toContain("asked_amount");
    expect(REPLY_SYSTEM_PROMPT).toContain("redirected");
  });
});