/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

// Stub for the SharedMap channel factory (`./mapFactory.js`).
//
// `@fluidframework/aqueduct`'s `DataObjectFactory` unconditionally registers the SharedMap factory
// (`sharedObjects.push(SharedMap.getFactory())`), guarded only by a stale "remove in 0.10" TODO, so a
// pre-0.10 document whose DataObject root channel was created as a `SharedMap` can still be loaded. This
// registration is the *sole* edge that pins `SharedMap` — and therefore the `SharedMapInternal`
// implementation (`./map.js`) and its `MapKernel` (`./mapKernel.js`, ~7 KB) — into a bundle. An
// application that uses only `SharedDirectory` (which has its own kernel and does not import `mapKernel`)
// carries that subgraph as dead weight.
//
// Replacing `mapFactory.js` with this stub via NormalModuleReplacementPlugin keeps everything the
// registration path actually touches — the `MapFactory` class with its `Type` / `Attributes` (used by
// the factory-dedup check `factory.type === MapFactory.Type`) and the `SharedMap` shared-object kind
// (whose `getFactory()` the registration calls) — while dropping the `./map.js` import. Because
// `@fluidframework/map` is `sideEffects:false`, severing that one import lets `map.js` + `mapKernel.js`
// tree-shake away entirely.
//
// The stub is NOT purely no-op: `MapFactory.Type` / `Attributes` and the `SharedMap` kind must stay
// faithful because they run on every `DataObjectFactory` construction. Only `create` / `load` — which
// materialize an actual SharedMap channel — throw. Those run exclusively when the app creates a SharedMap
// (this app does not) or loads a legacy document whose root channel is a SharedMap; under the "no
// pre-0.10 SharedMap-rooted documents" precondition they are never reached, so throwing is a loud,
// non-corrupting fail-fast if that assumption is violated.
//
// Example Webpack rule implementing the replacement after mapFactoryStub.ts is copied into the
// src/polyfills/ directory of the application:
// ```ts
// new webpack.NormalModuleReplacementPlugin(
//     /[\\/]mapFactory\.js$/,
//     (resource) => {
//         resource.request = resource.request.replace(/mapFactory\.js$/, "mapFactoryStub.js");
//     },
// ),
// ```

import type {
	IChannelAttributes,
	IChannelFactory,
	IChannelServices,
	IFluidDataStoreRuntime,
} from "@fluidframework/datastore-definitions/internal";
import { createSharedObjectKind } from "@fluidframework/shared-object-base/internal";

import type { ISharedMap } from "./interfaces.js";
import { pkgVersion } from "./packageVersion.js";

/**
 * {@link @fluidframework/datastore-definitions#IChannelFactory} for {@link ISharedMap}.
 *
 * Stub of the real {@link MapFactory}: `Type` / `Attributes` are reproduced verbatim so the factory
 * remains registration-compatible, but `create` / `load` throw because the SharedMap implementation is
 * not bundled.
 * @sealed
 * @legacy @beta
 */
export class MapFactory implements IChannelFactory<ISharedMap> {
	/**
	 * {@inheritDoc @fluidframework/datastore-definitions#IChannelFactory."type"}
	 */
	public static readonly Type = "https://graph.microsoft.com/types/map";

	/**
	 * {@inheritDoc @fluidframework/datastore-definitions#IChannelFactory.attributes}
	 */
	public static readonly Attributes: IChannelAttributes = {
		type: MapFactory.Type,
		snapshotFormatVersion: "0.2",
		packageVersion: pkgVersion,
	};

	/**
	 * {@inheritDoc @fluidframework/datastore-definitions#IChannelFactory."type"}
	 */
	public get type(): string {
		return MapFactory.Type;
	}

	/**
	 * {@inheritDoc @fluidframework/datastore-definitions#IChannelFactory.attributes}
	 */
	public get attributes(): IChannelAttributes {
		return MapFactory.Attributes;
	}

	/**
	 * {@inheritDoc @fluidframework/datastore-definitions#IChannelFactory.load}
	 */
	public async load(
		_runtime: IFluidDataStoreRuntime,
		_id: string,
		_services: IChannelServices,
		_attributes: IChannelAttributes,
	): Promise<ISharedMap> {
		throw new Error(
			"SharedMap is not available: mapFactoryStub was bundled in place of the real SharedMap implementation (precondition: no legacy SharedMap-rooted documents).",
		);
	}

	/**
	 * {@inheritDoc @fluidframework/datastore-definitions#IChannelFactory.create}
	 */
	public create(_runtime: IFluidDataStoreRuntime, _id: string): ISharedMap {
		throw new Error(
			"SharedMap is not available: mapFactoryStub was bundled in place of the real SharedMap implementation (precondition: no legacy SharedMap-rooted documents).",
		);
	}
}

/**
 * Entrypoint for {@link ISharedMap} creation.
 * @legacy @beta
 */
export const SharedMap = createSharedObjectKind<ISharedMap>(MapFactory);

/**
 * Entrypoint for {@link ISharedMap} creation.
 * @legacy @beta
 * @privateRemarks
 * This alias is for legacy compat from when the SharedMap class was exported as public.
 */
export type SharedMap = ISharedMap;
