/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

// Stub for Fluid container-runtime's BlobManager module (`./blobManager/index.js`).
//
// BlobManager implements attachment-blob support (uploading binary blobs and referencing them via
// handles). Applications that never create or reference attachment blobs (for example, ones that use
// only SharedString / SharedDirectory) do not need any of this machinery. Replacing the module with
// this stub via NormalModuleReplacementPlugin drops the BlobManager implementation (and its snapshot /
// summary helpers) from the bundle.
//
// The stub is NOT purely no-op: BlobManager contributes to the summary tree and the GC graph on paths
// that run for every client, so the stub returns *valid empty* results there (an empty summary tree -
// which container-runtime omits - and empty GC data). Methods that are only reached when the app
// actually uses blobs (createBlob, getBlob) throw, to fail fast if the no-blob assumption is violated.
//
// Example Webpack rule implementing the replacement after blobManagerStub.ts is copied into the
// src/polyfills/ directory of the application:
// ```ts
// new webpack.NormalModuleReplacementPlugin(
//     /blobManager[\\/]index\.js$/,
//     (resource) => {
//         resource.request = resource.request.replace(/index\.js$/, "blobManagerStub.js");
//     },
// ),
// ```

import type { IFluidHandleInternalPayloadPending } from "@fluidframework/core-interfaces/internal";
import type {
	IGarbageCollectionData,
	ISummaryTreeWithStats,
	ITelemetryContext,
	ISequencedMessageEnvelope,
} from "@fluidframework/runtime-definitions/internal";
import { SummaryTreeBuilder } from "@fluidframework/runtime-utils/internal";

// Type-only imports of the real module's surface keep the stub's signatures in sync without creating a
// runtime dependency edge back to the implementation (these imports are fully erased).
import type {
	BlobManager as BlobManagerReal,
	IBlobManagerRuntime as IBlobManagerRuntimeReal,
	ICreateBlobResponseWithTTL as ICreateBlobResponseWithTTLReal,
	IPendingBlobs as IPendingBlobsReal,
	SerializableLocalBlobRecord as SerializableLocalBlobRecordReal,
} from "./blobManager.js";
import type { IBlobManagerLoadInfo as IBlobManagerLoadInfoReal } from "./blobManagerSnapSum.js";

export type IBlobManagerRuntime = IBlobManagerRuntimeReal;
export type ICreateBlobResponseWithTTL = ICreateBlobResponseWithTTLReal;
export type IPendingBlobs = IPendingBlobsReal;
export type SerializableLocalBlobRecord = SerializableLocalBlobRecordReal;
export type IBlobManagerLoadInfo = IBlobManagerLoadInfoReal;

// Constants and pure path helpers are reproduced here (rather than re-exported from the real module,
// which would pull the implementation back in). A runtime test asserts they stay equal to the real
// values, so drift is caught.
export const blobManagerBasePath = "_blobs";
export const blobsTreeName = ".blobs";
export const redirectTableBlobName = ".redirectTable";

export const getGCNodePathFromLocalId = (localId: string): string =>
	`/${blobManagerBasePath}/${localId}`;

export const isBlobPath = (
	path: string,
): path is `/${typeof blobManagerBasePath}/${string}` => {
	const pathParts = path.split("/");
	return pathParts.length === 3 && pathParts[1] === blobManagerBasePath;
};

export const loadBlobManagerLoadInfo = async (): Promise<IBlobManagerLoadInfo> => ({});

const unavailable = (): never => {
	throw new Error(
		"BlobManager is not available: this bundle was built with the BlobManager stub. Attachment blobs are not supported.",
	);
};

/**
 * No-op stand-in for {@link BlobManager} usable in bundles that do not support attachment blobs. The
 * public surface mirrors the real class; summary/GC contributions are valid-but-empty and blob
 * upload/retrieval throws.
 */
export class BlobManager {
	public constructor(_props: ConstructorParameters<typeof BlobManagerReal>[0]) {}

	public hasBlob(_localId: string): boolean {
		return false;
	}

	public lookupTemporaryBlobStorageId(_localId: string): string | undefined {
		return undefined;
	}

	public async getBlob(
		_localId: string,
		_payloadPending: boolean,
	): Promise<ArrayBufferLike> {
		return unavailable();
	}

	public async createBlob(
		_blob: ArrayBufferLike,
		_signal?: AbortSignal,
	): Promise<IFluidHandleInternalPayloadPending<ArrayBufferLike>> {
		return unavailable();
	}

	public reSubmit(_metadata: Record<string, unknown> | undefined): void {}

	public processBlobAttachMessage(
		_message: ISequencedMessageEnvelope,
		_local: boolean,
	): void {}

	public summarize(_telemetryContext?: ITelemetryContext): ISummaryTreeWithStats {
		return new SummaryTreeBuilder().getSummaryTree();
	}

	public getGCData(_fullGC: boolean = false): IGarbageCollectionData {
		return { gcNodes: {} };
	}

	public deleteSweepReadyNodes(_sweepReadyBlobRoutes: readonly string[]): readonly string[] {
		return [];
	}

	public readonly patchRedirectTable = (_detachedStorageTable: Map<string, string>): void => {};

	public readonly sharePendingBlobs = async (): Promise<void> => {};

	public getPendingBlobs(): IPendingBlobs | undefined {
		return undefined;
	}
}
