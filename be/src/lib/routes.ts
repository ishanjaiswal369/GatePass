import type { App } from "./app.js";

let count = 0;

/** Counted from Fastify's own route table once the server is listening. */
export function recordRoutes(app: App): void {
  count = app
    .printRoutes({ commonPrefix: false })
    .split("\n")
    .filter((line) => /\((?:GET|POST|PUT|PATCH|DELETE)/.test(line)).length;
}

export function routeCount(): number {
  return count;
}
