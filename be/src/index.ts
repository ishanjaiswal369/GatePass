import cors from "@fastify/cors";
import { registerApi } from "./api.js";
import { env } from "./config/env.js";
import { app } from "./lib/app.js";
import { registerErrorHandler } from "./lib/errors.js";
import { prisma } from "./lib/prisma.js";

await app.register(cors, { origin: true });

registerErrorHandler(app);
registerApi(app);

const PORT = env.PORT;

async function start() {
  try {
    await app.listen({ port: PORT, host: "0.0.0.0" });
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
