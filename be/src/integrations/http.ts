import axios from "axios";
import { env } from "../config/env.js";
import { isRetryableError } from "./errors.js";

export const http = axios.create({
  timeout: env.INTEGRATION_TIMEOUT_MS,
});

export interface RetryOptions {
  retries?: number;
  isRetryable?: (error: unknown) => boolean;
  baseDelayMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const retries = options.retries ?? env.INTEGRATION_MAX_RETRIES;
  const isRetryable = options.isRetryable ?? isRetryableError;
  const baseDelayMs = options.baseDelayMs ?? 300;

  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= retries || !isRetryable(error)) {
        throw error;
      }

      const delayMs = baseDelayMs * 2 ** attempt;
      console.warn(
        `integration call failed, retrying in ${delayMs}ms ` +
          `(attempt ${attempt + 1}/${retries + 1})`,
        error
      );
      await sleep(delayMs);
    }
  }
}
