import cors from "@fastify/cors";
import { registerApi } from "./api.js";
import { env } from "./config/env.js";
import { app } from "./lib/app.js";
import { registerErrorHandler } from "./lib/errors.js";
import { prisma } from "./lib/prisma.js";
import { registerRateLimit } from "./lib/rate-limit.js";
import { recordRoutes, routeCount } from "./lib/routes.js";
import { BUILD_STAMP } from "./lib/build.js";
import { getPushProvider } from "./integrations/push/index.js";
import { startNotificationJobs, stopNotificationJobs } from "./services/notification-jobs.service.js";
import { startRefundJobs, stopRefundJobs } from "./services/refund.service.js";

// Browsers only: the phone app isn't subject to CORS. In production the one
// web origin allowed is the app's own; in development any origin is, because
// the app runs on whichever port Expo picked.
await app.register(cors, {
  origin: env.NODE_ENV === "production" ? [new URL(env.APP_WEB_URL).origin] : true,
});
await registerRateLimit(app);

// On every answer. `nosniff`: photos and documents people upload are served
// from this origin, and a browser must take the declared type rather than
// guess one from the bytes. `DENY`: nothing here is meant to be framed.
app.addHook("onSend", async (_request, reply) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
});

// Binary bodies for the local upload endpoint. Fastify only parses JSON out of
// the box, so without these a PUT of image bytes is refused before the route
// runs. Registered globally because a parser is per content type, not per
// route, and nothing else in this API accepts these types.
//
// The body limit is Fastify's 1 MB unless raised here, while presign promises
// MAX_UPLOAD_BYTES: every phone photo over 1 MB was refused with a 413 before
// the upload route could run. A little headroom so the route's own size check
// is the one that answers, with its readable message.
for (const contentType of [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/octet-stream",
]) {
  app.addContentTypeParser(
    contentType,
    { parseAs: "buffer", bodyLimit: env.MAX_UPLOAD_BYTES + 64 * 1024 },
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

    // Built now rather than at the first push, so a missing or unreadable
    // Firebase key stops the boot instead of failing quietly later.
    getPushProvider();
    startNotificationJobs();
    startRefundJobs();
  } catch (err) {
    app.log.fatal({ err }, "failed to start server");
    process.exit(1);
  }
}

/**
 * One way down, for Ctrl-C (SIGINT) and for `docker stop` (SIGTERM). Without
 * the second, a container ignores the request, waits out Docker's timeout and
 * is killed mid-request. Stops the jobs, lets requests in flight finish, then
 * closes the database.
 */
let stopping = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return;
  stopping = true;
  app.log.info({ signal }, "shutting down");
  stopNotificationJobs();
  stopRefundJobs();
  try {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "shutdown failed");
    process.exit(1);
  }
}

process.on("SIGINT", (signal) => void shutdown(signal));
process.on("SIGTERM", (signal) => void shutdown(signal));

start();
