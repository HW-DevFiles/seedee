import { ZodError } from "zod";

const messages = {
  unauthenticated: "Sign in to continue.",
  forbidden_or_missing: "This item is unavailable.",
  invalid_input: "Check your entries and try again.",
  conflict: "This item changed. Refresh and try again.",
  rate_limited: "Too many requests. Try again after the indicated wait.",
  provider_failed: "The operation could not finish. Please try again.",
} as const;

export type SecurityCode = keyof typeof messages;
export class SecurityError extends Error {
  constructor(
    readonly code: SecurityCode,
    readonly retryAfterSeconds?: number,
  ) {
    super(messages[code]);
    this.name = "SecurityError";
  }
}

// Never reflect exception messages, validation input, database errors or stacks.
export function safeError(error: unknown) {
  const code =
    error instanceof SecurityError
      ? error.code
      : error instanceof ZodError
        ? "invalid_input"
        : "provider_failed";
  return {
    code,
    message: messages[code],
    ...(error instanceof SecurityError &&
    code === "rate_limited" &&
    Number.isSafeInteger(error.retryAfterSeconds) &&
    error.retryAfterSeconds! > 0
      ? { retryAfterSeconds: error.retryAfterSeconds }
      : {}),
  };
}

export function securityLogEvent(
  event: "auth" | "generation" | "export" | "mutation",
  error: unknown,
) {
  // Deliberately no arbitrary metadata, request body, URL, identity or exception.
  return { event, code: safeError(error).code };
}
