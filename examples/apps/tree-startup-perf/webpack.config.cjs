/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = (env) => {
	const { production } = env;

	return {
		entry: {
			app: "./src/app.ts",
		},
		resolve: {
			extensionAlias: {
				".js": [".ts", ".tsx", ".js", ".cjs", ".mjs"],
			},
			extensions: [".ts", ".tsx", ".js", ".cjs", ".mjs"],
		},
		module: {
			rules: [
				{
					test: /\.tsx?$/,
					loader: "ts-loader",
				},
			],
		},
		output: {
			filename: "[name].bundle.js",
			path: path.resolve(__dirname, "dist"),
			library: "[name]",
			devtoolNamespace: "fluid-example/tree-startup-perf",
			libraryTarget: "umd",
		},
		plugins: [
			new HtmlWebpackPlugin({
				template: "./src/index.html",
			}),
		],
		mode: production ? "production" : "development",
		devtool: production ? "source-map" : "inline-source-map",
	};
};
