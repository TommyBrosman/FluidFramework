/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { execSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Command, Flags } from "@oclif/core";

import { maybePrintHelp } from "./oclifHelp.ts";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outerPackageRoot = resolve(scriptDirectory, "..");

/**
 * Workspace-relative path of this package, used to locate the same package
 * inside a freshly-cloned inner repo.
 */
const packageWorkspacePath = "examples/utils/bundle-size-tests";

/**
 * Gets the repository root directory for the given working directory.
 */
function getRepoRoot(cwd: string): string {
	return execSync("git rev-parse --show-toplevel", {
		cwd,
		encoding: "utf-8",
	}).trim();
}

const outerRepoRoot = getRepoRoot(outerPackageRoot);

/**
 * Where saved bundle stats live, keyed by sanitized label.
 * `compareBundles.ts` reads from `<bundleAnalysisDirectory>/<label>/bundleStats.msp.gz`.
 *
 * Lives under this package's `bundleAnalysis/` directory, which is matched by
 * the repo-wide `.gitignore` entry for `bundleAnalysis`.
 *
 * Note: `npm run clean` in this package rimrafs `bundleAnalysis/`, so any state
 * here (including the inner repo clone) is wiped on clean. The inner repo is
 * re-cloned automatically on next use.
 */
const bundleAnalysisDirectory = resolve(outerPackageRoot, "bundleAnalysis");

/**
 * Persistent location of the inner FluidFramework enlistment used for
 * collecting bundles at arbitrary revisions. Cloned from the outer repo's
 * `origin` remote on first use and reused across runs.
 *
 * Only one inner repo is ever maintained — the unique name avoids collisions
 * with label subdirectories under {@link bundleAnalysisDirectory}.
 */
const innerRepoRoot = resolve(bundleAnalysisDirectory, "base-repo");

/**
 * Sanitizes a string for use as a filename.
 */
function sanitizeForFileName(value: string): string {
	// eslint-disable-next-line unicorn/prefer-string-replace-all -- Keep regex replacement for older TS lib targets.
	return value.replace(/[^\w.-]/g, "_");
}

/**
 * Runs a command inheriting stdio, throwing on failure.
 */
function run(command: string, cwd: string): void {
	execSync(command, { cwd, stdio: "inherit" });
}

/**
 * Enables corepack and installs dependencies in the given repo.
 */
function installDependencies(repoRoot: string): void {
	console.log(`Enabling corepack and installing dependencies in ${repoRoot}...`);
	run("corepack enable", repoRoot);
	run("pnpm install", repoRoot);
}

/**
 * Runs the repo-root `clean` script, which invokes `fluid-build --task clean` across
 * the entire client release group. This is the only reliable way to clear stale
 * build artifacts for every transitive dependency of bundle-size-tests:
 *
 * - `fluid-build . --task clean` (scoped to this package) does NOT cascade into dependencies, because the `clean` task in fluidBuild.config.cjs has no `^clean`.
 * - The per-package `clean` npm scripts only remove outputs in their own package.
 */
function cleanWorkspace(repoRoot: string): void {
	console.log(`\nCleaning workspace build artifacts in ${repoRoot}...`);
	run("npm run clean", repoRoot);
}

/**
 * Compiles this package and its transitive dependencies so webpack has the
 * `lib/` outputs it needs. Uses `build:compile` to avoid the lint / docs / api-report
 * tasks pulled in by the full `build` target, which are unnecessary for bundle
 * collection and prone to unrelated failures across revisions.
 */
function buildWorkspace(packageRoot: string): void {
	console.log(`\nCompiling bundle-size-tests and its dependencies in ${packageRoot}...`);
	run("npm run build:compile", packageRoot);
}

/**
 * Builds bundles using webpack inside the given package root.
 *
 * @param packageRoot - Package root in which to invoke webpack.
 * @param scenario - If set, runs webpack directly against
 *   `scenarios/<scenario>/webpack.config.cts` instead of the default
 *   `webpack` npm script. Direct invocation (rather than
 *   `npm run webpack:scenario`) is intentional: in revision mode the inner
 *   `package.json` may predate the `webpack:scenario` script entirely (e.g.
 *   when the scenario was overlaid from the outer working tree). webpack and
 *   its loaders are already devDeps of this package across all relevant
 *   revisions, so direct invocation works regardless.
 */
function buildBundles(packageRoot: string, scenario: string | undefined): void {
	if (scenario === undefined) {
		console.log(`\nBuilding bundles with webpack in ${packageRoot}...`);
		run("npm run webpack", packageRoot);
	} else {
		console.log(
			`\nBuilding scenario bundle "${scenario}" with webpack in ${packageRoot}...`,
		);
		const configPath = resolve(
			packageRoot,
			"scenarios",
			scenario,
			"webpack.config.cts",
		);
		run(`npx webpack --config ${JSON.stringify(configPath)}`, packageRoot);
	}
}

/**
 * Moves webpack's stats output and bundle assets into the per-label directory
 * under the persistent analysis root.
 *
 * @param label - Sanitized label for this build (e.g., "main", "feature_branch").
 * @param sourcePackageRoot - Package root that produced the webpack output.
 * @param scenario - If set, copies bundle assets from
 *   `<sourcePackageRoot>/build/scenarios/<scenario>` and uses the
 *   scenario-specific stats filename `scenarioBundleStats.msp.gz`. The main
 *   webpack config also writes a `bundleStats.msp.gz` during the package's
 *   compile pipeline; using a separate scenario filename guarantees
 *   the scenario stats are not silently shadowed by the main config's output.
 *   Stats are still saved at the canonical destination filename
 *   `bundleStats.msp.gz` so compareBundles.ts can read them unchanged.
 */
function saveStats(
	label: string,
	sourcePackageRoot: string,
	scenario: string | undefined,
): void {
	const statsFileName =
		scenario === undefined ? "bundleStats.msp.gz" : "scenarioBundleStats.msp.gz";
	const webpackStatsOutputPath = resolve(
		sourcePackageRoot,
		"bundleAnalysis",
		statsFileName,
	);
	const webpackBuildOutputPath =
		scenario === undefined
			? resolve(sourcePackageRoot, "build")
			: resolve(sourcePackageRoot, "build", "scenarios", scenario);

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

	if (existsSync(webpackBuildOutputPath)) {
		const destBuildPath = resolve(labelDirectory, "build");
		rmSync(destBuildPath, { recursive: true, force: true });
		cpSync(webpackBuildOutputPath, destBuildPath, { recursive: true });
		console.log(`Saved build outputs to: ${destBuildPath}`);
	} else {
		console.warn(
			`Warning: webpack build outputs not found at ${webpackBuildOutputPath}; ` +
				`gzip sizes will be unavailable for label "${label}".`,
		);
	}
}

/**
 * Returns the URL of the outer repo's `origin` remote, used as the source
 * for cloning the inner repo.
 */
function getOuterOriginUrl(): string {
	return execSync("git config --get remote.origin.url", {
		cwd: outerRepoRoot,
		encoding: "utf-8",
	}).trim();
}

/**
 * Ensures the inner FluidFramework enlistment exists under {@link innerRepoRoot}.
 *
 * On first call, clones from the outer repo's `origin` remote. On subsequent
 * calls, reuses the existing clone (an explicit `git fetch` is performed before
 * checkout to ensure the requested revision is available).
 *
 * Never modifies the outer repo's working tree, branch, or stash.
 */
function ensureInnerRepo(): void {
	if (existsSync(resolve(innerRepoRoot, ".git"))) {
		return;
	}

	const originUrl = getOuterOriginUrl();
	mkdirSync(dirname(innerRepoRoot), { recursive: true });
	console.log(`\nCloning inner repo from ${originUrl} into ${innerRepoRoot}...`);
	// Filter blobs to keep the clone fast; blobs are fetched lazily on checkout.
	run(
		`git clone --filter=blob:none ${JSON.stringify(originUrl)} ${JSON.stringify(innerRepoRoot)}`,
		dirname(innerRepoRoot),
	);
}

/**
 * Discards all uncommitted changes and untracked files in the **inner repo only**.
 *
 * Required because {@link overlayScenarioFromOuter} writes into tracked paths
 * inside the inner repo (e.g. `scenarios/<scenario>/webpack.config.cts`).
 * Those edits would otherwise block the next `git checkout --detach` with
 * "Your local changes would be overwritten by checkout".
 *
 * **SAFETY: This is destructive — `git reset --hard` and `git clean -fdx`
 * permanently discard work. It MUST NEVER be invoked against the outer
 * repository.** The inner repo at {@link innerRepoRoot} is treated as
 * ephemeral scratch space (it is re-cloned automatically if missing, and
 * its working tree is not user-authored), so wiping it is safe; the outer
 * repo is the user's working enlistment and is never touched by this
 * script.
 *
 * The single call site for this function is {@link syncInnerRepoToRevision},
 * which is itself only invoked from the revision branch of
 * {@link CollectBundleCommand.run}. Local-mode (outer-repo) collection
 * never reaches this code path.
 */
function resetInnerRepo(): void {
	// Defense in depth: refuse to run if the path we were handed is somehow
	// not the inner repo (e.g. a future refactor wires the outer root in by
	// mistake). Both the literal path equality and the assertion that we are
	// not the outer repo must hold.
	if (innerRepoRoot === outerRepoRoot) {
		throw new Error(
			`resetInnerRepo refused to run: innerRepoRoot equals outerRepoRoot (${outerRepoRoot}). ` +
				`This function is only safe to call against the ephemeral inner repo.`,
		);
	}
	console.log(`\nResetting inner repo working tree to discard any prior overlays...`);
	run("git reset --hard HEAD", innerRepoRoot);
	run("git clean -fdx", innerRepoRoot);
}

/**
 * Fetches the latest refs and checks out the requested revision in the inner repo.
 * The revision can be a branch, tag, or commit SHA.
 *
 * @remarks Calls {@link resetInnerRepo} before checkout so that any overlays
 * left from a previous run (see {@link overlayScenarioFromOuter}) do not
 * block the checkout. This is safe because the inner repo is ephemeral; the
 * outer repo is never touched by this function.
 */
function syncInnerRepoToRevision(revision: string): void {
	resetInnerRepo();

	console.log(`\nFetching latest refs in inner repo...`);
	run("git fetch --tags origin", innerRepoRoot);

	console.log(`Checking out revision "${revision}" in inner repo...`);
	// Use detached HEAD checkout so we don't have to manage local branch state.
	run(`git checkout --detach ${JSON.stringify(revision)}`, innerRepoRoot);
}

/**
 * Mirrors `<outerPackageRoot>/scenarios/<scenario>/` into the inner package's
 * `scenarios/` directory so revision-mode builds use the scenario definition
 * from the outer working tree (rather than whatever version, if any, exists
 * at the base revision).
 *
 * The outer working tree is treated as the source of truth for scenarios:
 * the scenario harness (webpack config, plugins, entry point) is part of the
 * comparison machinery, not part of the code under comparison. Overlaying
 * unconditionally guarantees both the local and base bundles are produced
 * with byte-identical webpack configs, so the diff reflects only the
 * underlying dependency code.
 *
 * Existing files in the destination are overwritten (the inner repo is in a
 * detached HEAD state and treated as ephemeral, so this is safe). The outer
 * working tree is read-only.
 *
 * Limitations: only the scenario directory itself is overlaid. devDeps,
 * `package.json` scripts, and other package-level changes at the outer
 * revision are NOT propagated. The scenario should depend only on what is
 * already a devDep of this package across both revisions; if it does not,
 * the build will fail loudly during webpack invocation.
 */
function overlayScenarioFromOuter(scenario: string, innerPackageRoot: string): void {
	const outerScenarioDir = resolve(outerPackageRoot, "scenarios", scenario);
	const innerScenarioDir = resolve(innerPackageRoot, "scenarios", scenario);

	if (!existsSync(outerScenarioDir)) {
		throw new Error(
			`Cannot overlay scenario "${scenario}": source not found in outer working ` +
				`tree at ${outerScenarioDir}.`,
		);
	}

	console.log(
		`\nOverlaying scenario "${scenario}" from outer working tree:\n` +
			`  source: ${outerScenarioDir}\n` +
			`  dest:   ${innerScenarioDir}`,
	);
	mkdirSync(dirname(innerScenarioDir), { recursive: true });
	rmSync(innerScenarioDir, { recursive: true, force: true });
	cpSync(outerScenarioDir, innerScenarioDir, { recursive: true });
}

/**
 * Collects a single bundle from either the outer enlistment (local mode) or a
 * separate inner enlistment checked out to a specific revision (revision mode).
 *
 * In revision mode, the inner repo at {@link innerRepoRoot} is cloned from the
 * outer repo's `origin` remote on first use and reused thereafter. The outer
 * repo's working tree, branch, and stash are never modified.
 */
class CollectBundleCommand extends Command {
	public static override readonly description =
		"Build and collect a bundle, either from the outer enlistment (local mode) or " +
		"from a separate inner enlistment checked out to a specific revision (revision mode). " +
		"The outer repo's working tree, branch, and stash are never modified.";

	public static override readonly examples = [
		"<%= config.bin %> <%= command.id %>",
		"<%= config.bin %> <%= command.id %> --mode revision --revision main",
		"<%= config.bin %> <%= command.id %> --mode revision --revision v2.20.0",
		"<%= config.bin %> <%= command.id %> --scenario encapsulated-no-tree",
	];

	public static override readonly flags = {
		mode: Flags.string({
			description:
				"local: collect from the outer enlistment. revision: collect from a separate " +
				"inner enlistment checked out at --revision.",
			options: ["local", "revision"] as const,
			default: "local",
		}),
		revision: Flags.string({
			description:
				"(revision mode only, required) Branch, tag, or commit SHA to check out " +
				"in the inner repo before building. Also used as the default label.",
		}),
		label: Flags.string({
			description:
				"Override the directory name under which bundle stats are saved. " +
				'Defaults to the sanitized revision in revision mode, or "current" in local mode.',
		}),
		scenario: Flags.string({
			description:
				"If set, build the named scenario under `scenarios/<scenario>/` instead " +
				"of the default multi-entry webpack target. The scenario must define " +
				"`scenarios/<scenario>/webpack.config.cts` that emits " +
				"`scenarioBundleStats.msp.gz` into the package's `bundleAnalysis/` dir. In " +
				"revision mode, the scenario is overlaid from the outer working tree by " +
				"default so both sides build with the same harness (see --no-overlay-scenario).",
		}),
		"no-overlay-scenario": Flags.boolean({
			description:
				"(revision mode only) Disable overlaying the scenario from the outer " +
				"working tree. With this set, the scenario must already exist at the base " +
				"revision; if it does not, the build will fail loudly.",
			default: false,
		}),
		"force-clean-build": Flags.boolean({
			description:
				"Run the full workspace clean ('npm run clean' at the repo root) before " +
				"building. Off by default; opt in when stale incremental build state from a " +
				"previous revision may interfere with the current one.",
			default: false,
		}),
	};

	public async run(): Promise<void> {
		const { flags } = await this.parse(CollectBundleCommand);

		const mode = flags.mode as "local" | "revision";
		const { revision, scenario } = flags;
		const forceCleanBuild = flags["force-clean-build"];
		const noOverlayScenario = flags["no-overlay-scenario"];

		if (mode === "revision" && (revision === undefined || revision.length === 0)) {
			this.error("--mode revision requires --revision <rev>.", { exit: 1 });
		}

		const label = sanitizeForFileName(
			flags.label ?? (mode === "revision" ? (revision as string) : "current"),
		);

		let activeRepoRoot: string;
		let activePackageRoot: string;

		if (mode === "local") {
			activeRepoRoot = outerRepoRoot;
			activePackageRoot = outerPackageRoot;
		} else {
			ensureInnerRepo();
			// Only the inner repo's revision is changed. The outer repo is never touched.
			syncInnerRepoToRevision(revision as string);
			activeRepoRoot = innerRepoRoot;
			activePackageRoot = resolve(innerRepoRoot, packageWorkspacePath);
			if (!existsSync(activePackageRoot)) {
				this.error(
					`Expected package not found in inner repo at ${activePackageRoot}. ` +
						`The revision "${revision as string}" may predate this package.`,
					{ exit: 1 },
				);
			}
			installDependencies(activeRepoRoot);
		}

		if (scenario !== undefined) {
			const scenarioConfigPath = resolve(
				activePackageRoot,
				"scenarios",
				scenario,
				"webpack.config.cts",
			);
			if (mode === "revision" && !noOverlayScenario) {
				// Always overlay in revision mode (regardless of whether the scenario
				// exists at the base): the outer scenario is the source of truth for
				// the comparison harness, so both sides should build with the same
				// webpack config / plugins / entry point.
				overlayScenarioFromOuter(scenario, activePackageRoot);
			} else if (!existsSync(scenarioConfigPath)) {
				this.error(
					`Scenario webpack config not found at ${scenarioConfigPath}. ` +
						(mode === "revision"
							? `The revision "${revision as string}" may predate this scenario; ` +
								`drop --no-overlay-scenario to overlay it from the outer working tree.`
							: `Check that "scenarios/${scenario}" exists.`),
					{ exit: 1 },
				);
			}
		}

		if (forceCleanBuild) {
			cleanWorkspace(activeRepoRoot);
		}
		buildWorkspace(activePackageRoot);
		buildBundles(activePackageRoot, scenario);
		saveStats(label, activePackageRoot, scenario);

		console.log(`\n${"=".repeat(80)}`);
		console.log(
			`✓ Bundle collection complete (mode: ${mode}, label: ${label}` +
				(scenario === undefined ? "" : `, scenario: ${scenario}`) +
				").",
		);
		console.log(`  Stats directory: ${resolve(bundleAnalysisDirectory, label)}`);
		console.log("=".repeat(80));
	}
}

if (!maybePrintHelp(process.argv.slice(2), "collectBundle.ts", CollectBundleCommand)) {
	await CollectBundleCommand.run(process.argv.slice(2), import.meta.url);
}
