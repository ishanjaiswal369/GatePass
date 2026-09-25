import { createReadStream } from "node:fs";
import path from "node:path";
import type { FastifyReply } from "fastify";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

/**
 * Streams a private file the caller has already been checked for. `no-store`
 * so a shared device or proxy doesn't keep a copy of an identity document.
 */
export function sendFile(reply: FastifyReply, file: string) {
  return reply
    .type(CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream")
    .header("Cache-Control", "private, no-store")
    .send(createReadStream(file));
}
