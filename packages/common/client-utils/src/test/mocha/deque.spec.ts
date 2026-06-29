/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { strict as assert } from "node:assert";

import { Deque } from "../../deque.js";

describe("Deque", () => {
	describe("empty", () => {
		it("reports empty state", () => {
			const deque = new Deque<number>();
			assert.equal(deque.length, 0);
			assert.equal(deque.isEmpty(), true);
		});

		it("returns undefined from accessors", () => {
			const deque = new Deque<number>();
			assert.equal(deque.peekFront(), undefined);
			assert.equal(deque.peekBack(), undefined);
			assert.equal(deque.pop(), undefined);
			assert.equal(deque.shift(), undefined);
			assert.equal(deque.get(0), undefined);
			assert.equal(deque.get(-1), undefined);
			assert.deepEqual(deque.toArray(), []);
		});
	});

	describe("construction", () => {
		it("seeds from an initial array without aliasing it", () => {
			const initial = [1, 2, 3];
			const deque = new Deque<number>(initial);
			assert.equal(deque.length, 3);
			assert.equal(deque.isEmpty(), false);
			assert.deepEqual(deque.toArray(), [1, 2, 3]);
			// Mutating the source array must not affect the deque.
			initial.push(4);
			assert.deepEqual(deque.toArray(), [1, 2, 3]);
		});

		it("treats an empty initial array as empty", () => {
			const deque = new Deque<number>([]);
			assert.equal(deque.length, 0);
			assert.equal(deque.isEmpty(), true);
		});
	});

	describe("push", () => {
		it("appends to the back and returns the new length", () => {
			const deque = new Deque<number>();
			assert.equal(deque.push(1), 1);
			assert.equal(deque.push(2), 2);
			assert.deepEqual(deque.toArray(), [1, 2]);
			assert.equal(deque.peekBack(), 2);
		});

		it("accepts multiple values in one call", () => {
			const deque = new Deque<number>();
			assert.equal(deque.push(1, 2, 3), 3);
			assert.deepEqual(deque.toArray(), [1, 2, 3]);
		});
	});

	describe("pop", () => {
		it("removes and returns from the back (LIFO)", () => {
			const deque = new Deque<number>([1, 2, 3]);
			assert.equal(deque.pop(), 3);
			assert.equal(deque.pop(), 2);
			assert.deepEqual(deque.toArray(), [1]);
			assert.equal(deque.length, 1);
		});
	});

	describe("shift", () => {
		it("removes and returns from the front (FIFO)", () => {
			const deque = new Deque<number>([1, 2, 3]);
			assert.equal(deque.shift(), 1);
			assert.equal(deque.shift(), 2);
			assert.deepEqual(deque.toArray(), [3]);
			assert.equal(deque.length, 1);
		});

		it("supports interleaved push/shift as a FIFO queue", () => {
			const deque = new Deque<number>();
			deque.push(1, 2);
			assert.equal(deque.shift(), 1);
			deque.push(3);
			assert.equal(deque.shift(), 2);
			assert.equal(deque.shift(), 3);
			assert.equal(deque.shift(), undefined);
			assert.equal(deque.isEmpty(), true);
		});
	});

	describe("peek", () => {
		it("peekFront / peekBack do not mutate", () => {
			const deque = new Deque<number>([10, 20, 30]);
			assert.equal(deque.peekFront(), 10);
			assert.equal(deque.peekBack(), 30);
			assert.equal(deque.length, 3);
			assert.deepEqual(deque.toArray(), [10, 20, 30]);
		});
	});

	describe("get", () => {
		it("indexes from the front with non-negative indices", () => {
			const deque = new Deque<string>(["a", "b", "c"]);
			assert.equal(deque.get(0), "a");
			assert.equal(deque.get(1), "b");
			assert.equal(deque.get(2), "c");
		});

		it("indexes from the back with negative indices", () => {
			const deque = new Deque<string>(["a", "b", "c"]);
			assert.equal(deque.get(-1), "c");
			assert.equal(deque.get(-2), "b");
			assert.equal(deque.get(-3), "a");
		});

		it("returns undefined for out-of-range indices", () => {
			const deque = new Deque<string>(["a", "b", "c"]);
			assert.equal(deque.get(3), undefined);
			assert.equal(deque.get(-4), undefined);
		});

		it("remains correct after a shift moves the head", () => {
			const deque = new Deque<number>([1, 2, 3, 4]);
			deque.shift();
			assert.equal(deque.get(0), 2);
			assert.equal(deque.get(-1), 4);
		});
	});

	describe("clear", () => {
		it("empties the deque and allows reuse", () => {
			const deque = new Deque<number>([1, 2, 3]);
			deque.clear();
			assert.equal(deque.length, 0);
			assert.equal(deque.isEmpty(), true);
			assert.deepEqual(deque.toArray(), []);
			deque.push(42);
			assert.deepEqual(deque.toArray(), [42]);
		});
	});

	describe("compaction", () => {
		// The head-space is compacted once head > 16 && head > size, so a long
		// run of shifts must preserve order and contents across that boundary.
		it("preserves order and contents across the compaction threshold", () => {
			const deque = new Deque<number>();
			for (let i = 0; i < 40; i++) {
				deque.push(i);
			}
			for (let i = 0; i < 30; i++) {
				assert.equal(deque.shift(), i);
			}
			// 10 elements remain (30..39); compaction has occurred by now.
			assert.equal(deque.length, 10);
			assert.equal(deque.peekFront(), 30);
			assert.equal(deque.peekBack(), 39);
			assert.equal(deque.get(0), 30);
			assert.equal(deque.get(-1), 39);
			assert.deepEqual(deque.toArray(), [30, 31, 32, 33, 34, 35, 36, 37, 38, 39]);

			// Continue pushing/shifting after compaction to confirm integrity.
			for (let i = 40; i < 50; i++) {
				deque.push(i);
			}
			for (let i = 30; i < 50; i++) {
				assert.equal(deque.shift(), i);
			}
			assert.equal(deque.isEmpty(), true);
		});
	});

	describe("differential against a reference model", () => {
		// Exercises random sequences of every operation against a plain-array
		// oracle to catch subtle head-index / compaction regressions.
		it("matches a plain-array oracle over random operations", () => {
			// Deterministic LCG (no bitwise ops) so failures are reproducible.
			let seed = 624632861;
			const rand = (n: number): number => {
				seed = (seed * 1103515245 + 12345) % 2147483648;
				return seed % n;
			};

			const deque = new Deque<number>();
			const oracle: number[] = [];
			let nextValue = 0;

			const checkInvariants = (): void => {
				assert.equal(deque.length, oracle.length);
				assert.equal(deque.isEmpty(), oracle.length === 0);
				assert.equal(deque.peekFront(), oracle[0]);
				assert.equal(deque.peekBack(), oracle[oracle.length - 1]);
				assert.deepEqual(deque.toArray(), oracle);
				for (let i = 0; i < oracle.length; i++) {
					assert.equal(deque.get(i), oracle[i]);
					assert.equal(deque.get(-1 - i), oracle[oracle.length - 1 - i]);
				}
			};

			for (let step = 0; step < 5000; step++) {
				switch (rand(4)) {
					case 0: {
						const value = nextValue++;
						assert.equal(deque.push(value), oracle.push(value));
						break;
					}
					case 1: {
						assert.equal(deque.pop(), oracle.pop());
						break;
					}
					case 2: {
						assert.equal(deque.shift(), oracle.shift());
						break;
					}
					default: {
						// Occasionally push a small burst to grow the structure.
						const value = nextValue++;
						deque.push(value);
						oracle.push(value);
						break;
					}
				}
				checkInvariants();
			}
		});
	});
});
