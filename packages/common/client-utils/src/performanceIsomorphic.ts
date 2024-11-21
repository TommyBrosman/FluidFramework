/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Used by Performance.
 *
 * @internal
 */
export type EntryType =
	| "dns" // Node.js only
	| "function" // Node.js only
	| "gc" // Node.js only
	| "http2" // Node.js only
	| "http" // Node.js only
	| "mark" // available on the Web
	| "measure" // available on the Web
	| "net" // Node.js only
	| "node" // Node.js only
	| "resource"; // available on the Web

/**
 * Used by Performance.
 *
 * @internal
 */
export interface PerformanceEntry {
	/**
	 * The total number of milliseconds elapsed for this entry. This value will not
	 * be meaningful for all Performance Entry types.
	 */
	readonly duration: number;
	/**
	 * The name of the performance entry.
	 */
	readonly name: string;
	/**
	 * The high resolution millisecond timestamp marking the starting time of the
	 * Performance Entry.
	 */
	readonly startTime: number;
	/**
	 * The type of the performance entry. It may be one of:
	 *
	 * * `'node'` (Node.js only)
	 * * `'mark'` (available on the Web)
	 * * `'measure'` (available on the Web)
	 * * `'gc'` (Node.js only)
	 * * `'function'` (Node.js only)
	 * * `'http2'` (Node.js only)
	 * * `'http'` (Node.js only)
	 */
	readonly entryType: EntryType;
}

/**
 * Used by Performance.
 *
 * @internal
 */
export interface PerformanceMark extends PerformanceEntry {
	readonly duration: 0;
	readonly entryType: "mark";
}

/**
 * Used by Performance.
 *
 * @internal
 */
export interface PerformanceMeasure extends PerformanceEntry {
	readonly entryType: "measure";
}

/**
 * Used by `performance.mark`
 *
 * @internal
 */
export interface MarkOptions {
	/**
	 * Additional optional detail to include with the mark.
	 */
	// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
	detail?: unknown | undefined;
	/**
	 * An optional timestamp to be used as the mark time.
	 */
	startTime?: number | undefined;
}

/**
 * This type contains all browser performance properties as optional, and some
 * of the intersecting properties of node and browser performance as required.
 *
 * @internal
 */
export interface IsomorphicPerformance {
	/**
	 * If name is not provided, removes all PerformanceMark objects from the Performance Timeline.
	 * If name is provided, removes only the named mark.
	 * @param name - The name.
	 */
	clearMarks(name?: string): void;
	/**
	 * Creates a new PerformanceMark entry in the Performance Timeline.
	 * A PerformanceMark is a subclass of PerformanceEntry whose performanceEntry.entryType is always 'mark',
	 * and whose performanceEntry.duration is always 0.
	 * Performance marks are used to mark specific significant moments in the Performance Timeline.
	 * @param name - The name.
	 */
	mark(name?: string, options?: MarkOptions): PerformanceMark;
	/**
	 * Creates a new PerformanceMeasure entry in the Performance Timeline.
	 * A PerformanceMeasure is a subclass of PerformanceEntry whose performanceEntry.entryType is always 'measure',
	 * and whose performanceEntry.duration measures the number of milliseconds elapsed since startMark and endMark.
	 *
	 * The startMark argument may identify any existing PerformanceMark in the the Performance Timeline, or may identify
	 * any of the timestamp properties provided by the PerformanceNodeTiming class. If the named startMark does not exist,
	 * then startMark is set to timeOrigin by default.
	 *
	 * The endMark argument must identify any existing PerformanceMark in the the Performance Timeline or any of the timestamp
	 * properties provided by the PerformanceNodeTiming class. If the named endMark does not exist, an error will be thrown.
	 * @param name - The name.
	 * @param startMark - The mark to start measuring from.
	 * @param endMark - The mark to measure to.
	 * @returns The PerformanceMeasure entry that was created
	 */
	measure(name: string, startMark?: string, endMark?: string): PerformanceMeasure;
	/**
	 * The current high resolution millisecond timestamp
	 */
	now(): number;
	/**
	 * Returns a list of `PerformanceEntry` objects in chronological order with respect to `performanceEntry.startTime`
	 * whose `performanceEntry.entryType` is equal to `type`.
	 * @param type - The type of performance entry objects.
	 */
	getEntriesByType(type: EntryType): PerformanceEntry[];
}

/**
 * This exported "performance" member masks the built-in globalThis.performance object
 * as an IsomorphicPerformance, which hides all of its features that aren't compatible
 * between Node and browser implementations.  Anything exposed on this performance object
 * is considered safe to use regardless of the environment it runs in.
 *
 * @internal
 */
export const performance: IsomorphicPerformance = globalThis.performance;
