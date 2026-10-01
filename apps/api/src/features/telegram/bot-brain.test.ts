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
  intent: "query_balance",
  ok: true,
  action: "answered",
  amount: null,
  category: null,
  note: null,
  query_type: "balance",
  query: { query_type: "balance", balance: 1500, income: 2000, expenses: 500 },
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
  it.each(BOT_INTENTS.filter((intent) => intent !== "query"))(
    "accepts the %s intent with a null amount and note",
    (intent) => {
      const result = conversationEnvelopeSchema.safeParse({
        intent,
        amount: null,
        note: null,
      });
      expect(result.success).toBe(true);
    },
  );

  it("normalizes a Spanish string amount and keeps the note", () => {
    const result = conversationEnvelopeSchema.safeParse({
      intent: "query_balance",
      amount: "1.234,50",
      note: "pan",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBe(1234.5);
      expect(result.data.note).toBe("pan");
    }
  });

  it('normalizes "5 mil" to 5000', () => {
    const result = conversationEnvelopeSchema.safeParse({
      intent: "greeting",
      amount: "5 mil",
      note: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBe(5000);
    }
  });

  it("accepts an explicit JSON null amount", () => {
    const result = conversationEnvelopeSchema.safeParse({
      intent: "off_topic",
      amount: null,
      note: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBeNull();
    }
  });

  it.each([
    ["zero", { intent: "greeting", amount: 0, note: null }],
    ["negative", { intent: "greeting", amount: -5, note: null }],
    ["NaN", { intent: "greeting", amount: Number.NaN, note: null }],
    ["abc string", { intent: "greeting", amount: "abc", note: null }],
    ["missing amount key", { intent: "greeting", note: null }],
  ])("rejects a present-but-invalid amount (%s)", (_label, payload) => {
    expect(conversationEnvelopeSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects an unknown intent", () => {
    const result = conversationEnvelopeSchema.safeParse({
      intent: "fly_to_moon",
      amount: null,
      note: null,
    });
    expect(result.success).toBe(false);
  });

  it.each(["categories", "recent", "balance", "month", "savings", "planned"] as const)(
    "accepts the query intent with query_type %s",
    (queryType) => {
      const result = conversationEnvelopeSchema.safeParse({
        intent: "query",
        amount: null,
        note: null,
        query_type: queryType,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.query_type).toBe(queryType);
      }
    },
  );

  it("accepts query_type null for a non-query intent", () => {
    const result = conversationEnvelopeSchema.safeParse({
      intent: "off_topic",
      amount: null,
      note: null,
      query_type: null,
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ["missing query_type", { intent: "query", amount: null, note: null }],
    ["null query_type", { intent: "query", amount: null, note: null, query_type: null }],
    ["unknown query_type", { intent: "query", amount: null, note: null, query_type: "inventory" }],
  ])("rejects the query intent without a valid query_type (%s)", (_label, payload) => {
    expect(conversationEnvelopeSchema.safeParse(payload).success).toBe(false);
  });

  it("keeps the legacy query_* intents valid without a query_type", () => {
    for (const intent of ["query_recent", "query_balance", "query_month", "query_planned"]) {
      const result = conversationEnvelopeSchema.safeParse({
        intent,
        amount: null,
        note: null,
      });
      expect(result.success).toBe(true);
    }
  });

  it("decodes a query_planned envelope (spec: Planned query intent decodes)", () => {
    const result = conversationEnvelopeSchema.safeParse({
      intent: "query_planned",
      amount: null,
      note: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intent).toBe("query_planned");
    }
  });

  it("decodes a greeting envelope (spec: Greeting intent decodes)", () => {
    const result = conversationEnvelopeSchema.safeParse({
      intent: "greeting",
      amount: null,
      note: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intent).toBe("greeting");
    }
  });

  it.each([
    ["empty note", { intent: "greeting", amount: null, note: "" }],
    ["note over 200 chars", { intent: "greeting", amount: null, note: "n".repeat(201) }],
  ])("bounds the note: rejects %s", (_label, payload) => {
    expect(conversationEnvelopeSchema.safeParse(payload).success).toBe(false);
  });

  it("accepts a note of exactly 200 chars", () => {
    expect(
      conversationEnvelopeSchema.safeParse({ intent: "greeting", amount: null, note: "n".repeat(200) }).success,
    ).toBe(true);
  });
});

describe("v2 envelope contract (spec bot-brain Interpret Envelope Contract)", () => {
  it.each([
    "register_expense",
    "correct_amount",
    "correct_category",
    "associate_keyword",
    "create_category",
    "delete_category",
    "rename_category",
    "create_savings_rule",
    "capabilities",
    "mark_paid",
    "delete_expense",
  ])("rejects the removed %s intent", (intent) => {
    expect(
      conversationEnvelopeSchema.safeParse({ intent, amount: null, note: null }).success,
    ).toBe(false);
  });

  it("degrades a capture-intent payload to null (spec: Capture intent degrades)", () => {
    expect(
      conversationEnvelopeSchema.safeParse({
        intent: "register_expense",
        amount: 2500,
        category: "Cafe",
        note: null,
      }).success,
    ).toBe(false);
  });

  it("rejects a payload carrying planned: true (spec: Planned field rejected)", () => {
    expect(
      conversationEnvelopeSchema.safeParse({ intent: "register_expense", amount: 2500, planned: true }).success,
    ).toBe(false);
  });

  it.each(["category", "new_name", "dialog_action", "then_reassign", "shared", "planned"] as const)(
    "rejects the removed %s key even on a valid intent",
    (key) => {
      expect(
        conversationEnvelopeSchema.safeParse({ intent: "greeting", amount: null, note: null, [key]: "x" }).success,
      ).toBe(false);
    },
  );

  it("accepts only the v2 intent taxonomy", () => {
    expect(BOT_INTENTS).toEqual([
      "query",
      "query_recent",
      "query_balance",
      "query_month",
      "query_planned",
      "greeting",
      "off_topic",
      "help",
    ]);
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
              content: '{"intent":"query_balance","amount":"1.234,50","note":"pan","query_type":"balance"}',
            },
          },
        ],
      }),
    );
    const brain = brainWith(fetchImpl);

    const result = await brain.interpret("cuanto me queda");

    expect(result).toEqual({
      intent: "query_balance",
      amount: 1234.5,
      note: "pan",
      query_type: "balance",
    });
    expect(calls).toHaveLength(1);
  });

  it("returns the envelope for a numeric amount payload", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        choices: [{ message: { content: '{"intent":"off_topic","amount":null,"note":null}' } }],
      }),
    );
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("que lindo día")).resolves.toEqual({
      intent: "off_topic",
      amount: null,
      note: null,
      query_type: null,
    });
  });

  it("returns a query envelope with a query_type for a categories question", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              content: '{"intent":"query","amount":null,"note":null,"query_type":"categories"}',
            },
          },
        ],
      }),
    );
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("cuales son las categorias disponibles?")).resolves.toEqual({
      intent: "query",
      amount: null,
      note: null,
      query_type: "categories",
    });
  });

  it("returns a query_planned envelope when the LLM classifies a planned phrasing", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              content: '{"intent":"query_planned","amount":null,"note":null}',
            },
          },
        ],
      }),
    );
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("cuánto tengo previsto?")).resolves.toEqual({
      intent: "query_planned",
      amount: null,
      note: null,
      query_type: null,
    });
  });

  it("decodes a greeting envelope (spec: Greeting intent decodes)", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              content: '{"intent":"greeting","amount":null,"note":null}',
            },
          },
        ],
      }),
    );
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("hola, cómo andás?")).resolves.toEqual({
      intent: "greeting",
      amount: null,
      note: null,
      query_type: null,
    });
  });

  it("degrades to null when the query intent lacks a query_type", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              content: '{"intent":"query","amount":null,"note":null,"query_type":null}',
            },
          },
        ],
      }),
    );
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("cuales son las categorias?")).resolves.toBeNull();
  });

  it("degrades to null for a capture intent (spec: Capture intent degrades)", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              content: '{"intent":"register_expense","amount":2500,"category":"Cafe","note":null}',
            },
          },
        ],
      }),
    );
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("14000 pasaje")).resolves.toBeNull();
  });

  it("degrades to null when the payload carries planned (spec: Planned field rejected)", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              content: '{"intent":"register_expense","amount":2500,"planned":true}',
            },
          },
        ],
      }),
    );
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("dejá previsto el alquiler de 2500")).resolves.toBeNull();
  });

  it("posts to the base URL with the bearer key, model, temperature 0, JSON mode, few-shots and the message", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse(OPENAI_SHAPE));
    const brain = brainWith(fetchImpl);

    await brain.interpret("cuanto me queda");

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
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "cuanto me queda" });
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(call?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("never embeds dialog context in the prompt (the context is a vestige)", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse(OPENAI_SHAPE));
    const brain = brainWith(fetchImpl);

    await brain.interpret("Transporte", { state: "idle" });

    const body = JSON.parse(String(calls[0]?.init?.body)) as { messages: { role: string; content: string }[] };
    expect(body.messages[0]?.content).toBe(INTERPRET_SYSTEM_PROMPT);
    expect(body.messages).toHaveLength(1 + FEW_SHOTS.length + 1);
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "Transporte" });
  });

  it.each([429, 500])("degrades to null on HTTP %s", async (status) => {
    const { fetchImpl } = makeFetch(() => jsonResponse({ error: "boom" }, status));
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("cuanto me queda")).resolves.toBeNull();
  });

  it("degrades to null when the body is not JSON", async () => {
    const { fetchImpl } = makeFetch(() => new Response("<html>oops</html>", { status: 200 }));
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("cuanto me queda")).resolves.toBeNull();
  });

  it("degrades to null when choices[0].message.content is not a string", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({ choices: [{ message: { content: 42 } }] }),
    );
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("cuanto me queda")).resolves.toBeNull();
  });

  it("degrades to null when choices is missing", async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({}));
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("cuanto me queda")).resolves.toBeNull();
  });

  it("degrades to null when the content is not valid JSON", async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({ choices: [{ message: { content: "not json" } }] }));
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("cuanto me queda")).resolves.toBeNull();
  });

  it("degrades to null when the payload fails the schema (unknown intent)", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        choices: [{ message: { content: '{"intent":"fly_to_moon","amount":null,"note":null}' } }],
      }),
    );
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("cuanto me queda")).resolves.toBeNull();
  });

  it("degrades to null when the payload fails the schema (zero amount)", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        choices: [{ message: { content: '{"intent":"greeting","amount":0,"note":null}' } }],
      }),
    );
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("hola")).resolves.toBeNull();
  });

  it("degrades to null when the fetch rejects with a timeout AbortError, passing an AbortSignal", async () => {
    const { fetchImpl, calls } = makeFetch(async () => {
      throw new DOMException("The operation was aborted due to timeout", "AbortError");
    });
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("cuanto me queda")).resolves.toBeNull();
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("degrades to null when the fetch rejects with a generic network error", async () => {
    const { fetchImpl } = makeFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("cuanto me queda")).resolves.toBeNull();
  });

  it("never makes more than one attempt", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse(OPENAI_SHAPE));
    const brain = brainWith(fetchImpl);

    await brain.interpret("cuanto me queda");

    expect(calls).toHaveLength(1);
  });
});

describe("GroqBotBrain.reply", () => {
  it("returns the reply text for a valid payload (happy path)", async () => {
    const { fetchImpl, calls } = makeFetch(() =>
      jsonResponse({ choices: [{ message: { content: '{"reply":"Tu balance es $ 1.500,00."}' } }] }),
    );
    const brain = brainWith(fetchImpl);

    const result = await brain.reply(SAMPLE_RESULT);

    expect(result).toBe("Tu balance es $ 1.500,00.");
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

  it("posts the executed query facts to the LLM (spec: Query reply reflects executed facts)", async () => {
    const { fetchImpl, calls } = makeFetch(() =>
      jsonResponse({ choices: [{ message: { content: '{"reply":"En septiembre tenés previsto 4000."}' } }] }),
    );
    const brain = brainWith(fetchImpl);

    await brain.reply({
      intent: "query_planned",
      ok: true,
      action: "answered",
      amount: null,
      category: null,
      note: null,
      query_type: "planned",
      query: { query_type: "planned", month: "2026-09", total: 4000 },
    });

    const call = calls[0];
    const body = JSON.parse(String(call?.init?.body)) as { messages: { content: string }[] };
    const posted = body.messages.at(-1)?.content ?? "";
    expect(posted).toContain("query_type");
    expect(posted).toContain("planned");
    expect(posted).toContain("4000");
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

describe("prompt contracts (v2 three-intent taxonomy)", () => {
  it("demands JSON-only output with ARS-only semantics and never-invent amounts", () => {
    expect(INTERPRET_SYSTEM_PROMPT).toContain("JSON");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("ARS");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("NUNCA inventes");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("1.234,50");
  });

  it("teaches the three-intent taxonomy only and never mentions register_expense", () => {
    expect(INTERPRET_SYSTEM_PROMPT).toContain('"query"');
    expect(INTERPRET_SYSTEM_PROMPT).toContain('"greeting"');
    expect(INTERPRET_SYSTEM_PROMPT).toContain('"off_topic"');
    expect(INTERPRET_SYSTEM_PROMPT).toContain('"help"');
    expect(INTERPRET_SYSTEM_PROMPT).not.toContain("register_expense");
  });

  it("teaches that the bot never registers from free text (capture is by buttons)", () => {
    expect(INTERPRET_SYSTEM_PROMPT).toContain("NUNCA registra movimientos desde texto libre");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("botones del menú");
  });

  it("teaches that the brain never creates categories, infers capture types or decides destructive actions", () => {
    expect(INTERPRET_SYSTEM_PROMPT).toContain("NUNCA crea, renombra ni borra categorías");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("NUNCA infiere tipos de captura");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("NUNCA decide acciones destructivas");
  });

  it("routes capability questions to help", () => {
    expect(INTERPRET_SYSTEM_PROMPT).toContain("¿podes borrar categorías?");
    expect(INTERPRET_SYSTEM_PROMPT).toContain('"help"');
  });

  it("classifies off-topic and never answers as general chat", () => {
    expect(INTERPRET_SYSTEM_PROMPT).toContain("off_topic");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("charla general");
  });

  it("teaches the greeting classification separately from off_topic", () => {
    expect(INTERPRET_SYSTEM_PROMPT).toContain("greeting");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("saludos");
  });

  it("classifies natural query phrasing into the query intent with a query_type", () => {
    expect(INTERPRET_SYSTEM_PROMPT).toContain("query_type");
    expect(INTERPRET_SYSTEM_PROMPT).toContain('"categories"');
    expect(INTERPRET_SYSTEM_PROMPT).toContain('"recent"');
    expect(INTERPRET_SYSTEM_PROMPT).toContain('"balance"');
    expect(INTERPRET_SYSTEM_PROMPT).toContain('"month"');
    expect(INTERPRET_SYSTEM_PROMPT).toContain('"savings"');
    expect(INTERPRET_SYSTEM_PROMPT).toContain('"planned"');
  });

  it("keeps the legacy query_* intents documented for compatibility", () => {
    expect(INTERPRET_SYSTEM_PROMPT).toContain("query_recent");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("query_planned");
  });

  it("models the greeting flip in the interpret few-shots ('hola' → greeting)", () => {
    const hola = FEW_SHOTS.find((message) => message.role === "user" && message.content.includes("hola"));
    expect(hola).toBeDefined();
    const answer = FEW_SHOTS[FEW_SHOTS.indexOf(hola as { role: "user"; content: string }) + 1];
    expect(answer?.role).toBe("assistant");
    const parsed = JSON.parse(answer?.content ?? "{}") as { intent: string };
    expect(parsed.intent).toBe("greeting");
  });

  it("models an off-topic shot (never general chat)", () => {
    const shot = FEW_SHOTS.find(
      (message) => message.role === "assistant" && message.content.includes('"intent":"off_topic"'),
    );
    expect(shot).toBeDefined();
  });

  it("models a register-intent message as off_topic in the few-shots", () => {
    const shot = FEW_SHOTS.find(
      (message) => message.role === "user" && message.content.includes("quiero registrar un gasto"),
    );
    expect(shot).toBeDefined();
    const answer = FEW_SHOTS[FEW_SHOTS.indexOf(shot as { role: "user"; content: string }) + 1];
    const parsed = JSON.parse(answer?.content ?? "{}") as { intent: string };
    expect(parsed.intent).toBe("off_topic");
  });

  it("models the savings query in the interpret few-shots (query_type savings)", () => {
    const shot = FEW_SHOTS.find(
      (message) => message.role === "assistant" && message.content.includes('"query_type":"savings"'),
    );
    expect(shot).toBeDefined();
  });

  it("teaches the reply to answer query intents from the executed data only", () => {
    expect(REPLY_SYSTEM_PROMPT).toContain("answered");
    expect(REPLY_SYSTEM_PROMPT).toContain("query");
    expect(REPLY_SYSTEM_PROMPT).toContain("inventar");
  });

  it("teaches a warm expense-scoped greeting reply", () => {
    expect(REPLY_SYSTEM_PROMPT).toContain("greeting");
    expect(REPLY_SYSTEM_PROMPT).toContain("saludo");
  });

  it("teaches the reply to carry ok:false messages honestly", () => {
    expect(REPLY_SYSTEM_PROMPT).toContain("ok es false");
    expect(REPLY_SYSTEM_PROMPT).toContain("message");
  });

  it("writes replies after the action from the executed result only", () => {
    expect(REPLY_SYSTEM_PROMPT).toContain("JSON");
    expect(REPLY_SYSTEM_PROMPT).toContain("resultado ejecutado");
    expect(REPLY_SYSTEM_PROMPT).toContain("voseo");
    expect(REPLY_SYSTEM_PROMPT).toContain("null");
    expect(REPLY_SYSTEM_PROMPT).toContain("redirected");
  });
});