import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "./webhook.signature";

const secret = "test-app-secret";

function sign(rawBody: string, key: string = secret): string {
  return `sha256=${createHmac("sha256", key).update(rawBody).digest("hex")}`;
}

describe("verifyWebhookSignature", () => {
  it("accepts a valid signature", () => {
    const rawBody = JSON.stringify({ entry: [] });
    expect(verifyWebhookSignature(rawBody, sign(rawBody), secret)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const rawBody = JSON.stringify({ entry: [] });
    expect(verifyWebhookSignature(rawBody, sign(rawBody, "other-secret"), secret)).toBe(false);
  });

  it("rejects a signature for a tampered body", () => {
    const expectedBody = JSON.stringify({ entry: [1] });
    const tamperedBody = JSON.stringify({ entry: [2] });
    expect(verifyWebhookSignature(tamperedBody, sign(expectedBody), secret)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyWebhookSignature("body", undefined, secret)).toBe(false);
  });

  it("rejects a signature in the wrong format", () => {
    expect(verifyWebhookSignature("body", "not-a-signature", secret)).toBe(false);
  });
});
