/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Throwing stub for the summary-write implementation (`summaryInternals.ts`).
 *
 * `ContainerRuntime` implements the `ISummarizerInternalsProvider` summary-write path
 * (`submitSummary` / `refreshLatestSummaryAck` and the `summarize` helpers) by delegating to the
 * free functions in `summaryInternals.ts`. That path only runs on a client that summarizes
 * client-side; a client that summarizes server-side never reaches it (its `Summarizer` is
 * delay-loaded and stubbed).
 *
 * Consuming applications in that configuration can swap the real `summaryInternals.js` module for
 * this stub at build time (e.g. via webpack `NormalModuleReplacementPlugin`) to drop the (large)
 * summary-generation implementation from the bundle. Every entry point throws, since none of them
 * are reachable in that configuration.
 */

/**
 * Structural view of `ContainerRuntime` consumed by the (stubbed-out) summary-write functions.
 *
 * Declared here only so the `this as unknown as ISummaryInternalsHost` cast in `ContainerRuntime`
 * still type-checks against the stub module; it carries no members because the stub never reads the
 * host.
 */
export type ISummaryInternalsHost = unknown;

function stubbedOut(): never {
	throw new Error("summaryInternals is stubbed out in this build");
}

export async function summarizeInternalCore(): Promise<never> {
	return stubbedOut();
}

export async function summarizeCore(): Promise<never> {
	return stubbedOut();
}

export async function submitSummaryCore(): Promise<never> {
	return stubbedOut();
}

export async function refreshLatestSummaryAckCore(): Promise<never> {
	return stubbedOut();
}
