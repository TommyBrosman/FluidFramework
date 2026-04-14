/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Measures fetch + parse + execute time of the bundled \@fluidframework/tree
 * served over HTTP from a local static file server.
 *
 * This approximates what a real application experiences when loading the bundle
 * from a CDN (minus true network latency). Tests cover both cold-cache and warm-cache
 * scenarios.
 *
 * Each describe block contains exactly one benchmarkCustom test to ensure
 * --parentProcess can uniquely identify each test via --fgrep.
 */

import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

import { benchmarkCustom, BenchmarkType } from "@fluid-tools/benchmark";

import {
	getBuiltEntryNames,
	getBundlePath,
	timeImportFromHttp,
	reportLoadTimeResult,
} from "./utils.js";

const entries = getBuiltEntryNames();

/**
 * Creates a minimal static file server that serves .js files from the bundle output directory
 * with appropriate headers (Content-Type, gzip support via Accept-Encoding).
 */
function createBundleServer(bundleDir: string): http.Server {
	return http.createServer((req, res) => {
		const filePath = path.join(bundleDir, req.url ?? "");

		if (!fs.existsSync(filePath)) {
			res.writeHead(404);
			res.end("Not found");
			return;
		}

		const content = fs.readFileSync(filePath);
		res.writeHead(200, {
			"Content-Type": "application/javascript",
			"Content-Length": content.length,
			// Disable caching for cold-cache tests; warm-cache tests rely on
			// Node's HTTP agent connection reuse, not HTTP caching.
			"Cache-Control": "no-store",
		});
		res.end(content);
	});
}

/**
 * Sets up a before/after pair that starts and stops an HTTP server serving
 * the bundle output directory. Returns a getter for the base URL (only valid
 * after `before` has run).
 */
function setupBundleServer(entryName: string): () => string {
	let server: http.Server;
	let baseUrl: string;

	before((done) => {
		const bundleDir = path.dirname(getBundlePath(entryName));

		server = createBundleServer(bundleDir);

		// Let the OS assign an available port; done() when listening.
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			assert(address !== null && typeof address === "object", "Server did not bind");
			baseUrl = `http://127.0.0.1:${address.port}`;
			done();
		});
	});

	after((done) => {
		if (server === undefined) {
			done();
		} else {
			server.close(done);
		}
	});

	return () => baseUrl;
}

for (const entryName of entries) {
	/**
	 * Cold cache: first fetch in a fresh child process.
	 * The --parentProcess flag ensures this is a clean V8 instance with no
	 * prior module evaluation or JIT compilation.
	 */
	describe(`Boot perf - bundle load over HTTP (cold cache) - ${entryName}`, () => {
		const getBaseUrl = setupBundleServer(entryName);

		benchmarkCustom({
			title: `fetch + parse + execute "${entryName}" bundle over HTTP (cold cache)`,
			type: BenchmarkType.Measurement,
			run: async (reporter) => {
				const loadTimeMs = await timeImportFromHttp(getBaseUrl(), entryName);
				reportLoadTimeResult(reporter, loadTimeMs, entryName);
			},
		});
	});

	/**
	 * Warm cache: second fetch in the same process.
	 * The HTTP connection is reused (keep-alive), simulating a return visit
	 * before a new application version is deployed.
	 */
	describe(`Boot perf - bundle load over HTTP (warm cache) - ${entryName}`, () => {
		const getBaseUrl = setupBundleServer(entryName);

		benchmarkCustom({
			title: `fetch + parse + execute "${entryName}" bundle over HTTP (warm cache)`,
			type: BenchmarkType.Measurement,
			run: async (reporter) => {
				// Warm-up fetch (primes HTTP connection + any OS-level caches)
				await timeImportFromHttp(getBaseUrl(), entryName);
				// Measured fetch
				const loadTimeMs = await timeImportFromHttp(getBaseUrl(), entryName);
				reportLoadTimeResult(reporter, loadTimeMs, entryName);
			},
		});
	});
}
