/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import type { requireAssignableTo } from "@fluidframework/build-tools";

import type * as real from "../connectionTelemetry.js";
import type * as stub from "../connectionTelemetryStub.js";

/*
 * Compile-time type tests asserting that `connectionTelemetryStub` stays in sync with the op-perf
 * telemetry module (`./connectionTelemetry.js`) it stands in for.
 *
 * The stub is swapped in for the real module (via webpack's NormalModuleReplacementPlugin) in bundles
 * that do not need op-performance telemetry. For that swap to be safe, the stub must export the same
 * runtime (value) symbols with compatible signatures. If the real module changes and the stub is not
 * updated to match, the assertions below fail to compile, flagging that the stub needs updating.
 */

/**
 * Every runtime export of the real module must also be exported by the stub.
 */
declare type _stubExportsAllRealValueSymbols = requireAssignableTo<
	keyof typeof real,
	keyof typeof stub
>;

/**
 * The `ReportOpPerfTelemetry` entry point must remain signature-compatible.
 */
declare type _reportOpPerfTelemetry = requireAssignableTo<
	typeof stub.ReportOpPerfTelemetry,
	typeof real.ReportOpPerfTelemetry
>;
