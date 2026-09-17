import axios from "axios";

export interface IntegrationErrorContext {
  capability: string;
  provider: string;
  operation: string;
}

interface IntegrationErrorInit extends IntegrationErrorContext {
  retryable: boolean;
  statusCode?: number;
  raw?: unknown;
}

export class IntegrationError extends Error {
  readonly capability: string;
  readonly provider: string;
  readonly operation: string;
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly raw?: unknown;

  constructor(message: string, init: IntegrationErrorInit) {
    super(message);
    this.name = "IntegrationError";
    this.capability = init.capability;
    this.provider = init.provider;
    this.operation = init.operation;
    this.retryable = init.retryable;
    this.statusCode = init.statusCode;
    this.raw = init.raw;
  }

  static from(context: IntegrationErrorContext, error: unknown): IntegrationError {
    if (error instanceof IntegrationError) {
      return error;
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = error.response?.data as
        | { message?: string; error?: string }
        | string
        | undefined;
      const message =
        (typeof data === "object" && (data?.message || data?.error)) ||
        (typeof data === "string" ? data : undefined) ||
        error.message ||
        "Upstream request failed";

      return new IntegrationError(message, {
        ...context,
        retryable: isRetryableStatus(status),
        statusCode: status,
        raw: data ?? error.message,
      });
    }

    return new IntegrationError(
      error instanceof Error ? error.message : "Unknown integration error",
      { ...context, retryable: false, raw: error }
    );
  }
}

function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return true;
  return status >= 500 || status === 429;
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof IntegrationError) {
    return error.retryable;
  }

  if (axios.isAxiosError(error)) {
    return isRetryableStatus(error.response?.status);
  }

  return false;
}
