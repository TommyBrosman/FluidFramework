/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 */
//
// Flattened, declarative ship-only version of webpack.config.cts.
//
// Assumptions baked in:
//   - flavor === "ship"           (mode: "production", no source-map devtool conditionals)
//   - concatenateModules === true
//   - enableBundleAnalysis === false
//   - enableIncludeSourceMapsInBundles === false
//   - isIOS === false              (no iOS / "minimal" redirection bundle)
//
// Removed relative to webpack.config.cts:
//   - AzureDevOpsSymbolsPlugin
//   - externalizeTree flag / externals
//   - All polyfill modules (ProvidePlugin, NormalModuleReplacementPlugin,
//     and aliases that point at custom polyfill files such as the debug,
//     TextEncoder/TextDecoder, URL, performance, and uuid_rng polyfills)
//   - iOS-specific logic
//   - WORD_FLUID_IMPORTS alias (intentionally omitted)
//
// Kept in sync with webpack.config.cts (so this scenario behaves as close as
// possible to the external bundle measurement):
//   - DefinePlugin constants matching the ship branch
//   - resolve.alias DCE knockouts (axios, cross-fetch, crypto, dompurify) so
//     these heavy deps are tree-shaken away as they are in the external bundle
//
import path from "node:path";

// eslint-disable-next-line import-x/no-internal-modules
import { BundleComparisonPlugin } from "@mixer/webpack-bundle-compare/dist/plugin";
import TerserPlugin from "terser-webpack-plugin";
import { default as webpack } from "webpack";

const bundleName = "encapsulated-with-shared-tree.js";

// Package root for bundle-size-tests (two levels up from this scenario directory).
// `bundleStats.msp.gz` is written here so collectBundle.ts can pick it up at the
// same path it uses for the main webpack target.
const packageRoot = path.resolve(__dirname, "../..");

const config: webpack.Configuration = {
	devtool: "source-map",
	entry: {
		[bundleName]: path.resolve(__dirname, "./src/index.ts"),
	},
	mode: "production",
	module: {
		rules: [
			{
				enforce: "pre",
				test: /\.(?:js|mjs|cjs)$/,
				use: ["source-map-loader"],
			},
			{
				test: /\.tsx?$/,
				use: "ts-loader",
				exclude: /node_modules/,
			},
		],
	},
	name: bundleName,
	node: {
		global: true,
	},
	optimization: {
		concatenateModules: true,
		minimizer: [
			new TerserPlugin({
				extractComments: false,
				parallel: true,
				terserOptions: {
					format: {
						comments: false,
					},
				},
			}),
		],
		usedExports: true,
	},
	output: {
		filename: bundleName,
		library: {
			name: "encapsulatedWithSharedTree",
			type: "jsonp",
		},
		path: path.resolve(__dirname, "../../build/scenarios/encapsulated-with-shared-tree"),
	},
	plugins: [
		// NOTE: `LimitChunkCountPlugin({ maxChunks: 1 })` was intentionally removed.
		//
		// The official Fluid bundle-size metric (`getEntryStatsProcessor` in
		// build-tools/bundle-size-tools) measures an entrypoint's *initial* chunks
		// (`stats.entrypoints[name].assets`). Code behind `await import(...)` lands in
		// a separate async chunk that is NOT part of those initial assets, so it does
		// not count toward initial download size. The external ship build
		// (webpack.config.cjs) has no chunk-count limit and therefore splits this code
		// out. Forcing `maxChunks: 1` here re-merged already-deferred code (e.g. the
		// summarizer, which container-runtime loads via `await import()`) back into the
		// one measured chunk, over-counting initial size relative to production.
		//
		// Measuring the entry chunk (with code-splitting enabled) reflects real initial
		// download size, which is the metric this scenario targets.
		// Mirrors the DefinePlugin constants used by the external ship build so
		// the same code paths are eliminated by Terser DCE here. Most libraries
		// only strip dev-only warnings when `process.env.NODE_ENV === "production"`
		// is statically inlined, which is what makes this block load-bearing for
		// matching the external bundle size.
		new webpack.DefinePlugin({
			"console.warn": "console.log",
			global: {},
			"globalThis.performance": {
				mark: () => {
					/* empty impl */
				},
				measure: () => {
					/* empty impl */
				},
				now: () => 0,
			},
			"process.browser": true,
			"process.env.DEBUG": JSON.stringify(""),
			"process.env.ENABLE_WPM_OVER_OCS_SUPPORT": JSON.stringify(""),
			"process.env.NODE_DEBUG": JSON.stringify(""),
			"process.env.NODE_ENV": JSON.stringify("production"),
			"process.hrtime": undefined,
			"process.version": JSON.stringify("12.0.0"),
			"window.performance": {
				mark: () => {
					/* empty impl */
				},
				measure: () => {
					/* empty impl */
				},
				now: () => 0,
			},
		}),
		// Emits a MessagePack-compressed webpack stats file consumed by
		// compareBundles.ts. Scenario stats use a scenario-specific filename
		// (rather than `bundleStats.msp.gz`) so they do not collide with the
		// main multi-entry webpack config's output, which fluid-build invokes
		// during this package's compile pipeline.
		new BundleComparisonPlugin({
			file: path.resolve(packageRoot, "bundleAnalysis/scenarioBundleStats.msp.gz"),
		}),
	],
	resolve: {
		// DCE knockouts mirroring the external ship build. These dependencies
		// are stripped from the external bundle via `false` aliases; we do the
		// same here so unused-but-reachable transitive code (e.g. fetch shims,
		// crypto, markdown sanitizers) is tree-shaken consistently.
		alias: {
			axios: false,
			"cross-fetch": false,
			crypto: false,
			dompurify: false,
		},
		extensionAlias: {
			".js": [".js", ".ts"],
		},
		extensions: [".tsx", ".ts", ".js"],
	},
};

export default config;
