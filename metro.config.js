const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite uses a WebAssembly worker on web. Metro must treat the wasm
// binary as an asset so the same offline compendium repository can be bundled.
config.resolver.assetExts.push('wasm');

module.exports = config;

