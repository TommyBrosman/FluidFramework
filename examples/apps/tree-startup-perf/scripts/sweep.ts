/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * One-off script that builds the bundle at increasing padding sizes and
 * collects Lighthouse metrics for each, writing results to a CSV file.
 *
 * Uses the Lighthouse Node API directly (instead of LHCI CLI) to avoid
 * chrome-launcher temp-dir cleanup errors on Windows that cause LHCI to
 * discard otherwise-successful results.
 *
 * Usage:
 *   npx tsx scripts/sweep.ts
 *   npx tsx scripts/sweep.ts --throttle=slow4g
 *   npx tsx scripts/sweep.ts --iterations=5 --paddingStep=512 --throttle=desktop
 *
 * Throttle profiles: none, desktop, slow4g, regular3g
 */

import { execSync } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { parseArgs } from "node:util";
import type { AddressInfo } from "node:net";

// Import Lighthouse's built-in throttling presets.
const { throttling: builtIn } = await import("lighthouse/core/config/constants.js");

const { values: args } = parseArgs({
	options: {
		iterations: { type: "string", default: "10" },
		paddingStep: { type: "string", default: "256" },
		throttle: {
			type: "string",
			default: "none",
			// none | desktop | slow4g | regular3g
		},
		output: { type: "string", default: join(".lighthouseci", "lighthouse-sweep.csv") },
	},
});

const iterations = Number(args.iterations);
const paddingStep = Number(args.paddingStep); // KB per iteration
const csvPath = args.output as string;
const distDir = "dist";

interface ThrottleProfile {
	throttlingMethod: "devtools" | "simulate" | "provided";
	throttling: {
		cpuSlowdownMultiplier: number;
		requestLatencyMs: number;
		downloadThroughputKbps: number;
		uploadThroughputKbps: number;
		throughputKbps?: number;
		rttMs: number;
	};
}

const throttleProfiles: Record<string, ThrottleProfile> = {
	none: {
		throttlingMethod: "provided",
		throttling: {
			cpuSlowdownMultiplier: 1,
			requestLatencyMs: 0,
			downloadThroughputKbps: 0,
			uploadThroughputKbps: 0,
			throughputKbps: 0,
			rttMs: 0,
		},
	},
	desktop: {
		throttlingMethod: "devtools",
		throttling: builtIn.desktopDense4G,
	},
	slow4g: {
		throttlingMethod: "devtools",
		throttling: builtIn.mobileSlow4G,
	},
	regular3g: {
		throttlingMethod: "devtools",
		throttling: builtIn.mobileRegular3G,
	},
};

const profileName = args.throttle as string;
const profile = throttleProfiles[profileName];
if (!profile) {
	console.error(
		`Unknown throttle profile: "${profileName}". Options: ${Object.keys(throttleProfiles).join(", ")}`,
	);
	process.exit(1);
}
console.log(`Throttle profile: ${profileName}`);

const mimeTypes: Record<string, string> = {
	".html": "text/html",
	".js": "application/javascript",
	".map": "application/json",
};

/**
 * Start a simple static file server for the dist directory.
 * Returns { server, port }.
 */
function startServer(): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
	return new Promise((resolve) => {
		const server = createServer((req: IncomingMessage, res: ServerResponse) => {
			const filePath = join(distDir, req.url === "/" ? "index.html" : (req.url ?? ""));
			try {
				const data = readFileSync(filePath);
				const ext = extname(filePath);
				res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
				res.end(data);
			} catch {
				res.writeHead(404);
				res.end("Not found");
			}
		});
		server.listen(0, () => {
			resolve({ server, port: (server.address() as AddressInfo).port });
		});
	});
}

/**
 * Run Lighthouse against the given URL using the Node API.
 * Handles chrome-launcher cleanup errors gracefully.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runLighthouse(url: string): Promise<any> {
	const lighthouse = (await import("lighthouse")).default;
	const { launch } = await import("chrome-launcher");

	const chrome = await launch({ chromeFlags: ["--headless"] });
	try {
		const result = await lighthouse(url, {
			port: chrome.port,
			output: "json",
			onlyCategories: ["performance"],
			formFactor: "desktop",
			...profile,
			screenEmulation: {
				mobile: false,
				width: 1350,
				height: 940,
				deviceScaleFactor: 1,
				disabled: false,
			},
		});
		return result?.lhr ?? null;
	} finally {
		try {
			await chrome.kill();
		} catch {
			// Ignore chrome-launcher cleanup errors on Windows.
		}
	}
}

const header = [
	"paddingKb",
	"bundleSizeBytes",
	"firstContentfulPaint",
	"largestContentfulPaint",
	"speedIndex",
	"totalBlockingTime",
	"interactive",
	"performanceScore",
].join(",");

mkdirSync(dirname(csvPath), { recursive: true });
writeFileSync(csvPath, header + "\n");
console.log(`Created ${csvPath}`);

const { server, port } = await startServer();
const url = `http://localhost:${port}/index.html`;
console.log(`Static server running on port ${port}`);

try {
	for (let i = 0; i < iterations; i++) {
		const paddingKb = i * paddingStep;
		console.log(`\n=== Iteration ${i + 1}/${iterations}: paddingKb=${paddingKb} ===`);

		// Build
		console.log("Building...");
		execSync(`npx webpack --env production --env paddingKb=${paddingKb}`, {
			stdio: "inherit",
		});

		// Get bundle size
		const bundleSizeBytes = statSync("dist/app.bundle.js").size;
		console.log(`Bundle size: ${(bundleSizeBytes / 1024).toFixed(0)} KB`);

		// Run Lighthouse
		console.log("Running Lighthouse...");
		const lhr = await runLighthouse(url);

		if (!lhr || lhr.runtimeError?.code) {
			console.warn(
				`Lighthouse error: ${lhr?.runtimeError?.code ?? "no result"}, skipping iteration`,
			);
			continue;
		}

		const audit = (id: string): number | string => lhr.audits[id]?.numericValue ?? "N/A";

		const row = [
			paddingKb,
			bundleSizeBytes,
			audit("first-contentful-paint"),
			audit("largest-contentful-paint"),
			audit("speed-index"),
			audit("total-blocking-time"),
			audit("interactive"),
			(lhr.categories?.performance?.score ?? 0) * 100,
		].join(",");

		writeFileSync(csvPath, readFileSync(csvPath, "utf-8") + row + "\n");
		console.log(`Recorded: ${row}`);

		// Brief pause to let Chrome fully release resources on Windows.
		await new Promise((resolve) => setTimeout(resolve, 2000));
	}
} finally {
	server.close();
}

console.log(`\nDone! Results in ${csvPath}`);
