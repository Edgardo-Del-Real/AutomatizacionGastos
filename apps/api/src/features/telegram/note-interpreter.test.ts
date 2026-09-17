import { describe, expect, it } from "vitest";
import {
  GroqNoteInterpreter,
  interpretedNoteSchema,
  normalizeAmountString,
  SYSTEM_PROMPT,
} from "./note-interpreter";

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

function interpreterWith(fetchImpl: typeof fetch): GroqNoteInterpreter {
  return new GroqNoteInterpreter({
    apiKey: "test-key",
    model: "openai/gpt-oss-20b",
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    timeoutMs: 5000,
    fetchImpl,
  });
}

const OPENAI_SHAPE = { choices: [{ message: { content: "{}" } }] };

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

describe("interpretedNoteSchema", () => {
  it("normalizes a Spanish string amount and keeps category and product", () => {
    const result = interpretedNoteSchema.safeParse({
      amount: "1.234,50",
      category: "Supermercado",
      product: "pan",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBe(1234.5);
      expect(result.data.category).toBe("Supermercado");
      expect(result.data.product).toBe("pan");
    }
  });

  it("accepts a numeric amount and a null category", () => {
    const result = interpretedNoteSchema.safeParse({
      amount: 4800,
      category: null,
      product: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBe(4800);
      expect(result.data.category).toBeNull();
    }
  });

  it("accepts a missing product", () => {
    const result = interpretedNoteSchema.safeParse({ amount: 100, category: null });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.product).toBeUndefined();
    }
  });

  it.each([
    ["zero", { amount: 0, category: null }],
    ["negative", { amount: -5, category: null }],
    ["NaN string", { amount: "NaN", category: null }],
    ["missing amount", { category: null }],
    ["null amount", { amount: null, category: null }],
    ["empty category", { amount: 100, category: "" }],
    ["whitespace category", { amount: 100, category: "   " }],
    ["category over 60 chars", { amount: 100, category: "c".repeat(61) }],
    ["product over 200 chars", { amount: 100, category: null, product: "p".repeat(201) }],
  ])("rejects %s", (_label, payload) => {
    expect(interpretedNoteSchema.safeParse(payload).success).toBe(false);
  });
});

describe("GroqNoteInterpreter", () => {
  it("returns the interpreted note for a string amount payload (happy path)", async () => {
    const { fetchImpl, calls } = makeFetch(() =>
      jsonResponse({ choices: [{ message: { content: '{"amount":"1.234,50","category":"Supermercado","product":"pan"}' } }] }),
    );
    const interpreter = interpreterWith(fetchImpl);

    const result = await interpreter.interpret("1234,50 supermercado pan");

    expect(result).toEqual({ amount: 1234.5, category: "Supermercado", product: "pan" });
    expect(calls).toHaveLength(1);
  });

  it("returns the interpreted note for a numeric amount payload", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({ choices: [{ message: { content: '{"amount":4800,"category":null,"product":null}' } }] }),
    );
    const interpreter = interpreterWith(fetchImpl);

    await expect(interpreter.interpret("gaste 4800")).resolves.toEqual({
      amount: 4800,
      category: null,
      product: null,
    });
  });

  it("posts to the base URL with the bearer key, model, system prompt and JSON mode", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse(OPENAI_SHAPE));
    const interpreter = interpreterWith(fetchImpl);

    await interpreter.interpret("compre mercaderia");

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
    expect(body.messages[0]?.content).toContain("JSON");
    expect(body.messages[1]).toEqual({ role: "user", content: "compre mercaderia" });
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(call?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([429, 500])("degrades to null on HTTP %s", async (status) => {
    const { fetchImpl } = makeFetch(() => jsonResponse({ error: "boom" }, status));
    const interpreter = interpreterWith(fetchImpl);

    await expect(interpreter.interpret("compre mercaderia")).resolves.toBeNull();
  });

  it("degrades to null when the body is not JSON", async () => {
    const { fetchImpl } = makeFetch(() => new Response("<html>oops</html>", { status: 200 }));
    const interpreter = interpreterWith(fetchImpl);

    await expect(interpreter.interpret("compre mercaderia")).resolves.toBeNull();
  });

  it("degrades to null when choices[0].message.content is not a string", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({ choices: [{ message: { content: 42 } }] }),
    );
    const interpreter = interpreterWith(fetchImpl);

    await expect(interpreter.interpret("compre mercaderia")).resolves.toBeNull();
  });

  it("degrades to null when choices is missing", async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({}));
    const interpreter = interpreterWith(fetchImpl);

    await expect(interpreter.interpret("compre mercaderia")).resolves.toBeNull();
  });

  it("degrades to null when the content is not valid JSON", async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({ choices: [{ message: { content: "not json" } }] }));
    const interpreter = interpreterWith(fetchImpl);

    await expect(interpreter.interpret("compre mercaderia")).resolves.toBeNull();
  });

  it("degrades to null when the payload fails the schema (zero amount)", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({ choices: [{ message: { content: '{"amount":0,"category":null,"product":null}' } }] }),
    );
    const interpreter = interpreterWith(fetchImpl);

    await expect(interpreter.interpret("compre mercaderia")).resolves.toBeNull();
  });

  it("degrades to null when the fetch rejects with a timeout AbortError, passing an AbortSignal", async () => {
    const { fetchImpl, calls } = makeFetch(async () => {
      throw new DOMException("The operation was aborted due to timeout", "AbortError");
    });
    const interpreter = interpreterWith(fetchImpl);

    await expect(interpreter.interpret("compre mercaderia")).resolves.toBeNull();
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("degrades to null when the fetch rejects with a generic network error", async () => {
    const { fetchImpl } = makeFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    const interpreter = interpreterWith(fetchImpl);

    await expect(interpreter.interpret("compre mercaderia")).resolves.toBeNull();
  });

  it("never makes more than one attempt", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse(OPENAI_SHAPE));
    const interpreter = interpreterWith(fetchImpl);

    await interpreter.interpret("compre mercaderia");

    expect(calls).toHaveLength(1);
  });
});

describe("SYSTEM_PROMPT", () => {
  it("demands JSON-only output in Spanish with ARS-only semantics", () => {
    expect(SYSTEM_PROMPT).toContain("JSON");
    expect(SYSTEM_PROMPT).toContain("ARS");
    expect(SYSTEM_PROMPT).toContain("NUNCA inventes");
  });
});