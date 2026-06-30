/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

// Stub for Fluid container-runtime's op-performance telemetry module (`./connectionTelemetry.js`).
//
// `ReportOpPerfTelemetry` wires up `OpPerfTelemetry`, which subscribes to delta-manager and
// container-runtime events purely to emit op round-trip / connection performance telemetry. It has no
// effect on op processing, message routing, or runtime state - it is observability only. Applications
// that do not need this telemetry (for example, size-constrained mobile bundles) can replace this
// module with the stub via NormalModuleReplacementPlugin so the `OpPerfTelemetry` implementation is
// dropped from the bundle entirely.
//
// The stub is a NO-OP: it must not throw, because `ReportOpPerfTelemetry` is called unconditionally
// during container-runtime construction.
//
// Example Webpack rule implementing the replacement after connectionTelemetryStub.ts is copied into
// the src/polyfills/ directory of the application:
// ```ts
// new webpack.NormalModuleReplacementPlugin(
//     /connectionTelemetry\.js$/,
//     path.resolve(__dirname, "src/polyfills/connectionTelemetryStub.ts"),
// ),
// ```

import type { ReportOpPerfTelemetry as ReportOpPerfTelemetryReal } from "./connectionTelemetry.js";

/**
 * Latency threshold constant, preserved with its real value so consumers that read it behave
 * identically. (Telemetry that compares against it simply never fires once reporting is stubbed out.)
 */
export const latencyThreshold = 5000;

export const ReportOpPerfTelemetry: typeof ReportOpPerfTelemetryReal = () => {};
