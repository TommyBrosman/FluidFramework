/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { strict as assert } from "node:assert";

import type { requireAssignableTo } from "@fluidframework/build-tools";

import * as real from "../../mapFactory.js";
import * as stub from "../../mapFactoryStub.js";

/*
 * Type tests asserting that `mapFactoryStub` stays in sync with the real SharedMap factory module
 * (`./mapFactory.js`) it stands in for. The stub is swapped in (via webpack's
 * NormalModuleReplacementPlugin) in bundles that never create a SharedMap or load a legacy
 * SharedMap-rooted document, so the SharedMap implementation (`./map.js` + `./mapKernel.js`) can be
 * tree-shaken away. For that swap to be safe the stub must export the same runtime (value) symbols, with
 * compatible signatures, as the real module. If the real module changes and the stub is not updated, the
 * assertions below fail to compile.
 */

/**
 * Every runtime export of the real module must also be exported by the stub (and vice versa).
 */
declare type _stubExportsAllRealValueSymbols = requireAssignableTo<
	keyof typeof real,
	keyof typeof stub
>;
declare type _stubExportsNothingExtra = requireAssignableTo<
	keyof typeof stub,
	keyof typeof real
>;

/**
 * The `MapFactory` class the aqueduct registration constructs must remain signature-compatible.
 */
declare type _factoryCtor = requireAssignableTo<
	typeof stub.MapFactory,
	typeof real.MapFactory
>;

/**
 * The `SharedMap` shared-object kind (whose `getFactory()` the registration calls) must stay compatible.
 */
declare type _sharedMapKind = requireAssignableTo<typeof stub.SharedMap, typeof real.SharedMap>;

describe("mapFactoryStub", () => {
	it("reproduces the real factory Type and Attributes verbatim", () => {
		assert.equal(stub.MapFactory.Type, real.MapFactory.Type);
		assert.deepEqual(stub.MapFactory.Attributes, real.MapFactory.Attributes);
	});

	it("keeps the factory registration path faithful (type / attributes / getFactory)", () => {
		const factory = stub.SharedMap.getFactory();
		assert.equal(factory.type, real.MapFactory.Type);
		assert.deepEqual(factory.attributes, real.MapFactory.Attributes);
		assert.ok(factory instanceof stub.MapFactory);
	});

	it("throws on create (SharedMap implementation is not bundled)", () => {
		const factory = new stub.MapFactory();
		assert.throws(
			() =>
				factory.create(
					undefined as unknown as Parameters<typeof factory.create>[0],
					"id",
				),
			/SharedMap is not available/,
		);
	});

	it("throws on load (SharedMap implementation is not bundled)", async () => {
		const factory = new stub.MapFactory();
		await assert.rejects(
			factory.load(
				undefined as unknown as Parameters<typeof factory.load>[0],
				"id",
				undefined as unknown as Parameters<typeof factory.load>[2],
				stub.MapFactory.Attributes,
			),
			/SharedMap is not available/,
		);
	});
});
