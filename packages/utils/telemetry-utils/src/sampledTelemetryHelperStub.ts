/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import type { IDisposable, ITelemetryBaseProperties } from "@fluidframework/core-interfaces";

// Type-only re-exports keep the stub's type surface identical to the real module without
// creating a runtime import edge back to it.
import type {
	CustomMetrics,
	MeasureReturnType,
} from "./sampledTelemetryHelper.js";
import type {
	ITelemetryGenericEventExt,
	TelemetryLoggerExt,
} from "./telemetryTypesUndeprecated.js";

export type {
	CustomMetrics,
	ICustomData,
	MeasureReturnType,
} from "./sampledTelemetryHelper.js";

/**
 * Build-time stub replacement for `sampledTelemetryHelper.ts`.
 *
 * The real `SampledTelemetryHelper.measure(codeToMeasure)` executes `codeToMeasure()` and
 * returns its result, and additionally records execution-time samples and periodically emits a
 * performance telemetry event. The measured code — not the helper — carries all functional
 * behavior, so a **passthrough** stub that simply invokes and returns `codeToMeasure()`
 * preserves runtime behavior exactly while dropping all sampling/aggregation/logging code.
 *
 * A consumer that does not need op-processing / callback duration telemetry can replace the
 * module with this stub via `NormalModuleReplacementPlugin` to drop the code from a
 * single-chunk bundle.
 *
 * @remarks Keep the value-export surface (`SampledTelemetryHelper`) and the `measure` / `dispose`
 * signatures in sync with the real module; a compile-time drift test enforces this.
 *
 * @internal
 */
export class SampledTelemetryHelper<
	TMeasureReturn = void,
	TCustomMetrics extends CustomMetrics<TCustomMetrics> = void,
> implements IDisposable
{
	private _disposed: boolean = false;

	public get disposed(): boolean {
		return this._disposed;
	}

	public constructor(
		eventBase: ITelemetryGenericEventExt,
		logger: TelemetryLoggerExt,
		sampleThreshold: number,
		includeAggregateMetrics: boolean = false,
		perBucketProperties = new Map<string, ITelemetryBaseProperties>(),
	) {}

	public measure(
		codeToMeasure: () => MeasureReturnType<TMeasureReturn, TCustomMetrics>,
		bucket: string = "",
	): MeasureReturnType<TMeasureReturn, TCustomMetrics> {
		return codeToMeasure();
	}

	public dispose(error?: Error | undefined): void {
		this._disposed = true;
	}
}
