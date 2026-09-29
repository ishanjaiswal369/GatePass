import * as ImageManipulator from "expo-image-manipulator";
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

/** Longest side, in pixels, a photo is uploaded at unless the caller asks for more. */
const DEFAULT_MAX_SIDE = 1600;
/** JPEG quality for a re-encoded photo: well under 1 MB at 1600 px, and still sharp. */
const RESIZE_QUALITY = 0.7;

/**
 * Picks photos from the library, the same way on web, iOS and Android.
 *
 * Native details that web testing never shows:
 * - iPhones shoot HEIC. "Compatible" asks iOS for a JPEG, which the API
 *   accepts and every browser and phone can display; HEIC would be refused,
 *   or worse, stored under a .jpg name that half the viewers can't open.
 * - A phone camera shoots 12+ megapixels, several MB a photo. Each one is
 *   scaled down to `maxSide` on its longest edge and re-encoded as JPEG here,
 *   before upload, so a host never has to go and find "a smaller photo".
 *   Re-encoding also settles the content type: on a device `blob.type` is
 *   often empty, and guessing it once mislabelled PNGs.
 *
 * Returns null when the picker was closed without a choice. Throws with a
 * readable message for a format the API won't take.
 */
export async function pickImages(
  options: { multiple?: boolean; limit?: number; quality?: number; maxSide?: number } = {}
): Promise<PickedImage[] | null> {
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
      const original = (asset.mimeType || "").toLowerCase();
      if (original && !ACCEPTED.includes(original)) {
        throw new UserError("That photo's format isn't supported. Choose a JPEG, PNG or WebP image.");
      }

      const uri = await shrink(asset, options.maxSide ?? DEFAULT_MAX_SIDE);
      // fetch()+blob() rather than the file URI: the same on web and native,
      // and the PUT needs the bytes either way.
      const blob = await (await fetch(uri)).blob();
      return { uri, blob, contentType: "image/jpeg", size: blob.size };
    })
  );
}

/**
 * The asset as a JPEG no larger than `maxSide` on its longest edge.
 *
 * Always re-encoded, even when already small enough: it drops EXIF (a
 * phone's GPS tag included) and settles the type as JPEG, which the upload
 * URL is then signed for.
 */
async function shrink(asset: ImagePicker.ImagePickerAsset, maxSide: number): Promise<string> {
  const longest = Math.max(asset.width, asset.height);
  const resize =
    longest > maxSide
      ? [{ resize: asset.width >= asset.height ? { width: maxSide } : { height: maxSide } }]
      : [];

  try {
    const out = await ImageManipulator.manipulateAsync(asset.uri, resize, {
      compress: RESIZE_QUALITY,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return out.uri;
  } catch {
    throw new UserError("That photo couldn't be read. Try a different one.");
  }
}
