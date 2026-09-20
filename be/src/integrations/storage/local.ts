import { randomUUID } from "node:crypto";
import type {
  PresignOptions,
  PresignedUpload,
  StorageProvider,
} from "./provider.js";

/**
 * Development stand-in for object storage.
 *
 * It does not accept uploads. It mints the same shape of response S3 does so
 * the whole wizard -- request a URL, PUT, attach the resulting URL -- can be
 * built and driven end to end before a bucket exists. Nothing is stored, so a
 * URL from here resolves to nothing; that is the point at which you notice the
 * provider is not configured, rather than in production.
 *
 * Mirrors EMAIL_PROVIDER=console: the feature stays exercisable, and the
 * fake is obvious rather than quietly plausible.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";

  constructor(private readonly baseUrl: string) {}

  async presignUpload(options: PresignOptions): Promise<PresignedUpload> {
    const key = `${options.prefix}/${randomUUID()}`;
    const fileUrl = `${this.baseUrl}/${key}`;

    console.warn(
      `[storage:local] handed out a fake upload URL for ${key} -- ` +
        "no bytes will be stored. Set STORAGE_PROVIDER=s3 for real uploads."
    );

    return {
      uploadUrl: `${fileUrl}?fake-presigned=1`,
      fileUrl,
      headers: { "Content-Type": options.contentType },
      expiresInSeconds: 900,
    };
  }

  ownsUrl(url: string): boolean {
    return url.startsWith(`${this.baseUrl}/`);
  }
}
