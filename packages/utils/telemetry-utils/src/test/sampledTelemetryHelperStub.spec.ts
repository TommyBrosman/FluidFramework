/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { strict as assert } from "node:assert";

import type { requireAssignableTo } from "@fluidframework/build-tools";

import * as real from "../sampledTelemetryHelper.js";
import * as stub from "../sampledTelemetryHelperStub.js";
import type { TelemetryLoggerExt, ITelemetryGenericEventExt } from "../telemetryTypesUndeprecated.js";

/*
 * Type tests asserting that `sampledTelemetryHelperStub` stays in sync with the real module
 * (`./sampledTelemetryHelper.js`) it stands in for. The stub is swapped in (via webpack's
 * NormalModuleReplacementPlugin) in bundles that do not need op-processing / callback duration
 * telemetry. For that swap to be safe the stub must export the same runtime (value) symbols, with
 * a compatible constructor and `measure` signature, as the real module. If the real module changes
 * and the stub is not updated, the assertions below fail to compile.
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
 * The constructor and `measure` signature callers rely on must remain compatible.
 */
declare type _ctor = requireAssignableTo<
	ConstructorParameters<typeof stub.SampledTelemetryHelper>,
	ConstructorParameters<typeof real.SampledTelemetryHelper>
>;

describe("sampledTelemetryHelperStub", () => {
	const eventBase = { eventName: "test" } as unknown as ITelemetryGenericEventExt;
	const logger = undefined as unknown as TelemetryLoggerExt;

	it("measure executes the code block and returns its value (passthrough)", () => {
		const helper = new stub.SampledTelemetryHelper<number>(eventBase, logger, 1);
		let ran = 0;
		const result = helper.measure(() => {
			ran++;
			return 42;
		});
		assert.equal(ran, 1);
		assert.equal(result, 42);
		helper.dispose();
		assert.equal(helper.disposed, true);
	});

	it("measure runs the callback every call (no sampling suppression)", () => {
		const helper = new stub.SampledTelemetryHelper<void>(eventBase, logger, 1000);
		let ran = 0;
		for (let i = 0; i < 5; i++) {
			helper.measure(() => {
				ran++;
			});
		}
		assert.equal(ran, 5);
	});
});
