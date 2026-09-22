import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import { getLocalStorage } from "../integrations/storage/index.js";
import { badRequest, notFound, serviceUnavailable } from "../lib/errors.js";

/**
 * The storage endpoints that back STORAGE_PROVIDER=local.
 *
 * These exist so the upload flow is the real one in development: the client
 * presigns, PUTs the bytes here, and reads them back from the URL it was
 * given -- the same three steps it will make against a bucket later. With a
 * real object store configured these routes simply answer 503, because
 * nothing should be uploading here.
 *
 * Deliberately unauthenticated: the signed, expiring URL is the credential,
 * exactly as it is with a presigned S3 URL. A session token here would be the
 * wrong check, since the whole point is that the browser talks to storage
 * directly rather than through the API's auth.
 */

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

function keyFrom(request: FastifyRequest): string {
  // Fastify gives the wildcard as params["*"].
  return (request.params as Record<string, string>)["*"] ?? "";
}

export const uploadController = {
  put: async (request: FastifyRequest, reply: FastifyReply) => {
    const storage = getLocalStorage();

    if (!storage) {
      throw serviceUnavailable(
        "This server is not configured for local uploads"
      );
    }

    const body = request.body;

    if (!Buffer.isBuffer(body)) {
      throw badRequest("Upload body must be the file's bytes");
    }

    const result = await storage.acceptUpload(
      keyFrom(request),
      request.query as Record<string, string>,
      body
    );

    if (!result.ok) {
      throw badRequest(result.reason);
    }

    return reply.code(200).send({ ok: true });
  },

  get: async (request: FastifyRequest, reply: FastifyReply) => {
    const storage = getLocalStorage();

    if (!storage) {
      throw notFound("Not found");
    }

    const resolved = storage.resolvePath(keyFrom(request));

    if (!resolved) {
      throw notFound("Not found");
    }

    try {
      await stat(resolved);
    } catch {
      throw notFound("Not found");
    }

    const type = CONTENT_TYPES[path.extname(resolved)] ?? "application/octet-stream";

    return reply.type(type).send(createReadStream(resolved));
  },
};
