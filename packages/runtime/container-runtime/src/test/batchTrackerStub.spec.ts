/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { strict as assert } from "node:assert";

import { TypedEventEmitter } from "@fluid-internal/client-utils";
import type { requireAssignableTo } from "@fluidframework/build-tools";
import type { ITelemetryBaseLogger } from "@fluidframework/core-interfaces";

import * as real from "../batchTracker.js";
import * as stub from "../batchTrackerStub.js";

/*
 * Type tests asserting that `batchTrackerStub` stays in sync with the real module
 * (`./batchTracker.js`) it stands in for. The stub is swapped in (via webpack's
 * NormalModuleReplacementPlugin) in bundles that do not need batch-size telemetry. For that swap
 * to be safe the stub must export the same runtime (value) symbols, with a compatible
 * `BindBatchTracker` signature, as the real module. If the real module changes and the stub is
 * not updated, the assertions below fail to compile.
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
 * The `BindBatchTracker` signature `ContainerRuntime` calls must remain compatible.
 */
declare type _bind = requireAssignableTo<
	Parameters<typeof stub.BindBatchTracker>,
	Parameters<typeof real.BindBatchTracker>
>;

describe("batchTrackerStub", () => {
	const logger = undefined as unknown as ITelemetryBaseLogger;

	it("BindBatchTracker subscribes to nothing and has no functional effect", () => {
		const emitter = new TypedEventEmitter();
		const before = emitter.listenerCount("batchBegin") + emitter.listenerCount("batchEnd");
		stub.BindBatchTracker(emitter, logger, 1000, 1000);
		const after = emitter.listenerCount("batchBegin") + emitter.listenerCount("batchEnd");
		assert.equal(before, 0);
		assert.equal(after, 0);
	});
});
