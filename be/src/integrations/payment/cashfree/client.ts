import { randomUUID } from "node:crypto";
import axios, { type AxiosInstance } from "axios";
import { IntegrationError } from "../../errors.js";
import { withRetry } from "../../http.js";

/**
 * Cashfree PG over HTTP, and nothing about bookings.
 *
 * Everything a Cashfree call needs is decided here once: the base URL per
 * environment, the auth and version headers, an `x-request-id` per call (the
 * id Cashfree support asks for), the idempotency key, the timeout, and which
 * failures are worth another attempt.
 *
 * The secret travels in a header and nowhere else. Failures are turned into
 * an IntegrationError *inside* the attempt, before anything logs them: a raw
 * axios error carries its request config, headers and all, and a retry
 * warning that printed one would put the secret in the logs.
 */

export interface CashfreeClientOptions {
  clientId: string;
  clientSecret: string;
  apiVersion: string;
  /** https://sandbox.cashfree.com/pg or https://api.cashfree.com/pg; a local fake in tests. */
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
}

export const CASHFREE_BASE_URLS = {
  sandbox: "https://sandbox.cashfree.com/pg",
  production: "https://api.cashfree.com/pg",
} as const;

const CONTEXT = { capability: "payment", provider: "cashfree" } as const;

/** Cashfree's error body: `{ message, code, type, help }`. */
interface CashfreeErrorBody {
  message?: string;
  code?: string;
  type?: string;
}

export interface CashfreeRequest {
  /** Names the call in errors and logs: "createOrder". */
  operation: string;
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
  /**
   * Makes the call safe to repeat, and so allowed to be retried. A POST
   * without one is sent once: repeating it could make a second order.
   */
  idempotencyKey?: string;
}

export class CashfreeClient {
  private readonly http: AxiosInstance;

  constructor(private readonly options: CashfreeClientOptions) {
    this.http = axios.create({
      baseURL: options.baseUrl,
      timeout: options.timeoutMs,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-client-id": options.clientId,
        "x-client-secret": options.clientSecret,
        "x-api-version": options.apiVersion,
      },
    });
  }

  async request<T = unknown>(call: CashfreeRequest): Promise<T> {
    const retryable = call.method === "GET" || Boolean(call.idempotencyKey);

    return withRetry(() => this.attempt<T>(call), {
      retries: retryable ? this.options.maxRetries : 0,
    });
  }

  private async attempt<T>(call: CashfreeRequest): Promise<T> {
    // A fresh id per attempt: each one is its own request in Cashfree's logs.
    const requestId = randomUUID();
    const started = Date.now();

    try {
      const response = await this.http.request<T>({
        method: call.method,
        url: call.path,
        data: call.body,
        headers: {
          "x-request-id": requestId,
          ...(call.idempotencyKey ? { "x-idempotency-key": call.idempotencyKey } : {}),
        },
      });

      console.info(
        `cashfree ${call.operation} ${call.method} ${call.path} -> ${response.status} ` +
          `${Date.now() - started}ms request=${requestId}`
      );
      return response.data;
    } catch (error) {
      const failure = toIntegrationError(call.operation, requestId, error);
      console.warn(
        `cashfree ${call.operation} ${call.method} ${call.path} failed ` +
          `(${failure.statusCode ?? "no response"}) ${Date.now() - started}ms request=${requestId}: ${failure.message}`
      );
      throw failure;
    }
  }
}

/**
 * Keeps what explains the failure -- status, Cashfree's code and message, the
 * request id -- and drops everything else, the request config included.
 */
function toIntegrationError(operation: string, requestId: string, error: unknown): IntegrationError {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const body = (error.response?.data ?? {}) as CashfreeErrorBody;
    const code = typeof body.code === "string" ? body.code : undefined;
    const message =
      (typeof body.message === "string" && body.message) ||
      (error.code === "ECONNABORTED" ? "Cashfree did not answer in time" : error.message) ||
      "Cashfree request failed";

    return new IntegrationError(code ? `${code}: ${message}` : message, {
      ...CONTEXT,
      operation,
      // No answer at all, a server error, or throttling: worth another go.
      // Anything else is our request being wrong and will be wrong again.
      retryable: status === undefined || status >= 500 || status === 429,
      statusCode: status,
      raw: { requestId, code, type: body.type, message },
    });
  }

  return new IntegrationError(error instanceof Error ? error.message : "Cashfree request failed", {
    ...CONTEXT,
    operation,
    retryable: false,
    raw: { requestId },
  });
}
