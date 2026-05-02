/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

// TODO AB#7377 Provide Fluid EventEmitter using support in packages/dds/tree/src/events.

// Minimal Node-API-compatible EventEmitter. Replaces the `events` (npm) polyfill,
// which contributed ~6 KB to browser bundles. Implements the subset of the Node
// EventEmitter surface used by `TypedEventEmitter` and the ~150 downstream
// consumers in this repo.
//
// Public surface matches `@types/events` (the polyfill's typings):
// `string | number` event names (not Node's `string | symbol` — the polyfill
// diverged historically and consumers were written against its shape) and an
// `(...args: any[])` listener type that subclasses can narrow.
//
// Semantic invariants preserved (matching Node's EventEmitter):
// - Listeners fire in registration (FIFO) order.
// - `emit` returns true iff at least one listener was invoked.
// - `removeListener` removes only the most-recently-added matching reference.
// - Listeners added during emission do not run for the in-flight emit.
// - Listeners removed during emission do not run if they hadn't been called yet.
// - `once` auto-removes its listener exactly before invoking it (so re-entrant
//   emits don't double-fire it).
//
// Implementation note: hidden state lives in module-level WeakMaps rather than
// instance private fields. This keeps the class's public TypeScript type clean
// (no `#private` synthetic member, no `_underscore` leakage) so downstream
// `class X implements EventEmitter` continues to type-check, and avoids pulling
// __classPrivateFieldGet/Set helpers into this CommonJS-emitted file (which,
// through the `require("tslib")` namespace, would inflate the bundle far more
// than the saving from removing the polyfill).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (...args: any[]) => void;
type EventName = string | number;

interface OnceWrapper extends Listener {
	listener: Listener;
}

const isOnceWrapper = (l: Listener): l is OnceWrapper =>
	typeof (l as Partial<OnceWrapper>).listener === "function";

const eventsState = new WeakMap<EventEmitter, Map<EventName, Listener[]>>();
const maxListenersState = new WeakMap<EventEmitter, number>();

function getEvents(self: EventEmitter): Map<EventName, Listener[]> {
	let events = eventsState.get(self);
	if (events === undefined) {
		events = new Map();
		eventsState.set(self, events);
	}
	return events;
}

function addListener(
	self: EventEmitter,
	eventName: EventName,
	listener: Listener,
	prepend: boolean,
): EventEmitter {
	// Match Node: emit "newListener" BEFORE the listener is added, with
	// (eventName, originalListener). For once-wrappers, expose the user's listener,
	// not the wrapper. Skip when adding "newListener" itself to avoid recursion.
	if (eventName !== "newListener") {
		const userListener = isOnceWrapper(listener) ? listener.listener : listener;
		self.emit("newListener", eventName, userListener);
	}
	const events = getEvents(self);
	let list = events.get(eventName);
	if (list === undefined) {
		list = [];
		events.set(eventName, list);
	}
	if (prepend) list.unshift(listener);
	else list.push(listener);
	// Node would emit a warning past maxListeners; we keep the contract minimal —
	// no warning, no throw — to avoid console spam in browser bundles.
	return self;
}

function wrapOnce(self: EventEmitter, eventName: EventName, listener: Listener): OnceWrapper {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const wrapper: OnceWrapper = ((...args: any[]) => {
		// Auto-remove BEFORE invoking, so a re-entrant emit doesn't double-fire.
		self.removeListener(eventName, wrapper);
		listener.apply(self, args);
	}) as OnceWrapper;
	wrapper.listener = listener;
	return wrapper;
}

class EventEmitter {
	public on(eventName: EventName, listener: Listener): this {
		addListener(this, eventName, listener, false);
		return this;
	}

	public addListener(eventName: EventName, listener: Listener): this {
		addListener(this, eventName, listener, false);
		return this;
	}

	public prependListener(eventName: EventName, listener: Listener): this {
		addListener(this, eventName, listener, true);
		return this;
	}

	public once(eventName: EventName, listener: Listener): this {
		addListener(this, eventName, wrapOnce(this, eventName, listener), false);
		return this;
	}

	public prependOnceListener(eventName: EventName, listener: Listener): this {
		addListener(this, eventName, wrapOnce(this, eventName, listener), true);
		return this;
	}

	public off(eventName: EventName, listener: Listener): this {
		return this.removeListener(eventName, listener);
	}

	public removeListener(eventName: EventName, listener: Listener): this {
		const events = eventsState.get(this);
		const list = events?.get(eventName);
		if (events === undefined || list === undefined) return this;
		// Walk from the end so we remove the most-recently-added match (Node semantics).
		for (let i = list.length - 1; i >= 0; i--) {
			const entry = list[i];
			if (
				entry === listener ||
				(entry !== undefined && isOnceWrapper(entry) && entry.listener === listener)
			) {
				list.splice(i, 1);
				if (list.length === 0) events.delete(eventName);
				// Match Node: emit "removeListener" AFTER the listener is removed,
				// with (eventName, originalListener). Skip when removing "removeListener"
				// itself to avoid recursion.
				if (eventName !== "removeListener") {
					this.emit("removeListener", eventName, listener);
				}
				return this;
			}
		}
		return this;
	}

	public removeAllListeners(eventName?: EventName): this {
		const events = eventsState.get(this);
		if (events === undefined) return this;
		if (eventName === undefined) events.clear();
		else events.delete(eventName);
		return this;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	public emit(eventName: EventName, ...args: any[]): boolean {
		const events = eventsState.get(this);
		if (events === undefined) return false;
		const list = events.get(eventName);
		if (list === undefined || list.length === 0) return false;
		// Snapshot so listeners added during emit don't run in this pass,
		// and listeners removed mid-emit don't shift indices.
		const snapshot = list.slice();
		for (const listener of snapshot) {
			// Skip listeners removed by an earlier handler in this same emit.
			// Once-wrappers self-remove inside their bodies (after this check, before
			// invoking the user listener), so they're still in the live list here.
			if (events.get(eventName)?.includes(listener) !== true) continue;
			listener.apply(this, args);
		}
		return true;
	}

	public listenerCount(eventName: EventName): number {
		return eventsState.get(this)?.get(eventName)?.length ?? 0;
	}

	public listeners(eventName: EventName): Listener[] {
		const list = eventsState.get(this)?.get(eventName);
		if (list === undefined) return [];
		return list.map((l) => (isOnceWrapper(l) ? l.listener : l));
	}

	public rawListeners(eventName: EventName): Listener[] {
		const list = eventsState.get(this)?.get(eventName);
		return list === undefined ? [] : list.slice();
	}

	public eventNames(): EventName[] {
		const events = eventsState.get(this);
		return events === undefined ? [] : [...events.keys()];
	}

	public setMaxListeners(n: number): this {
		maxListenersState.set(this, n);
		return this;
	}

	public getMaxListeners(): number {
		return maxListenersState.get(this) ?? 10;
	}
}

export { EventEmitter };
