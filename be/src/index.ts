import cors from "@fastify/cors";
import { registerApi } from "./api.js";
import { env } from "./config/env.js";
import { app } from "./lib/app.js";
import { registerErrorHandler } from "./lib/errors.js";
import { prisma } from "./lib/prisma.js";
import { recordRoutes, routeCount } from "./lib/routes.js";
import { BUILD_STAMP } from "./lib/build.js";

await app.register(cors, { origin: true });

// Binary bodies for the local upload endpoint. Fastify only parses JSON out of
// the box, so without these a PUT of image bytes is refused before the route
// runs. Registered globally because a parser is per content type, not per
// route, and nothing else in this API accepts these types.
for (const contentType of [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/octet-stream",
]) {
  app.addContentTypeParser(
    contentType,
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body)
  );
}

registerErrorHandler(app);
registerApi(app);

const PORT = env.PORT;

async function start() {
  try {
    await app.listen({ port: PORT, host: "0.0.0.0" });

    // Routes are only countable once they are all registered and the server
    // is up. Logged as well as served, so a stale container is visible in
    // `docker compose logs be` without anyone having to call /health.
    recordRoutes(app);
    console.log(
      `GatePass API on :${PORT} — build ${BUILD_STAMP}, ${routeCount()} routes`
    );
  } catch (err) {
    // console, not app.log: the Fastify logger is disabled, so app.log.error
    // would swallow the reason the server failed to start.
    console.error("failed to start server", err);
    process.exit(1);
  }
}

process.on("SIGINT", async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
});

start();
