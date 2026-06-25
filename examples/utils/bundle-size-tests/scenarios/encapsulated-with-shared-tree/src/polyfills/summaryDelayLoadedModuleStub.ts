/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 */

// Stub for Fluid container-runtime's delay-loaded summarizer module
// (`./summary/summaryDelayLoadedModule/index.js`, the "summarizerDelayLoadedModule" chunk).
//
// This scenario models an interactive-only client that never runs the summarizer
// (summarization happens service-side). We replace that module with this stub via
// NormalModuleReplacementPlugin so the (large) summarizer graph is excluded from the
// single-file bundle. Reaching this code would be a bug, so instantiation fails fast.
//
// `container-runtime`'s `summary/index.js` statically re-exports every symbol that
// `summaryDelayLoadedModule/index.js` exports, so this stub must re-expose all of them
// (otherwise webpack fails with "export X was not found"). Only `Summarizer` is ever
// reached (via a dynamic import) and even that path is unused in this scenario.
const unavailable = (name: string): never => {
	throw new Error(
		`${name} is unavailable: the summaryDelayLoadedModule chunk was stubbed out of the bundle.`,
	);
};

export class Summarizer {
	public constructor() {
		unavailable("Summarizer");
	}
}

export class RunWhileConnectedCoordinator {
	public constructor() {
		unavailable("RunWhileConnectedCoordinator");
	}
}

export class RunningSummarizer {
	public constructor() {
		unavailable("RunningSummarizer");
	}
}

export class SummarizeHeuristicData {
	public constructor() {
		unavailable("SummarizeHeuristicData");
	}
}

export class SummarizeHeuristicRunner {
	public constructor() {
		unavailable("SummarizeHeuristicRunner");
	}
}

export const defaultMaxAttempts = 2;
export const defaultMaxAttemptsForSubmitFailures = 5;
export const neverCancelledSummaryToken = Object.freeze({
	cancelled: false as const,
	waitCancelled: new Promise<never>(() => {}),
});
