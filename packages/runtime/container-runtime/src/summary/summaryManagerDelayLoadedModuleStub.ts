/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

// Stub for Fluid container-runtime's delay-loaded summarizer-election module
// (`./summary/summaryManagerDelayLoadedModule/index.js`).
//
// This stub is for clients that do not use client-side summarization (for example, when
// summarization happens server-side). The election / SummaryManager machinery is a graph of modules
// that is not needed in the single-file bundle for such clients. The stub is used in the single-file
// bundle instead of the real module, replaced via NormalModuleReplacementPlugin in the webpack
// config.
//
// Unlike the throwing stubs for fully-optional subsystems, this stub is a NO-OP: `setupSummaryManager`
// is reached on the normal (non-summarizer) client path, so it must not throw. Returning an empty
// result is behaviorally equivalent to "this client does not participate in summarizer election",
// which is correct for a client that summarizes server-side (and whose summarizer implementation is
// itself stubbed out).
//
// Example Webpack rule implementing the replacement after summaryManagerDelayLoadedModuleStub.ts is
// copied into the src/polyfills/ directory of the application:
// ```ts
// new webpack.NormalModuleReplacementPlugin(
//     /summaryManagerDelayLoadedModule[\\/]index\.js$/,
//     path.resolve(__dirname, "src/polyfills/summaryManagerDelayLoadedModuleStub.ts"),
// ),
// ```

import type {
	SummaryManagerSetupContext,
	SummaryManagerSetupResult,
} from "./summaryManagerDelayLoadedModule/index.js";

export function setupSummaryManager(
	_context: SummaryManagerSetupContext,
	_forwardEvent: (eventName: string, ...args: unknown[]) => void,
): SummaryManagerSetupResult {
	return {};
}
