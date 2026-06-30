/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { TypedEventEmitter } from "@fluid-internal/client-utils";
import type { IDeltaManager } from "@fluidframework/container-definitions/internal";
import type { IEvent, ITelemetryBaseLogger } from "@fluidframework/core-interfaces";
import type {
	IDocumentMessage,
	ISequencedDocumentMessage,
} from "@fluidframework/driver-definitions/internal";

/**
 * A no-op {@link SummaryCollection} used to exclude the summary-ack/nack tracking
 * implementation (`summaryCollection.ts`) from a bundle.
 *
 * `ContainerRuntime` constructs a `SummaryCollection` unconditionally, but only ever passes it to
 * the client-side summarizer (`Summarizer`) and the summarizer-election machinery
 * (`setupSummaryManager`) — it never calls any method on the instance itself. In a bundle where both
 * of those subsystems are already stubbed out (this client summarizes server-side and never
 * participates in election), the real `SummaryCollection` — which watches every op to track summary
 * acks/nacks — is dead weight.
 *
 * Consuming applications in that configuration can swap the real `summaryCollection.js` module for
 * this stub at build time (e.g. via webpack `NormalModuleReplacementPlugin`).
 *
 * The constructor and the trivial read accessors are kept faithful (so the unconditional
 * construction in `ContainerRuntime` succeeds and any defensive reads stay valid); the
 * watcher/wait methods — only ever invoked by the summarizer machinery — throw.
 */
export class SummaryCollection extends TypedEventEmitter<IEvent> {
	public constructor(
		_deltaManager: IDeltaManager<ISequencedDocumentMessage, IDocumentMessage>,
		_logger: ITelemetryBaseLogger,
	) {
		super();
	}

	public readonly latestAck: undefined = undefined;

	public readonly opsSinceLastAck: number = 0;

	public addOpListener(): void {}

	public removeOpListener(): void {}

	public createWatcher(): never {
		throw new Error("SummaryCollection is stubbed out in this build");
	}

	public removeWatcher(): void {}

	public setPendingAckTimerTimeoutCallback(): void {}

	public unsetPendingAckTimerTimeoutCallback(): void {}

	public async waitFlushed(): Promise<undefined> {
		return undefined;
	}

	public async waitSummaryAck(): Promise<never> {
		throw new Error("SummaryCollection is stubbed out in this build");
	}
}
