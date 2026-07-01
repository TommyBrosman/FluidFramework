/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import type { EventEmitter } from "@fluid-internal/client-utils";
import type { ITelemetryBaseLogger } from "@fluidframework/core-interfaces";

/**
 * Build-time stub replacement for `batchTracker.ts`.
 *
 * The real `BatchTracker` subscribes to `batchBegin`/`batchEnd` and emits batch-size /
 * batch-duration performance telemetry. It has **no** functional effect on op processing or
 * runtime state — it only calls `logger.sendPerformanceEvent`. A consumer that does not need
 * this observability can replace the module with this no-op stub via
 * `NormalModuleReplacementPlugin` to drop the code from a single-chunk bundle.
 *
 * @remarks Keep the value-export surface (`BatchTracker`, `BindBatchTracker`) in sync with the
 * real module; a compile-time drift test enforces this.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- value-export parity with the real BatchTracker
export class BatchTracker {
	public constructor(
		batchEventEmitter: EventEmitter,
		logger: ITelemetryBaseLogger,
		batchLengthThreshold: number,
		batchCountSamplingRate: number,
		dateTimeProvider: () => number = () => 0,
	) {}
}

/**
 * No-op replacement for the real `BindBatchTracker`. Constructs (and discards) a stub
 * `BatchTracker`; subscribes to nothing.
 */
export const BindBatchTracker = (
	batchEventEmitter: EventEmitter,
	logger: ITelemetryBaseLogger,
	batchLengthThreshold: number = 1000,
	batchCountSamplingRate: number = 1000,
): BatchTracker =>
	new BatchTracker(batchEventEmitter, logger, batchLengthThreshold, batchCountSamplingRate);
