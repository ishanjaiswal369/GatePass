import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * When the running code was built.
 *
 * A Docker container serves whatever image it was built from, so `docker
 * compose up -d` without `--build` starts a *new container* running *old
 * code*. Every route added since then answers 404, which looks exactly like a
 * frontend bug and has cost real debugging time more than once.
 *
 * The Dockerfile writes BUILD_STAMP at image build. Running from source there
 * is no file and no staleness to detect, so it reports "source".
 */
function readStamp(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/lib at runtime, src/lib under tsx -- the stamp sits above both.
    return readFileSync(join(here, "..", "..", "BUILD_STAMP"), "utf8").trim();
  } catch {
    return "source";
  }
}

export const BUILD_STAMP = readStamp();
