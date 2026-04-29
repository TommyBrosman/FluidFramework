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
//   - All polyfills (ProvidePlugin, NormalModuleReplacementPlugin, polyfill aliases)
//   - iOS-specific logic
//   - WORD_FLUID_IMPORTS alias (intentionally omitted)
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
		new webpack.optimize.LimitChunkCountPlugin({
			maxChunks: 1,
		}),
		// Emits a MessagePack-compressed webpack stats file consumed by
		// compareBundles.ts. Path matches the one used by the main webpack
		// config so collectBundle.ts can pick up scenario stats unchanged.
		new BundleComparisonPlugin({
			file: path.resolve(packageRoot, "bundleAnalysis/bundleStats.msp.gz"),
		}),
	],
	resolve: {
		extensionAlias: {
			".js": [".js", ".ts"],
		},
		extensions: [".tsx", ".ts", ".js"],
	},
};

export default config;
