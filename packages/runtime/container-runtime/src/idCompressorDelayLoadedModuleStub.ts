/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

// Stub for Fluid container-runtime's delay-loaded id-compressor module
// (`./idCompressorDelayLoadedModule/index.js`).
//
// This stub is for clients that never enable id-compression
// (`runtimeOptions.enableRuntimeIdCompressor`, which is off by default). The id-compressor — together
// with its transitive `@tylerbu/sorted-btree-es6` dependency — is a large graph of modules that is
// not needed in the single-file bundle for such clients. The stub is used in the single-file bundle
// instead of the real id-compressor module, replaced via NormalModuleReplacementPlugin in the
// webpack config.
//
// The stub re-exports all symbols that the real module exports, but each throws an error when
// called. This ensures that if any code path reaches this stub (i.e. a client enables id-compression
// despite having stubbed it out), it fails fast and clearly indicates that the id-compressor is
// unavailable in this client.
//
// Example Webpack rule implementing the replacement after idCompressorDelayLoadedModuleStub.ts is
// copied into the src/polyfills/ directory of the application:
// ```ts
// new webpack.NormalModuleReplacementPlugin(
//     /idCompressorDelayLoadedModule[\\/]index\.js$/,
//     path.resolve(__dirname, "src/polyfills/idCompressorDelayLoadedModuleStub.ts"),
// ),
// ```

const unavailable = (name: string): never => {
	throw new Error(
		`${name} is unavailable: the idCompressorDelayLoadedModule chunk was stubbed out of the bundle.`,
	);
};

export const createIdCompressor = (): never => unavailable("createIdCompressor");
export const createSessionId = (): never => unavailable("createSessionId");
export const deserializeIdCompressor = (): never => unavailable("deserializeIdCompressor");
export const toIdCompressorWithCore = (): never => unavailable("toIdCompressorWithCore");
