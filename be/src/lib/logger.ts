import pino from "pino";
import type { TransportTargetOptions } from "pino";
import { env } from "../config/env.js";

const targets: TransportTargetOptions[] = [
  env.LOG_PRETTY
    ? {
        target: "pino-pretty",
        level: env.LOG_LEVEL,
        options: {
          colorize: true,
          translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
          ignore: "pid,hostname",
        },
      }
    : {
        target: "pino/file",
        level: env.LOG_LEVEL,
        options: { destination: 1 },
      },
];

if (env.LOG_TO_FILE) {
  targets.push({
    target: "pino-roll",
    level: env.LOG_LEVEL,
    options: {
      file: `${env.LOG_DIR}/app`,
      frequency: "daily",
      dateFormat: "yyyy-MM-dd",
      extension: ".log",
      mkdir: true,
    },
  });
}

export const logger = pino({ level: env.LOG_LEVEL }, pino.transport({ targets }));
