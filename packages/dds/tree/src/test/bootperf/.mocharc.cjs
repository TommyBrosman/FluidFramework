/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Mocha configuration file for load-time benchmarks.
 *
 * These tests measure bundle load (fetch + parse + execute) time for @fluidframework/tree.
 * They require --parentProcess for process-level isolation per test.
 */
"use strict";

const getFluidTestMochaConfig = require("@fluid-internal/mocha-test-setup/mocharc-common");

const packageDir = __dirname + "/../../..";
const baseConfig = getFluidTestMochaConfig(packageDir);

module.exports = {
	...baseConfig,
	"fgrep": ["@CustomBenchmark"],
	"recursive": true,
	"reporter": "@fluid-tools/benchmark/dist/MochaReporter.js",
	"reporterOptions": ["reportDir=.bootperfTestsOutput/"],
	"spec": ["lib/test/bootperf/**/*.spec.*js"],
	"timeout": 120000,
};
