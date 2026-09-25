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

// Hierarchical lookup stays ON. Turning it off (to guard against a second
// copy of React) also hid every nested node_modules from Metro, so a package
// that ships its own version of a dependency got the hoisted one instead:
// react-native-svg -> css-tree needs source-map 0.6, the root has 0.7 (which
// requires Node's `url`), and every iOS/Android bundle failed to build. The
// web bundle never loads css-tree, which is why it went unnoticed. There is
// one React and one React Native in this workspace (npm dedupes them to the
// root, fe/node_modules is empty); `npm ls react` shows it if that changes.

module.exports = config;
