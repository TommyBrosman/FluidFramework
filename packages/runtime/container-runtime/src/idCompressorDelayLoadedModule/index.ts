/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

// Delay-loaded entry point for the id-compressor implementation.
//
// The id-compressor (and its transitive `@tylerbu/sorted-btree-es6` dependency) is a sizeable graph
// of modules that is only needed when a client actually enables id-compression
// (`runtimeOptions.enableRuntimeIdCompressor`), which is off by default. ContainerRuntime reaches
// this module exclusively through a dynamic `import()` taken only on the enabled path; every other
// reference to `@fluidframework/id-compressor` in container-runtime is type-only. That isolation lets
// a bundler split this subgraph into its own lazy chunk and, more importantly, lets an application
// replace this module with a stub (see `idCompressorDelayLoadedModuleStub.ts`) so the id-compressor
// code is dropped entirely from single-file bundles that never enable it.

export {
	createIdCompressor,
	createSessionId,
	deserializeIdCompressor,
	toIdCompressorWithCore,
} from "@fluidframework/id-compressor/internal";
