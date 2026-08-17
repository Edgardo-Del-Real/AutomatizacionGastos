import type { FastifyReply, FastifyRequest } from "fastify";

export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationFailedError extends AppError {
  readonly code = "ValidationFailed";
  readonly statusCode = 422;

  constructor(message: string, readonly details?: unknown) {
    super(message);
  }
}

export class NotFoundError extends AppError {
  readonly code = "NotFound";
  readonly statusCode = 404;

  constructor(message: string) {
    super(message);
  }
}

export class UnauthorizedError extends AppError {
  readonly code = "Unauthorized";
  readonly statusCode = 401;

  constructor(message: string) {
    super(message);
  }
}

export function errorHandler(error: unknown, request: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof AppError) {
    const body: Record<string, unknown> = { code: error.code, message: error.message };
    if (error instanceof ValidationFailedError && error.details !== undefined) {
      body.details = error.details;
    }
    void reply.status(error.statusCode).send(body);
    return;
  }

  request.log.error({ err: error }, "Unhandled error");
  void reply.status(500).send({ code: "InternalServerError", message: "Internal server error" });
}
