/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");

/**
 * Path to the jiti CLI entrypoint.
 *
 * `jiti`'s package.json `exports` map does not expose its CLI file directly,
 * but its `bin` field points to it. We resolve the package's own package.json
 * (always exported) and then resolve the bin path relative to that.
 */
const jitiCliPath = (() => {
	const req = createRequire(import.meta.url);
	const jitiPackageJsonPath = req.resolve("jiti/package.json");
	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
	const jitiPackageJson = req("jiti/package.json") as { bin?: string | Record<string, string> };
	const binField = jitiPackageJson.bin;
	const binRelPath = typeof binField === "string" ? binField : binField?.jiti;
	if (binRelPath === undefined) {
		throw new Error("Unable to locate jiti CLI via its package.json bin field.");
	}
	return resolve(dirname(jitiPackageJsonPath), binRelPath);
})();

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
 * Runs a script with jiti and inherited stdio.
 *
 * Invokes the local jiti CLI directly via `process.execPath` to avoid relying
 * on `jiti` being on PATH (which is flaky on Windows / npm script contexts).
 *
 * @param scriptName - Script file name under ./scripts/
 * @param scriptArgs - Arguments to forward to the script
 */
function runScript(scriptName: string, scriptArgs: string[]): void {
	const scriptPath = resolve(scriptDirectory, scriptName);
	const result = spawnSync(process.execPath, [jitiCliPath, scriptPath, ...scriptArgs], {
		cwd: packageRoot,
		stdio: "inherit",
	});

	if (result.error !== undefined) {
		throw new Error(
			`Failed to launch script ${scriptName}: ${result.error.message}`,
		);
	}
	if (result.status !== 0) {
		throw new Error(
			`Script ${scriptName} exited with code ${result.status ?? "null (signal)"}.`,
		);
	}
}

/**
 * Prints the help text describing usage and options.
 */
function printHelp(): void {
	console.log(`
Usage:
  jiti ./scripts/collectAndCompareBundles.ts [options]

Options:
  --help, -h
    Show this help text and exit.

  --base-branch <name>    Base branch name (default: main)
  --current-branch <name> Current branch name (default: current git branch or CI branch)
  --skip-compare          Collect stats only, skip the comparison step
  --clean-analysis-dir    Remove the persistent bundleAnalysis directory before starting
  --skip-clean-build      Skip the full workspace clean that normally runs before each
                          build. By default we run 'fluid-build --task clean' at the
                          repo root before building each revision so the comparison is
                          not affected by stale artifacts. Skipping is faster but may
                          produce incorrect sizes or build errors if incremental build
                          state from a previous revision interferes with the current one.
  --restore-only          Do not collect or compare. Use the state file left by a previous
                          aborted run to check out the original branch, reinstall
                          dependencies, and pop the matching stash (if any).

Examples:
  jiti ./scripts/collectAndCompareBundles.ts
  jiti ./scripts/collectAndCompareBundles.ts --base-branch main --current-branch feature/my-changes
  jiti ./scripts/collectAndCompareBundles.ts --clean-analysis-dir --skip-compare
  jiti ./scripts/collectAndCompareBundles.ts --skip-clean-build
  jiti ./scripts/collectAndCompareBundles.ts --restore-only
`);
}

/**
 * Extracts the value of a command-line option from the argument list.
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
 * Main entry point: runs collection followed by comparison.
 *
 * @param argv - The command-line argument list
 */
function main(argv: string[]): void {
	if (hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
		printHelp();
		return;
	}

	// Restore-only short-circuits: delegate to collectBundles and skip comparison.
	if (hasFlag(argv, "--restore-only")) {
		runScript("collectBundles.ts", ["--restore-only"]);
		return;
	}

	const baseBranch = getOptionValue(argv, "--base-branch");
	const currentBranch = getOptionValue(argv, "--current-branch");
	const skipCompare = hasFlag(argv, "--skip-compare");
	const cleanAnalysisDir = hasFlag(argv, "--clean-analysis-dir");
	const skipCleanBuildFlag = hasFlag(argv, "--skip-clean-build");

	const collectArgs: string[] = [];
	const compareArgs: string[] = [];
	if (baseBranch !== undefined) {
		collectArgs.push("--base-branch", baseBranch);
		compareArgs.push("--base-branch", baseBranch);
	}
	if (currentBranch !== undefined) {
		collectArgs.push("--current-branch", currentBranch);
		compareArgs.push("--current-branch", currentBranch);
	}
	if (cleanAnalysisDir) {
		collectArgs.push("--clean-analysis-dir");
	}
	if (skipCleanBuildFlag) {
		collectArgs.push("--skip-clean-build");
	}

	try {
		console.log(`\n${"=".repeat(80)}`);
		console.log("Collecting bundle stats...");
		console.log("=".repeat(80));
		runScript("collectBundles.ts", collectArgs);

		if (!skipCompare) {
			console.log(`\n${"=".repeat(80)}`);
			console.log("Running bundle comparison...");
			console.log("=".repeat(80));
			runScript("compareBundles.ts", compareArgs);
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
