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

const bundleName = "encapsulated-no-tree.js";

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
		path: path.resolve(__dirname, "../../build/scenarios/encapsulated-no-tree"),
	},
	plugins: [
		// Force a single chunk. The consuming target is a MOBILE app bundle, not a
		// web app: there is no benefit to deferring code into separate async chunks,
		// because every byte must still ship in the single download. Measuring a
		// single merged chunk reflects the real metric — total shipped bytes — and
		// ensures only TRUE removals (not code-splitting/deferral) register as wins.
		new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
		// TRUE removal of the id-compressor implementation. The id-compressor is off
		// by default (runtimeOptions.enableRuntimeIdCompressor) and this scenario never
		// enables it, so its implementation — plus its transitive
		// `@tylerbu/sorted-btree-es6` dependency — is dead weight. ContainerRuntime
		// reaches the id-compressor exclusively through a dynamic import of
		// `./idCompressorDelayLoadedModule/index.js`; every other reference is
		// type-only. Replacing that leaf module with the throwing stub shipped by
		// container-runtime drops the entire subgraph from the bundle. Unlike code
		// splitting, this is a real removal that holds under the single-chunk metric.
		new webpack.NormalModuleReplacementPlugin(
			/idCompressorDelayLoadedModule[\\/]index\.js$/,
			(resource: { request: string }) => {
				resource.request = resource.request.replace(
					/idCompressorDelayLoadedModule[\\/]index\.js$/,
					"idCompressorDelayLoadedModuleStub.js",
				);
			},
		),
		// TRUE removal of the summarizer implementation. The summarizer (~28 KB) is
		// only needed by clients that summarize on the client; this mobile target
		// summarizes server-side and never instantiates it. ContainerRuntime reaches
		// the summarizer exclusively through a dynamic import of
		// `./summary/summaryDelayLoadedModule/index.js`; every other reference is
		// type-only except the public-API value re-exports (`Summarizer`,
		// `RunningSummarizer`, ...), which resolve to the stub's throwing versions so
		// the API surface is preserved while the implementation is dropped. Replacing
		// that leaf module with the throwing stub shipped by container-runtime removes
		// the entire subgraph from the single chunk.
		new webpack.NormalModuleReplacementPlugin(
			/summaryDelayLoadedModule[\\/]index\.js$/,
			(resource: { request: string }) => {
				resource.request = resource.request.replace(
					/summaryDelayLoadedModule[\\/]index\.js$/,
					"summaryDelayLoadedModuleStub.js",
				);
			},
		),
		// TRUE removal of the client-side summarizer election / SummaryManager machinery. This client
		// summarizes server-side and never participates in summarizer election, so the election +
		// SummaryManager subgraph is dead weight. ContainerRuntime reaches it exclusively through a
		// dynamic import of `./summary/summaryManagerDelayLoadedModule/index.js`. Replacing that leaf
		// module with the no-op stub shipped by container-runtime drops the subgraph from the single
		// chunk; the stub returns an empty result, equivalent to "this client does not elect".
		new webpack.NormalModuleReplacementPlugin(
			/summaryManagerDelayLoadedModule[\\/]index\.js$/,
			(resource: { request: string }) => {
				resource.request = resource.request.replace(
					/summaryManagerDelayLoadedModule[\\/]index\.js$/,
					"summaryManagerDelayLoadedModuleStub.js",
				);
			},
		),
		// TRUE removal of op-performance telemetry. `connectionTelemetry.js`'s `ReportOpPerfTelemetry`
		// wires up `OpPerfTelemetry`, which only emits op round-trip / connection performance telemetry
		// and has no effect on op processing or runtime state. Replacing the whole module with the no-op
		// stub shipped by container-runtime drops the `OpPerfTelemetry` implementation from the chunk.
		new webpack.NormalModuleReplacementPlugin(
			/[\\/]connectionTelemetry\.js$/,
			(resource: { request: string }) => {
				resource.request = resource.request.replace(
					/connectionTelemetry\.js$/,
					"connectionTelemetryStub.js",
				);
			},
		),
		// TRUE removal of broadcast-signal latency telemetry. `SignalTelemetryManager` only measures
		// signal round-trip latency; its sole mutation to outbound signals is an optional telemetry
		// sequence-number stamp that is not used for delivery or ordering. Replacing the module with the
		// no-op stub drops the telemetry implementation without changing signal behavior.
		new webpack.NormalModuleReplacementPlugin(
			/[\\/]signalTelemetryProcessing\.js$/,
			(resource: { request: string }) => {
				resource.request = resource.request.replace(
					/signalTelemetryProcessing\.js$/,
					"signalTelemetryProcessingStub.js",
				);
			},
		),
		// TRUE removal of attachment-blob support. This app uses only SharedString / SharedDirectory and
		// never creates or references attachment blobs, so the BlobManager implementation (and its
		// snapshot/summary helpers) is dead weight. Replacing `blobManager/index.js` with the stub
		// shipped by container-runtime drops the subgraph; the stub returns valid-empty summary/GC
		// contributions and throws only on actual blob create/get (which never happen here).
		new webpack.NormalModuleReplacementPlugin(
			/blobManager[\\/]index\.js$/,
			(resource: { request: string }) => {
				resource.request = resource.request.replace(/index\.js$/, "blobManagerStub.js");
			},
		),
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
