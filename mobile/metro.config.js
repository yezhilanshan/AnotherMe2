// Metro config — 为 React Native 提供 Node.js 内置模块的 polyfill
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);
const workspaceRoot = path.resolve(__dirname, "..");

// markdown-it 依赖 Node.js 内置的 punycode 模块
// React Native 运行时不包含 Node 标准库，需映射到 npm polyfill
config.resolver = {
  ...config.resolver,
  assetExts: Array.from(new Set([...(config.resolver?.assetExts || []), "txt"])),
  extraNodeModules: {
    punycode: path.dirname(require.resolve("punycode/")),
  },
  nodeModulesPaths: [
    path.resolve(__dirname, "node_modules"),
    path.resolve(workspaceRoot, "AnotherMe", "node_modules"),
  ],
};

config.watchFolders = [
  workspaceRoot,
  path.resolve(workspaceRoot, "AnotherMe", "packages"),
];

config.transformer = {
  ...config.transformer,
  getTransformOptions: async () => ({
    transform: {
      inlineRequires: true,
    },
  }),
};

module.exports = config;
