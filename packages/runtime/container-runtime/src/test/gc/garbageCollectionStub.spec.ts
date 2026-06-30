/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { strict as assert } from "node:assert";

import type { requireAssignableTo } from "@fluidframework/build-tools";

// eslint-disable-next-line import-x/no-internal-modules -- import the real module the stub stands in for
import * as real from "../../gc/garbageCollection.js";
// eslint-disable-next-line import-x/no-internal-modules -- the stub is imported directly under test
import * as stub from "../../gc/garbageCollectionStub.js";

/*
 * Type tests asserting that `garbageCollectionStub` stays in sync with the real GarbageCollector module
 * (`./gc/garbageCollection.js`) it stands in for. The stub is swapped in (via webpack's
 * NormalModuleReplacementPlugin) in bundles that do not rely on GC sweep / tombstone enforcement; for that
 * swap to be safe the stub must export the same runtime (value) symbols, with compatible signatures, as the
 * real module. If the real module changes and the stub is not updated, the assertions below fail to compile.
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
 * The static factory the container-runtime uses must remain signature-compatible.
 */
declare type _create = requireAssignableTo<
	typeof stub.GarbageCollector.create,
	typeof real.GarbageCollector.create
>;

/**
 * The instances must satisfy the `IGarbageCollector` interface the container-runtime depends on. (Full
 * instance assignability between stub and real cannot be asserted because the real class has private
 * members; both sides independently implement `IGarbageCollector`, which is what the consumer uses.)
 */
declare type _stubIsGarbageCollector = requireAssignableTo<
	ReturnType<typeof stub.GarbageCollector.create>,
	ReturnType<typeof real.GarbageCollector.create>
>;

describe("garbageCollectionStub", () => {
	it("does not run GC and never reports deleted nodes", () => {
		const gc = stub.GarbageCollector.create(
			undefined as unknown as Parameters<typeof stub.GarbageCollector.create>[0],
		);
		assert.equal(gc.shouldRunGC, false);
		assert.equal(gc.isNodeDeleted("/some/path"), false);
		assert.equal(gc.updatedDSCountSinceLastSummary, 0);
		assert.equal(gc.sessionExpiryTimerStarted, undefined);
	});

	it("returns valid-empty summary/metadata results (GC disabled)", async () => {
		const gc = stub.GarbageCollector.create(
			undefined as unknown as Parameters<typeof stub.GarbageCollector.create>[0],
		);
		assert.equal(gc.summarize(true, false), undefined);
		assert.equal(await gc.collectGarbage({}), undefined);
		// gcFeature undefined => GC disabled per IGCMetadata contract.
		assert.equal(gc.getMetadata().gcFeature, undefined);
		assert.deepEqual(await gc.getBaseGCDetails(), {});
	});
});
