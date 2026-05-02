/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Minimal double-ended queue. Replaces the `double-ended-queue` (npm) polyfill,
 * which contributed ~3 KB to browser bundles, with the subset of API actually
 * used by Fluid: push / pop / shift / peekFront / peekBack / get / length /
 * isEmpty / clear / toArray.
 *
 * Backed by a single resizing array with a moving head index, so `shift`,
 * `push`, `pop`, and `peekFront` are amortized O(1). `get(i)` is O(1). The
 * array is compacted when half-empty after `shift` to keep memory bounded.
 *
 * @internal
 */
export class Deque<T> {
	private items: (T | undefined)[] = [];
	private head: number = 0;
	private size: number = 0;

	public constructor(initial?: readonly T[]) {
		if (initial !== undefined && initial.length > 0) {
			this.items = initial.slice();
			this.size = initial.length;
		}
	}

	public get length(): number {
		return this.size;
	}

	public isEmpty(): boolean {
		return this.size === 0;
	}

	public push(...values: T[]): number {
		for (const value of values) {
			this.items[this.head + this.size] = value;
			this.size += 1;
		}
		return this.size;
	}

	public pop(): T | undefined {
		if (this.size === 0) return undefined;
		this.size -= 1;
		const i = this.head + this.size;
		const value = this.items[i] as T;
		this.items[i] = undefined;
		return value;
	}

	public shift(): T | undefined {
		if (this.size === 0) return undefined;
		const value = this.items[this.head] as T;
		this.items[this.head] = undefined;
		this.head += 1;
		this.size -= 1;
		// Compact when more than half the array is wasted head space.
		if (this.head > 16 && this.head > this.size) {
			this.items = this.items.slice(this.head, this.head + this.size);
			this.head = 0;
		}
		return value;
	}

	public peekFront(): T | undefined {
		return this.size === 0 ? undefined : (this.items[this.head] as T);
	}

	public peekBack(): T | undefined {
		return this.size === 0 ? undefined : (this.items[this.head + this.size - 1] as T);
	}

	public get(index: number): T | undefined {
		// Negative indices count from the back, matching double-ended-queue.
		const i = index < 0 ? this.size + index : index;
		if (i < 0 || i >= this.size) return undefined;
		return this.items[this.head + i] as T;
	}

	public clear(): void {
		this.items = [];
		this.head = 0;
		this.size = 0;
	}

	public toArray(): T[] {
		return this.items.slice(this.head, this.head + this.size) as T[];
	}
}
