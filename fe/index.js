// The app's entry point, deliberately a real file inside this package.
//
// Pointing "main" straight at "expo-router/entry" resolves to the hoisted copy
// at <repo root>/node_modules, which is OUTSIDE Metro's project root. Expo
// then builds the <script> URL as a path from the project root to that file
// and it comes out relative: "../node_modules/expo-router/entry.bundle". That
// breaks differently on each OS -- the browser strips the "/.." on macOS and
// Linux so the request 404s, and on Windows the separators are backslashes,
// so the URL arrives percent-encoded as "..%5Cnode_modules%5C..." and Metro
// answers 500. Either way the page is blank with nothing in the terminal.
//
// Re-exporting from a file that lives here keeps the entry inside the project
// root, so the URL is a plain "/index.bundle" on every platform.
import "expo-router/entry";
