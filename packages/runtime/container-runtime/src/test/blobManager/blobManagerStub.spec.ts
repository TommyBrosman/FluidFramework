/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { strict as assert } from "node:assert";

import type { requireAssignableTo } from "@fluidframework/build-tools";

// eslint-disable-next-line import-x/no-internal-modules -- the stub is imported directly under test
import * as stub from "../../blobManager/blobManagerStub.js";
import * as real from "../../blobManager/index.js";

/*
 * Type tests asserting that `blobManagerStub` stays in sync with the real BlobManager module
 * (`./blobManager/index.js`) it stands in for. The stub is swapped in (via webpack's
 * NormalModuleReplacementPlugin) in bundles that do not support attachment blobs; for that swap to be
 * safe the stub must export the same runtime (value) symbols, with compatible signatures, as the real
 * module. If the real module changes and the stub is not updated, the assertions below fail to compile.
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
 * The public methods container-runtime uses must remain signature-compatible. (Full instance
 * assignability cannot be asserted because the real class has private members.)
 */
declare type _hasBlob = requireAssignableTo<
	InstanceType<typeof stub.BlobManager>["hasBlob"],
	InstanceType<typeof real.BlobManager>["hasBlob"]
>;
declare type _getBlob = requireAssignableTo<
	InstanceType<typeof stub.BlobManager>["getBlob"],
	InstanceType<typeof real.BlobManager>["getBlob"]
>;
declare type _createBlob = requireAssignableTo<
	InstanceType<typeof stub.BlobManager>["createBlob"],
	InstanceType<typeof real.BlobManager>["createBlob"]
>;
declare type _summarize = requireAssignableTo<
	InstanceType<typeof stub.BlobManager>["summarize"],
	InstanceType<typeof real.BlobManager>["summarize"]
>;
declare type _getGCData = requireAssignableTo<
	InstanceType<typeof stub.BlobManager>["getGCData"],
	InstanceType<typeof real.BlobManager>["getGCData"]
>;
declare type _processBlobAttachMessage = requireAssignableTo<
	InstanceType<typeof stub.BlobManager>["processBlobAttachMessage"],
	InstanceType<typeof real.BlobManager>["processBlobAttachMessage"]
>;
declare type _patchRedirectTable = requireAssignableTo<
	InstanceType<typeof stub.BlobManager>["patchRedirectTable"],
	InstanceType<typeof real.BlobManager>["patchRedirectTable"]
>;
declare type _deleteSweepReadyNodes = requireAssignableTo<
	InstanceType<typeof stub.BlobManager>["deleteSweepReadyNodes"],
	InstanceType<typeof real.BlobManager>["deleteSweepReadyNodes"]
>;
declare type _getPendingBlobs = requireAssignableTo<
	InstanceType<typeof stub.BlobManager>["getPendingBlobs"],
	InstanceType<typeof real.BlobManager>["getPendingBlobs"]
>;
declare type _loadBlobManagerLoadInfo = requireAssignableTo<
	Awaited<ReturnType<typeof stub.loadBlobManagerLoadInfo>>,
	Awaited<ReturnType<typeof real.loadBlobManagerLoadInfo>>
>;

describe("blobManagerStub", () => {
	it("reproduces the real path constants (guards against drift)", () => {
		assert.equal(stub.blobManagerBasePath, real.blobManagerBasePath);
		assert.equal(stub.blobsTreeName, real.blobsTreeName);
		assert.equal(stub.redirectTableBlobName, real.redirectTableBlobName);
		assert.equal(stub.getGCNodePathFromLocalId("abc"), real.getGCNodePathFromLocalId("abc"));
		assert.equal(
			stub.isBlobPath(`/${real.blobManagerBasePath}/abc`),
			real.isBlobPath(`/${real.blobManagerBasePath}/abc`),
		);
		assert.equal(stub.isBlobPath("/other/abc"), real.isBlobPath("/other/abc"));
	});

	it("summarize() returns an empty (omittable) summary tree", () => {
		const summary = new stub.BlobManager(
			undefined as unknown as ConstructorParameters<typeof stub.BlobManager>[0],
		).summarize();
		assert.equal(Object.keys(summary.summary.tree).length, 0);
	});

	it("getGCData() returns empty GC nodes", () => {
		const gcData = new stub.BlobManager(
			undefined as unknown as ConstructorParameters<typeof stub.BlobManager>[0],
		).getGCData();
		assert.equal(Object.keys(gcData.gcNodes).length, 0);
	});
});
