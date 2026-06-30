/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Minimal in-tree replacement for the subset of the `debug` (npm) package used
 * by {@link DebugLogger}. It replaces the ~6 KB `debug` + `ms` browser-bundle
 * footprint while preserving the partner-facing diagnostic contract: namespaces
 * are enabled via `localStorage.debug` / `localStorage.DEBUG` (browser) or
 * `process.env.DEBUG` (node), with `*` wildcards and `-`-prefixed exclusions,
 * exactly as `debug@4` does.
 *
 * Only the surface `DebugLogger` consumes is implemented: the namespace factory,
 * `.enabled` (with override), `.log`, `.extend`, and calling the logger. The
 * package's color output and printf-style `%`-formatters are intentionally
 * omitted — `DebugLogger` passes a single pre-formatted string and does not use
 * them, and color is cosmetic (equivalent to `debug` in a no-color environment).
 */

/**
 * The subset of the `debug` package's `Debugger` interface used by
 * {@link DebugLogger}.
 */
export interface IDebugger {
	(message: string): void;
	/**
	 * Whether this namespace is currently enabled. Reading reflects the
	 * configured namespaces; assigning forces the value regardless of config.
	 */
	enabled: boolean;
	/**
	 * Per-instance log sink. When unset, {@link registerDebug.log} is used.
	 */
	log?: (...args: unknown[]) => void;
	readonly namespace: string;
	/**
	 * Create a child debugger whose namespace is `${namespace}${delimiter}${sub}`.
	 */
	extend(sub: string, delimiter?: string): IDebugger;
}

/**
 * Glob-style matcher identical to `debug@4.4`'s `matchesTemplate`: `*` in the
 * template matches any run of characters; all other characters match literally.
 */
function matchesTemplate(search: string, template: string): boolean {
	let searchIndex = 0;
	let templateIndex = 0;
	let starIndex = -1;
	let matchIndex = 0;

	while (searchIndex < search.length) {
		if (
			templateIndex < template.length &&
			(template[templateIndex] === search[searchIndex] || template[templateIndex] === "*")
		) {
			if (template[templateIndex] === "*") {
				starIndex = templateIndex;
				matchIndex = searchIndex;
				templateIndex++;
			} else {
				searchIndex++;
				templateIndex++;
			}
		} else if (starIndex === -1) {
			return false;
		} else {
			templateIndex = starIndex + 1;
			matchIndex++;
			searchIndex = matchIndex;
		}
	}

	while (templateIndex < template.length && template[templateIndex] === "*") {
		templateIndex++;
	}
	return templateIndex === template.length;
}

/**
 * Read the configured namespaces from `localStorage` (browser) or
 * `process.env.DEBUG` (node), mirroring `debug`'s browser `load()`.
 */
function load(): string | undefined {
	try {
		// Accessing `localStorage` throws in some environments (e.g. when cookies
		// are disabled), so this is guarded.
		if (typeof localStorage !== "undefined") {
			const stored = localStorage.getItem("debug") ?? localStorage.getItem("DEBUG");
			if (stored !== null) {
				return stored;
			}
		}
	} catch {
		// Swallow — fall through to the environment variable.
	}

	const globalProcess = (
		globalThis as { process?: { env?: Record<string, string | undefined> } }
	).process;
	if (globalProcess?.env !== undefined) {
		return globalProcess.env.DEBUG;
	}
	return undefined;
}

const names: string[] = [];
const skips: string[] = [];

function enable(namespaces: string | undefined): void {
	const split = (typeof namespaces === "string" ? namespaces : "")
		.trim()
		// eslint-disable-next-line unicorn/prefer-string-replace-all -- build lib target lacks replaceAll
		.replace(/\s+/g, ",")
		.split(",")
		.filter(Boolean);
	for (const ns of split) {
		if (ns.startsWith("-")) {
			skips.push(ns.slice(1));
		} else {
			names.push(ns);
		}
	}
}

function namespaceEnabled(namespace: string): boolean {
	for (const skip of skips) {
		if (matchesTemplate(namespace, skip)) {
			return false;
		}
	}
	for (const ns of names) {
		if (matchesTemplate(namespace, ns)) {
			return true;
		}
	}
	return false;
}

const defaultLog = (...args: unknown[]): void => {
	// `debug` defaults to `console.debug` and falls back to `console.log`.
	const sink = console.debug ?? console.log;
	sink(...args);
};

/**
 * Create a debugger bound to `namespace`. Mirrors `debug`'s per-namespace
 * function: callable to log, with `.enabled` (config-driven, overridable),
 * `.log`, and `.extend`.
 */
function createDebug(namespace: string): IDebugger {
	let enableOverride: boolean | undefined;

	const debug = ((message: string): void => {
		if (!debug.enabled) {
			return;
		}
		const logFn = debug.log ?? defaultLog;
		logFn(`${namespace} ${message}`);
	}) as IDebugger;

	Object.defineProperty(debug, "namespace", { value: namespace, enumerable: true });
	Object.defineProperty(debug, "enabled", {
		enumerable: true,
		get: () => enableOverride ?? namespaceEnabled(namespace),
		set: (value: boolean) => {
			enableOverride = value;
		},
	});
	debug.extend = (sub: string, delimiter: string = ":"): IDebugger => {
		const child = createDebug(`${namespace}${delimiter}${sub}`);
		child.log = debug.log;
		return child;
	};

	return debug;
}

/**
 * Namespace factory mirroring the `debug` default export's call signature and
 * its static `.log` default sink.
 */
export const registerDebug: ((namespace: string) => IDebugger) & {
	log: (...args: unknown[]) => void;
} = Object.assign((namespace: string) => createDebug(namespace), { log: defaultLog });

enable(load());
