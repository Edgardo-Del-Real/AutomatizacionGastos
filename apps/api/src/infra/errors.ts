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

/**
 * 422 discriminator for SAVINGS-category guard violations (D9): assigning
 * "ahorro" to EXPENSE/INCOME movements, or deleting/renaming the SAVINGS
 * category. Kept as a subclass so executors can route the exact machine code
 * while the generic error handler still treats it as a validation failure.
 */
export class SavingsForbiddenError extends ValidationFailedError {
  constructor(message: string) {
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

/**
 * 409 discriminator for the mark-paid transition (D5): the movement exists for
 * the owner but is not a PENDING EXPENSE (already PAID, non-EXPENSE, or a
 * concurrent transition won the race). The generic error handler routes it as
 * a plain 409.
 */
export class ConflictError extends AppError {
  readonly code = "Conflict";
  readonly statusCode = 409;

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
