// Metro in an npm workspace.
//
// Dependencies hoist to the repo root, so fe/node_modules is nearly empty and
// everything this app imports actually lives at <repo root>/node_modules. The
// workspace root therefore has to be both watched and searched, or Metro
// cannot resolve a single dependency.
//
// The entry point is a separate concern, handled by fe/index.js -- see the
// comment there. Metro is NOT asked to serve from the workspace root: doing
// that makes Expo emit a relative "../node_modules/..." script URL, which no
// browser sends back intact.
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

// Without this, Metro also walks parent directories on its own and can resolve
// two copies of React -- one hoisted, one local -- which fails at runtime with
// an invalid-hook-call error rather than at build time.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
