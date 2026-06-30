/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import type { requireAssignableTo } from "@fluidframework/build-tools";

// eslint-disable-next-line import-x/no-internal-modules -- the test deliberately compares the stub against the real module that it stands in for
import type * as real from "../../summary/summaryManagerDelayLoadedModule/index.js";
// eslint-disable-next-line import-x/no-internal-modules -- the stub is not part of the package's public surface and is imported directly under test
import type * as stub from "../../summary/summaryManagerDelayLoadedModuleStub.js";

/*
 * Compile-time type tests asserting that `summaryManagerDelayLoadedModuleStub` stays in sync with the
 * real delay-loaded election / SummaryManager module
 * (`./summary/summaryManagerDelayLoadedModule/index.js`) that it stands in for.
 *
 * The stub is swapped in for the real module (via webpack's NormalModuleReplacementPlugin) in
 * single-file bundles that do not use client-side summarization. For that swap to be safe, the stub
 * must re-export exactly the same runtime (value) symbols as the real module. If the real module gains
 * or loses a runtime export and the stub is not updated to match, the assertions below fail to
 * compile, flagging that the stub needs to be updated.
 */

/**
 * Every runtime export of the real module must also be exported by the stub.
 */
declare type _stubExportsAllRealValueSymbols = requireAssignableTo<
	keyof typeof real,
	keyof typeof stub
>;

/**
 * The stub must not export anything the real module does not.
 */
declare type _stubExportsNothingExtra = requireAssignableTo<
	keyof typeof stub,
	keyof typeof real
>;

/**
 * The `setupSummaryManager` entry point must remain signature-compatible so the stub is a valid
 * stand-in for any caller.
 */
declare type _setupSummaryManager = requireAssignableTo<
	typeof stub.setupSummaryManager,
	typeof real.setupSummaryManager
>;
