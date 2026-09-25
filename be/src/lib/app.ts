import Fastify from "fastify";
import { env } from "../config/env.js";

/**
 * The Fastify instance, with pino as its logger.
 *
 * Per-request access lines are off: what is worth reading is logged on
 * purpose -- security events and state changes (lib/security-log) and
 * failures (lib/errors). Credentials never reach a log line: the headers that
 * carry them are redacted, and nothing here logs a body.
 */
export const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    redact: {
      paths: ["req.headers.authorization", "req.headers.cookie", "headers.authorization"],
      censor: "[redacted]",
    },
  },
  disableRequestLogging: true,
  trustProxy: env.TRUST_PROXY,
});

export type App = typeof app;
