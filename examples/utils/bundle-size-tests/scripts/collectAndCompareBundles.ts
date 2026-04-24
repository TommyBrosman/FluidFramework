/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");

/**
 * Checks if a flag is present in the command-line argument list.
 *
 * @param argv - The command-line argument list
 * @param flagName - The flag to check for
 * @returns True if the flag is present, false otherwise
 */
function hasFlag(argv: string[], flagName: string): boolean {
	return argv.includes(flagName);
}

/**
 * Runs a script with tsx and inherited stdio.
 *
 * @param scriptName - Script file name under ./scripts/
 * @param scriptArgs - Arguments to forward to the script
 */
function runScript(scriptName: string, scriptArgs: string[]): void {
	const scriptPath = resolve(scriptDirectory, scriptName);
	const result = spawnSync(
		"tsx",
		[
			"--tsconfig",
			resolve(packageRoot, "tsconfig.scripts.json"),
			scriptPath,
			...scriptArgs,
		],
		{
			cwd: packageRoot,
			stdio: "inherit",
		},
	);

	if (result.status !== 0 && result.status !== null) {
		throw new Error(`Script ${scriptName} exited with code ${result.status}`);
	}
}

/**
 * Prints the help text describing usage and options.
 */
function printHelp(): void {
	console.log(`
Usage:
  tsx ./scripts/collectAndCompareBundles.ts [options]

Options:
  --help, -h
    Show this help text and exit.

  --base-branch <name>    Base branch name (default: main)
  --current-branch <name> Current branch name (default: current git branch or CI branch)
  --skip-compare          Collect stats only, skip the comparison step
  --clean                 Remove bundleAnalysis directory before starting

Examples:
  tsx ./scripts/collectAndCompareBundles.ts
  tsx ./scripts/collectAndCompareBundles.ts --base-branch main --current-branch feature/my-changes
  tsx ./scripts/collectAndCompareBundles.ts --clean --skip-compare
`);
}

/**
 * Main entry point: runs collection followed by comparison.
 *
 * @param argv - The command-line argument list
 */
function main(argv: string[]): void {
	if (hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
		printHelp();
		return;
	}

	const skipCompare = hasFlag(argv, "--skip-compare");
	const collectionArgs = argv.filter((arg) => arg !== "--skip-compare");

	try {
		console.log(`\n${"=".repeat(80)}`);
		console.log("Collecting bundle stats...");
		console.log("=".repeat(80));
		runScript("collectBundles.ts", collectionArgs);

		if (!skipCompare) {
			console.log(`\n${"=".repeat(80)}`);
			console.log("Running bundle comparison...");
			console.log("=".repeat(80));
			runScript("compareBundles.ts", collectionArgs);
		}

		console.log(`\n${"=".repeat(80)}`);
		console.log("✓ Bundle collection and comparison complete!");
		console.log("=".repeat(80));
	} catch (error) {
		console.error("\n✖ Error:", error instanceof Error ? error.message : String(error));
		throw error;
	}
}

main(process.argv.slice(2));
