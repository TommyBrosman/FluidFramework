/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Measures parse + execute time of the bundled \@fluidframework/tree
 * by importing the webpack bundle directly from disk.
 *
 * This eliminates network variables and provides a deterministic baseline for
 * load-time regression detection.
 *
 * Each test uses --parentProcess for process-level isolation so that V8's JIT
 * and module cache do not carry over between tests.
 */

import { benchmarkCustom, BenchmarkType } from "@fluid-tools/benchmark";

import { getBuiltEntryNames, timeImportFromDisk, reportLoadTimeResult } from "./utils.js";

for (const entryName of getBuiltEntryNames()) {
	describe(`Boot perf - bundle load from disk - ${entryName}`, () => {
		benchmarkCustom({
			title: `parse + execute "${entryName}" bundle from disk`,
			type: BenchmarkType.Measurement,
			run: async (reporter) => {
				const loadTimeMs = await timeImportFromDisk(entryName);
				reportLoadTimeResult(reporter, loadTimeMs, entryName);
			},
		});
	});
}
