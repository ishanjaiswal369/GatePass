import Fastify from "fastify";

// Logging is intentionally off for now; a real logger gets set up before
// production. Fastify still exposes app.log, but with logger disabled it is a
// no-op, so anything that must be seen uses console directly.
export const app = Fastify();

export type App = typeof app;
