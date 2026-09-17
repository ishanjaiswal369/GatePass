import Fastify from "fastify";
import { logger } from "./logger.js";

export const app = Fastify({ logger });

export type App = typeof app;
