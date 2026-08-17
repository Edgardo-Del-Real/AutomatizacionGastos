import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PREFIX = "sha256=";

export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (typeof signatureHeader !== "string") return false;
  const provided = signatureHeader.trim();
  if (!provided.startsWith(SIGNATURE_PREFIX)) return false;
  const expected = `${SIGNATURE_PREFIX}${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}
