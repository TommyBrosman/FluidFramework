/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 */
//
// Experimental variant of webpack.config.cts that uses babel-loader with
// @react-native/babel-preset instead of ts-loader. The intent is to measure
// the impact (if any) of the React Native preset on final bundle size.
//
// Notes:
//   - @react-native/babel-preset includes @babel/preset-typescript, so we
//     can feed .ts directly to babel-loader.
//   - We also run babel-loader over .js files (including node_modules) since
//     most of the bundle's mass comes from already-compiled package code
//     in node_modules. Without this, the preset would only affect the tiny
//     entry file and have effectively no impact on size.
//   - Output is written to a sibling directory so it can be compared
//     against the ts-loader build without overwriting it.
//
import path from "node:path";

import TerserPlugin from "terser-webpack-plugin";
import { default as webpack } from "webpack";

const withoutTree = process.env.WITHOUT_TREE === "1";
const bundleName = "encapsulated-with-shared-tree.js";
const entryFile = withoutTree ? "./src/index.no-tree.ts" : "./src/index.ts";
const outDirSuffix = withoutTree ? "-no-tree" : "";

const babelLoader = {
	loader: "babel-loader",
	options: {
		babelrc: false,
		configFile: false,
		cacheDirectory: false,
		presets: [
			[
				"@react-native/babel-preset",
				{
					// Disable transforms that assume a Metro runtime / hot-reload environment.
					disableImportExportTransform: true,
					enableBabelRuntime: false,
					unstable_disableES06Transforms: false,
				},
			],
		],
		// Required so webpack can still tree-shake ESM after babel runs.
		sourceType: "unambiguous",
	},
};

const config: webpack.Configuration = {
	devtool: "source-map",
	entry: {
		[bundleName]: path.resolve(__dirname, entryFile),
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
				exclude: /node_modules/,
				use: [babelLoader],
			},
			{
				test: /\.(?:js|mjs|cjs)$/,
				use: [babelLoader],
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
		path: path.resolve(
			__dirname,
			`../../build/scenarios/encapsulated-with-shared-tree-babel${outDirSuffix}`,
		),
	},
	plugins: [
		new webpack.optimize.LimitChunkCountPlugin({
			maxChunks: 1,
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
