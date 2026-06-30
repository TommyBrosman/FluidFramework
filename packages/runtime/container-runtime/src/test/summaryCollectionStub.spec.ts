/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { strict as assert } from "node:assert";

import type { requireAssignableTo } from "@fluidframework/build-tools";
import type { IDeltaManager } from "@fluidframework/container-definitions/internal";
import type { ITelemetryBaseLogger } from "@fluidframework/core-interfaces";
import type {
	IDocumentMessage,
	ISequencedDocumentMessage,
} from "@fluidframework/driver-definitions/internal";

// eslint-disable-next-line import-x/no-internal-modules -- import the real module the stub stands in for
import * as real from "../summary/summaryCollection.js";
// eslint-disable-next-line import-x/no-internal-modules -- the stub is imported directly under test
import * as stub from "../summary/summaryCollectionStub.js";

/*
 * Type tests asserting that `summaryCollectionStub` stays in sync with the real module
 * (`./summary/summaryCollection.js`) it stands in for. The stub is swapped in (via webpack's
 * NormalModuleReplacementPlugin) in bundles that summarize server-side and never participate in
 * summarizer election. For that swap to be safe the stub must export the same runtime (value) symbols,
 * with a compatible constructor, as the real module. If the real module changes and the stub is not
 * updated, the assertions below fail to compile.
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
 * The constructor `ContainerRuntime` uses must remain compatible.
 */
declare type _ctor = requireAssignableTo<
	ConstructorParameters<typeof stub.SummaryCollection>,
	ConstructorParameters<typeof real.SummaryCollection>
>;

describe("summaryCollectionStub", () => {
	const deltaManager = undefined as unknown as IDeltaManager<
		ISequencedDocumentMessage,
		IDocumentMessage
	>;
	const logger = undefined as unknown as ITelemetryBaseLogger;

	it("constructs and exposes faithful trivial accessors", () => {
		const sc = new stub.SummaryCollection(deltaManager, logger);
		assert.equal(sc.latestAck, undefined);
		assert.equal(sc.opsSinceLastAck, 0);
		// no-op listeners should not throw
		sc.addOpListener();
		sc.removeOpListener();
	});

	it("returns undefined from waitFlushed", async () => {
		const sc = new stub.SummaryCollection(deltaManager, logger);
		assert.equal(await sc.waitFlushed(), undefined);
	});

	it("throws from summarizer-only methods (never reached on a non-summarizing client)", async () => {
		const sc = new stub.SummaryCollection(deltaManager, logger);
		assert.throws(() => sc.createWatcher());
		await assert.rejects(async () => sc.waitSummaryAck());
	});
});
