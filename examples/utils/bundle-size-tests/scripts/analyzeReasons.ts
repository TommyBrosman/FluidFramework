/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Analyzes which Fluid-package modules end up in a scenario's production
 * bundle, and **why** — i.e. which named import in the scenario entry (or
 * which `--root` module) caused each module to be pulled in.
 *
 * Defaults to `@fluidframework/tree`. Use `--root` to point at any other
 * package's lib module (e.g.
 * `runtime/container-runtime/containerRuntime.js`) to analyze that package's
 * forward-reachable fan-out instead.
 *
 * Usage:
 *
 * ```
 * npx jiti scripts/analyzeReasons.ts [--scenario \<name\>] [--out \<path\>] [--root \<path\>]
 * ```
 *
 * What it does:
 *
 * 1. **No `--root`**: parses the scenario entry to find the
 *    `@fluidframework/tree/legacy` import statement and the list of
 *    runtime-imported names. For each name, locates the declaring file in
 *    `packages/dds/tree/lib`. That file is the API's "owning module".
 *    **With `--root`**: uses the provided module directly as the single
 *    owner.
 * 2. Builds the scenario's production bundle (`mode: production`,
 *    `concatenateModules: true`, terser-minified, exactly as the scenario
 *    config defines), with a source map.
 * 3. Runs source-map-explorer on the produced bundle to get **real
 *    post-minification bundle bytes** per source file across all
 *    `packages/*` modules. These numbers reflect what's actually in the
 *    shipped bundle.
 * 4. Builds a second webpack pass with `concatenateModules: false` so the
 *    reasons graph can be inspected. From each owning module, performs a
 *    forward BFS over the reasons graph to collect every module within the
 *    target package (derived from `--root`, or `packages/dds/tree/lib/` by
 *    default) reachable through it.
 * 5. Emits a concise Markdown report. Sizes come from step 3 (real bundle
 *    bytes); attribution comes from step 4.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { default as webpack } from "webpack";

const localRequire = createRequire(import.meta.url);

interface Reason {
	moduleName?: string;
	userRequest?: string;
}

interface StatsModule {
	name?: string;
	identifier?: string;
	size?: number;
	reasons?: Reason[];
}

interface CliFlags {
	scenario: string;
	outPath: string;
	cutoff: number;
	root: string | undefined;
}

function parseFlags(): CliFlags {
	const argv = process.argv.slice(2);
	let scenario = "encapsulated-no-tree";
	let outPath: string | undefined;
	let cutoff = 0;
	let root: string | undefined;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--scenario": {
				scenario = argv[++i] ?? scenario;
				break;
			}
			case "--out": {
				outPath = argv[++i];
				break;
			}
			case "--cutoff": {
				const raw = argv[++i] ?? "0";
				const parsed = Number(raw);
				if (!Number.isFinite(parsed) || parsed < 0) {
					throw new TypeError(`--cutoff expects a non-negative number, got ${raw}`);
				}
				cutoff = parsed;
				break;
			}
			case "--root": {
				root = argv[++i];
				break;
			}
			case "-h":
			case "--help": {
				console.log(
					"Usage: jiti scripts/analyzeReasons.ts [--scenario <name>] [--out <path>] [--cutoff <bytes>] [--root <lib-relpath>]",
				);
				process.exit(0);
			}
			default: {
				break;
			}
		}
	}
	const defaultBaseName = root === undefined
		? `reasons-${scenario}.md`
		: `reasons-${scenario}-${path.basename(root).replace(/\.js$/, "")}.md`;
	return {
		scenario,
		outPath: outPath ?? path.resolve(packageRoot, "bundleAnalysis", defaultBaseName),
		cutoff,
		root,
	};
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..", "..");
const treeLibDir = path.resolve(repoRoot, "packages", "dds", "tree", "lib");
const DEFAULT_PKG_FRAGMENT = "packages/dds/tree/lib/";

/**
 * Extract `packages/<pkg-path>/lib/` from a webpack-stats-form module name
 * like `../../../packages/runtime/container-runtime/lib/containerRuntime.js`.
 */
function packageFragmentFromStats(statsName: string): string {
	const pkgIdx = statsName.indexOf("packages/");
	if (pkgIdx === -1) {
		throw new Error(`Cannot derive package fragment from: ${statsName}`);
	}
	const libIdx = statsName.indexOf("/lib/", pkgIdx);
	if (libIdx === -1) {
		throw new Error(`Module path does not include a /lib/ segment: ${statsName}`);
	}
	return statsName.slice(pkgIdx, libIdx + "/lib/".length);
}

type JitiFactory = (root: string, options?: unknown) => (id: string) => unknown;

async function loadScenarioConfig(scenario: string): Promise<webpack.Configuration> {
	const configPath = path.resolve(packageRoot, "scenarios", scenario, "webpack.config.cts");
	const jitiFactory = localRequire("jiti") as JitiFactory;
	const jiti = jitiFactory(packageRoot, { interopDefault: true });
	const mod = jiti(configPath) as { default?: webpack.Configuration } | webpack.Configuration;
	return (
		(mod as { default?: webpack.Configuration }).default ?? (mod as webpack.Configuration)
	);
}

async function runWebpack(config: webpack.Configuration): Promise<webpack.StatsCompilation> {
	return new Promise((resolve, reject) => {
		webpack(config, (error, stats) => {
			if (error !== null && error !== undefined) {
				reject(error);
				return;
			}
			if (stats === undefined) {
				reject(new Error("No stats produced"));
				return;
			}
			if (stats.hasErrors()) {
				reject(new Error(stats.toString({ errors: true, errorDetails: true })));
				return;
			}
			resolve(
				stats.toJson({
					all: false,
					modules: true,
					reasons: true,
					ids: true,
					cachedModules: true,
				}),
			);
		});
	});
}

/** Pretty short label for a fluid-package module path. */
function shortName(name: string, pkgFragment: string): string {
	const idx = name.indexOf(pkgFragment);
	if (idx !== -1) {
		// Strip `packages/<owner>/<pkg>/lib/` down to `<pkg>/<rest>`.
		const pkgRoot = pkgFragment.slice("packages/".length, -"/lib/".length);
		const pkgLabel = pkgRoot.split("/").at(-1) ?? pkgRoot;
		return `${pkgLabel}/${name.slice(idx + pkgFragment.length)}`;
	}
	// Fallback: strip a generic `packages/.../lib/` prefix if any.
	const generic = /packages\/(?:[^/]+\/)*([^/]+)\/lib\//.exec(name);
	if (generic !== null) {
		return `${generic[1]}/${name.slice(generic.index + generic[0].length)}`;
	}
	return name;
}

function formatTreePrefix(isLast: boolean[]): { indent: string; branch: string } {
	const indent = isLast
		.slice(0, -1)
		.map((l) => (l ? "    " : "│   "))
		.join("");
	const last = isLast.at(-1);
	const branch = last === undefined ? "" : last ? "└── " : "├── ";
	return { indent, branch };
}

function isInTargetPackage(name: string | undefined, pkgFragment: string): boolean {
	return name?.includes(pkgFragment) ?? false;
}

/**
 * Parse the scenario entry source. Returns the list of names imported (as
 * values, not types) from `@fluidframework/tree/legacy`.
 */
function parseEntryImports(scenario: string): { runtime: string[]; typeOnly: string[] } {
	const entryPath = path.resolve(packageRoot, "scenarios", scenario, "src", "index.ts");
	const src = readFileSync(entryPath, "utf8");
	// Find the import block ending with `from "@fluidframework/tree/legacy"`.
	// Match an `(export|import) { ... } from "@fluidframework/tree/legacy"` block.
	// `[^}]+` keeps the body within a single brace pair (no other braces nested).
	const re =
		/(?:export|import)\s*(?:type\s+)?{([^}]+)}\s*from\s*["']@fluidframework\/tree\/legacy["']/g;
	const runtime: string[] = [];
	const typeOnly: string[] = [];
	for (const match of src.matchAll(re)) {
		const blockIsTypeOnly = /(?:export|import)\s+type\s+{/.test(match[0]);
		const body = match[1];
		// Split on commas. Each item may be `Foo`, `type Foo`, `Foo as Bar`, `type Foo as Bar`.
		for (const rawItem of body.split(",")) {
			const item = rawItem.trim();
			if (item === "") continue;
			const itemIsType = /^type\s+/.test(item);
			const cleaned = item.replace(/^type\s+/, "");
			const name = cleaned.split(/\s+as\s+/u)[0].trim();
			if (name === "") continue;
			if (blockIsTypeOnly || itemIsType) typeOnly.push(name);
			else runtime.push(name);
		}
	}
	return { runtime, typeOnly };
}

/**
 * For each runtime-imported name, find the file in the tree dist that
 * declares the export. Returns a map from API name to absolute module name
 * (matching the form webpack reports in stats: `../../../packages/dds/tree/lib/...`).
 */
function findOwningModules(names: string[]): Map<string, string> {
	const owners = new Map<string, string>();
	// Use grep to find all `export (class|const|function|let|var) NAME` in the tree dist.
	for (const name of names) {
		try {
			const out = execFileSync(
				"grep",
				[
					"-rlE",
					`^export (class|const|function|let|var) ${name}\\b`,
					"--include=*.js",
					treeLibDir,
				],
				{ encoding: "utf8" },
			).trim();
			const lines = out.split("\n").filter((s) => s !== "");
			if (lines.length === 0) {
				continue;
			}
			// Prefer the shortest path (least nested) — that's typically the
			// declaring file rather than a re-export.
			const declaring = lines
				.filter((p) => p.endsWith(".js"))
				.sort((a, b) => a.length - b.length)[0];
			if (declaring === undefined) continue;
			// Convert absolute path to webpack-style relative.
			const rel = path.relative(packageRoot, declaring).replaceAll(path.sep, "/");
			owners.set(name, rel.startsWith("..") ? rel : `./${rel}`);
		} catch {
			// grep returns non-zero if no match; skip.
		}
	}
	return owners;
}

/**
 * Build forward (parent -\> children) and reverse (child -\> parents) edge maps
 * from a flat module list.
 */
interface Graph {
	parents: Map<string, Set<string>>;
	children: Map<string, Set<string>>;
}

function buildGraph(modules: StatsModule[]): Graph {
	const parents = new Map<string, Set<string>>();
	const children = new Map<string, Set<string>>();
	const ensure = (m: Map<string, Set<string>>, k: string): Set<string> => {
		let v = m.get(k);
		if (v === undefined) {
			v = new Set();
			m.set(k, v);
		}
		return v;
	};
	for (const m of modules) {
		if (m.name === undefined) continue;
		for (const r of m.reasons ?? []) {
			const parent = r.moduleName;
			if (parent === undefined) continue;
			ensure(parents, m.name).add(parent);
			ensure(children, parent).add(m.name);
		}
	}
	return { parents, children };
}

/**
 * BFS forward from `start`, returning every module in the target package
 * reachable through the graph (traversal walks the full graph; only modules
 * matching `pkgFragment` are returned).
 */
function reachablePackageModules(graph: Graph, start: string, pkgFragment: string): Set<string> {
	const seen = new Set<string>();
	const stack = [start];
	while (stack.length > 0) {
		const cur = stack.pop();
		if (cur === undefined || seen.has(cur)) continue;
		seen.add(cur);
		for (const c of graph.children.get(cur) ?? []) {
			stack.push(c);
		}
	}
	const out = new Set<string>();
	for (const n of seen) if (isInTargetPackage(n, pkgFragment)) out.add(n);
	return out;
}

/** source-map-explorer JSON shape (subset). */
interface SmeBundleResult {
	bundleName: string;
	totalBytes: number;
	mappedBytes: number;
	files: Record<string, { size: number }>;
}
interface SmeResult {
	results: SmeBundleResult[];
}

/**
 * Run source-map-explorer on the bundle and return a map from
 * webpack-stats-form module name (e.g.
 * `../../../packages/dds/tree/lib/foo.js`) to bundle bytes, covering every
 * `packages/<pkg>/src/...` source file present. `targetTotal` is the subset
 * of those bytes from the target package (matched by `pkgFragment`).
 */
function smePackageSizes(
	bundlePath: string,
	scenario: string,
	pkgFragment: string,
): { sizes: Map<string, number>; total: number; targetTotal: number } {
	const tmpJson = path.resolve(tmpdir(), `sme-${scenario}.json`);
	execFileSync(
		"npx",
		["source-map-explorer", "--no-border-checks", "--json", tmpJson, bundlePath],
		{ cwd: packageRoot, stdio: "ignore" },
	);
	const j = JSON.parse(readFileSync(tmpJson, "utf8")) as SmeResult;
	const sizes = new Map<string, number>();
	let total = 0;
	let targetTotal = 0;
	for (const result of j.results) {
		total = result.totalBytes;
		for (const [file, info] of Object.entries(result.files)) {
			// source-map-explorer keys look like:
			//   webpack://encapsulatedWithSharedTree/packages/runtime/container-runtime/src/foo.ts
			// We want the same module key webpack stats uses:
			//   ../../../packages/runtime/container-runtime/lib/foo.js
			// Map src/<x>.ts -> lib/<x>.js, regardless of which fluid package.
			const idx = file.indexOf("packages/");
			if (idx === -1) continue;
			const afterPackages = file.slice(idx + "packages/".length);
			const srcIdx = afterPackages.indexOf("/src/");
			if (srcIdx === -1) continue;
			const pkg = afterPackages.slice(0, srcIdx);
			const subpath = afterPackages
				.slice(srcIdx + "/src/".length)
				.replace(/\.tsx?$/, ".js");
			const statsName = `../../../packages/${pkg}/lib/${subpath}`;
			sizes.set(statsName, (sizes.get(statsName) ?? 0) + info.size);
			if (statsName.includes(pkgFragment)) {
				targetTotal += info.size;
			}
		}
	}
	return { sizes, total, targetTotal };
}

interface ApiRow {
	api: string;
	owner: string | undefined;
	ownerSize: number;
	reachableModules: string[];
	reachableSize: number;
	uniqueSize: number;
}

function buildReport(
	scenario: string,
	flags: { runtime: string[]; typeOnly: string[] },
	graph: Graph,
	apiRows: ApiRow[],
	moduleSizes: Map<string, number>,
	bundleTotal: number,
	targetTotal: number,
	bundlePath: string,
	cutoff: number,
	pkgFragment: string,
	rootMode: boolean,
): string {
	// Label for the package being analyzed, e.g.
	// `packages/dds/tree/lib/` -> `@fluidframework/tree`-ish: just last segment.
	const pkgRoot = pkgFragment.slice("packages/".length, -"/lib/".length);
	const pkgLabel = pkgRoot.split("/").at(-1) ?? pkgRoot;
	const lines: string[] = [];
	lines.push(`# ${pkgLabel} reasons — scenario \`${scenario}\``);
	lines.push("");
	lines.push(
		`Bundle: \`${path.basename(bundlePath)}\` — ${bundleTotal.toLocaleString()} B total · ${targetTotal.toLocaleString()} B from \`${pkgLabel}\` (${((targetTotal / bundleTotal) * 100).toFixed(1)}%).`,
	);
	lines.push("");
	if (rootMode) {
		lines.push(
			`Analysis rooted at: **${flags.runtime.length === 1 ? `\`${flags.runtime[0]}\`` : `${flags.runtime.length} modules`}** (via \`--root\`).`,
		);
	} else {
		lines.push(
			`Scenario imports from \`@fluidframework/tree/legacy\`: **${flags.runtime.length} runtime**, **${flags.typeOnly.length} type-only**.`,
		);
	}
	lines.push("");
	lines.push(
		"All sizes below are **real production bundle bytes** (post-minify, post-concat) attributed via the source map.",
	);
	lines.push("");

	lines.push(`## Per-API summary`);
	lines.push("");
	lines.push(
		`- \`Reachable B\` — bytes of all \`${pkgLabel}\` modules forward-reachable from this API's owning module.`,
	);
	lines.push(
		"- `Unique B` — bytes that are reachable **only** from this API (no other listed API reaches them). Removing the API would let tree-shaking drop these.",
	);
	lines.push(
		`- \`Modules\` — count of \`${pkgLabel}\` modules forward-reachable from this API's owning module.`,
	);
	lines.push("");
	lines.push("| API | Owner module | Reachable B | Unique B | Modules |");
	lines.push("|---|---|---:|---:|---:|");
	const sorted = [...apiRows].sort((a, b) => b.reachableSize - a.reachableSize);
	for (const r of sorted) {
		const owner = r.owner === undefined ? "(not found)" : shortName(r.owner, pkgFragment);
		lines.push(
			`| \`${r.api}\` | \`${owner}\` | ${r.reachableSize.toLocaleString()} | ${r.uniqueSize.toLocaleString()} | ${r.reachableModules.length} |`,
		);
	}
	lines.push("");

	if (flags.typeOnly.length > 0) {
		lines.push(
			`Type-only imports (cost 0 B): ${flags.typeOnly.map((n) => `\`${n}\``).join(", ")}.`,
		);
		lines.push("");
	}

	lines.push(`## Per-API import chains`);
	lines.push("");
	lines.push(
		"For each API, this shows the **import chain** — the tree of modules reached starting from the API's owning module. Each node is printed at most once across the whole tree, in DFS-preorder of the first API to reach it. Children are sorted by descending bundle bytes.",
	);
	lines.push("");
	lines.push(
		"Notation: `A B  module/path  [shared: api1, api2]` where `A` = bytes of this module and `B` = sum of bytes for this module plus all of its descendants printed beneath it. Lines marked `(see above)` are modules already printed earlier in the same tree or by a previous API; they are not re-expanded.",
	);
	lines.push("");
	if (cutoff > 0) {
		lines.push(
			`Pruning: subtrees with Σ &lt; **${cutoff.toLocaleString()} B** are folded into a single \`(N modules pruned, Σ X B)\` summary line. The API root itself is always shown.`,
		);
		lines.push("");
	}

	const printedGlobally = new Set<string>();
	const targetChildren = (m: string): string[] =>
		[...(graph.children.get(m) ?? [])].filter((c) => isInTargetPackage(c, pkgFragment));

	// Compute subtree-byte totals (treating the spanning DFS tree from this
	// root, where each module is counted once; descendants encountered later
	// down a sibling branch are shared and counted there).
	function computeSubtreeSize(root: string, alreadyPrinted: Set<string>): Map<string, number> {
		const subtree = new Map<string, number>();
		const counted = new Set<string>(alreadyPrinted);
		function dfs(node: string): number {
			if (counted.has(node)) return 0;
			counted.add(node);
			let total = moduleSizes.get(node) ?? 0;
			const kids = targetChildren(node).sort(
				(a, b) => (moduleSizes.get(b) ?? 0) - (moduleSizes.get(a) ?? 0),
			);
			for (const k of kids) total += dfs(k);
			subtree.set(node, total);
			return total;
		}
		dfs(root);
		return subtree;
	}

	function sharersOf(m: string, currentApi: string): string[] {
		return sorted
			.filter((other) => other.api !== currentApi && other.reachableModules.includes(m))
			.map((other) => other.api);
	}

	function dfsPrint(
		node: string,
		isLast: boolean[],
		subtree: Map<string, number>,
		currentApi: string,
	): void {
		const { indent, branch } = formatTreePrefix(isLast);
		if (printedGlobally.has(node)) {
			lines.push(`${indent}${branch}\`${shortName(node, pkgFragment)}\` (see above)`);
			return;
		}
		printedGlobally.add(node);
		const ownB = moduleSizes.get(node) ?? 0;
		const subB = subtree.get(node) ?? ownB;
		const sh = sharersOf(node, currentApi);
		const sharedLabel = sh.length === 0 ? "" : `  [shared: ${sh.join(", ")}]`;
		lines.push(
			`${indent}${branch}\`${shortName(node, pkgFragment)}\`  ${ownB.toLocaleString()} B / Σ ${subB.toLocaleString()} B${sharedLabel}`,
		);
		const allKids = targetChildren(node).sort(
			(a, b) => (subtree.get(b) ?? 0) - (subtree.get(a) ?? 0),
		);
		// Apply cutoff: a child is shown if it's a `(see above)` reference
		// (cheap, informative) OR its fresh subtree size meets the cutoff.
		const shown: string[] = [];
		const pruned: string[] = [];
		for (const k of allKids) {
			const isRepeat = printedGlobally.has(k);
			const sz = subtree.get(k) ?? 0;
			if (isRepeat || cutoff <= 0 || sz >= cutoff) {
				shown.push(k);
			} else {
				pruned.push(k);
			}
		}
		const hasPrunedSummary = pruned.length > 0;
		for (let idx = 0; idx < shown.length; idx++) {
			const isLastShown = idx === shown.length - 1 && !hasPrunedSummary;
			dfsPrint(shown[idx], [...isLast, isLastShown], subtree, currentApi);
		}
		if (hasPrunedSummary) {
			const prunedTotal = pruned.reduce((acc, k) => acc + (subtree.get(k) ?? 0), 0);
			const { indent: pIndent, branch: pBranch } = formatTreePrefix([...isLast, true]);
			lines.push(
				`${pIndent}${pBranch}(${pruned.length} ${pruned.length === 1 ? "subtree" : "subtrees"} below cutoff, Σ ${prunedTotal.toLocaleString()} B)`,
			);
		}
	}

	for (const r of sorted) {
		if (r.owner === undefined) {
			lines.push(`### \`${r.api}\` — owner not located in package lib`);
			lines.push("");
			continue;
		}
		lines.push(
			`### \`${r.api}\` (${shortName(r.owner, pkgFragment)}) — ${r.reachableSize.toLocaleString()} B reachable, ${r.uniqueSize.toLocaleString()} B unique`,
		);
		lines.push("");
		const subtree = computeSubtreeSize(r.owner, printedGlobally);
		lines.push("```");
		dfsPrint(r.owner, [], subtree, r.api);
		lines.push("```");
		lines.push("");
	}

	// Modules that are in the bundle but not attributed to any API
	// (e.g. side-effect-only imports of barrel modules; should be small).
	const attributed = new Set<string>();
	for (const r of apiRows) for (const m of r.reachableModules) attributed.add(m);
	const orphans = [...moduleSizes.entries()]
		.filter(([m]) => isInTargetPackage(m, pkgFragment) && !attributed.has(m))
		.sort((a, b) => b[1] - a[1]);
	if (orphans.length > 0) {
		lines.push(`## ${pkgLabel} modules in bundle but not attributed`);
		lines.push("");
		lines.push(
			`These \`${pkgLabel}\` modules show up in source-map-explorer but no API's owning module reaches them in the reasons graph (typically barrel/side-effect-only modules).`,
		);
		lines.push("");
		lines.push("| Module | B |");
		lines.push("|---|---:|");
		for (const [m, sz] of orphans) {
			lines.push(`| \`${shortName(m, pkgFragment)}\` | ${sz.toLocaleString()} |`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

/**
 * Normalize a `--root` argument to the webpack-stats module name. Accepts
 * stats form (`../../../packages/runtime/container-runtime/lib/x.js`),
 * repo-relative (`packages/runtime/container-runtime/lib/x.js`), stripped
 * (`runtime/container-runtime/lib/x.js`), or the legacy tree shorthand
 * (`tree/shared-tree/treeCheckout.js`, `shared-tree/treeCheckout.js`).
 */
function normalizeRoot(raw: string): string {
	if (raw.startsWith("../") || raw.startsWith("./")) return raw;
	if (raw.startsWith("packages/")) return `../../../${raw}`;
	if (raw.startsWith("tree/")) {
		return `../../../packages/dds/tree/lib/${raw.slice("tree/".length)}`;
	}
	if (raw.includes("/lib/")) {
		// Stripped form: `<pkg-path>/lib/<rest>`.
		return `../../../packages/${raw}`;
	}
	// Backward-compat: bare `<rest>` is treated as tree lib-relative.
	return `../../../packages/dds/tree/lib/${raw}`;
}

async function main(): Promise<void> {
	const flags = parseFlags();

	let imports: { runtime: string[]; typeOnly: string[] };
	let owners: Map<string, string> = new Map();
	let pkgFragment: string = DEFAULT_PKG_FRAGMENT;
	if (flags.root === undefined) {
		console.log(`[1/5] Parsing scenario entry imports...`);
		imports = parseEntryImports(flags.scenario);
		console.log(`  ${imports.runtime.length} runtime: ${imports.runtime.join(", ")}`);
		console.log(`  ${imports.typeOnly.length} type-only: ${imports.typeOnly.join(", ")}`);
	} else {
		const normalized = normalizeRoot(flags.root);
		pkgFragment = packageFragmentFromStats(normalized);
		const apiName = shortName(normalized, pkgFragment);
		console.log(`[1/5] Using explicit --root override: ${apiName} (pkg: ${pkgFragment})`);
		imports = { runtime: [apiName], typeOnly: [] };
		owners = new Map([[apiName, normalized]]);
	}

	if (flags.root === undefined) {
		console.log(`[2/5] Locating owning modules in tree dist...`);
		if (!existsSync(treeLibDir)) {
			throw new Error(
				`Tree dist not found at ${treeLibDir}. Build @fluidframework/tree first.`,
			);
		}
		owners = findOwningModules(imports.runtime);
		for (const name of imports.runtime) {
			const o = owners.get(name);
			console.log(`  ${name} -> ${o === undefined ? "(not found)" : shortName(o, pkgFragment)}`);
		}
	} else {
		console.log(`[2/5] Skipping owning-module lookup (using --root).`);
	}

	console.log(`[3/5] Building production bundle...`);
	const baseConfig = await loadScenarioConfig(flags.scenario);
	const prodConfig: webpack.Configuration = {
		...baseConfig,
		mode: "production",
		output: {
			...baseConfig.output,
			path: path.resolve(tmpdir(), `analyzeReasons-prod-${flags.scenario}`),
		},
		plugins: (baseConfig.plugins ?? []).filter(
			(p: unknown) =>
				(p as { constructor?: { name?: string } } | null)?.constructor?.name !==
				"BundleComparisonPlugin",
		),
	};
	await runWebpack(prodConfig);
	const bundleFile =
		typeof prodConfig.output?.filename === "string" ? prodConfig.output.filename : undefined;
	if (bundleFile === undefined) {
		throw new Error("Could not determine bundle filename from scenario config.");
	}
	const outDir = prodConfig.output?.path;
	if (typeof outDir !== "string") {
		throw new TypeError("Bundle output path is not a string.");
	}
	const bundlePath = path.resolve(outDir, bundleFile);
	if (!existsSync(bundlePath)) {
		throw new Error(`Bundle not produced at ${bundlePath}`);
	}

	console.log(`[4/5] Running source-map-explorer for real bundle bytes...`);
	const { sizes, total, targetTotal } = smePackageSizes(bundlePath, flags.scenario, pkgFragment);
	const targetCount = [...sizes.keys()].filter((k) => k.includes(pkgFragment)).length;
	console.log(
		`  Bundle ${total.toLocaleString()} B total, ${targetTotal.toLocaleString()} B from ${pkgFragment} (${targetCount} modules).`,
	);

	console.log(`[5/5] Building reasons graph (no concat)...`);
	const graphConfig: webpack.Configuration = {
		...baseConfig,
		mode: "production",
		profile: true,
		optimization: {
			...baseConfig.optimization,
			concatenateModules: false,
			minimize: false,
			usedExports: true,
		},
		output: {
			...baseConfig.output,
			path: path.resolve(tmpdir(), `analyzeReasons-graph-${flags.scenario}`),
		},
		plugins: (baseConfig.plugins ?? []).filter(
			(p: unknown) =>
				(p as { constructor?: { name?: string } } | null)?.constructor?.name !==
				"BundleComparisonPlugin",
		),
	};
	const stats = await runWebpack(graphConfig);
	const modules = (stats.modules ?? []) as StatsModule[];
	const graph = buildGraph(modules);
	console.log(`  ${modules.length} modules in graph.`);

	// Compute per-API reachable sets.
	const apiRows: ApiRow[] = [];
	const reachByApi = new Map<string, Set<string>>();
	for (const name of imports.runtime) {
		const owner = owners.get(name);
		if (owner === undefined) {
			apiRows.push({
				api: name,
				owner: undefined,
				ownerSize: 0,
				reachableModules: [],
				reachableSize: 0,
				uniqueSize: 0,
			});
			continue;
		}
		const reach = reachablePackageModules(graph, owner, pkgFragment);
		reach.add(owner);
		reachByApi.set(name, reach);
		const reachableSize = [...reach].reduce((s, m) => s + (sizes.get(m) ?? 0), 0);
		apiRows.push({
			api: name,
			owner,
			ownerSize: sizes.get(owner) ?? 0,
			reachableModules: [...reach],
			reachableSize,
			uniqueSize: 0,
		});
	}
	// Compute unique-to-this-API bytes.
	for (const row of apiRows) {
		if (row.owner === undefined) continue;
		const myReach = reachByApi.get(row.api);
		if (myReach === undefined) continue;
		let unique = 0;
		for (const m of myReach) {
			let sharedByOther = false;
			for (const [otherApi, otherReach] of reachByApi) {
				if (otherApi === row.api) continue;
				if (otherReach.has(m)) {
					sharedByOther = true;
					break;
				}
			}
			if (!sharedByOther) unique += sizes.get(m) ?? 0;
		}
		row.uniqueSize = unique;
	}

	const report = buildReport(
		flags.scenario,
		imports,
		graph,
		apiRows,
		sizes,
		total,
		targetTotal,
		bundlePath,
		flags.cutoff,
		pkgFragment,
		flags.root !== undefined,
	);
	writeFileSync(flags.outPath, report);
	console.log(`\nReport written to: ${flags.outPath}`);
}

await main();
