/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { strict as assert } from "node:assert";

import type { requireAssignableTo } from "@fluidframework/build-tools";
import type { ITelemetryBaseLogger } from "@fluidframework/core-interfaces";
import type { ISequencedDocumentMessage } from "@fluidframework/driver-definitions/internal";
import type {
	CreateChildSummarizerNodeParam,
	SummarizeInternalFn,
} from "@fluidframework/runtime-definitions/internal";

// eslint-disable-next-line import-x/no-internal-modules -- import the real module the stub stands in for
import * as real from "../summary/summarizerNode/summarizerNodeWithGc.js";
// eslint-disable-next-line import-x/no-internal-modules -- the stub is imported directly under test
import * as stub from "../summary/summarizerNode/summarizerNodeWithGcStub.js";

/*
 * Type tests asserting that `summarizerNodeWithGcStub` stays in sync with the real module
 * (`./summary/summarizerNode/summarizerNodeWithGc.js`) it stands in for. The stub is swapped in (via
 * webpack's NormalModuleReplacementPlugin) in bundles that summarize server-side and run with GC disabled;
 * for that swap to be safe the stub must export the same runtime (value) symbols, with a compatible
 * factory signature, as the real module. If the real module changes and the stub is not updated, the
 * assertions below fail to compile.
 */

/**
 * Every runtime export of the real module must also be exported by the stub (and vice versa).
 */
declare type _stubExportsAllRealValueSymbols = requireAssignableTo<
	keyof typeof real,
	keyof typeof stub
>;
declare type _stubExportsNothingExtra = requireAssignableTo<
	keyof typeof stub,
	keyof typeof real
>;

/**
 * The factory the container-runtime uses must remain signature-compatible, including its return type
 * (`IRootSummarizerNodeWithGC`, which is what the consumer depends on).
 */
declare type _createRoot = requireAssignableTo<
	typeof stub.createRootSummarizerNodeWithGC,
	typeof real.createRootSummarizerNodeWithGC
>;

describe("summarizerNodeWithGcStub", () => {
	const logger = undefined as unknown as ITelemetryBaseLogger;
	const summarizeInternalFn = (async () => {}) as unknown as SummarizeInternalFn;
	const localParam = undefined as unknown as CreateChildSummarizerNodeParam;
	const op = undefined as unknown as ISequencedDocumentMessage;

	it("maintains a faithful child map (create/get/delete)", () => {
		const root = stub.createRootSummarizerNodeWithGC(logger, summarizeInternalFn, 0, 0);
		const child = root.createChild(summarizeInternalFn, "a", localParam);
		assert.equal(root.getChild("a"), child, "getChild returns the created child");
		// createChild is idempotent per id (returns the same node)
		assert.equal(root.createChild(summarizeInternalFn, "a", localParam), child);
		assert.equal(
			root.getChild("missing"),
			undefined,
			"unknown child is undefined (consumer-guarded)",
		);
		root.deleteChild("a");
		assert.equal(root.getChild("a"), undefined, "deleted child is gone");
	});

	it("treats every-client lifecycle methods as safe no-ops", () => {
		const root = stub.createRootSummarizerNodeWithGC(logger, summarizeInternalFn, 0, 0);
		// Should not throw.
		root.invalidate(5);
		root.recordChange(op);
		root.updateUsedRoutes([""]);
		assert.equal(root.isReferenced(), true, "always referenced when GC is disabled");
	});

	it("fails fast on summarizer-only methods (never reached on a server-side-summarizing client)", async () => {
		const root = stub.createRootSummarizerNodeWithGC(logger, summarizeInternalFn, 0, 0);
		await assert.rejects(async () => root.summarize(true));
		assert.throws(() => root.validateSummary());
		assert.throws(() => root.completeSummary("h"));
	});
});
