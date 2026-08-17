import type { FastifyPluginAsync } from "fastify";
import type { WebhookService } from "./webhook.service";

export type WebhookRouteOptions = {
  webhookService: WebhookService;
  verifyToken: string;
};

export const webhookRoute: FastifyPluginAsync<WebhookRouteOptions> = async (app, options) => {
  const { webhookService, verifyToken } = options;

  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, payload, done) => {
    request.rawBody = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    let body: unknown = null;
    try {
      body = payload.length > 0 ? JSON.parse(payload.toString("utf8")) : null;
    } catch {
      body = null;
    }
    done(null, body);
  });

  app.get("/webhook/whatsapp", async (request, reply) => {
    const query = (request.query ?? {}) as {
      "hub.mode"?: unknown;
      "hub.verify_token"?: unknown;
      "hub.challenge"?: unknown;
    };
    if (query["hub.mode"] !== "subscribe" || query["hub.verify_token"] !== verifyToken) {
      return reply.status(403).type("text/plain").send("Forbidden");
    }
    const challenge = typeof query["hub.challenge"] === "string" ? query["hub.challenge"] : "";
    return reply.type("text/plain").send(challenge);
  });

  app.post("/webhook/whatsapp", async (request, reply) => {
    const signature = readSignatureHeader(request.headers["x-hub-signature-256"]);
    await webhookService.handleIncoming(request.body, request.rawBody ?? Buffer.alloc(0), signature);
    return reply.type("text/plain").send("EVENT_RECEIVED");
  });
};

function readSignatureHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
