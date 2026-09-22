import { env } from "../../config/env.js";
import { LocalStorageProvider } from "./local.js";
import type { StorageProvider } from "./provider.js";

let cached: StorageProvider | undefined;

export function getStorageProvider(): StorageProvider {
  if (cached) {
    return cached;
  }

  switch (env.STORAGE_PROVIDER) {
    case "local":
    default:
      cached = new LocalStorageProvider(
        env.STORAGE_PUBLIC_BASE_URL,
        env.STORAGE_LOCAL_DIR,
        // The upload signature only has to be unforgeable by a client, and
        // this key already is. A separate secret would be one more thing to
        // set correctly for a dev-only provider.
        env.JWT_SECRET
      );
      break;
  }

  return cached;
}

/** The concrete provider, for the routes that serve its files. */
export function getLocalStorage(): LocalStorageProvider | null {
  const provider = getStorageProvider();
  return provider instanceof LocalStorageProvider ? provider : null;
}

export type {
  StorageProvider,
  PresignedUpload,
  PresignOptions,
} from "./provider.js";
