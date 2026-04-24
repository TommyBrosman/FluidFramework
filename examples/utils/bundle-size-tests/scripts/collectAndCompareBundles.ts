/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");
const bundleAnalysisDirectory = resolve(packageRoot, "bundleAnalysis");

/**
 * Sanitizes a string for use as a filename by replacing non-alphanumeric characters with underscores.
 *
 * @param value - The string to sanitize
 * @returns The sanitized string safe for use as a filename
 */
function sanitizeForFileName(value: string): string {
	return value.replace(/[^\w.-]/g, "_");
}

/**
 * Gets the current git branch name.
 *
 * @returns The current branch name
 */
function getCurrentBranch(): string {
	return execSync("git rev-parse --abbrev-ref HEAD", {
		cwd: packageRoot,
		encoding: "utf-8",
	}).trim();
}

/**
 * Stashes current changes if any exist.
 *
 * @returns True if changes were stashed, false otherwise
 */
function stashChanges(): boolean {
	try {
		const output = execSync("git stash push -u", {
			cwd: packageRoot,
			encoding: "utf-8",
		}).trim();
		// If nothing was stashed, output says "No local changes to save"
		if (output && !output.includes("No local changes")) {
			console.log("Stashed local changes");
			return true;
		}
		return false;
	} catch {
		return false;
	}
}

/**
 * Restores the most recent stash.
 */
function restoreStash(): void {
	try {
		execSync("git stash pop", {
			cwd: packageRoot,
			encoding: "utf-8",
		});
		console.log("Restored stashed changes");
	} catch (error) {
		console.warn(
			"Could not restore stashed changes:",
			error instanceof Error ? error.message : String(error),
		);
	}
}

/**
 * Checks out a git branch without force (preserves untracked files like bundleAnalysis/).
 *
 * @param branchName - The branch to check out
 */
function checkoutBranch(branchName: string): void {
	console.log(`\nChecking out branch: ${branchName}`);
	execSync(`git checkout ${branchName}`, {
		cwd: packageRoot,
		stdio: "inherit",
	});
}

/**
 * Builds bundles using webpack.
 */
function buildBundles(): void {
	console.log("\nBuilding bundles with webpack...");
	execSync("npm run webpack", {
		cwd: packageRoot,
		stdio: "inherit",
	});
}

/**
 * Saves the generated stats file to a label-specific subdirectory.
 * Assumes webpack has just run and created bundleAnalysis/bundleStats.msp.gz.
 *
 * @param label - The label for this build (e.g., "main", "feature_branch")
 */
function saveStats(label: string): void {
	const tempStatsPath = resolve(bundleAnalysisDirectory, "bundleStats.msp.gz");
	const labelDirectory = resolve(bundleAnalysisDirectory, label);
	const destStatsPath = resolve(labelDirectory, "bundleStats.msp.gz");

	if (!existsSync(tempStatsPath)) {
		throw new Error(
			`Bundle stats not found at ${tempStatsPath}. ` + `Check that webpack ran successfully.`,
		);
	}

	mkdirSync(labelDirectory, { recursive: true });
	renameSync(tempStatsPath, destStatsPath);
	console.log(`Saved stats to: ${destStatsPath}`);
}

/**
 * Extracts the value of a command-line option from the argument list.
 *
 * @param argv - The command-line argument list
 * @param optionName - The name of the option to extract
 * @returns The option value, or undefined if not found
 */
function getOptionValue(argv: string[], optionName: string): string | undefined {
	const optionPrefix = `${optionName}=`;
	const index = argv.findIndex((arg) => arg === optionName || arg.startsWith(optionPrefix));
	if (index === -1) {
		return undefined;
	}

	const optionArg = argv[index];
	if (optionArg === undefined) {
		return undefined;
	}

	if (optionArg.startsWith(optionPrefix)) {
		return optionArg.slice(optionPrefix.length);
	}

	return argv[index + 1];
}

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
  --current-branch <name> Current branch name (default: current git branch)
  --skip-compare          Collect stats only, skip the comparison step
  --clean                 Remove bundleAnalysis directory before starting

Examples:
  tsx ./scripts/collectAndCompareBundles.ts
  tsx ./scripts/collectAndCompareBundles.ts --base-branch main --current-branch feature/my-changes
  tsx ./scripts/collectAndCompareBundles.ts --clean --skip-compare
`);
}

/**
 * Main entry point: collects bundle stats from two branches and runs comparison.
 *
 * @param argv - The command-line argument list
 */
function main(argv: string[]): void {
	if (hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
		printHelp();
		return;
	}

	const baseBranch = getOptionValue(argv, "--base-branch") ?? "main";
	const currentBranch = getOptionValue(argv, "--current-branch") ?? getCurrentBranch();
	const skipCompare = hasFlag(argv, "--skip-compare");
	const clean = hasFlag(argv, "--clean");

	const originalBranch = getCurrentBranch();

	try {
		if (clean && existsSync(bundleAnalysisDirectory)) {
			console.log(`\nCleaning bundleAnalysis directory...`);
			rmSync(bundleAnalysisDirectory, { recursive: true });
		}

		// Stash local changes before switching branches
		const hasStash = stashChanges();

		try {
			// Collect base branch stats
			if (originalBranch !== baseBranch) {
				checkoutBranch(baseBranch);
			}
			buildBundles();
			saveStats(sanitizeForFileName(baseBranch));

			// Collect current branch stats
			if (originalBranch !== currentBranch && baseBranch !== currentBranch) {
				checkoutBranch(currentBranch);
			}
			buildBundles();
			saveStats(sanitizeForFileName(currentBranch));

			// Return to original branch
			if (originalBranch !== currentBranch && originalBranch !== baseBranch) {
				checkoutBranch(originalBranch);
			}
		} finally {
			// Restore stashed changes if any were made
			if (hasStash) {
				restoreStash();
			}
		}

		// Run comparison unless skipped
		if (!skipCompare) {
			console.log("\n" + "=".repeat(80));
			console.log("Running bundle comparison...");
			console.log("=".repeat(80));

			const compareScript = resolve(scriptDirectory, "compareBundles.ts");
			const result = spawnSync(
				"tsx",
				[
					"--tsconfig",
					resolve(packageRoot, "tsconfig.scripts.json"),
					compareScript,
					"--base-branch",
					baseBranch,
					"--current-branch",
					currentBranch,
					"--analysis-dir",
					packageRoot,
				],
				{
					cwd: packageRoot,
					stdio: "inherit",
				},
			);

			if (result.status !== 0 && result.status !== null) {
				throw new Error(`Comparison script exited with code ${result.status}`);
			}
		}

		console.log("\n" + "=".repeat(80));
		console.log("✓ Bundle collection and comparison complete!");
		console.log("=".repeat(80));
	} catch (error) {
		console.error("\n❌ Error:", error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

main(process.argv.slice(2));
