/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import type {
	IGarbageCollectionDetailsBase,
	ISummarizeResult,
	ITelemetryContext,
} from "@fluidframework/runtime-definitions/internal";
import type { ITelemetryLoggerExt } from "@fluidframework/telemetry-utils/internal";

import type { IRefreshSummaryResult } from "../summary/index.js";

import type {
	GarbageCollectionMessage,
	IGCMetadata,
	IGCNodeUpdatedProps,
	IGCStats,
	IGarbageCollector,
	IGarbageCollectorCreateParams,
} from "./gcDefinitions.js";

/**
 * A no-op {@link IGarbageCollector} used to exclude the garbage collection implementation from a bundle.
 *
 * Consuming applications that do not rely on GC sweep / tombstone deletion enforcement can swap the real
 * `garbageCollection.js` module for this stub at build time (e.g. via webpack `NormalModuleReplacementPlugin`).
 * Doing so removes `GarbageCollector` and its exclusive dependencies (gc telemetry, the unreferenced-state and
 * summary-state trackers, the reference-graph algorithm, and gc configs) from the bundle.
 *
 * Behavior of the stub:
 *
 * - `shouldRunGC` is `false`, so the runtime never invokes garbage collection.
 * - `isNodeDeleted` always returns `false`, so no node is ever treated as swept/tombstoned. This is the
 * key precondition: the consuming app must not rely on GC deletion enforcement.
 * - Reference-tracking and message-processing entry points are no-ops.
 * - Summary / metadata accessors return valid-empty results, signalling "GC disabled".
 *
 * The public surface mirrors the real {@link GarbageCollector} (a class with a static `create`) so the swap
 * is signature-compatible. A type test in the spec file guards against drift.
 */
export class GarbageCollector implements IGarbageCollector {
	public static create(
		createParams: IGarbageCollectorCreateParams,
	): IGarbageCollector {
		return new GarbageCollector();
	}

	public readonly serializedConfigs: string = "{}";
	public readonly sessionExpiryTimerStarted: number | undefined = undefined;
	public readonly shouldRunGC: boolean = false;
	public readonly updatedDSCountSinceLastSummary: number = 0;

	public async initializeBaseState(): Promise<void> {}

	public async collectGarbage(
		options: {
			logger?: ITelemetryLoggerExt;
			runSweep?: boolean;
			fullGC?: boolean;
		},
		telemetryContext?: ITelemetryContext,
	): Promise<IGCStats | undefined> {
		return undefined;
	}

	public summarize(
		fullTree: boolean,
		trackState: boolean,
		telemetryContext?: ITelemetryContext,
	): ISummarizeResult | undefined {
		return undefined;
	}

	public getMetadata(): IGCMetadata {
		return {};
	}

	public async getBaseGCDetails(): Promise<IGarbageCollectionDetailsBase> {
		return {};
	}

	public async refreshLatestSummary(result: IRefreshSummaryResult): Promise<void> {}

	public nodeUpdated(props: IGCNodeUpdatedProps): void {}

	public addedOutboundReference(
		fromNodePath: string,
		toNodePath: string,
		timestampMs: number,
		autorecovery?: true,
	): void {}

	public processMessages(
		messageContents: GarbageCollectionMessage[],
		messageTimestampMs: number,
		local: boolean,
	): void {}

	public isNodeDeleted(nodePath: string): boolean {
		return false;
	}

	public setConnectionState(canSendOps: boolean, clientId?: string): void {}

	public dispose(): void {}
}
