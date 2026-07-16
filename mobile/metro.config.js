const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");
const webAppRoot = path.resolve(workspaceRoot, "AnotherMe");
const teachingCoreRoot = path.resolve(webAppRoot, "packages", "teaching-core");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot, webAppRoot, teachingCoreRoot];

config.resolver.assetExts = Array.from(
  new Set([...(config.resolver?.assetExts || []), "txt"]),
);

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
  path.resolve(webAppRoot, "node_modules"),
];

config.resolver.disableHierarchicalLookup = false;

module.exports = config;
