/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

const fs = require("fs");
const path = require("path");

const entriesDir = path.resolve(__dirname, "src/test/bootperf/entries");

/**
 * Webpack configuration for building @fluidframework/tree bundles for boot perf benchmarks.
 *
 * Produces a production-mode bundle that approximates what a real application would download
 * from a CDN. Each .ts file in src/test/bootperf/entries/ becomes a separate bundle.
 */
module.exports = () => {
	// Auto-discover entry points from the entries directory.
	const entryFiles = fs.readdirSync(entriesDir).filter((f) => f.endsWith(".ts"));
	const entry = Object.fromEntries(
		entryFiles.map((f) => [path.basename(f, ".ts"), path.join(entriesDir, f)]),
	);

	return {
		mode: "production",
		devtool: "source-map",
		entry,
		output: {
			path: path.resolve(__dirname, "dist/bootperf-bundles"),
			filename: "[name].bundle.js",
			publicPath: "/",
			clean: true,
		},
		optimization: {
			// Produce a single self-contained file per entry.
			splitChunks: false,
			runtimeChunk: false,
		},
		resolve: {
			extensionAlias: {
				".js": [".ts", ".tsx", ".js"],
				".cjs": [".cts", ".cjs"],
				".mjs": [".mts", ".mjs"],
			},
			extensions: [".ts", ".tsx", ".js", ".cjs", ".mjs"],
		},
		module: {
			rules: [
				{
					test: /\.tsx?$/,
					loader: "ts-loader",
					options: {
						// Use the main tsconfig for building the library source
						configFile: path.resolve(__dirname, "tsconfig.json"),
						// Skip type-checking for speed — we only need the JS output
						transpileOnly: true,
					},
				},
			],
		},
	};
};
