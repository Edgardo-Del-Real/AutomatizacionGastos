import { describe, expect, it } from "vitest";
import {
  BOT_INTENTS,
  conversationEnvelopeSchema,
  DIALOG_FEW_SHOTS,
  DIALOG_INTERPRET_ADDENDUM,
  FEW_SHOTS,
  GroqBotBrain,
  INTERPRET_SYSTEM_PROMPT,
  normalizeAmountString,
  renderDialogContext,
  replyEnvelopeSchema,
  REPLY_SYSTEM_PROMPT,
  type ExecutionResult,
  type InterpretContext,
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
  it.each(BOT_INTENTS.filter((intent) => intent !== "query"))(
    "accepts the %s intent with a null amount, category and note",
    (intent) => {
      const result = conversationEnvelopeSchema.safeParse({
        intent,
        amount: null,
        category: null,
        note: null,
      });
      expect(result.success).toBe(true);
    },
  );

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

  it.each(["categories", "recent", "balance", "month"] as const)(
    "accepts the query intent with query_type %s",
    (queryType) => {
      const result = conversationEnvelopeSchema.safeParse({
        intent: "query",
        amount: null,
        category: null,
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
      category: null,
      note: null,
      query_type: null,
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ["create_category", { intent: "create_category", amount: null, category: "Mascotas", note: null }],
    ["delete_category", { intent: "delete_category", amount: null, category: "Viajes", note: null }],
  ])("accepts the %s intent carrying the target category name", (intent, payload) => {
    const result = conversationEnvelopeSchema.safeParse(payload);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe(payload.category);
    }
  });

  it("accepts rename_category with the current name in category and the target in new_name", () => {
    const result = conversationEnvelopeSchema.safeParse({
      intent: "rename_category",
      amount: null,
      category: "Super",
      note: null,
      new_name: "Supermercado",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe("Super");
      expect(result.data.new_name).toBe("Supermercado");
    }
  });

  it("accepts the capabilities intent with null fields", () => {
    const result = conversationEnvelopeSchema.safeParse({
      intent: "capabilities",
      amount: null,
      category: null,
      note: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.new_name).toBeNull();
    }
  });

  it("defaults new_name to null when the key is omitted", () => {
    const result = conversationEnvelopeSchema.safeParse({
      intent: "help",
      amount: null,
      category: null,
      note: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.new_name).toBeNull();
    }
  });

  it.each([
    ["empty", { intent: "rename_category", amount: null, category: "Super", note: null, new_name: "" }],
    ["whitespace", { intent: "rename_category", amount: null, category: "Super", note: null, new_name: "   " }],
    ["over 60 chars", { intent: "rename_category", amount: null, category: "Super", note: null, new_name: "n".repeat(61) }],
  ])("bounds new_name: rejects %s", (_label, payload) => {
    expect(conversationEnvelopeSchema.safeParse(payload).success).toBe(false);
  });

  it.each([
    ["missing query_type", { intent: "query", amount: null, category: null, note: null }],
    ["null query_type", { intent: "query", amount: null, category: null, note: null, query_type: null }],
    ["unknown query_type", { intent: "query", amount: null, category: null, note: null, query_type: "inventory" }],
  ])("rejects the query intent without a valid query_type (%s)", (_label, payload) => {
    expect(conversationEnvelopeSchema.safeParse(payload).success).toBe(false);
  });

  it("keeps the legacy query_* intents valid without a query_type", () => {
    for (const intent of ["query_recent", "query_balance", "query_month"]) {
      const result = conversationEnvelopeSchema.safeParse({
        intent,
        amount: null,
        category: null,
        note: null,
      });
      expect(result.success).toBe(true);
    }
  });

  it.each(["resolve", "abandon"] as const)("accepts the dialog_action %s value", (dialogAction) => {
    const result = conversationEnvelopeSchema.safeParse({
      intent: "correct_category",
      amount: null,
      category: "Transporte",
      note: null,
      dialog_action: dialogAction,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dialog_action).toBe(dialogAction);
    }
  });

  it("defaults dialog_action to null when the key is omitted", () => {
    const result = conversationEnvelopeSchema.safeParse({
      intent: "off_topic",
      amount: null,
      category: null,
      note: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dialog_action).toBeNull();
    }
  });

  it("accepts an explicit null dialog_action", () => {
    const result = conversationEnvelopeSchema.safeParse({
      intent: "query",
      amount: null,
      category: null,
      note: null,
      query_type: "recent",
      dialog_action: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dialog_action).toBeNull();
    }
  });

  it("rejects an invalid dialog_action value", () => {
    const result = conversationEnvelopeSchema.safeParse({
      intent: "correct_category",
      amount: null,
      category: "Transporte",
      note: null,
      dialog_action: "confirm",
    });

    expect(result.success).toBe(false);
  });

  it("defaults then_reassign to false when the key is omitted", () => {
    const result = conversationEnvelopeSchema.safeParse({
      intent: "create_category",
      amount: null,
      category: "Mascotas",
      note: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.then_reassign).toBe(false);
    }
  });

  it("decodes a mixed-intent envelope with then_reassign true (create + reassign)", () => {
    const result = conversationEnvelopeSchema.safeParse({
      intent: "create_category",
      amount: null,
      category: "Gastos Hormiga",
      note: null,
      then_reassign: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe("Gastos Hormiga");
      expect(result.data.then_reassign).toBe(true);
    }
  });

  it("keeps a stray then_reassign true on a non-create intent (schema-permissive)", () => {
    const result = conversationEnvelopeSchema.safeParse({
      intent: "register_expense",
      amount: 5000,
      category: null,
      note: null,
      then_reassign: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.then_reassign).toBe(true);
    }
  });

  it("carries dialog_action and then_reassign on every parsed envelope", () => {
    const result = conversationEnvelopeSchema.safeParse({
      intent: "register_expense",
      amount: "5 mil",
      category: "Supermercado",
      note: "gaste en el super",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dialog_action).toBeNull();
      expect(result.data.then_reassign).toBe(false);
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
      query_type: null,
      new_name: null,
      dialog_action: null,
      then_reassign: false,
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
      query_type: null,
      new_name: null,
      dialog_action: null,
      then_reassign: false,
    });
  });

  it("returns a query envelope with a query_type for a categories question", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              content:
                '{"intent":"query","amount":null,"category":null,"note":null,"query_type":"categories"}',
            },
          },
        ],
      }),
    );
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("cuales son las categorias disponibles?")).resolves.toEqual({
      intent: "query",
      amount: null,
      category: null,
      note: null,
      query_type: "categories",
      new_name: null,
      dialog_action: null,
      then_reassign: false,
    });
  });

  it("degrades to null when the query intent lacks a query_type", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              content: '{"intent":"query","amount":null,"category":null,"note":null,"query_type":null}',
            },
          },
        ],
      }),
    );
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("cuales son las categorias?")).resolves.toBeNull();
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

  it("returns a rename_category envelope carrying the current and new names", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              content:
                '{"intent":"rename_category","amount":null,"category":"super","note":null,"query_type":null,"new_name":"supermercado"}',
            },
          },
        ],
      }),
    );
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("renombra super a supermercado")).resolves.toEqual({
      intent: "rename_category",
      amount: null,
      category: "super",
      note: null,
      query_type: null,
      new_name: "supermercado",
      dialog_action: null,
      then_reassign: false,
    });
  });

  it("returns a create_category envelope for a create-phrasing message", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              content:
                '{"intent":"create_category","amount":null,"category":"mascotas","note":null,"query_type":null,"new_name":null}',
            },
          },
        ],
      }),
    );
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("creá una categoria llamada mascotas")).resolves.toEqual({
      intent: "create_category",
      amount: null,
      category: "mascotas",
      note: null,
      query_type: null,
      new_name: null,
      dialog_action: null,
      then_reassign: false,
    });
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

describe("GroqBotBrain.interpret with dialog context", () => {
  const categoryContext: InterpretContext = {
    state: "awaiting_category",
    pending: { movementId: "mov-1", note: "uber viaje" },
    openQuestion: '¿Querés asignarle otra categoría al movimiento "uber viaje"? Escribí el nombre o "no".',
  };

  it("embeds the dialog addendum, the rendered context and the dialog few-shots when a context is supplied", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse(OPENAI_SHAPE));
    const brain = brainWith(fetchImpl);

    await brain.interpret("Transporte", categoryContext);

    const call = calls[0];
    const body = JSON.parse(String(call?.init?.body)) as {
      messages: { role: string; content: string }[];
    };
    const system = body.messages[0]?.content ?? "";
    expect(system).toBe(
      `${INTERPRET_SYSTEM_PROMPT} ${DIALOG_INTERPRET_ADDENDUM["awaiting_category"]} ${renderDialogContext(categoryContext)}`,
    );
    expect(body.messages).toHaveLength(1 + FEW_SHOTS.length + DIALOG_FEW_SHOTS["awaiting_category"].length + 1);
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "Transporte" });
  });

  it("returns a resolve envelope when the LLM answers with an exact category", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              content:
                '{"intent":"correct_category","amount":null,"category":"Transporte","note":null,"query_type":null,"new_name":null,"dialog_action":"resolve","then_reassign":false}',
            },
          },
        ],
      }),
    );
    const brain = brainWith(fetchImpl);

    const result = await brain.interpret("Transporte", categoryContext);

    expect(result).toEqual({
      intent: "correct_category",
      amount: null,
      category: "Transporte",
      note: null,
      query_type: null,
      new_name: null,
      dialog_action: "resolve",
      then_reassign: false,
    });
  });

  it("degrades to null when the LLM returns an invalid dialog_action", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              content:
                '{"intent":"correct_category","amount":null,"category":"Transporte","note":null,"query_type":null,"new_name":null,"dialog_action":"confirm","then_reassign":false}',
            },
          },
        ],
      }),
    );
    const brain = brainWith(fetchImpl);

    await expect(brain.interpret("Transporte", categoryContext)).resolves.toBeNull();
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

  it("pins the awaiting_category dialog addendum", async () => {
    await expect(DIALOG_INTERPRET_ADDENDUM["awaiting_category"]).toMatchFileSnapshot(
      "./__goldens__/dialog-awaiting-category-addendum.txt",
    );
  });

  it("pins the awaiting_amount_confirmation dialog addendum", async () => {
    await expect(DIALOG_INTERPRET_ADDENDUM["awaiting_amount_confirmation"]).toMatchFileSnapshot(
      "./__goldens__/dialog-awaiting-amount-confirmation-addendum.txt",
    );
  });

  it("pins the awaiting_category dialog few-shots", async () => {
    await expect(JSON.stringify(DIALOG_FEW_SHOTS["awaiting_category"], null, 2)).toMatchFileSnapshot(
      "./__goldens__/dialog-awaiting-category-few-shots.json",
    );
  });

  it("pins the awaiting_amount_confirmation dialog few-shots", async () => {
    await expect(JSON.stringify(DIALOG_FEW_SHOTS["awaiting_amount_confirmation"], null, 2)).toMatchFileSnapshot(
      "./__goldens__/dialog-awaiting-amount-confirmation-few-shots.json",
    );
  });

  it("pins the rendered dialog context fixture", async () => {
    const context: InterpretContext = {
      state: "awaiting_category",
      pending: { movementId: "mov-1", note: "uber viaje" },
      openQuestion: '¿Querés asignarle otra categoría al movimiento "uber viaje"? Escribí el nombre o "no".',
    };
    await expect(renderDialogContext(context)).toMatchFileSnapshot("./__goldens__/dialog-context-rendered.txt");
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

  it("classifies natural query phrasing into the query intent with a query_type", () => {
    expect(INTERPRET_SYSTEM_PROMPT).toContain("query_type");
    expect(INTERPRET_SYSTEM_PROMPT).toContain('"categories"');
    expect(INTERPRET_SYSTEM_PROMPT).toContain('"recent"');
    expect(INTERPRET_SYSTEM_PROMPT).toContain('"balance"');
    expect(INTERPRET_SYSTEM_PROMPT).toContain('"month"');
    expect(INTERPRET_SYSTEM_PROMPT).toContain("categorías tiene/disponibles");
  });

  it("teaches the reply to answer query intents from the executed data only", () => {
    expect(REPLY_SYSTEM_PROMPT).toContain("answered");
    expect(REPLY_SYSTEM_PROMPT).toContain("query");
    expect(REPLY_SYSTEM_PROMPT).toContain("inventar");
  });

  it("classifies category CRUD phrasing into create/delete/rename intents", () => {
    expect(INTERPRET_SYSTEM_PROMPT).toContain("create_category");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("delete_category");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("rename_category");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("new_name");
  });

  it("answers capability questions naturally instead of returning no action", () => {
    expect(INTERPRET_SYSTEM_PROMPT).toContain("capabilities");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("¿podes");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("sabés");
  });

  it("teaches the reply to confirm category actions, list capabilities and carry errors", () => {
    expect(REPLY_SYSTEM_PROMPT).toContain("created");
    expect(REPLY_SYSTEM_PROMPT).toContain("deleted");
    expect(REPLY_SYSTEM_PROMPT).toContain("renamed");
    expect(REPLY_SYSTEM_PROMPT).toContain("capabilities");
    expect(REPLY_SYSTEM_PROMPT).toContain("message");
  });

  it("documents dialog_action semantics and the then_reassign flag in the interpret prompt", () => {
    expect(INTERPRET_SYSTEM_PROMPT).toContain("dialog_action");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("resolve");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("abandon");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("then_reassign");
  });

  it("documents correct_category reference extraction in the interpret prompt", () => {
    expect(INTERPRET_SYSTEM_PROMPT).toContain("correct_category");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("identifican");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("DESTINO");
  });

  it("teaches the reply to confirm asked_movement and created_reassigned actions", () => {
    expect(REPLY_SYSTEM_PROMPT).toContain("asked_movement");
    expect(REPLY_SYSTEM_PROMPT).toContain("created_reassigned");
  });

  it("teaches the amount-confirmation addendum that a bare affirmation never resolves", () => {
    const addendum = DIALOG_INTERPRET_ADDENDUM["awaiting_amount_confirmation"];
    expect(addendum).toContain("resolve");
    expect(addendum).toContain("NUNCA");
    expect(addendum).toContain("si");
  });

  it("teaches the category addendum the resolve/abandon/null classification", () => {
    const addendum = DIALOG_INTERPRET_ADDENDUM["awaiting_category"];
    expect(addendum).toContain("resolve");
    expect(addendum).toContain("abandon");
    expect(addendum).toContain("null");
  });

  it("models a bare affirmation as dialog_action null in the amount-confirmation few-shots", () => {
    const shots = DIALOG_FEW_SHOTS["awaiting_amount_confirmation"];
    const siIndex = shots.findIndex((message) => message.role === "user" && message.content === "si");
    expect(siIndex).toBeGreaterThan(-1);
    const answer = shots[siIndex + 1];
    expect(answer?.role).toBe("assistant");
    const parsed = JSON.parse(answer?.content ?? "{}") as {
      dialog_action: string | null;
      amount: number | null;
    };
    expect(parsed.dialog_action).toBeNull();
    expect(parsed.amount).toBeNull();
  });

  it("models an exact category answer as resolve and an explicit out as abandon in the category few-shots", () => {
    const shots = DIALOG_FEW_SHOTS["awaiting_category"];
    const resolve = shots.find((message) => {
      if (message.role !== "assistant") return false;
      const parsed = JSON.parse(message.content) as { dialog_action?: string };
      return parsed.dialog_action === "resolve";
    });
    const abandon = shots.find((message) => {
      if (message.role !== "assistant") return false;
      const parsed = JSON.parse(message.content) as { dialog_action?: string };
      return parsed.dialog_action === "abandon";
    });
    expect(resolve).toBeDefined();
    expect(abandon).toBeDefined();
  });
});