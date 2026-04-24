/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { execSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");

/**
 * Environment for all child processes we spawn.
 *
 * This script is itself launched via `tsx --tsconfig ./tsconfig.scripts.json`
 * (see the `collect:bundles` npm script). tsx propagates that choice to
 * subprocesses via the `TSX_TSCONFIG_PATH` env var. If we inherit it blindly,
 * any child that also runs tsx (e.g. fluid-build -> `tsx scripts/print-configs.ts`
 * in @fluidframework/eslint-config-fluid) will try to load `./tsconfig.scripts.json`
 * relative to its own cwd and fail. We also strip `TSX_TSCONFIG_CONTENT` for the
 * same reason. Everything else is inherited normally.
 */
const childEnv: NodeJS.ProcessEnv = (() => {
	const env = { ...process.env };
	delete env.TSX_TSCONFIG_PATH;
	delete env.TSX_TSCONFIG_CONTENT;
	return env;
})();

/**
 * Gets the repository root directory.
 *
 * @returns The absolute path to the repository root
 */
function getRepoRoot(): string {
	return execSync("git rev-parse --show-toplevel", {
		encoding: "utf-8",
		env: childEnv,
	}).trim();
}

const repoRoot = getRepoRoot();

/**
 * Root of persistent state for collect/compare runs.
 * Lives in the OS temp directory so it survives:
 *   - `git checkout` between branches (which would overwrite in-tree untracked files)
 *   - `npm run clean` (which rimrafs bundleAnalysis/ under the package)
 */
const analysisRoot = resolve(tmpdir(), "fluid-bundle-compare");

/**
 * Where saved bundle stats live, keyed by sanitized branch label.
 * compareBundles.ts reads from `<analysisRoot>/bundleAnalysis/<label>/bundleStats.msp.gz`.
 */
const bundleAnalysisDirectory = resolve(analysisRoot, "bundleAnalysis");

/**
 * State file used to coordinate restore after an aborted run.
 * Written before the first branch switch; removed on clean exit.
 */
const stateFilePath = resolve(analysisRoot, "state.json");

/**
 * Webpack writes its raw output here (inside the package).
 * `saveStats` moves it out of the package into `bundleAnalysisDirectory`.
 */
const webpackStatsOutputPath = resolve(packageRoot, "bundleAnalysis", "bundleStats.msp.gz");

/**
 * Persistent state saved before we start mutating the working tree.
 */
interface RunState {
	/** ISO timestamp at which the run started. */
	createdAt: string;
	/** The branch we must return to on completion or restore. */
	originalBranch: string;
	/** Unique marker embedded in the stash message so we can find it later. */
	stashMarker: string;
	/** True if a stash entry was actually created with that marker. */
	stashed: boolean;
}

/**
 * Sanitizes a string for use as a filename by replacing non-alphanumeric characters with underscores.
 *
 * @param value - The string to sanitize
 * @returns The sanitized string safe for use as a filename
 */
function sanitizeForFileName(value: string): string {
	// eslint-disable-next-line unicorn/prefer-string-replace-all -- Keep regex replacement for older TS lib targets.
	return value.replace(/[^\w.-]/g, "_");
}

/**
 * Gets the current git branch name.
 *
 * @returns The current branch name
 */
function getCurrentBranch(): string {
	return execSync("git rev-parse --abbrev-ref HEAD", {
		cwd: repoRoot,
		encoding: "utf-8",
		env: childEnv,
	}).trim();
}

/**
 * Writes the run state file.
 */
function writeState(state: RunState): void {
	mkdirSync(analysisRoot, { recursive: true });
	writeFileSync(stateFilePath, `${JSON.stringify(state, undefined, 2)}\n`);
}

/**
 * Reads the run state file if it exists.
 */
function readState(): RunState | undefined {
	if (!existsSync(stateFilePath)) {
		return undefined;
	}
	try {
		return JSON.parse(readFileSync(stateFilePath, "utf-8")) as RunState;
	} catch {
		return undefined;
	}
}

/**
 * Removes the run state file if it exists.
 */
function clearState(): void {
	if (existsSync(stateFilePath)) {
		rmSync(stateFilePath, { force: true });
	}
}

/**
 * Generates a unique marker for the git stash created by this run.
 */
function generateStashMarker(): string {
	return `fluid-bundle-collect:${Date.now()}-${process.pid}`;
}

/**
 * Stashes current changes (if any) with the given marker embedded in the message.
 *
 * @returns True if a stash entry was created, false if there was nothing to stash.
 */
function stashChanges(marker: string): boolean {
	const output = execSync(`git stash push -u -m "${marker}"`, {
		cwd: repoRoot,
		encoding: "utf-8",
		env: childEnv,
	}).trim();
	if (output.includes("No local changes")) {
		return false;
	}
	console.log(`Stashed local changes (marker: ${marker})`);
	return true;
}

/**
 * Finds the stash list index for the stash entry containing the given marker in its subject.
 *
 * @returns The stash ref (e.g. "stash@{2}"), or undefined if no matching stash is found.
 */
function findStashRefByMarker(marker: string): string | undefined {
	const list = execSync("git stash list", {
		cwd: repoRoot,
		encoding: "utf-8",
		env: childEnv,
	});
	for (const line of list.split("\n")) {
		if (line.includes(marker)) {
			const match = line.match(/^(stash@\{\d+\})/);
			if (match !== null) {
				return match[1];
			}
		}
	}
	return undefined;
}

/**
 * Pops the stash entry whose subject contains the given marker.
 *
 * @returns True if a matching stash was found and popped, false otherwise.
 */
function popStashByMarker(marker: string): boolean {
	const stashRef = findStashRefByMarker(marker);
	if (stashRef === undefined) {
		console.warn(`No stash entry found matching marker "${marker}".`);
		return false;
	}
	try {
		execSync(`git stash pop ${stashRef}`, {
			cwd: repoRoot,
			stdio: "inherit",
			env: childEnv,
		});
		console.log(`Restored stashed changes from ${stashRef}.`);
		return true;
	} catch (error) {
		console.warn(
			`Could not pop stash ${stashRef}:`,
			error instanceof Error ? error.message : String(error),
		);
		return false;
	}
}

/**
 * Checks out a git branch without force (preserves untracked files).
 *
 * @param branchName - The branch to check out
 */
function checkoutBranch(branchName: string): void {
	console.log(`\nChecking out branch: ${branchName}`);
	execSync(`git checkout ${branchName}`, {
		cwd: repoRoot,
		stdio: "inherit",
		env: childEnv,
	});
}

/**
 * Installs dependencies for the currently checked-out revision.
 */
function installDependencies(): void {
	console.log("Enabling corepack and installing dependencies...");
	execSync("corepack enable", {
		cwd: repoRoot,
		stdio: "inherit",
		env: childEnv,
	});
	execSync("pnpm install", {
		cwd: repoRoot,
		stdio: "inherit",
		env: childEnv,
	});
}

/**
 * Runs the repo-root `clean` script, which invokes `fluid-build --task clean` across
 * the entire client release group. This is the only reliable way to clear stale
 * build artifacts for every transitive dependency of bundle-size-tests:
 *
 *   - `fluid-build . --task clean` (scoped to this package) does NOT cascade into
 *     dependencies, because the `clean` task in fluidBuild.config.cjs has no `^clean`.
 *   - The per-package `clean` npm scripts only remove outputs in their own package.
 *
 * Only runs when --force-clean-build is set. By default we rely on fluid-build's
 * content-hash based incremental detection: when sources change across a git
 * checkout, their hashes differ from the stored `*.done.build.log`, and the
 * affected packages rebuild. This is usually sufficient and much faster.
 */
function forceCleanBuild(): void {
	console.log("\nForce-cleaning all workspace build artifacts (fluid-build --task clean)...");
	execSync("npm run clean", {
		cwd: repoRoot,
		stdio: "inherit",
		env: childEnv,
	});
}

/**
 * Builds this package and its transitive dependencies so webpack has the lib/
 * outputs it needs.
 *
 * Runs the `build:compile` script (`fluid-build . --task compile`), which only
 * produces the JS outputs webpack consumes. We deliberately do NOT run the full
 * `build` task: that also pulls in `lint`, `check:format`, `build:api-reports`,
 * `build:docs`, etc. across every transitive dependency. Those are:
 *   - unnecessary for producing webpack bundles, and
 *   - prone to unrelated failures across revisions (e.g. lint rule changes),
 *     which would make bundle-size comparison impossible whenever any
 *     non-code check happens to be broken at either revision.
 *
 * fluid-build uses content-hash based incremental detection, so after a `git
 * checkout` to a different revision, source hashes differ from the stored
 * `*.done.build.log` and the affected packages rebuild automatically. This
 * means a prior clean is not normally required (see --force-clean-build).
 */
function buildWorkspace(): void {
	console.log("\nCompiling bundle-size-tests and its dependencies...");
	execSync("npm run build:compile", {
		cwd: packageRoot,
		stdio: "inherit",
		env: childEnv,
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
		env: childEnv,
	});
}

/**
 * Moves webpack's raw stats output into the per-label directory under the persistent
 * analysis root (in the OS temp dir).
 *
 * @param label - The label for this build (e.g., "main", "feature_branch")
 */
function saveStats(label: string): void {
	const labelDirectory = resolve(bundleAnalysisDirectory, label);
	const destStatsPath = resolve(labelDirectory, "bundleStats.msp.gz");

	if (!existsSync(webpackStatsOutputPath)) {
		throw new Error(
			`Bundle stats not found at ${webpackStatsOutputPath}. ` +
				`Check that webpack ran successfully.`,
		);
	}

	mkdirSync(labelDirectory, { recursive: true });
	// Use copy + unlink instead of renameSync because the source and destination
	// may live on different drives (e.g. D: -> C:\Users\<user>\AppData\Local\Temp),
	// which causes renameSync to fail with EXDEV on Windows.
	copyFileSync(webpackStatsOutputPath, destStatsPath);
	unlinkSync(webpackStatsOutputPath);
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
  tsx ./scripts/collectBundles.ts [options]

Options:
  --help, -h              Show this help text and exit.
  --base-branch <name>    Base branch name (default: main)
  --current-branch <name> Current branch name (default: current git branch)
  --clean-analysis-dir    Remove the persistent bundleAnalysis directory before starting
  --force-clean-build     Run a full workspace clean (fluid-build --task clean) at each
                          revision before building. By default, we rely on fluid-build's
                          content-hash based incremental detection, which is usually
                          sufficient to rebuild only what changed across the checkout.
                          Use this if you suspect stale artifacts are influencing the
                          comparison.
  --restore-only          Do not collect anything. Instead, use the state file left by a
                          previous aborted run to check out the original branch, reinstall
                          dependencies, and pop the matching stash (if any).
  --exit-after-build      Debug only. Stop after building the workspace at the base branch
                          (before webpack). Skips the automatic restore so the workspace
                          can be inspected at the base revision. Run --restore-only to
                          return to the original branch and pop the stash.

Persistent state lives under: ${analysisRoot}

Examples:
  tsx ./scripts/collectBundles.ts
  tsx ./scripts/collectBundles.ts --base-branch main --current-branch feature/my-changes
  tsx ./scripts/collectBundles.ts --clean-analysis-dir
  tsx ./scripts/collectBundles.ts --force-clean-build
  tsx ./scripts/collectBundles.ts --restore-only
`);
}

/**
 * Performs the restore-only workflow: read state, return to original branch,
 * reinstall dependencies, pop the matching stash, and clear state.
 */
function restoreFromState(): void {
	const state = readState();
	if (state === undefined) {
		console.log(`No run state found at ${stateFilePath}. Nothing to restore.`);
		return;
	}

	console.log(`Found run state from ${state.createdAt}.`);
	console.log(`  originalBranch: ${state.originalBranch}`);
	console.log(`  stashMarker:    ${state.stashMarker}`);
	console.log(`  stashed:        ${state.stashed}`);

	const currentBranch = getCurrentBranch();
	if (currentBranch !== state.originalBranch) {
		checkoutBranch(state.originalBranch);
	} else {
		console.log(`Already on original branch (${state.originalBranch}).`);
	}

	installDependencies();

	if (state.stashed) {
		popStashByMarker(state.stashMarker);
	} else {
		console.log("No stash to restore (nothing was stashed at start of run).");
	}

	clearState();
	console.log(`\n${"=".repeat(80)}`);
	console.log("✓ Restore complete.");
	console.log("=".repeat(80));
}

/**
 * Main entry point: collects bundle stats from two branches.
 *
 * @param argv - The command-line argument list
 */
function main(argv: string[]): void {
	if (hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
		printHelp();
		return;
	}

	if (hasFlag(argv, "--restore-only")) {
		restoreFromState();
		return;
	}

	const baseBranch = getOptionValue(argv, "--base-branch") ?? "main";
	const currentBranch = getOptionValue(argv, "--current-branch") ?? getCurrentBranch();
	const cleanAnalysisDir = hasFlag(argv, "--clean-analysis-dir");
	const forceCleanBuildFlag = hasFlag(argv, "--force-clean-build");
	const exitAfterBuild = hasFlag(argv, "--exit-after-build");

	const existingState = readState();
	if (existingState !== undefined) {
		throw new Error(
			`Found leftover run state at ${stateFilePath} from ${existingState.createdAt}. ` +
				`A previous collect run may have been aborted. ` +
				`Run with --restore-only to recover, or delete the state file manually if you are sure it is stale.`,
		);
	}

	const originalBranch = getCurrentBranch();
	const stashMarker = generateStashMarker();

	try {
		if (cleanAnalysisDir && existsSync(bundleAnalysisDirectory)) {
			console.log(`\nCleaning bundleAnalysis directory: ${bundleAnalysisDirectory}`);
			rmSync(bundleAnalysisDirectory, { recursive: true });
		}

		// Record state BEFORE mutating the working tree so that --restore-only
		// can recover from any failure after this point.
		writeState({
			createdAt: new Date().toISOString(),
			originalBranch,
			stashMarker,
			stashed: false,
		});

		const hasStash = stashChanges(stashMarker);
		if (hasStash) {
			writeState({
				createdAt: new Date().toISOString(),
				originalBranch,
				stashMarker,
				stashed: true,
			});
		}

		try {
			if (getCurrentBranch() !== baseBranch) {
				checkoutBranch(baseBranch);
				installDependencies();
			}
			if (forceCleanBuildFlag) {
				forceCleanBuild();
			}
			buildWorkspace();

			if (exitAfterBuild) {
				console.log(`\n${"=".repeat(80)}`);
				console.log("--exit-after-build: stopping after base-branch build.");
				console.log(`  Currently checked out: ${getCurrentBranch()}`);
				console.log(
					"  State file retained at:",
					stateFilePath,
				);
				console.log(
					"  Use --restore-only to return to the original branch and pop the stash.",
				);
				console.log("=".repeat(80));
				return;
			}

			buildBundles();
			saveStats(sanitizeForFileName(baseBranch));

			if (getCurrentBranch() !== currentBranch) {
				checkoutBranch(currentBranch);
				installDependencies();
			}
			if (forceCleanBuildFlag) {
				forceCleanBuild();
			}
			buildWorkspace();
			buildBundles();
			saveStats(sanitizeForFileName(currentBranch));

			if (getCurrentBranch() !== originalBranch) {
				checkoutBranch(originalBranch);
			}
		} finally {
			if (!exitAfterBuild) {
				// Always ensure original branch has fresh dependencies and restore stash if needed.
				const nowOn = getCurrentBranch();
				if (nowOn !== originalBranch) {
					checkoutBranch(originalBranch);
				}
				installDependencies();
				if (hasStash) {
					popStashByMarker(stashMarker);
				}
				clearState();
			}
			// When exitAfterBuild is set, intentionally skip the automatic restore
			// so the user can inspect the workspace at the failing revision.
			// Run --restore-only to clean up.
		}

		console.log(`\n${"=".repeat(80)}`);
		console.log("✓ Bundle collection complete!");
		console.log(`  Stats directory: ${bundleAnalysisDirectory}`);
		console.log("=".repeat(80));
	} catch (error) {
		console.error("\n✖ Error:", error instanceof Error ? error.message : String(error));
		console.error(
			`If the working tree or branch is in an inconsistent state, re-run with --restore-only.`,
		);
		throw error;
	}
}

main(process.argv.slice(2));
