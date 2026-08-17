declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export type WebhookMessage = {
  id: string;
  from: string;
  type: string;
  text: { body: string } | null;
};
