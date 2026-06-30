/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import type { requireAssignableTo } from "@fluidframework/build-tools";

import type * as realModule from "../idCompressorDelayLoadedModule/index.js";
import type * as stubModule from "../idCompressorDelayLoadedModuleStub.js";

// Compile-time guarantee that the stub stays in sync with the real delay-loaded id-compressor module:
// the set of (value) exports must be identical in both directions. If the real module gains or loses
// a runtime export, these assertions fail until the stub is updated to match, preventing the
// NormalModuleReplacementPlugin swap from silently dropping or adding symbols at build time.
declare type _realKeysAreInStub = requireAssignableTo<
	keyof typeof realModule,
	keyof typeof stubModule
>;
declare type _stubKeysAreInReal = requireAssignableTo<
	keyof typeof stubModule,
	keyof typeof realModule
>;

describe("idCompressorDelayLoadedModuleStub", () => {
	it("exports match the real delay-loaded id-compressor module (checked at compile time)", () => {
		// The assertions above run at compile time; this test exists so the spec is discovered by mocha.
	});
});
