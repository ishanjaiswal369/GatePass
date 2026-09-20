import { createHmac, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env.js";
import type {
  PresignOptions,
  PresignedUpload,
  StorageProvider,
} from "./provider.js";

/**
 * Object storage on the API's own disk, for development.
 *
 * It behaves like the real thing in the one way that matters to the client:
 * presign, PUT the bytes to the URL you get back, then read them from the URL
 * the response named. That means the whole upload path -- including the parts
 * that only fail against a real server, like content-type and size -- is
 * exercised before a bucket exists.
 *
 * Upload URLs are signed and short-lived rather than simply guessable. This is
 * a dev provider, but an unsigned write endpoint is an open file drop on
 * whatever machine it runs on, and dev machines get exposed.
 *
 * It is NOT for production: files land on the container's own disk, so they
 * vanish with it and are invisible to a second replica.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";

  constructor(
    private readonly baseUrl: string,
    private readonly directory: string,
    private readonly secret: string
  ) {}

  async presignUpload(options: PresignOptions): Promise<PresignedUpload> {
    const expiresInSeconds = 900;
    const key = `${options.prefix}/${randomUUID()}${extensionFor(options.contentType)}`;
    const expiresAt = Date.now() + expiresInSeconds * 1000;
    const signature = this.sign(key, expiresAt, options.contentType);

    const query = new URLSearchParams({
      expires: String(expiresAt),
      contentType: options.contentType,
      signature,
    });

    return {
      uploadUrl: `${this.baseUrl}/${key}?${query}`,
      fileUrl: `${this.baseUrl}/${key}`,
      headers: { "Content-Type": options.contentType },
      expiresInSeconds,
    };
  }

  ownsUrl(url: string): boolean {
    return url.startsWith(`${this.baseUrl}/`);
  }

  /**
   * Checks a signed upload and writes the bytes.
   *
   * The content type is part of the signature, so a URL issued for a JPEG
   * cannot be replayed to store something else under the same key.
   */
  async acceptUpload(
    key: string,
    query: { expires?: string; contentType?: string; signature?: string },
    body: Buffer
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const expiresAt = Number(query.expires);

    if (!expiresAt || !query.signature || !query.contentType) {
      return { ok: false, reason: "Upload URL is missing its signature" };
    }

    if (Date.now() > expiresAt) {
      return { ok: false, reason: "Upload URL has expired" };
    }

    const expected = this.sign(key, expiresAt, query.contentType);

    if (expected !== query.signature) {
      return { ok: false, reason: "Upload URL signature does not match" };
    }

    if (body.byteLength > env.MAX_UPLOAD_BYTES) {
      return { ok: false, reason: "File is too large" };
    }

    // Keys are built from a uuid here, never from client input, but a ".."
    // that reached this far would write outside the upload directory.
    const destination = path.resolve(this.directory, key);

    if (!destination.startsWith(path.resolve(this.directory) + path.sep)) {
      return { ok: false, reason: "Invalid upload path" };
    }

    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, body);

    return { ok: true };
  }

  resolvePath(key: string): string | null {
    const resolved = path.resolve(this.directory, key);

    return resolved.startsWith(path.resolve(this.directory) + path.sep)
      ? resolved
      : null;
  }

  private sign(key: string, expiresAt: number, contentType: string): string {
    return createHmac("sha256", this.secret)
      .update(`${key}:${expiresAt}:${contentType}`)
      .digest("hex");
  }
}

function extensionFor(contentType: string): string {
  switch (contentType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "application/pdf":
      return ".pdf";
    default:
      return "";
  }
}
