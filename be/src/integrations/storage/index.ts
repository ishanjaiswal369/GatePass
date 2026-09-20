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
      cached = new LocalStorageProvider(env.STORAGE_PUBLIC_BASE_URL);
      break;
  }

  return cached;
}

export type {
  StorageProvider,
  PresignedUpload,
  PresignOptions,
} from "./provider.js";
