/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as vm from "node:vm";
import * as zlib from "node:zlib";

import type { IMeasurementReporter } from "@fluid-tools/benchmark";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Minimal browser-like globals needed by webpack bundles when evaluated in Node.
 */
const browserGlobals = {
	self: globalThis,
	window: globalThis,
};

/**
 * Directory where webpack writes bundle output files.
 */
const bundleOutputDir = path.resolve(currentDir, "../../../dist/bootperf-bundles");

/**
 * Returns the list of entry names that have been built by webpack.
 * Derived from the `*.bundle.js` files present in the bundle output directory.
 */
export function getBuiltEntryNames(): string[] {
	assert(
		fs.existsSync(bundleOutputDir),
		`Bundle output directory not found: ${bundleOutputDir}. Run "npm run test:bootperf:build" first.`,
	);
	return fs
		.readdirSync(bundleOutputDir)
		.filter((f) => f.endsWith(".bundle.js"))
		.map((f) => f.replace(/\.bundle\.js$/, ""));
}

/**
 * Returns the absolute path to the webpack bundle for the given entry name.
 */
export function getBundlePath(entryName: string): string {
	return path.join(bundleOutputDir, `${entryName}.bundle.js`);
}

/**
 * Computes the total size in bytes of all `.js` files in the bundle output directory
 * matching the given entry name pattern.
 */
export function getBundleSizeBytes(entryName: string): number {
	const bundlePath = getBundlePath(entryName);
	assert(fs.existsSync(bundlePath), `Bundle not found: ${bundlePath}`);
	const stat = fs.statSync(bundlePath);
	return stat.size;
}

/**
 * Computes the gzipped size of the bundle using Node's zlib.
 */
export function getGzipBundleSizeBytes(entryName: string): number {
	const bundlePath = getBundlePath(entryName);
	const content = fs.readFileSync(bundlePath);
	return zlib.gzipSync(content).length;
}

/**
 * Times how long it takes to read and evaluate the bundle from disk.
 * Uses vm.Script to simulate a fresh script evaluation (parse + compile + execute).
 * Returns elapsed time in milliseconds.
 */
export async function timeImportFromDisk(entryName: string): Promise<number> {
	const bundlePath = getBundlePath(entryName);
	const code = fs.readFileSync(bundlePath, "utf8");

	const start = performance.now();
	const script = new vm.Script(code, { filename: `${entryName}.bundle.js` });
	script.runInNewContext({ ...browserGlobals, ...globalThis });
	const elapsed = performance.now() - start;
	return elapsed;
}

/**
 * Times how long it takes to fetch the bundle over HTTP and evaluate it.
 * Returns elapsed time in milliseconds.
 */
export async function timeImportFromHttp(baseUrl: string, entryName: string): Promise<number> {
	const url = `${baseUrl}/${entryName}.bundle.js`;

	const start = performance.now();
	const response = await fetch(url);
	assert(response.ok, `Failed to fetch bundle: ${response.status} ${response.statusText}`);
	// Evaluate the fetched JS to simulate real load behavior.
	// In a browser this would be a <script> tag; in Node we use the vm module.
	const code = await response.text();
	const script = new vm.Script(code, { filename: `${entryName}.bundle.js` });
	script.runInNewContext({ ...browserGlobals, ...globalThis });
	const elapsed = performance.now() - start;

	return elapsed;
}

/**
 * Reports load time as the primary output and bundle sizes as supplementary
 * measurements via the {@link IMeasurementReporter} from `benchmarkCustom`.
 */
export function reportLoadTimeResult(
	reporter: IMeasurementReporter,
	loadTimeMs: number,
	entryName: string,
): void {
	reporter.addMeasurement("loadTimeMs", loadTimeMs);
	reporter.addMeasurement("bundleSizeBytes", getBundleSizeBytes(entryName));
	reporter.addMeasurement("bundleSizeGzipBytes", getGzipBundleSizeBytes(entryName));
}
