/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

// Stub for Fluid container-runtime's signal telemetry module (`./signalTelemetryProcessing.js`).
//
// `SignalTelemetryManager` exists solely to measure broadcast-signal round-trip latency and emit the
// corresponding telemetry. The only mutation it makes to outbound signals is stamping the optional
// `clientBroadcastSignalSequenceNumber` field on the envelope, which is read back only to compute
// latency telemetry on receipt - it is not used for signal delivery or ordering. Replacing this
// module with the stub via NormalModuleReplacementPlugin drops the telemetry implementation from the
// bundle without affecting signal behavior.
//
// The stub is a NO-OP: `SignalTelemetryManager` is constructed unconditionally during
// container-runtime construction and its methods run on the signal send/receive paths, so they must
// not throw.
//
// Example Webpack rule implementing the replacement after signalTelemetryProcessingStub.ts is copied
// into the src/polyfills/ directory of the application:
// ```ts
// new webpack.NormalModuleReplacementPlugin(
//     /signalTelemetryProcessing\.js$/,
//     path.resolve(__dirname, "src/polyfills/signalTelemetryProcessingStub.ts"),
// ),
// ```

import type { ISignalEnvelope } from "@fluidframework/core-interfaces/internal";
import type { ITelemetryLoggerExt } from "@fluidframework/telemetry-utils/internal";

export class SignalTelemetryManager {
	public applyTrackingToBroadcastSignalEnvelope(_envelope: ISignalEnvelope): void {}

	public resetTracking(): void {}

	public trackReceivedSignal(
		_envelope: ISignalEnvelope,
		_logger: ITelemetryLoggerExt,
		_consecutiveReconnects: number,
	): void {}
}
