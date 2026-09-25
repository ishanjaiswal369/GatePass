import * as ImagePicker from "expo-image-picker";
import { UserError } from "./userError";

/** One picked image, ready to PUT to a presigned upload URL. */
export interface PickedImage {
  uri: string;
  blob: Blob;
  /** What the bytes are, as the upload URL is signed for. */
  contentType: string;
  size: number;
}

/** What the API's upload endpoints accept (be/src/services/*: IMAGE_CONTENT_TYPES). */
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

/**
 * Picks photos from the library, the same way on web, iOS and Android.
 *
 * Two native details that web testing never shows:
 * - iPhones shoot HEIC. "Compatible" asks iOS for a JPEG, which the API
 *   accepts and every browser and phone can display; HEIC would be refused,
 *   or worse, stored under a .jpg name that half the viewers can't open.
 * - On a device `blob.type` is often empty, so the picker's own `mimeType`
 *   is what says what the bytes are -- guessing "image/jpeg" mislabelled PNGs.
 *
 * Returns null when the picker was closed without a choice. Throws with a
 * readable message for a format the API won't take.
 */
export async function pickImages(options: { multiple?: boolean; limit?: number; quality?: number } = {}): Promise<PickedImage[] | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: options.quality ?? 0.8,
    allowsMultipleSelection: Boolean(options.multiple),
    ...(options.multiple && options.limit ? { selectionLimit: options.limit } : {}),
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });

  if (result.canceled || result.assets.length === 0) return null;

  return Promise.all(
    result.assets.map(async (asset) => {
      // fetch()+blob() rather than the file URI: the same on web and native,
      // and the PUT needs the bytes either way.
      const blob = await (await fetch(asset.uri)).blob();
      const contentType = (asset.mimeType || blob.type || "image/jpeg").toLowerCase();
      if (!ACCEPTED.includes(contentType)) {
        throw new UserError("That photo's format isn't supported. Choose a JPEG, PNG or WebP image.");
      }
      return { uri: asset.uri, blob, contentType, size: blob.size || asset.fileSize || 0 };
    })
  );
}
