/** One presigned upload: where to PUT the bytes, and what URL results. */
export interface PresignedUpload {
  /** The URL the client PUTs the file to. */
  uploadUrl: string;
  /** Where the object will be readable once the PUT succeeds. */
  fileUrl: string;
  /** Headers the client must send with the PUT, if the provider needs any. */
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export interface PresignOptions {
  /** Logical folder, e.g. "spot-photos" or "ownership-docs". */
  prefix: string;
  contentType: string;
  /** Refused above this; the caller sends the size it intends to upload. */
  contentLength: number;
}

export interface StorageProvider {
  readonly name: string;
  presignUpload(options: PresignOptions): Promise<PresignedUpload>;
  /**
   * Whether a URL is one this provider handed out. The API stores only URLs
   * the client reports back, so without this check a host could attach any
   * URL on the internet to their listing.
   */
  ownsUrl(url: string): boolean;
}

/**
 * Folders whose files are private: never served from their public URL, only
 * through an authenticated route that checks who is asking (the ownership
 * document: its host and admins).
 */
export const PRIVATE_PREFIXES = ["ownership-docs/"];

export function isPrivateKey(key: string): boolean {
  return PRIVATE_PREFIXES.some((prefix) => key.startsWith(prefix));
}
