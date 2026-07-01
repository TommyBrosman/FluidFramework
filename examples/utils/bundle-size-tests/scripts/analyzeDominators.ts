/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Dominator-tree analysis of the scenario bundle's module graph.
 *
 * For every module `m`, computes the total bundle bytes that become
 * UNREACHABLE from the entry if `m` is removed — i.e. the sum of sizes of all
 * modules dominated by `m` (the dominator subtree rooted at `m`). A module with
 * a large dominated-subtree weight is a severable "lever": cutting the single
 * import edge that dominates it drops the whole subtree from the bundle.
 *
 * This is the rigorous, no-shortcuts complement to analyzeReasons.ts: instead
 * of attributing a package's bytes to top-level APIs, it finds internal
 * articulation points anywhere in the cross-package graph.
 *
 * Usage: npx jiti scripts/analyzeDominators.ts [--scenario <name>] [--min <bytes>]
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { default as webpack } from "webpack";

const localRequire = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

interface Reason {
	moduleName?: string;
	type?: string;
}
interface StatsModule {
	name?: string;
	reasons?: Reason[];
}

const argv = process.argv.slice(2);
let scenario = "encapsulated-no-tree";
let minBytes = 500;
for (let i = 0; i < argv.length; i++) {
	if (argv[i] === "--scenario") scenario = argv[++i] ?? scenario;
	else if (argv[i] === "--min") minBytes = Number(argv[++i] ?? minBytes);
}

/** Normalize a module id so graph names and SME keys line up. */
function norm(name: string): string {
	const p = name.indexOf("packages/");
	if (p !== -1) {
		return name
			.slice(p)
			.replace(/\/src\//, "/lib/")
			.replace(/\.tsx?$/, ".js");
	}
	const n = name.indexOf("node_modules/");
	if (n !== -1) return name.slice(n);
	// entry / webpack runtime / etc.
	return name.replace(/^(?:\.\/)+/, "");
}

type JitiFactory = (root: string, options?: unknown) => (id: string) => unknown;
async function loadScenarioConfig(): Promise<webpack.Configuration> {
	const configPath = path.resolve(packageRoot, "scenarios", scenario, "webpack.config.cts");
	const jitiFactory = localRequire("jiti") as JitiFactory;
	const jiti = jitiFactory(packageRoot, { interopDefault: true });
	const mod = jiti(configPath) as { default?: webpack.Configuration } | webpack.Configuration;
	return (mod as { default?: webpack.Configuration }).default ?? (mod as webpack.Configuration);
}

async function runWebpack(config: webpack.Configuration): Promise<webpack.StatsCompilation> {
	return new Promise((resolve, reject) => {
		webpack(config, (error, stats) => {
			if (error) return reject(error);
			if (!stats) return reject(new Error("No stats produced"));
			if (stats.hasErrors()) return reject(new Error(stats.toString({ errors: true })));
			resolve(stats.toJson({ all: false, modules: true, reasons: true, ids: true }));
		});
	});
}

interface SmeResult {
	results: { totalBytes: number; files: Record<string, { size: number }> }[];
}
function smeSizes(bundlePath: string): { sizes: Map<string, number>; total: number } {
	const tmpJson = path.resolve(tmpdir(), `sme-dom-${scenario}.json`);
	execFileSync(
		"npx",
		["source-map-explorer", "--no-border-checks", "--json", tmpJson, bundlePath],
		{ cwd: packageRoot, stdio: "ignore" },
	);
	const j = JSON.parse(readFileSync(tmpJson, "utf8")) as SmeResult;
	const sizes = new Map<string, number>();
	let total = 0;
	for (const r of j.results) {
		total = r.totalBytes;
		for (const [file, info] of Object.entries(r.files)) {
			sizes.set(norm(file), (sizes.get(norm(file)) ?? 0) + info.size);
		}
	}
	return { sizes, total };
}

async function main(): Promise<void> {
	const baseConfig = await loadScenarioConfig();

	console.log(`[1/4] Building production bundle (concat, minified)...`);
	const prodConfig: webpack.Configuration = {
		...baseConfig,
		mode: "production",
		output: { ...baseConfig.output, path: path.resolve(tmpdir(), `dom-prod-${scenario}`) },
		plugins: (baseConfig.plugins ?? []).filter(
			(p: unknown) =>
				(p as { constructor?: { name?: string } } | null)?.constructor?.name !==
				"BundleComparisonPlugin",
		),
	};
	await runWebpack(prodConfig);
	const bundleFile =
		typeof prodConfig.output?.filename === "string" ? prodConfig.output.filename : undefined;
	const outDir = prodConfig.output?.path as string;
	const bundlePath = path.resolve(outDir, bundleFile as string);

	console.log(`[2/4] source-map-explorer for real bundle bytes...`);
	const { sizes, total } = smeSizes(bundlePath);
	console.log(`  Bundle ${total.toLocaleString()} B; ${sizes.size} sized modules.`);

	console.log(`[3/4] Building reasons graph (no concat)...`);
	const graphConfig: webpack.Configuration = {
		...baseConfig,
		mode: "production",
		optimization: {
			...baseConfig.optimization,
			concatenateModules: false,
			minimize: false,
			usedExports: true,
		},
		output: { ...baseConfig.output, path: path.resolve(tmpdir(), `dom-graph-${scenario}`) },
		plugins: (baseConfig.plugins ?? []).filter(
			(p: unknown) =>
				(p as { constructor?: { name?: string } } | null)?.constructor?.name !==
				"BundleComparisonPlugin",
		),
	};
	const stats = await runWebpack(graphConfig);
	const modules = (stats.modules ?? []) as StatsModule[];

	// Build edges (importer -> imported) using normalized ids. Track roots.
	const succ = new Map<string, Set<string>>();
	const allNodes = new Set<string>();
	const rootNodes = new Set<string>();
	const ensure = (k: string): Set<string> => {
		let v = succ.get(k);
		if (!v) succ.set(k, (v = new Set()));
		return v;
	};
	for (const m of modules) {
		if (!m.name) continue;
		const child = norm(m.name);
		allNodes.add(child);
		const reasons = m.reasons ?? [];
		let hasParent = false;
		for (const r of reasons) {
			if (r.type === "entry") rootNodes.add(child);
			if (!r.moduleName) continue;
			const parent = norm(r.moduleName);
			if (parent === child) continue;
			allNodes.add(parent);
			ensure(parent).add(child);
			hasParent = true;
		}
		if (!hasParent) rootNodes.add(child);
	}

	// Synthetic super-root -> all roots.
	const ROOT = "__root__";
	const rootSucc = ensure(ROOT);
	for (const r of rootNodes) rootSucc.add(r);
	allNodes.add(ROOT);

	// RPO numbering via DFS from ROOT.
	const order: string[] = [];
	const visited = new Set<string>();
	(function dfs(n: string): void {
		visited.add(n);
		for (const c of succ.get(n) ?? []) if (!visited.has(c)) dfs(c);
		order.push(n);
	})(ROOT);
	order.reverse();
	const rpo = new Map<string, number>();
	order.forEach((n, i) => rpo.set(n, i));

	// Predecessors restricted to reachable nodes.
	const preds = new Map<string, string[]>();
	for (const [p, cs] of succ) {
		if (!rpo.has(p)) continue;
		for (const c of cs) {
			if (!rpo.has(c)) continue;
			(preds.get(c) ?? preds.set(c, []).get(c)!).push(p);
		}
	}

	// Cooper-Harvey-Kennedy iterative dominators.
	const idom = new Map<string, string | undefined>();
	for (const n of order) idom.set(n, undefined);
	idom.set(ROOT, ROOT);
	const intersect = (a: string, b: string): string => {
		let x = a;
		let y = b;
		while (x !== y) {
			while ((rpo.get(x) ?? 0) > (rpo.get(y) ?? 0)) x = idom.get(x)!;
			while ((rpo.get(y) ?? 0) > (rpo.get(x) ?? 0)) y = idom.get(y)!;
		}
		return x;
	};
	let changed = true;
	while (changed) {
		changed = false;
		for (const n of order) {
			if (n === ROOT) continue;
			const ps = (preds.get(n) ?? []).filter((p) => idom.get(p) !== undefined);
			if (ps.length === 0) continue;
			let newIdom = ps[0];
			for (const p of ps.slice(1)) newIdom = intersect(p, newIdom);
			if (idom.get(n) !== newIdom) {
				idom.set(n, newIdom);
				changed = true;
			}
		}
	}

	// Dominator subtree weight: bytes of all nodes dominated by m (incl. m).
	const sz = (n: string): number => sizes.get(n) ?? 0;
	const domChildren = new Map<string, string[]>();
	for (const n of order) {
		if (n === ROOT) continue;
		const d = idom.get(n);
		if (d === undefined) continue;
		(domChildren.get(d) ?? domChildren.set(d, []).get(d)!).push(n);
	}
	const subtreeWeight = new Map<string, number>();
	(function weigh(n: string): number {
		let w = sz(n);
		for (const c of domChildren.get(n) ?? []) w += weigh(c);
		subtreeWeight.set(n, w);
		return w;
	})(ROOT);

	// Report: modules ranked by dominated-subtree weight, showing own size and
	// the dominator (the module whose single edge, if cut, drops this subtree).
	const rows = [...subtreeWeight.entries()]
		.filter(([n]) => n !== ROOT && rpo.has(n))
		.map(([n, w]) => ({
			node: n,
			own: sz(n),
			subtree: w,
			idom: idom.get(n),
			nDominated: (function count(x: string): number {
				let c = 1;
				for (const ch of domChildren.get(x) ?? []) c += count(ch);
				return c;
			})(n),
		}))
		.filter((r) => r.subtree >= minBytes)
		.sort((a, b) => b.subtree - a.subtree);

	console.log(`\n[4/4] Dominator levers (subtree >= ${minBytes} B), ranked:\n`);
	console.log(
		"SubtreeB".padStart(9),
		"OwnB".padStart(7),
		"#Dom".padStart(5),
		"Module  <- idom",
	);
	for (const r of rows.slice(0, 60)) {
		const label = norm(r.node)
			.replace(/^packages\/[^/]+\//, "")
			.replace(/^node_modules\/\.pnpm\//, "npm:");
		const idomLabel = (r.idom ?? "?")
			.replace(/^packages\/[^/]+\//, "")
			.replace(/^node_modules\/\.pnpm\//, "npm:");
		console.log(
			String(r.subtree).padStart(9),
			String(r.own).padStart(7),
			String(r.nDominated).padStart(5),
			`${label}  <- ${idomLabel}`,
		);
	}
}

await main();
