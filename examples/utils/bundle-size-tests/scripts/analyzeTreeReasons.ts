/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Analyzes which `@fluidframework/tree` modules end up in the
 * `encapsulated-with-shared-tree` bundle and **why** — i.e. which entry-level
 * API caused each one to be pulled in transitively.
 *
 * Run with:
 *
 * ```
 * npx jiti scripts/analyzeTreeReasons.ts [--scenario \<name\>] [--out \<path\>]
 * ```
 *
 * What it does:
 *
 * 1. Loads the scenario's webpack config (default scenario:
 *    `encapsulated-with-shared-tree`).
 * 2. Forces `concatenateModules: false` and disables minimization so
 *    per-module reasons are preserved in the stats output. Tree-shaking
 *    (`usedExports`) is left enabled, so only modules that actually survive
 *    tree-shaking are present.
 * 3. Walks the reasons graph backward from each `@fluidframework/tree`
 *    module to the scenario entry to determine which named API on the
 *    `@fluidframework/tree/legacy` import line is responsible.
 * 4. Approximates each tree module's contribution to the production bundle
 *    by minifying its source individually with terser (the same minifier
 *    webpack production uses) and reporting raw + min + gzip bytes.
 * 5. Emits a Markdown report grouping tree modules by entry API.
 *
 * Caveats:
 *
 * - "Parse size" here means the per-module minified byte count. The real
 *   production bundle minifies all modules together, so cross-module
 *   identifier sharing makes individual numbers slightly larger than the
 *   true marginal cost. They are still useful for relative comparisons and
 *   for ordering modules by impact.
 * - When a module is reachable through more than one entry API, it is
 *   attributed to *all* of them. The "uniquely attributable" column shows
 *   bytes that would actually disappear if a single API were removed.
 */

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { default as webpack } from "webpack";

const localRequire = createRequire(import.meta.url);

/** Minimal subset of the terser API that this script uses. */
interface TerserLike {
	minify(
		source: string,
		options: {
			compress: boolean;
			mangle: boolean;
			format: { comments: boolean };
		},
	): Promise<{ code?: string }>;
}

interface Reason {
	moduleName?: string;
	moduleIdentifier?: string;
	userRequest?: string;
	type?: string;
	loc?: string;
	resolvedModule?: string;
}

interface StatsModule {
	name?: string;
	identifier?: string;
	size?: number;
	reasons?: Reason[];
	source?: string;
}

interface CliFlags {
	scenario: string;
	outPath: string;
}

function parseFlags(): CliFlags {
	const argv = process.argv.slice(2);
	let scenario = "encapsulated-with-shared-tree";
	let outPath: string | undefined;
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
			case "-h":
			case "--help": {
				console.log(
					"Usage: jiti scripts/analyzeTreeReasons.ts [--scenario <name>] [--out <path>]",
				);
				process.exit(0);
			}
			default: {
				// Unknown flag is ignored.
				break;
			}
		}
	}
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const repoRoot = path.resolve(__dirname, "..");
	return {
		scenario,
		outPath:
			outPath ?? path.resolve(repoRoot, "bundleAnalysis", `tree-reasons-${scenario}.md`),
	};
}

// jiti factory is loaded dynamically so this script can run from a built copy
// or via jiti directly.
type JitiFactory = (root: string, options?: unknown) => (id: string) => unknown;

async function loadScenarioConfig(scenario: string): Promise<webpack.Configuration> {
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const repoRoot = path.resolve(__dirname, "..");
	const configPath = path.resolve(repoRoot, "scenarios", scenario, "webpack.config.cts");
	const jitiFactory = localRequire("jiti") as JitiFactory;
	const jiti = jitiFactory(repoRoot, { interopDefault: true });
	const mod = jiti(configPath) as { default?: webpack.Configuration } | webpack.Configuration;
	const config =
		(mod as { default?: webpack.Configuration }).default ?? (mod as webpack.Configuration);
	return config;
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
			const json = stats.toJson({
				all: false,
				modules: true,
				reasons: true,
				nestedModules: false,
				chunks: false,
				assets: false,
				ids: true,
				cachedModules: true,
				source: true,
			});
			resolve(json);
		});
	});
}

const TREE_LIB_FRAGMENT = "packages/dds/tree/lib/";

/**
 * Returns true if the given module name is from `@fluidframework/tree`
 * (the dist `lib/` of the tree package).
 */
function isTreeModule(name: string | undefined): boolean {
	if (name === undefined) return false;
	return name.includes(TREE_LIB_FRAGMENT);
}

/**
 * Returns true if the module is the scenario entry index.
 */
function isScenarioEntry(name: string | undefined, scenario: string): boolean {
	if (name === undefined) return false;
	return name.endsWith(`scenarios/${scenario}/src/index.ts`);
}

/** Result of {@link approxParseSize}. */
interface ParseSize {
	min: number;
	gz: number;
}

/**
 * Approximate parse size: minify a single module's source with terser and
 * also report gzip of that minified output.
 */
async function approxParseSize(source: string | undefined): Promise<ParseSize> {
	if (source === undefined || source === "") {
		return { min: 0, gz: 0 };
	}
	// Resolve terser from the workspace's hoisted pnpm location. terser is a
	// transitive dep of terser-webpack-plugin; the local `node_modules` of
	// this package may not have it as a direct dependency.
	let terser: TerserLike;
	try {
		const resolved = localRequire.resolve("terser", {
			paths: [path.resolve("/workspaces/FluidFramework/node_modules")],
		});
		terser = localRequire(resolved) as TerserLike;
	} catch {
		terser = localRequire("terser") as TerserLike;
	}
	const result = await terser.minify(source, {
		compress: true,
		mangle: true,
		format: { comments: false },
	});
	const minSrc = result.code ?? "";
	return {
		min: Buffer.byteLength(minSrc, "utf8"),
		gz: gzipSync(Buffer.from(minSrc, "utf8")).length,
	};
}

/**
 * Build maps from a flat module list:
 * - `byName`: name -\> module
 * - `parents`: child name -\> set of parent names
 * - `children`: parent name -\> set of child names
 * - `reasonEdge`: child -\> parent -\> first reason linking them
 */
interface Graph {
	byName: Map<string, StatsModule>;
	parents: Map<string, Set<string>>;
	children: Map<string, Set<string>>;
	reasonEdge: Map<string, Map<string, Reason>>;
}

function getOrCreateSet<K>(map: Map<K, Set<string>>, key: K): Set<string> {
	let v = map.get(key);
	if (v === undefined) {
		v = new Set();
		map.set(key, v);
	}
	return v;
}

function getOrCreateMap<K, V>(map: Map<K, Map<string, V>>, key: K): Map<string, V> {
	let v = map.get(key);
	if (v === undefined) {
		v = new Map();
		map.set(key, v);
	}
	return v;
}

function buildGraph(modules: StatsModule[]): Graph {
	const byName = new Map<string, StatsModule>();
	const parents = new Map<string, Set<string>>();
	const children = new Map<string, Set<string>>();
	const reasonEdge = new Map<string, Map<string, Reason>>();
	for (const m of modules) {
		if (m.name === undefined) continue;
		byName.set(m.name, m);
	}
	for (const m of modules) {
		if (m.name === undefined) continue;
		for (const r of m.reasons ?? []) {
			const parent = r.moduleName;
			if (parent === undefined) continue;
			getOrCreateSet(parents, m.name).add(parent);
			getOrCreateSet(children, parent).add(m.name);
			const edges = getOrCreateMap(reasonEdge, m.name);
			// First reason wins per parent (good enough for attribution).
			if (!edges.has(parent)) {
				edges.set(parent, r);
			}
		}
	}
	return { byName, parents, children, reasonEdge };
}

interface AttributionResult {
	/** entry-API root modules (level-1 children of the legacy barrel) */
	apiRoots: string[];
	/** child name -\> set of apiRoot names reachable to it */
	attribution: Map<string, Set<string>>;
}

/**
 * BFS forward from the scenario entry, collecting every module reachable.
 *
 * The entry import line for `@fluidframework/tree/legacy` resolves to a
 * single barrel module (e.g. `packages/dds/tree/lib/legacy.js`). To attribute
 * downstream modules by named API, we use that barrel's level-1 children as
 * "API roots" — each one corresponds (more or less) to a re-exported API on
 * the import line. Each downstream tree module is then tagged with every
 * apiRoot from which it is forward-reachable.
 */
function computeAttribution(graph: Graph, scenarioEntryName: string): AttributionResult {
	const visited = new Set<string>();
	const queue: string[] = [scenarioEntryName];
	while (queue.length > 0) {
		const cur = queue.shift();
		if (cur === undefined || visited.has(cur)) continue;
		visited.add(cur);
		for (const c of graph.children.get(cur) ?? []) queue.push(c);
	}

	// Find the tree legacy barrel: a tree module imported directly by the entry.
	let legacyBarrel: string | undefined;
	for (const name of visited) {
		if (!isTreeModule(name)) continue;
		const ps = graph.parents.get(name) ?? new Set();
		if (ps.has(scenarioEntryName)) {
			legacyBarrel = name;
			break;
		}
	}
	if (legacyBarrel === undefined) {
		throw new Error("Could not find @fluidframework/tree barrel reachable from entry");
	}

	const apiRoots = [...(graph.children.get(legacyBarrel) ?? [])].filter(isTreeModule);

	const attribution = new Map<string, Set<string>>();
	for (const root of apiRoots) {
		const stack: string[] = [root];
		const seen = new Set<string>();
		while (stack.length > 0) {
			const cur = stack.pop();
			if (cur === undefined || seen.has(cur)) continue;
			seen.add(cur);
			if (isTreeModule(cur)) {
				getOrCreateSet(attribution, cur).add(root);
			}
			for (const c of graph.children.get(cur) ?? []) {
				if (visited.has(c)) stack.push(c);
			}
		}
	}

	return { apiRoots, attribution };
}

/** Pretty short label for a module name. */
function shortName(name: string): string {
	const idx = name.indexOf(TREE_LIB_FRAGMENT);
	if (idx === -1) return name;
	return `tree/${name.slice(idx + TREE_LIB_FRAGMENT.length)}`;
}

/** Pretty entry-API label by inspecting the level-1 root module path. */
function apiLabel(root: string): string {
	const short = shortName(root);
	const base = path.basename(short, ".js");
	return `${base} (${short})`;
}

interface ApiSummary {
	root: string;
	modules: string[];
	sumMin: number;
	sumGz: number;
	uniqueMin: number;
	uniqueGz: number;
}

function buildReport(
	scenario: string,
	graph: Graph,
	treeModules: StatsModule[],
	apiRoots: string[],
	attribution: Map<string, Set<string>>,
	sizeByName: Map<string, { raw: number; min: number; gz: number }>,
): string {
	const lines: string[] = [];
	lines.push(`# Tree module attribution — scenario \`${scenario}\``);
	lines.push("");
	lines.push(
		"Generated by `scripts/analyzeTreeReasons.ts`. Each entry API on the scenario's `@fluidframework/tree/legacy` import line is shown together with the set of `@fluidframework/tree` modules reachable from it through the webpack reasons graph.",
	);
	lines.push("");
	lines.push("**Per-module sizes**:");
	lines.push("- `raw` — pre-minified source bytes (post-loader).");
	lines.push(
		"- `min` — bytes after minifying that single module's source with terser (compress + mangle).",
	);
	lines.push("- `gz` — gzip of the per-module minified output.");
	lines.push("");
	lines.push(
		"Per-module minification overestimates the marginal cost slightly vs. the real bundle, where adjacent modules share identifiers and terser removes more — useful for relative comparisons and ordering.",
	);
	lines.push("");

	const totalRaw = treeModules.reduce(
		(s, m) => s + (m.name === undefined ? 0 : (sizeByName.get(m.name)?.raw ?? 0)),
		0,
	);
	const totalMin = treeModules.reduce(
		(s, m) => s + (m.name === undefined ? 0 : (sizeByName.get(m.name)?.min ?? 0)),
		0,
	);
	const totalGz = treeModules.reduce(
		(s, m) => s + (m.name === undefined ? 0 : (sizeByName.get(m.name)?.gz ?? 0)),
		0,
	);
	lines.push(`## Totals (all tree modules in bundle)`);
	lines.push("");
	lines.push(`- Modules: **${treeModules.length}**`);
	lines.push(`- Raw source: **${totalRaw.toLocaleString()} B**`);
	lines.push(`- Per-module min: **${totalMin.toLocaleString()} B**`);
	lines.push(`- Per-module min+gz: **${totalGz.toLocaleString()} B**`);
	lines.push("");

	lines.push(`## Tree modules grouped by entry API`);
	lines.push("");

	const summaries: ApiSummary[] = apiRoots.map((root) => ({
		root,
		modules: [],
		sumMin: 0,
		sumGz: 0,
		uniqueMin: 0,
		uniqueGz: 0,
	}));
	const summaryByRoot = new Map(summaries.map((s) => [s.root, s]));
	for (const [child, roots] of attribution) {
		const sz = sizeByName.get(child) ?? { raw: 0, min: 0, gz: 0 };
		for (const r of roots) {
			const s = summaryByRoot.get(r);
			if (s === undefined) continue;
			s.modules.push(child);
			s.sumMin += sz.min;
			s.sumGz += sz.gz;
			if (roots.size === 1) {
				s.uniqueMin += sz.min;
				s.uniqueGz += sz.gz;
			}
		}
	}
	summaries.sort((a, b) => b.sumMin - a.sumMin);

	lines.push(
		"| Entry API root module | Modules | Reachable min (B) | Reachable gz (B) | Unique min (B) | Unique gz (B) |",
	);
	lines.push("|---|---:|---:|---:|---:|---:|");
	for (const s of summaries) {
		lines.push(
			`| \`${shortName(s.root)}\` | ${s.modules.length} | ${s.sumMin.toLocaleString()} | ${s.sumGz.toLocaleString()} | ${s.uniqueMin.toLocaleString()} | ${s.uniqueGz.toLocaleString()} |`,
		);
	}
	lines.push("");

	for (const s of summaries) {
		lines.push(`### ${apiLabel(s.root)}`);
		lines.push("");
		lines.push(
			`Reachable tree modules: **${s.modules.length}** · summed min **${s.sumMin.toLocaleString()} B** / gz **${s.sumGz.toLocaleString()} B** · unique-to-this-API min **${s.uniqueMin.toLocaleString()} B** / gz **${s.uniqueGz.toLocaleString()} B**`,
		);
		lines.push("");
		lines.push("| Module | raw (B) | min (B) | gz (B) | also reached by |");
		lines.push("|---|---:|---:|---:|---|");
		const rows = [...new Set(s.modules)]
			.map((name) => {
				const sz = sizeByName.get(name) ?? { raw: 0, min: 0, gz: 0 };
				const others = [...(attribution.get(name) ?? [])].filter((r) => r !== s.root);
				return { name, sz, others };
			})
			.sort((a, b) => b.sz.min - a.sz.min);
		for (const r of rows) {
			const othersLabel =
				r.others.length === 0 ? "—" : r.others.map((o) => `\`${shortName(o)}\``).join(", ");
			lines.push(
				`| \`${shortName(r.name)}\` | ${r.sz.raw.toLocaleString()} | ${r.sz.min.toLocaleString()} | ${r.sz.gz.toLocaleString()} | ${othersLabel} |`,
			);
		}
		lines.push("");
	}

	const unattributed = treeModules.filter(
		(m) => m.name !== undefined && !attribution.has(m.name),
	);
	if (unattributed.length > 0) {
		lines.push(`## Tree modules not attributed to a single API root`);
		lines.push("");
		lines.push(
			"Typically: the legacy barrel module itself, and any glue modules pulled in directly by it that don't fall under one of the named re-exports.",
		);
		lines.push("");
		lines.push("| Module | raw (B) | min (B) | gz (B) | reasons |");
		lines.push("|---|---:|---:|---:|---|");
		for (const m of unattributed) {
			if (m.name === undefined) continue;
			const sz = sizeByName.get(m.name) ?? { raw: 0, min: 0, gz: 0 };
			const reasons = (m.reasons ?? [])
				.map((r) => {
					if (r.moduleName !== undefined && r.moduleName !== "") {
						return shortName(r.moduleName);
					}
					return r.userRequest ?? "(?)";
				})
				.filter((v, idx, arr) => arr.indexOf(v) === idx)
				.slice(0, 5)
				.map((label) => `\`${label}\``)
				.join(", ");
			lines.push(
				`| \`${shortName(m.name)}\` | ${sz.raw.toLocaleString()} | ${sz.min.toLocaleString()} | ${sz.gz.toLocaleString()} | ${reasons} |`,
			);
		}
		lines.push("");
	}

	lines.push(`## Reasons graph (immediate parents per tree module)`);
	lines.push("");
	lines.push(
		'For each tree module, the immediate importers are listed (deduped). Useful for spotting a single "pin point" — a module that, if its import were removed or broken into a smaller surface, would let webpack drop the dependent module.',
	);
	lines.push("");
	const sortedTreeMods = [...treeModules].sort((a, b) => {
		const am = a.name === undefined ? 0 : (sizeByName.get(a.name)?.min ?? 0);
		const bm = b.name === undefined ? 0 : (sizeByName.get(b.name)?.min ?? 0);
		return bm - am;
	});
	for (const m of sortedTreeMods) {
		if (m.name === undefined) continue;
		const sz = sizeByName.get(m.name) ?? { min: 0 };
		const ps = [...(graph.parents.get(m.name) ?? [])].map((p) => shortName(p)).sort();
		lines.push(
			`- \`${shortName(m.name)}\` — ${sz.min.toLocaleString()} B min  ` +
				`\n  ← ${ps.length === 0 ? "(entry)" : ps.map((p) => `\`${p}\``).join(", ")}`,
		);
	}
	lines.push("");
	return lines.join("\n");
}

async function main(): Promise<void> {
	const flags = parseFlags();
	console.log(`Loading webpack config for scenario "${flags.scenario}"...`);
	const config = await loadScenarioConfig(flags.scenario);

	// Force per-module visibility while keeping production tree-shaking semantics.
	const cfg: webpack.Configuration = {
		...config,
		mode: "production",
		profile: true,
		optimization: {
			...config.optimization,
			concatenateModules: false,
			minimize: false,
			usedExports: true,
		},
		output: {
			...config.output,
			path: path.resolve("/tmp", `analyzeTreeReasons-${flags.scenario}`),
		},
		plugins: (config.plugins ?? []).filter(
			(p: unknown) =>
				(p as { constructor?: { name?: string } } | null)?.constructor?.name !==
				"BundleComparisonPlugin",
		),
	};

	console.log("Running webpack...");
	const stats = await runWebpack(cfg);
	const modules = (stats.modules ?? []) as StatsModule[];
	console.log(`Webpack produced ${modules.length} modules.`);

	const treeModules = modules.filter((m) => isTreeModule(m.name));
	console.log(`Of those, ${treeModules.length} are from @fluidframework/tree.`);

	console.log("Building reasons graph...");
	const graph = buildGraph(modules);

	const entry = modules.find((m) => isScenarioEntry(m.name, flags.scenario));
	if (entry?.name === undefined) {
		throw new Error("Could not locate scenario entry module in stats.");
	}

	console.log("Computing attribution from entry-API roots...");
	const { apiRoots, attribution } = computeAttribution(graph, entry.name);
	console.log(`API roots reachable in tree barrel: ${apiRoots.length}`);

	console.log("Minifying each tree module to approximate parse size...");
	const sizeByName = new Map<string, { raw: number; min: number; gz: number }>();
	let processed = 0;
	for (const m of treeModules) {
		processed++;
		if (processed % 50 === 0) console.log(`  ${processed}/${treeModules.length}`);
		if (m.name === undefined) continue;
		const { min, gz } = await approxParseSize(m.source);
		sizeByName.set(m.name, { raw: m.size ?? 0, min, gz });
	}

	const report = buildReport(
		flags.scenario,
		graph,
		treeModules,
		apiRoots,
		attribution,
		sizeByName,
	);

	writeFileSync(flags.outPath, report);
	console.log(`\nReport written to: ${flags.outPath}`);
}

await main();
