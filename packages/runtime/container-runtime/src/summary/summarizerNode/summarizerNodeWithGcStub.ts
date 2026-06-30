/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import type { ITelemetryBaseLogger } from "@fluidframework/core-interfaces";
import type {
	ISequencedDocumentMessage,
	ISnapshotTree,
} from "@fluidframework/driver-definitions/internal";
import type {
	CreateChildSummarizerNodeParam,
	IGarbageCollectionData,
	IGarbageCollectionDetailsBase,
	ISummarizeResult,
	ISummarizerNodeConfigWithGC,
	ITelemetryContext,
	SummarizeInternalFn,
} from "@fluidframework/runtime-definitions/internal";
import type { ITelemetryLoggerExt } from "@fluidframework/telemetry-utils/internal";

import type {
	IRefreshSummaryResult,
	IStartSummaryResult,
	ValidateSummaryResult,
} from "./summarizerNodeUtils.js";
import type { IRootSummarizerNodeWithGC } from "./summarizerNodeWithGc.js";

/**
 * A no-op {@link IRootSummarizerNodeWithGC} used to exclude the summarizer-node tracking implementation
 * (`summarizerNode.ts` + `summarizerNodeWithGc.ts`) from a bundle.
 *
 * The summarizer-node tree tracks per-node summary/GC state so the summarizer client can produce
 * incremental summaries. A client that summarizes **server-side** (the summarizer is already stubbed
 * out) never generates a summary, and with garbage collection disabled the node's reference / used-route
 * tracking is moot. Consuming applications in that configuration can swap the real
 * `summarizerNodeWithGc.js` module for this stub at build time (e.g. via webpack
 * `NormalModuleReplacementPlugin`), which also drops the base `summarizerNode.js` it depends on.
 *
 * Behavior of the stub:
 *
 * - Methods that run on **every** client (the datastore/channel lifecycle and op hot path) are faithful:
 * `createChild`/`getChild`/`deleteChild` maintain a real child map, and `recordChange` / `invalidate` /
 * `updateUsedRoutes` / `updateBaseSummaryState` are no-ops (they only affect summary state this client
 * never produces). `isReferenced` returns `true` (nothing is GC-unreferenced when GC is disabled).
 * - Methods only reached on the **summarizer** client or via GC (`summarize`, `getGCData`, and the root
 * contract `startSummary` / `validateSummary` / `completeSummary` / `clearSummary` /
 * `refreshLatestSummary`) throw, failing fast if the precondition is ever violated.
 */
class StubSummarizerNodeWithGC implements IRootSummarizerNodeWithGC {
	private readonly children = new Map<string, StubSummarizerNodeWithGC>();

	public readonly referenceSequenceNumber: number = 0;

	// --- Every-client lifecycle / op-hot-path methods: faithful no-ops ---

	public createChild(
		summarizeInternalFn: SummarizeInternalFn,
		id: string,
		createParam: CreateChildSummarizerNodeParam,
		config?: ISummarizerNodeConfigWithGC,
		getGCDataFn?: (fullGC?: boolean) => Promise<IGarbageCollectionData>,
		getBaseGCDetailsFn?: () => Promise<IGarbageCollectionDetailsBase>,
	): IRootSummarizerNodeWithGC {
		let child = this.children.get(id);
		if (child === undefined) {
			child = new StubSummarizerNodeWithGC();
			this.children.set(id, child);
		}
		return child;
	}

	public getChild(id: string): IRootSummarizerNodeWithGC | undefined {
		return this.children.get(id);
	}

	public deleteChild(id: string): void {
		this.children.delete(id);
	}

	public invalidate(sequenceNumber: number): void {}

	public recordChange(op: ISequencedDocumentMessage): void {}

	public updateBaseSummaryState(snapshot: ISnapshotTree): void {}

	public updateUsedRoutes(usedRoutes: string[]): void {}

	public isReferenced(): boolean {
		return true;
	}

	public isSummaryInProgress(): boolean {
		return false;
	}

	// --- Summarizer-only / GC methods: never reached on this client; fail fast ---

	public async summarize(
		fullTree: boolean,
		trackState?: boolean,
		telemetryContext?: ITelemetryContext,
	): Promise<ISummarizeResult> {
		throw new Error("summarizerNode stub: summarize is not supported (client summarizes server-side)");
	}

	public async getGCData(fullGC?: boolean): Promise<IGarbageCollectionData> {
		throw new Error("summarizerNode stub: getGCData is not supported (GC disabled)");
	}

	public startSummary(
		referenceSequenceNumber: number,
		summaryLogger: ITelemetryLoggerExt,
		latestSummaryRefSeqNum: number,
	): IStartSummaryResult {
		throw new Error("summarizerNode stub: startSummary is not supported (client summarizes server-side)");
	}

	public validateSummary(): ValidateSummaryResult {
		throw new Error("summarizerNode stub: validateSummary is not supported (client summarizes server-side)");
	}

	public completeSummary(proposalHandle: string): void {
		throw new Error("summarizerNode stub: completeSummary is not supported (client summarizes server-side)");
	}

	public clearSummary(): void {}

	public async refreshLatestSummary(
		proposalHandle: string,
		summaryRefSeq: number,
	): Promise<IRefreshSummaryResult> {
		throw new Error(
			"summarizerNode stub: refreshLatestSummary is not supported (client summarizes server-side)",
		);
	}
}

/**
 * Stub mirror of the real `SummarizerNodeWithGC` class, exported only to keep the stub's value exports in
 * sync with the module it replaces. Consumers depend on the `ISummarizerNodeWithGC` interface, not this class.
 */
export class SummarizerNodeWithGC extends StubSummarizerNodeWithGC {}

/**
 * Stub mirror of {@link createRootSummarizerNodeWithGC} that returns a no-op root node.
 */
export const createRootSummarizerNodeWithGC = (
	logger: ITelemetryBaseLogger,
	summarizeInternalFn: SummarizeInternalFn,
	changeSequenceNumber: number,
	referenceSequenceNumber: number | undefined,
	config: ISummarizerNodeConfigWithGC = {},
	getGCDataFn?: (fullGC?: boolean) => Promise<IGarbageCollectionData>,
	getBaseGCDetailsFn?: () => Promise<IGarbageCollectionDetailsBase>,
): IRootSummarizerNodeWithGC => new StubSummarizerNodeWithGC();
