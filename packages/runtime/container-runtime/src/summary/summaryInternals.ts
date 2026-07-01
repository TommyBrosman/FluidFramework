/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { Trace } from "@fluid-internal/client-utils";
import type { IContainerStorageService, IDeltaManager } from "@fluidframework/container-definitions/internal";
import { assert, delay } from "@fluidframework/core-utils/internal";
import { SummaryType } from "@fluidframework/driver-definitions";
import {
	FetchSource,
	type IDocumentMessage,
	type ISequencedDocumentMessage,
	type ISnapshotTree,
	type ISummaryContent,
	type ISummaryContext,
	type SummaryObject,
} from "@fluidframework/driver-definitions/internal";
import {
	channelsTreeName,
	gcTreeKey,
	type ISummarizeInternalResult,
	type ISummaryTreeWithStats,
	type ITelemetryContext,
} from "@fluidframework/runtime-definitions/internal";
import {
	TelemetryContext,
	calculateStats,
	seqFromTree,
} from "@fluidframework/runtime-utils/internal";
import {
	DataProcessingError,
	PerformanceEvent,
	type ITelemetryLoggerExt,
	type MonitoringContext,
	createChildLogger,
	wrapError,
} from "@fluidframework/telemetry-utils/internal";

import type { ChannelCollection } from "../channelCollection.js";
import type { BaseDeltaManagerProxy } from "../deltaManagerProxies.js";
import type { IGarbageCollector } from "../gc/index.js";
import type { Outbox } from "../opLifecycle/index.js";

import type { IRootSummarizerNodeWithGC } from "./summarizerNode/index.js";
import type {
	IBaseSummarizeResult,
	IGenerateSummaryTreeResult,
	IGeneratedSummaryStats,
	IRefreshSummaryAckOptions,
	ISubmitSummaryOptions,
	SubmitSummaryResult,
} from "./summarizerTypes.js";
import { RetriableSummaryError } from "./summarizerUtils.js";
import {
	defaultPendingOpsRetryDelayMs,
	defaultPendingOpsWaitTimeoutMs,
} from "./summaryConstants.js";
import type { Summarizer } from "./summaryDelayLoadedModule/index.js";
import { wrapSummaryInChannelsTree, type ISummaryMetadataMessage } from "./summaryFormat.js";

/**
 * Options for {@link ISummaryInternalsHost.collectGarbage}.
 */
interface ICollectGarbageOptions {
	logger?: ITelemetryLoggerExt;
	runSweep?: boolean;
	fullGC?: boolean;
}

/**
 * Structural view of {@link ContainerRuntime} used by the summary-generation ("summary write")
 * functions in this module.
 *
 * These functions implement the summary-write path (`submitSummary` /`refreshLatestSummaryAck` and
 * their helpers). That path only runs on a client that summarizes client-side; a client that
 * summarizes server-side never reaches it (its {@link Summarizer} is delay-loaded and stubbed). By
 * hosting the (large) implementation here rather than as prototype methods on the always-loaded
 * `ContainerRuntime` class, bundles for non-summarizing clients can replace this module with a
 * throwing stub and drop the code entirely.
 *
 * `ContainerRuntime` passes itself (cast through this interface) as the host, so property reads and
 * writes (e.g. `lastAckedSummaryContext`) operate directly on the runtime instance.
 */
export interface ISummaryInternalsHost {
	readonly channelCollection: ChannelCollection;
	readonly garbageCollector: IGarbageCollector;
	readonly summarizerNode: IRootSummarizerNodeWithGC;
	readonly mc: MonitoringContext;
	readonly deltaManager: IDeltaManager<ISequencedDocumentMessage, IDocumentMessage>;
	readonly _deltaManager: BaseDeltaManagerProxy;
	readonly outbox: Outbox;
	readonly storage: IContainerStorageService;
	readonly pendingMessagesCount: number;
	readonly nextSummaryNumber: number;
	readonly isDirty: boolean;
	readonly connected: boolean;
	readonly loadedFromVersionId: string | undefined;
	readonly isSnapshotInstanceOfISnapshot: boolean;
	readonly closeSummarizerDelayMs: number;
	readonly _summarizer?: Summarizer;
	lastAckedSummaryContext: ISummaryContext | undefined;
	messageAtLastSummary: ISummaryMetadataMessage | undefined;
	readonly readAndParseBlob: <T>(id: string) => Promise<T>;
	readonly disposeFn: (error?: unknown) => void;
	once(event: string, listener: () => void): unknown;
	verifyNotClosed(): void;
	loadIdCompressor(): void;
	submitSummaryMessage(contents: ISummaryContent, referenceSequenceNumber: number): number;
	collectGarbage(
		options: ICollectGarbageOptions,
		telemetryContext?: ITelemetryContext,
	): Promise<unknown>;
	addContainerStateToSummary(
		summaryTree: ISummaryTreeWithStats,
		fullTree: boolean,
		trackState: boolean,
		telemetryContext?: ITelemetryContext,
	): void;
	summarize(options: {
		fullTree?: boolean;
		trackState?: boolean;
		summaryLogger?: ITelemetryLoggerExt;
		runGC?: boolean;
		fullGC?: boolean;
		runSweep?: boolean;
		telemetryContext?: TelemetryContext;
	}): Promise<ISummaryTreeWithStats>;
}

export async function summarizeInternalCore(
	host: ISummaryInternalsHost,
	fullTree: boolean,
	trackState: boolean,
	telemetryContext?: ITelemetryContext,
): Promise<ISummarizeInternalResult> {
		const summarizeResult = await host.channelCollection.summarize(
			fullTree,
			trackState,
			telemetryContext,
		);

		// Wrap data store summaries in .channels subtree.
		wrapSummaryInChannelsTree(summarizeResult);
		const pathPartsForChildren = [channelsTreeName];

		host.loadIdCompressor();

		host.addContainerStateToSummary(summarizeResult, fullTree, trackState, telemetryContext);
		return {
			...summarizeResult,
			id: "",
			pathPartsForChildren,
		};
	
}

export async function summarizeCore(
	host: ISummaryInternalsHost,
	options: {
		/**
		 * True to generate the full tree with no handle reuse optimizations; defaults to false
		 */
		fullTree?: boolean;
		/**
		 * True to track the state for this summary in the SummarizerNodes; defaults to true
		 */
		trackState?: boolean;
		/**
		 * Logger to use for correlated summary events
		 */
		summaryLogger?: ITelemetryLoggerExt;
		/**
		 * True to run garbage collection before summarizing; defaults to true
		 */
		runGC?: boolean;
		/**
		 * True to generate full GC data
		 */
		fullGC?: boolean;
		/**
		 * True to run GC sweep phase after the mark phase
		 */
		runSweep?: boolean;
		/**
		 * Telemetry context to populate during summarization.
		 */
		telemetryContext?: TelemetryContext;
	},
): Promise<ISummaryTreeWithStats> {
		host.verifyNotClosed();

		const {
			fullTree = false,
			trackState = true,
			summaryLogger = host.mc.logger,
			runGC = host.garbageCollector.shouldRunGC,
			runSweep,
			fullGC,
			telemetryContext = new TelemetryContext(),
		} = options;

		// Add the options that are used to generate this summary to the telemetry context.
		telemetryContext.setMultiple("fluid_Summarize", "Options", {
			fullTree,
			trackState,
			runGC,
			fullGC,
			runSweep,
		});

		try {
			if (runGC) {
				await host.collectGarbage(
					{ logger: summaryLogger, runSweep, fullGC },
					telemetryContext,
				);
			}

			const { stats, summary } = await host.summarizerNode.summarize(
				fullTree,
				trackState,
				telemetryContext,
			);

			assert(
				summary.type === SummaryType.Tree,
				0x12f /* "Container Runtime's summarize should always return a tree" */,
			);

			return { stats, summary };
		} finally {
			summaryLogger.sendTelemetryEvent({
				eventName: "SummarizeTelemetry",
				details: telemetryContext.serialize(),
			});
		}
	
}

export async function submitSummaryCore(
	host: ISummaryInternalsHost,
	options: ISubmitSummaryOptions,
): Promise<SubmitSummaryResult> {
		const {
			cancellationToken,
			fullTree = false,
			finalAttempt = false,
			summaryLogger,
			latestSummaryRefSeqNum,
			telemetryContext = new TelemetryContext(),
		} = options;
		// The summary number for this summary. This will be updated during the summary process, so get it now and
		// use it for all events logged during this summary.
		const summaryNumber = host.nextSummaryNumber;
		let summaryRefSeqNum: number | undefined;
		const summaryNumberLogger = createChildLogger({
			logger: summaryLogger,
			properties: {
				all: {
					summaryNumber,
					referenceSequenceNumber: () => summaryRefSeqNum,
				},
			},
		});

		// legacy: assert 0x3d1
		if (!host.outbox.isEmpty) {
			throw DataProcessingError.create(
				"Can't trigger summary in the middle of a batch",
				"submitSummary",
				undefined,
				{
					summaryNumber,
					pendingMessages: host.pendingMessagesCount,
					outboxLength: host.outbox.messageCount,
					mainBatchLength: host.outbox.mainBatchMessageCount,
					blobAttachBatchLength: host.outbox.blobAttachBatchMessageCount,
				},
			);
		}

		// If the container is dirty, i.e., there are pending unacked ops, the summary will not be eventual consistent
		// and it may even be incorrect. So, wait for the container to be saved with a timeout. If the container is not
		// saved within the timeout, check if it should be failed or can continue.
		if (host.isDirty) {
			const countBefore = host.pendingMessagesCount;
			// The timeout for waiting for pending ops can be overridden via configurations.
			const pendingOpsTimeout =
				host.mc.config.getNumber("Fluid.Summarizer.waitForPendingOpsTimeoutMs") ??
				defaultPendingOpsWaitTimeoutMs;
			await new Promise<void>((resolve, reject) => {
				const timeoutId = setTimeout(() => resolve(), pendingOpsTimeout);
				host.once("saved", () => {
					clearTimeout(timeoutId);
					resolve();
				});
				host.once("dispose", () => {
					clearTimeout(timeoutId);
					reject(new Error("Runtime is disposed while summarizing"));
				});
			});

			// Log that there are pending ops while summarizing. This will help us gather data on how often this
			// happens, whether we attempted to wait for these ops to be acked and what was the result.
			summaryNumberLogger.sendTelemetryEvent({
				eventName: "PendingOpsWhileSummarizing",
				saved: !host.isDirty,
				timeout: pendingOpsTimeout,
				countBefore,
				countAfter: host.pendingMessagesCount,
			});

			// There could still be pending ops. Check if summary should fail or continue.
			const pendingMessagesFailResult = await shouldFailSummaryOnPendingOpsCore(host, 
				summaryNumberLogger,
				host.deltaManager.lastSequenceNumber,
				host.deltaManager.minimumSequenceNumber,
				finalAttempt,
				true /* beforeSummaryGeneration */,
			);
			if (pendingMessagesFailResult !== undefined) {
				return pendingMessagesFailResult;
			}
		}

		const shouldPauseInboundSignal =
			host.mc.config.getBoolean(
				"Fluid.ContainerRuntime.SubmitSummary.disableInboundSignalPause",
			) !== true;
		const shouldValidatePreSummaryState =
			host.mc.config.getBoolean(
				"Fluid.ContainerRuntime.SubmitSummary.shouldValidatePreSummaryState",
			) === true;

		try {
			await host._deltaManager.inbound.pause();
			if (shouldPauseInboundSignal) {
				await host.deltaManager.inboundSignal.pause();
			}

			summaryRefSeqNum = host.deltaManager.lastSequenceNumber;
			const minimumSequenceNumber = host.deltaManager.minimumSequenceNumber;
			const message = `Summary @${summaryRefSeqNum}:${host.deltaManager.minimumSequenceNumber}`;
			const lastAckedContext = host.lastAckedSummaryContext;

			const startSummaryResult = host.summarizerNode.startSummary(
				summaryRefSeqNum,
				summaryNumberLogger,
				latestSummaryRefSeqNum,
			);

			/**
			 * This was added to validate that the summarizer node tree has the same reference sequence number from the
			 * top running summarizer down to the lowest summarizer node.
			 *
			 * The order of mismatch numbers goes (validate sequence number)-(node sequence number).
			 * Generally the validate sequence number comes from the running summarizer and the node sequence number comes from the
			 * summarizer nodes.
			 */
			if (startSummaryResult.invalidNodes > 0 || startSummaryResult.mismatchNumbers.size > 0) {
				summaryLogger.sendTelemetryEvent({
					eventName: "LatestSummaryRefSeqNumMismatch",
					details: {
						...startSummaryResult,
						mismatchNumbers: [...startSummaryResult.mismatchNumbers],
					},
				});

				if (shouldValidatePreSummaryState && !finalAttempt) {
					return {
						stage: "base",
						referenceSequenceNumber: summaryRefSeqNum,
						minimumSequenceNumber,
						error: new RetriableSummaryError(
							`Summarizer node state inconsistent with summarizer state.`,
						),
					};
				}
			}

			// Helper function to check whether we should still continue between each async step.
			const checkContinue = (): { continue: true } | { continue: false; error: string } => {
				// Do not check for loss of connectivity directly! Instead leave it up to
				// RunWhileConnectedCoordinator to control policy in a single place.
				// This will allow easier change of design if we chose to. For example, we may chose to allow
				// summarizer to reconnect in the future.
				// Also checking for cancellation is a must as summary process may be abandoned for other reasons,
				// like loss of connectivity for main (interactive) client.
				if (cancellationToken.cancelled) {
					return { continue: false, error: "disconnected" };
				}
				// That said, we rely on submitSystemMessage() that today only works in connected state.
				// So if we fail here, it either means that RunWhileConnectedCoordinator does not work correctly,
				// OR that design changed and we need to remove this check and fix submitSystemMessage.
				assert(host.connected, 0x258 /* "connected" */);

				// Ensure that lastSequenceNumber has not changed after pausing.
				// We need the summary op's reference sequence number to match our summary sequence number,
				// otherwise we'll get the wrong sequence number stamped on the summary's .protocol attributes.
				if (host.deltaManager.lastSequenceNumber !== summaryRefSeqNum) {
					return {
						continue: false,
						error: `lastSequenceNumber changed before uploading to storage. ${host.deltaManager.lastSequenceNumber} !== ${summaryRefSeqNum}`,
					};
				}
				assert(
					summaryRefSeqNum === host.deltaManager.lastMessage?.sequenceNumber,
					0x395 /* it's one and the same thing */,
				);

				if (lastAckedContext !== host.lastAckedSummaryContext) {
					return {
						continue: false,
						// eslint-disable-next-line @typescript-eslint/no-base-to-string
						error: `Last summary changed while summarizing. ${host.lastAckedSummaryContext} !== ${lastAckedContext}`,
					};
				}
				return { continue: true };
			};

			let continueResult = checkContinue();
			if (!continueResult.continue) {
				return {
					stage: "base",
					referenceSequenceNumber: summaryRefSeqNum,
					minimumSequenceNumber,
					error: new RetriableSummaryError(continueResult.error),
				};
			}

			const trace = Trace.start();
			let summarizeResult: ISummaryTreeWithStats;
			try {
				summarizeResult = await host.summarize({
					fullTree,
					trackState: true,
					summaryLogger: summaryNumberLogger,
					runGC: host.garbageCollector.shouldRunGC,
					telemetryContext,
				});
			} catch (error) {
				return {
					stage: "base",
					referenceSequenceNumber: summaryRefSeqNum,
					minimumSequenceNumber,
					error: wrapError(error, (msg) => new RetriableSummaryError(msg)),
				};
			}

			// Validate that the summary generated by summarizer nodes is correct before uploading.
			const validateResult = host.summarizerNode.validateSummary();
			if (!validateResult.success) {
				const { success, ...loggingProps } = validateResult;
				const error = new RetriableSummaryError(
					validateResult.reason,
					validateResult.retryAfterSeconds,
					{ ...loggingProps },
				);
				return {
					stage: "base",
					referenceSequenceNumber: summaryRefSeqNum,
					minimumSequenceNumber,
					error,
				};
			}

			// If there are pending unacked ops, this summary attempt may fail as the uploaded
			// summary would be eventually inconsistent.
			const pendingMessagesFailResult = await shouldFailSummaryOnPendingOpsCore(host, 
				summaryNumberLogger,
				summaryRefSeqNum,
				minimumSequenceNumber,
				finalAttempt,
				false /* beforeSummaryGeneration */,
			);
			if (pendingMessagesFailResult !== undefined) {
				return pendingMessagesFailResult;
			}

			const { summary: summaryTree, stats: partialStats } = summarizeResult;

			// Now that we have generated the summary, update the message at last summary to the last message processed.
			host.messageAtLastSummary = host.deltaManager.lastMessage;

			// Counting dataStores and handles
			// Because handles are unchanged dataStores in the current logic,
			// summarized dataStore count is total dataStore count minus handle count
			const dataStoreTree: SummaryObject | undefined = summaryTree.tree[channelsTreeName];

			assert(dataStoreTree?.type === SummaryType.Tree, 0x1fc /* "summary is not a tree" */);
			const handleCount = Object.values(dataStoreTree.tree).filter(
				(value) => value.type === SummaryType.Handle,
			).length;
			const gcSummaryTreeStats =
				summaryTree.tree[gcTreeKey] === undefined
					? undefined
					: calculateStats(summaryTree.tree[gcTreeKey]);

			const summaryStats: IGeneratedSummaryStats = {
				dataStoreCount: host.channelCollection.size,
				summarizedDataStoreCount: host.channelCollection.size - handleCount,
				gcStateUpdatedDataStoreCount: host.garbageCollector.updatedDSCountSinceLastSummary,
				gcBlobNodeCount: gcSummaryTreeStats?.blobNodeCount,
				gcTotalBlobsSize: gcSummaryTreeStats?.totalBlobSize,
				summaryNumber,
				...partialStats,
			};
			const generateSummaryData: Omit<IGenerateSummaryTreeResult, "stage" | "error"> = {
				referenceSequenceNumber: summaryRefSeqNum,
				minimumSequenceNumber,
				summaryTree,
				summaryStats,
				generateDuration: trace.trace().duration,
			} as const;

			continueResult = checkContinue();
			if (!continueResult.continue) {
				return {
					stage: "generate",
					...generateSummaryData,
					error: new RetriableSummaryError(continueResult.error),
				};
			}

			const summaryContext: ISummaryContext = {
				proposalHandle: host.lastAckedSummaryContext?.proposalHandle ?? undefined,
				ackHandle: host.lastAckedSummaryContext?.ackHandle ?? host.loadedFromVersionId,
				referenceSequenceNumber: summaryRefSeqNum,
			};

			let handle: string;
			try {
				handle = await host.storage.uploadSummaryWithContext(summaryTree, summaryContext);
			} catch (error) {
				return {
					stage: "generate",
					...generateSummaryData,
					error: wrapError(error, (msg) => new RetriableSummaryError(msg)),
				};
			}

			const parent = summaryContext.ackHandle;
			const summaryMessage: ISummaryContent = {
				handle,
				// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
				head: parent!,
				message,
				parents: parent === undefined ? [] : [parent],
			};
			const uploadData = {
				...generateSummaryData,
				handle,
				uploadDuration: trace.trace().duration,
			} as const;

			continueResult = checkContinue();
			if (!continueResult.continue) {
				return {
					stage: "upload",
					...uploadData,
					error: new RetriableSummaryError(continueResult.error),
				};
			}

			let clientSequenceNumber: number;
			try {
				clientSequenceNumber = host.submitSummaryMessage(summaryMessage, summaryRefSeqNum);
			} catch (error) {
				return {
					stage: "upload",
					...uploadData,
					error: wrapError(error, (msg) => new RetriableSummaryError(msg)),
				};
			}

			const submitData = {
				stage: "submit",
				...uploadData,
				clientSequenceNumber,
				submitOpDuration: trace.trace().duration,
			} as const;

			try {
				host.summarizerNode.completeSummary(handle);
			} catch (error) {
				return {
					stage: "upload",
					...uploadData,
					error: wrapError(error, (msg) => new RetriableSummaryError(msg)),
				};
			}
			return submitData;
		} finally {
			// Cleanup wip summary in case of failure
			host.summarizerNode.clearSummary();

			// ! This needs to happen before we resume inbound queues to ensure heuristics are tracked correctly
			host._summarizer?.recordSummaryAttempt?.(summaryRefSeqNum);

			// Restart the delta manager
			host._deltaManager.inbound.resume();
			if (shouldPauseInboundSignal) {
				host.deltaManager.inboundSignal.resume();
			}
		}
	
}

async function shouldFailSummaryOnPendingOpsCore(
	host: ISummaryInternalsHost,
	logger: ITelemetryLoggerExt,
	referenceSequenceNumber: number,
	minimumSequenceNumber: number,
	finalAttempt: boolean,
	beforeSummaryGeneration: boolean,
): Promise<IBaseSummarizeResult | undefined> {
		if (!host.isDirty) {
			return;
		}

		// Don't fail the summary in the last attempt. This is a fallback to make progress in
		// documents where there are consistently pending ops in the summarizer.
		if (finalAttempt) {
			const error = DataProcessingError.create(
				"Pending ops during summarization",
				"submitSummary",
				undefined,
				{ pendingMessages: host.pendingMessagesCount },
			);
			logger.sendErrorEvent(
				{
					eventName: "PendingOpsDuringSummaryFinalAttempt",
					referenceSequenceNumber,
					minimumSequenceNumber,
					beforeGenerate: beforeSummaryGeneration,
				},
				error,
			);
		} else {
			// The retry delay when there are pending ops can be overridden via config so that we can adjust it
			// based on telemetry while we decide on a stable number.
			const retryDelayMs =
				host.mc.config.getNumber("Fluid.Summarizer.PendingOpsRetryDelayMs") ??
				defaultPendingOpsRetryDelayMs;
			const error = new RetriableSummaryError(
				"PendingOpsWhileSummarizing",
				retryDelayMs / 1000,
				{
					count: host.pendingMessagesCount,
					beforeGenerate: beforeSummaryGeneration,
				},
			);
			return {
				stage: "base",
				referenceSequenceNumber,
				minimumSequenceNumber,
				error,
			};
		}
	
}

export async function refreshLatestSummaryAckCore(
	host: ISummaryInternalsHost,
	options: IRefreshSummaryAckOptions,
): Promise<void> {
		const { proposalHandle, ackHandle, summaryRefSeq, summaryLogger } = options;
		// proposalHandle is always passed from RunningSummarizer.
		assert(proposalHandle !== undefined, 0x766 /* proposalHandle should be available */);
		const result = await host.summarizerNode.refreshLatestSummary(
			proposalHandle,
			summaryRefSeq,
		);

		/* eslint-disable jsdoc/check-indentation */
		/**
		 * If the snapshot corresponding to the ack is not tracked by this client, it was submitted by another client.
		 * Take action as per the following scenarios:
		 * 1. If that snapshot is older than the one tracked by this client, ignore the ack because only the latest
		 *    snapshot is tracked.
		 * 2. If that snapshot is newer, attempt to fetch the latest snapshot and do one of the following:
		 *    2.1. If the fetched snapshot is same or newer than the one for which ack was received, close this client.
		 *         The next summarizer client will likely start from this snapshot and get out of this state. Fetching
		 *         the snapshot updates the cache for this client so if it's re-elected as summarizer, this will prevent
		 *         any thrashing.
		 *    2.2. If the fetched snapshot is older than the one for which ack was received, ignore the ack. This can
		 *         happen in scenarios where the snapshot for the ack was lost in storage (in scenarios like DB rollback,
		 *         etc.) but the summary ack is still there because it's tracked a different service. In such cases,
		 *         ignoring the ack is the correct thing to do because the latest snapshot in storage is not the one for
		 *         the ack but is still the one tracked by this client. If we were to close the summarizer like in the
		 *         previous scenario, it will result in this document stuck in this state in a loop.
		 */
		/* eslint-enable jsdoc/check-indentation */
		if (!result.isSummaryTracked) {
			if (result.isSummaryNewer) {
				await fetchLatestSnapshotAndMaybeCloseCore(host, summaryRefSeq, ackHandle, summaryLogger);
			}
			return;
		}

		// Notify the garbage collector so it can update its latest summary state.
		await host.garbageCollector.refreshLatestSummary(result);

		// If we here, the ack was tracked by this client. Update the summary context of the last ack.
		// This is a faithful extraction of a ContainerRuntime prototype method: `host` is the runtime
		// instance and this single-writer assignment mirrors the original `this.lastAckedSummaryContext`
		// write (which the rule did not flag on `this`), so the race warning is a false positive here.
		// eslint-disable-next-line require-atomic-updates
		host.lastAckedSummaryContext = {
			proposalHandle,
			ackHandle,
			referenceSequenceNumber: summaryRefSeq,
		};
	
}

async function fetchLatestSnapshotAndMaybeCloseCore(
	host: ISummaryInternalsHost,
	targetRefSeq: number,
	targetAckHandle: string,
	logger: ITelemetryLoggerExt,
): Promise<void> {
		const fetchedSnapshotRefSeq = await PerformanceEvent.timedExecAsync(
			logger,
			{ eventName: "RefreshLatestSummaryAckFetch" },
			async (perfEvent: {
				end: (arg0: {
					details: {
						getVersionDuration?: number | undefined;
						getSnapshotDuration?: number | undefined;
						snapshotRefSeq?: number | undefined;
						snapshotVersion?: string | undefined;
						newerSnapshotPresent?: boolean | undefined;
						targetRefSeq?: number | undefined;
						targetAckHandle?: string | undefined;
					};
				}) => void;
			}) => {
				const props: {
					getVersionDuration?: number;
					getSnapshotDuration?: number;
					snapshotRefSeq?: number;
					snapshotVersion?: string;
					newerSnapshotPresent?: boolean | undefined;
					targetRefSeq?: number | undefined;
					targetAckHandle?: string | undefined;
				} = { targetRefSeq, targetAckHandle };
				const trace = Trace.start();

				let snapshotTree: ISnapshotTree | null;
				const scenarioName = "RefreshLatestSummaryAckFetch";
				// If loader supplied us the ISnapshot when loading, the new getSnapshotApi is supported and feature gate is ON, then use the
				// new API, otherwise it will reduce the service performance because the service will need to recalculate the full snapshot
				// in case previously getSnapshotApi was used and now we use the getVersions API.
				if (
					host.isSnapshotInstanceOfISnapshot &&
					host.storage.getSnapshot !== undefined &&
					host.mc.config.getBoolean("Fluid.Container.UseLoadingGroupIdForSnapshotFetch2") ===
						true
				) {
					const snapshot = await host.storage.getSnapshot({
						scenarioName,
						fetchSource: FetchSource.noCache,
					});
					const id = snapshot.snapshotTree.id;
					assert(id !== undefined, 0x9d0 /* id of the fetched snapshot should be defined */);
					props.snapshotVersion = id;
					snapshotTree = snapshot.snapshotTree;
				} else {
					const versions = await host.storage.getVersions(
						// eslint-disable-next-line unicorn/no-null
						null,
						1,
						scenarioName,
						FetchSource.noCache,
					);
					assert(versions[0] !== undefined, 0x137 /* "Failed to get version from storage" */);
					snapshotTree = await host.storage.getSnapshotTree(versions[0]);
					assert(!!snapshotTree, 0x138 /* "Failed to get snapshot from storage" */);
					props.snapshotVersion = versions[0].id;
				}

				props.getSnapshotDuration = trace.trace().duration;

				const snapshotRefSeq = await seqFromTree(snapshotTree, host.readAndParseBlob);
				props.snapshotRefSeq = snapshotRefSeq;
				props.newerSnapshotPresent = snapshotRefSeq >= targetRefSeq;

				perfEvent.end({ details: props });
				return snapshotRefSeq;
			},
		);

		// If the snapshot that was fetched is older than the target snapshot, return. The summarizer will not be closed
		// because the snapshot is likely deleted from storage and it so, closing the summarizer will result in the
		// document being stuck in this state.
		if (fetchedSnapshotRefSeq < targetRefSeq) {
			return;
		}

		await delay(host.closeSummarizerDelayMs);
		host._summarizer?.stop("latestSummaryStateStale");
		host.disposeFn();
	
}
