/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

// Delay-loaded entry point for the client-side summarizer election / SummaryManager wiring.
//
// `SummaryManager`, `SummarizerClientElection` and `OrderedClientElection` exist so an interactive
// client can be elected to spawn a summarizer container. A client that summarizes server-side never
// needs this machinery, and (because the summarizer implementation itself is delay-loaded and may be
// stubbed out) electing such a client would be pointless. ContainerRuntime reaches this module
// exclusively through a dynamic `import()` taken only on the non-summarizer, election-eligible path;
// every other reference to these classes in container-runtime is type-only. That isolation lets an
// application replace this module with a no-op stub (see `summaryManagerDelayLoadedModuleStub.ts`) so
// the election/SummaryManager subgraph is dropped entirely from single-file bundles that do not use
// client-side summarization.

import type { ILoader, IDeltaManager } from "@fluidframework/container-definitions/internal";
import type { ITelemetryBaseLogger } from "@fluidframework/core-interfaces";
import type { IQuorumClients } from "@fluidframework/driver-definitions";
import { MessageType } from "@fluidframework/driver-definitions/internal";
import {
	createChildLogger,
	type ITelemetryLoggerExt,
} from "@fluidframework/telemetry-utils/internal";

import { Throttler, formExponentialFn } from "../../throttler.js";
import {
	OrderedClientCollection,
	OrderedClientElection,
	type ISerializedElection,
} from "../orderedClientElection.js";
import { SummarizerClientElection } from "../summarizerClientElection.js";
import type { SummaryCollection } from "../summaryCollection.js";
import { formCreateSummarizerFn } from "../summaryHelpers.js";
import { type IConnectedState, SummaryManager } from "../summaryManager.js";

/**
 * Inputs required to construct the client-side summarizer election and SummaryManager.
 */
export interface SummaryManagerSetupContext {
	readonly connectedState: IConnectedState;
	readonly summaryCollection: SummaryCollection;
	readonly parentLogger: ITelemetryBaseLogger;
	readonly telemetryLogger: ITelemetryLoggerExt;
	readonly deltaManager: Pick<IDeltaManager<unknown, unknown>, "lastSequenceNumber">;
	readonly quorum: Pick<IQuorumClients, "getMembers" | "on">;
	readonly electedSummarizerData: ISerializedElection | undefined;
	readonly enablePerformanceEvents: boolean | undefined;
	readonly maxOpsSinceLastSummary: number;
	readonly initialSummarizerDelayMs: number;
	readonly loader: ILoader;
}

/**
 * Result of {@link setupSummaryManager}. Fields are optional so the stub can return an empty result
 * (no election participation) without lying about its types.
 */
export interface SummaryManagerSetupResult {
	readonly summaryManager?: SummaryManager;
	readonly summarizerClientElection?: SummarizerClientElection;
}

/**
 * Construct and start the client-side summarizer election and SummaryManager. Forwards SummaryManager
 * lifecycle events through `forwardEvent`.
 */
export function setupSummaryManager(
	context: SummaryManagerSetupContext,
	forwardEvent: (eventName: string, ...args: unknown[]) => void,
): SummaryManagerSetupResult {
	const orderedClientLogger = createChildLogger({
		logger: context.parentLogger,
		namespace: "OrderedClientElection",
	});
	const orderedClientCollection = new OrderedClientCollection(
		orderedClientLogger,
		context.deltaManager,
		context.quorum,
	);
	const orderedClientElectionForSummarizer = new OrderedClientElection(
		orderedClientLogger,
		orderedClientCollection,
		context.electedSummarizerData ?? context.deltaManager.lastSequenceNumber,
		SummarizerClientElection.isClientEligible,
		context.enablePerformanceEvents,
	);

	const summarizerClientElection = new SummarizerClientElection(
		orderedClientLogger,
		context.summaryCollection,
		orderedClientElectionForSummarizer,
		context.maxOpsSinceLastSummary,
	);

	const { summaryCollection, telemetryLogger, maxOpsSinceLastSummary } = context;
	const defaultAction = (): void => {
		if (summaryCollection.opsSinceLastAck > maxOpsSinceLastSummary) {
			telemetryLogger.sendTelemetryEvent({
				eventName: "SummaryStatus:Behind",
				opsWithoutSummary: summaryCollection.opsSinceLastAck,
			});
			// unregister default to no log on every op after falling behind
			// and register summary ack handler to re-register this handler
			// after successful summary
			summaryCollection.once(MessageType.SummaryAck, () => {
				telemetryLogger.sendTelemetryEvent({
					eventName: "SummaryStatus:CaughtUp",
				});
				// we've caught up, so re-register the default action to monitor for
				// falling behind, and unregister ourself
				summaryCollection.on("default", defaultAction);
			});
			summaryCollection.off("default", defaultAction);
		}
	};

	summaryCollection.on("default", defaultAction);

	// Create the SummaryManager and mark the initial state
	const summaryManager = new SummaryManager(
		summarizerClientElection,
		context.connectedState,
		summaryCollection,
		context.parentLogger,
		formCreateSummarizerFn(context.loader),
		new Throttler(
			60 * 1000, // 60 sec delay window
			30 * 1000, // 30 sec max delay
			// throttling function increases exponentially (0ms, 40ms, 80ms, 160ms, etc)
			formExponentialFn({ coefficient: 20, initialDelay: 0 }),
		),
		{
			initialDelayMs: context.initialSummarizerDelayMs,
		},
	);

	// Forward events from SummaryManager
	for (const eventName of [
		"summarize",
		"summarizeAllAttemptsFailed",
		"summarizerStop",
		"summarizerStart",
		"summarizerStartupFailed",
		"summarizeTimeout",
	] as const) {
		summaryManager.on(eventName, (...args: unknown[]) => {
			forwardEvent(eventName, ...args);
		});
	}

	summaryManager.start();

	return { summaryManager, summarizerClientElection };
}
