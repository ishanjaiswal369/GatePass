// Metro in an npm workspace.
//
// Dependencies hoist to the repo root, so fe/node_modules is nearly empty and
// the entry point lives at <root>/node_modules/expo-router/entry.js -- one
// level above Metro's project root. Two things break without the settings
// below, and both fail silently as a blank white page:
//
//  1. Metro only searches fe/node_modules, so it cannot resolve the entry.
//  2. Expo writes the <script> URL as a path from the server root to the
//     entry, which comes out as "/../node_modules/expo-router/entry.bundle".
//     Every browser normalises the "/.." away before sending it, so the
//     request arrives as "/node_modules/..." and 404s.
//
// Verified both ways in a browser: remove this file and the page renders
// empty with a 404 on the entry bundle.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Serving from the workspace root is what makes the normalised URL resolve.
config.server = { ...config.server, unstable_serverRoot: workspaceRoot };

// Without this, Metro also walks parent directories on its own and can resolve
// two copies of React -- one hoisted, one local -- which fails at runtime with
// an invalid-hook-call error rather than at build time.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
