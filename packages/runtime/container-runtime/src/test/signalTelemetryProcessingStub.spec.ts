/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import type { requireAssignableTo } from "@fluidframework/build-tools";

import type * as real from "../signalTelemetryProcessing.js";
import type * as stub from "../signalTelemetryProcessingStub.js";

/*
 * Compile-time type tests asserting that `signalTelemetryProcessingStub` stays in sync with the
 * signal telemetry module (`./signalTelemetryProcessing.js`) it stands in for.
 *
 * The stub is swapped in for the real module (via webpack's NormalModuleReplacementPlugin) in bundles
 * that do not need signal-latency telemetry. For that swap to be safe, the stub must export the same
 * runtime (value) symbols and a `SignalTelemetryManager` whose public surface stays signature-
 * compatible with the real one. If the real module changes and the stub is not updated to match, the
 * assertions below fail to compile, flagging that the stub needs updating.
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
 * The stub `SignalTelemetryManager` must expose the same public methods, with compatible signatures,
 * as the real one. (Full instance assignability cannot be asserted because the real class has private
 * members; container-runtime only uses the public surface below.)
 */
declare type _applyTracking = requireAssignableTo<
	InstanceType<typeof stub.SignalTelemetryManager>["applyTrackingToBroadcastSignalEnvelope"],
	InstanceType<typeof real.SignalTelemetryManager>["applyTrackingToBroadcastSignalEnvelope"]
>;
declare type _resetTracking = requireAssignableTo<
	InstanceType<typeof stub.SignalTelemetryManager>["resetTracking"],
	InstanceType<typeof real.SignalTelemetryManager>["resetTracking"]
>;
declare type _trackReceivedSignal = requireAssignableTo<
	InstanceType<typeof stub.SignalTelemetryManager>["trackReceivedSignal"],
	InstanceType<typeof real.SignalTelemetryManager>["trackReceivedSignal"]
>;
