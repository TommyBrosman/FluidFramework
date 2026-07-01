# Polyfill Validity, Testing, and Dependency Chain

This document explains the build-time **stub-polyfills** used by the
`encapsulated-no-tree` bundle scenario. Each polyfill replaces a real
container-runtime (or telemetry-utils) module with a small stub at webpack build
time via `NormalModuleReplacementPlugin` (see `webpack.config.cts`). The stubs are
*not* shipped in the product; they exist only in this scenario's single-file
bundle, where they remove dead-weight subsystems that the target client never
executes.

It answers three questions the reviewer asked:

1. **What makes each polyfill valid?** — the concrete code-flow and imported-API
   guarantees that the stubbed code never runs.
2. **How do we know which tests break under a polyfill?** — a reproducible method
   (with a script) to run the real suite against the polyfilled build.
3. **What is the logical dependency chain?** — which polyfills are only valid
   *because* another polyfill was applied.

Finally, it proposes a **unified testing approach**.

All line numbers reference `packages/runtime/container-runtime/src/containerRuntime.ts`
on the `tbrosman/claude-shrink-bundle` branch unless otherwise noted. Re-verify
with `grep -n` before relying on an exact number — the file changes often.

---

## 0. The two stub shapes

Every stub is one of two shapes, and *which* shape is legal is dictated by **how
the runtime reaches the module**:

| Shape | When it is legal | Behavior |
|-------|------------------|----------|
| **Throwing** | The module is only reached **behind a runtime gate that the target client never enters** (a feature flag that is off, or a summarizer-only branch). | Every entry point throws "…is stubbed out of the bundle." If the assumption is ever violated, the client fails fast and loud. |
| **No-op / passthrough / valid-empty** | The module is **constructed or called unconditionally** on the normal client path. | Mirrors the real public surface but does nothing (or returns valid-empty values). Must never throw, because the code path *is* taken. |

The single most important review question for any stub is therefore:
**"Is this module reached unconditionally, or only behind a gate the target client
never enters?"** The answer determines whether a throwing stub is safe or whether
a valid no-op is mandatory.

The target client for this scenario is an **interactive mobile client** that:

- uses only `SharedString` and `SharedDirectory` (see `src/index.ts` value
  exports — no `SharedMap`, no attachment blobs, no id-compression enabled);
- **summarizes server-side** — it is never elected summarizer and never writes a
  summary;
- has `clientDetails.type !== summarizerClientType`, so `isSummarizerClient`
  (L1333, assigned L1746 `this.clientDetails.type === summarizerClientType`) is
  **`false`**.

These three facts are the root assumptions from which every validity argument
below is derived.

---

## 1. Per-polyfill validity

The 11 polyfills, in webpack-config order. For each: the replacement, the stub
shape, the code-flow guarantee (with line numbers), and the API-surface argument.

### 1.1 id-compressor — `idCompressorDelayLoadedModule/index.js` → `idCompressorDelayLoadedModuleStub.js`

- **Shape:** throwing (`createIdCompressor`, `createSessionId`,
  `deserializeIdCompressor`, `toIdCompressorWithCore` all throw).
- **Gate:** The real module is loaded only at L1180-1183:

  ```ts
  const idCompressorBundle =
      idCompressorMode === undefined
          ? undefined
          : await import("./idCompressorDelayLoadedModule/index.js");
  ```

  `idCompressorMode` resolves from `runtimeOptions.enableRuntimeIdCompressor`
  (default logic L1043-1048; resolution L1139-1169). It is `undefined` unless the
  app **opts in** to id-compression. When `undefined`, the dynamic import is never
  evaluated, and `createIdCompressorFn` (L1185) is never called (it asserts the
  bundle is loaded, L1186-1189).
- **Why the target client never trips it:** the scenario does not set
  `enableRuntimeIdCompressor`, so `idCompressorMode === undefined`. A throwing stub
  is safe: the throw path is only reachable if a future consumer turns
  id-compression on *and* keeps the stub — in which case failing fast is the
  correct behavior.
- **API surface:** `src/index.ts` re-exports no id-compressor symbol; nothing in
  the consumer's import set reaches the compressor except via the gated import.

### 1.2 summarizer — `summary/summaryDelayLoadedModule/index.js` → `summaryDelayLoadedModuleStub.js`

- **Shape:** throwing for the classes (`Summarizer`, `RunningSummarizer`,
  `SummarizeHeuristicData`, `SummarizeHeuristicRunner`,
  `RunWhileConnectedCoordinator` all throw in their constructors); the stub keeps
  the **value constants** (`defaultMaxAttempts`, `neverCancelledSummaryToken`,
  etc.) as real values, because those are the only members referenced *outside*
  the summarizer branch.
- **Gate:** The real module is loaded only inside `if (this.isSummarizerClient)`
  (L2296), at L2305-2307, and `new module.Summarizer(...)` is constructed at
  L2309.
- **Why the target client never trips it:** `isSummarizerClient === false`
  (L1746) for an interactive client, so the entire `if` block — the only place the
  `Summarizer` class is instantiated — is dead for this client. A throwing stub is
  safe.
- **API surface:** no summarizer type is a value export from `src/index.ts`.

### 1.3 summarizer-election — `summary/summaryManagerDelayLoadedModule/index.js` → `summaryManagerDelayLoadedModuleStub.js`

- **Shape:** **no-op** — `setupSummaryManager(...)` returns `{}`.
- **Gate:** Reached in the `else if` branch at L2324-2331:

  ```ts
  } else if (
      !onRequestMode &&
      (this.clientDetails.capabilities.interactive ||
          this.clientDetails.type === summarizerClientType)
  ) {
      const summaryManagerModule = await import(
          "./summary/summaryManagerDelayLoadedModule/index.js"   // L2336-2338
      );
      const { summaryManager, summarizerClientElection } =
          summaryManagerModule.setupSummaryManager({ ... });      // L2341
  ```

- **Why a throwing stub would be WRONG here:** an **interactive** client *does*
  enter this branch (`capabilities.interactive === true`), so the dynamic import
  *is* evaluated and `setupSummaryManager` *is* called. Therefore the stub must
  not throw. Returning `{}` is behaviorally "this client does not participate in
  summarizer election," which is exactly correct for a client that summarizes
  server-side (and whose `Summarizer` is itself stubbed, §1.2).
- **Key enabler:** `SummarizerClientElection.clientDetailsPermitElection` was
  **inlined** into the gate condition (comment at L2325-2327) precisely so the
  gate does not *statically* reference the election machinery. Without that
  inlining, the election module would be a static import edge and could not be
  stubbed away.

### 1.4 connection-telemetry (op-perf) — `connectionTelemetry.js` → `connectionTelemetryStub.js`

- **Shape:** **no-op** — `ReportOpPerfTelemetry` is `() => {}`.
- **Gate:** none — called unconditionally at L2176
  `ReportOpPerfTelemetry(this.clientId, this._deltaManager, this, this.baseLogger)`.
- **Why safe:** it is pure observability (op-latency telemetry). Removing it
  changes no functional behavior; the no-op preserves the call site. A throwing
  stub would be wrong (the call is unconditional).
- **API surface:** no telemetry symbol is a value export.

### 1.5 signal-telemetry — `signalTelemetryProcessing.js` → `signalTelemetryProcessingStub.js`

- **Shape:** **no-op** — `SignalTelemetryManager` methods all do nothing.
- **Gate:** none — constructed unconditionally at L1519
  `private readonly signalTelemetryManager = new SignalTelemetryManager();`
- **Why safe:** pure observability (signal round-trip tracking). No-op preserves
  the field and its method calls. Must not throw.

### 1.6 blob-manager — `blobManager/index.js` → `blobManager/blobManagerStub.js`

- **Shape:** **mixed** — valid-empty on the unconditional paths, throwing on the
  optional paths. `summarize()` returns an empty summary tree, `getGCData()`
  returns `{ gcNodes: {} }`, `hasBlob()` returns `false` — these run for every
  client. `createBlob()` / `getBlob()` **throw**, to fail fast if the no-blob
  assumption is violated.
- **Gate:** constructed unconditionally at L2017 `new BlobManager({...})`, and its
  summarize/GC methods are on always-run paths — hence those must be valid-empty.
  `createBlob`/`getBlob` are only reached if the app actually uploads/downloads
  attachment blobs.
- **Why the target client never trips the throws:** the scenario uses only
  `SharedString`/`SharedDirectory`; neither uses attachment blobs
  (`IFluidHandle`-backed BLOB storage). The consumer's API surface (`src/index.ts`)
  exposes no blob API.

### 1.7 gc (garbage collection) — `gc/garbageCollection.js` → `gc/garbageCollectionStub.js`

- **Shape:** **valid-empty** — `GarbageCollector.create(...)` returns a stub whose
  `shouldRunGC === false`, `isNodeDeleted()` returns `false`, and
  summary/metadata accessors return empty. Nothing throws.
- **Gate:** constructed unconditionally at L1932 `GarbageCollector.create({...})`.
  Crucially, the channel-collection wires `garbageCollector.nodeUpdated` and
  `garbageCollector.isNodeDeleted` on **always-run** paths — so a throwing stub
  would crash normal operation. The no-op is mandatory.
- **Why valid-empty is correct:** `shouldRunGC === false` means the runtime never
  invokes a GC pass; `isNodeDeleted() === false` means no node is ever treated as
  swept/tombstoned (the safe direction — nothing is spuriously deleted).
- **Precondition (consumer opt-in):** the app must not rely on GC sweep /
  tombstone enforcement for data-integrity. This is the one stub with a
  data-semantics precondition (documented in `BUNDLE_SIZE_REDUCTIONS.md`).
- **Enabled by §1.2:** because this client summarizes server-side (its
  `Summarizer` is stubbed), it never *writes* a summary, so the GC data this stub
  omits is never serialized by this client. See the dependency chain (§3).

### 1.8 summarizer-node (tree) — `summary/summarizerNode/summarizerNodeWithGc.js` → `summarizerNodeWithGcStub.js`

- **Shape:** **mixed** — faithful lifecycle where it must be, throwing on
  summarizer-only methods. `createChild`/`getChild`/`deleteChild` maintain a real
  child map; `recordChange`/`invalidate`/`updateUsedRoutes` are no-ops;
  `isReferenced()` returns `true` (nothing is GC-unreferenced when GC is disabled).
  `summarize`/`getGCData`/`startSummary`/`validateSummary`/`completeSummary`/
  `refreshLatestSummary` **throw**.
- **Gate:** constructed unconditionally at L1956 `createRootSummarizerNodeWithGC(...)`
  (root node), and children are created on always-run data-store paths — so the
  child-map lifecycle must be faithful (no-op-but-correct). The throwing methods
  are only invoked by a summarize pass.
- **Why the target client never trips the throws:** a summarize pass is driven by
  the `Summarizer` (stubbed, §1.2) with GC disabled (§1.7). With no summarizer and
  no GC, `summarize`/`getGCData`/`startSummary`/etc. are unreachable for this
  client.
- **Enabled by §1.2 + §1.7.** See §3.

### 1.9 summary-collection — `summary/summaryCollection.js` → `summaryCollectionStub.js`

- **Shape:** **mixed** — faithful `TypedEventEmitter` + trivial accessors
  (`latestAck === undefined`, `opsSinceLastAck === 0`, `addOpListener`/
  `removeOpListener`/`waitFlushed` are no-ops); `createWatcher()` and
  `waitSummaryAck()` **throw**.
- **Gate:** constructed **unconditionally** at L2290-2293
  `const summaryCollection = new SummaryCollection(deltaManager, baseLogger)` — so
  construction and the op-listener surface must be valid. The throwing methods
  (`createWatcher`, `waitSummaryAck`) are only called by the `Summarizer` (§1.2)
  and the election `SummaryManager` (§1.3).
- **Why the target client never trips the throws:** both consumers of the throwing
  methods are stubbed — `Summarizer` throws before it can call them (§1.2), and
  the election stub's `setupSummaryManager` returns `{}` without wiring a watcher
  (§1.3). So `createWatcher`/`waitSummaryAck` are unreachable.
- **Enabled by §1.2 + §1.3.** See §3.

### 1.10 batch-tracker — `batchTracker.js` → `batchTrackerStub.js`

- **Shape:** **no-op** — `BindBatchTracker` constructs a `BatchTracker` that does
  nothing.
- **Gate:** none — called unconditionally at L2177 `BindBatchTracker(this, this.baseLogger)`.
- **Why safe:** pure observability (batch-size telemetry). No-op preserves the
  call. Must not throw.

### 1.11 sampled-telemetry — (telemetry-utils) `sampledTelemetryHelper.js` → `sampledTelemetryHelperStub.js`

- **Shape:** **passthrough** — `measure(codeToMeasure)` returns
  `codeToMeasure()`; sampling/emission removed.
- **Gate:** none — `SampledTelemetryHelper` is constructed in multiple DDSs and
  `measure()` wraps functional code. The measured *callback* carries all
  behavior, so a passthrough is functionally identical minus the telemetry.
- **Why safe:** the passthrough executes and returns the measured code unchanged.
  A throwing stub would break every measured operation.

---

## 2. Determining which tests break under a polyfill

### 2.1 The method

The stubs are only swapped in the **webpack** build, so the standard package test
suite always exercises the **real** modules. To learn which tests would fail if a
stub were shipped, run the compiled test suite against a build in which the stub is
swapped over the real module — exactly mirroring
`NormalModuleReplacementPlugin`, but at the compiled-`lib/` level.

Because the suite runs against `lib/test` (ESM) and the runtime under test is the
compiled `lib/*.js`, copying `lib/<foo>Stub.js` over `lib/<foo>.js` makes every
importer of `./<foo>.js` resolve to the stub. This is the same substitution
webpack performs at bundle time.

### 2.2 The script

`tools/polyfill-swap.sh` (in this directory) automates swap → run → restore:

```bash
tools/polyfill-swap.sh list                 # print the stub-id -> (real,stub) table
tools/polyfill-swap.sh baseline             # control run: REAL modules
tools/polyfill-swap.sh gc                    # run suite with the gc stub swapped in
tools/polyfill-swap.sh summarizer gc         # multiple stubs at once
tools/polyfill-swap.sh all                   # all 11 stubs (the shipped bundle's module set)
```

It backs up each real module, copies the stub over it, runs `npx mocha`, and
**always restores** on exit (including Ctrl-C). Stub ids:
`id-compressor summarizer election connection-telemetry signal-telemetry
blob-manager gc summarizer-node summary-collection batch-tracker sampled-telemetry`.

### 2.3 Interpreting results — two buckets

Run `baseline` once, then each stub, and diff. Every test that passes at baseline
but fails under a stub falls into exactly one bucket:

- **Expected (subsystem-owned):** the test *directly exercises the stubbed
  subsystem* (e.g. `batchTracker.spec.ts` asserts batch-telemetry events). These
  failures are correct and expected — the subsystem is intentionally gone. Such
  tests belong to the **exclusion set** for the polyfilled build.
- **Unexpected (validity violation):** a test that does *not* target the stubbed
  subsystem fails. This means a real code path reaches the stub — the polyfill is
  **not** actually safe, and either the stub is wrong or a new static dependency
  crept in. This is the signal that must be investigated.

**Empirical confirmation.** Running `tools/polyfill-swap.sh batch-tracker` against
the current build produces exactly **2 failing / 967 passing / 1 pending**, and
both failures are in `batchTracker.spec.ts` (the tests asserting
`Batching:Length` / `Batching:LengthTooBig` events). Zero unexpected failures —
confirming the batch-tracker stub is safe and that its exclusion set is precisely
`batchTracker.spec.ts`.

### 2.4 Expected exclusion set per polyfill

The tests expected to fail (and therefore excluded from a polyfilled-build run)
map directly to each stubbed subsystem's own specs. Non-exhaustive:

| Polyfill | Expected failing specs (subsystem-owned) |
|----------|------------------------------------------|
| id-compressor | id-compressor enablement / serialization specs |
| summarizer | summarizer / running-summarizer / heuristics specs |
| election | summarizer-election / summary-manager specs |
| connection-telemetry | op-perf / `connectionTelemetry` specs |
| signal-telemetry | signal-telemetry specs |
| blob-manager | `blobManager` create/get specs (summary/GC blob specs stay green) |
| gc | `gc/*` collect/sweep/tombstone specs |
| summarizer-node | `summarizerNode` summarize/GC-data specs (child-map lifecycle stays green) |
| summary-collection | `summaryCollection` watcher / ack specs |
| batch-tracker | `batchTracker.spec.ts` (**confirmed:** 2 tests) |
| sampled-telemetry | `sampledTelemetryHelper` sampling/emission specs |

Any failure **outside** the corresponding row is a red flag (see §2.3).

### 2.5 Compile-time guard (already in place)

Each stub ships a companion `*Stub.spec.ts` drift test that uses
`requireAssignableTo<keyof typeof real, keyof typeof stub>` in **both** directions
plus constructor/signature assignability, so the stub can never silently diverge
from the real module's public surface. These run as part of the normal suite
(against the real modules) and are the first line of defense: if FF adds/renames
an export, the drift spec fails at compile time before any bundle is built.

---

## 3. The logical polyfill dependency chain

Several polyfills are only valid **because another polyfill (or root assumption)
was applied first**. Grouping by root assumption:

```
Root A: "client summarizes SERVER-SIDE; never elected summarizer"
        (isSummarizerClient === false, L1746)
   │
   ├─► (1.2) summarizer stub           [throwing; behind isSummarizerClient gate L2296]
   │      │
   │      ├─► (1.7) gc stub            [valid-empty; server-side summary ⇒ this client
   │      │         │                    never writes GC data / runs sweep]
   │      │         │
   │      │         └─► (1.8) summarizer-node stub
   │      │                   [throwing summarize/getGCData require BOTH:
   │      │                    summarizer stubbed (1.2) AND GC disabled (1.7)]
   │      │
   │      └─► (1.9) summary-collection stub
   │                [throwing createWatcher/waitSummaryAck require BOTH consumers
   │                 stubbed: Summarizer (1.2) AND election SummaryManager (1.3)]
   │
   └─► (1.3) election stub             [no-op; interactive clients DO enter the gate
                                        L2324, so it must not throw; returns {} = "does
                                        not elect", correct because summary is server-side]

Root B: "id-compression is OFF (default)"      ─► (1.1) id-compressor stub   [independent]
Root C: "app uses only SharedString/SharedDirectory; no attachment blobs" ─► (1.6) blob-manager stub [independent]
Root D: "telemetry is optional observability"  ─► (1.4) connection-telemetry, (1.5) signal-telemetry,
                                                    (1.10) batch-tracker, (1.11) sampled-telemetry  [independent]
```

**Reading the chain ("B is valid because A was applied"):**

- **summarizer-node (1.8)** throws in `summarize`/`getGCData`/`startSummary`/etc.
  That is only safe because **(1.2) summarizer** removes the code that would drive
  a summarize pass **and** **(1.7) gc** disables the GC pass that would call
  `getGCData`. Neither alone is sufficient; the throwing methods have two distinct
  callers.
- **summary-collection (1.9)** throws in `createWatcher`/`waitSummaryAck`. That is
  only safe because **both** consumers are stubbed: the `Summarizer` (1.2) and the
  election `SummaryManager` (1.3). If either were real, it would call the throwing
  methods.
- **gc (1.7)** omits GC data from summaries. That is only immaterial because
  **(1.2)** makes this client summarize server-side — it never writes a summary,
  so the omitted data is never serialized by this client.
- **election (1.3)** is not *enabled by* another stub, but it is the reason the
  summarizer-only branch is genuinely dead: with the election returning `{}` this
  client never becomes the summarizer, reinforcing Root A at runtime.

**Independent stubs** (no cross-dependency): id-compressor (1.1), blob-manager
(1.6), and all four telemetry stubs (1.4, 1.5, 1.10, 1.11). Each rests only on its
own root assumption and could be applied or removed without affecting the others.

---

## 4. Proposed unified testing approach

The per-polyfill investigation above is diagnostic. For ongoing CI protection we
want a single coherent strategy with three layers, cheapest-first:

### Layer 1 — Compile-time surface drift (already exists; keep + require)

The `requireAssignableTo` drift specs (§2.5) are the cheapest guard and already
run in the normal suite. **Requirement:** every stub must have a bidirectional
drift spec; a CI policy check should fail if a `*Stub.ts` exists without a matching
`*Stub.spec.ts`. This catches renamed/added/removed exports the instant FF changes
them.

### Layer 2 — Static-dependency guard (the missing piece; model on PR #27597)

Drift specs prove the *surface* matches but not that the real subgraph is
*unreachable* except through the intended gate. The failure mode we most fear is
FF adding a **new static `import`** into a stubbed subgraph *outside* the
`await import()` / `isSummarizerClient` gate — which would silently pull the real
code back into the bundle (or, with the stub, crash at runtime).

Add an automated assertion that the only edges into each stubbed module are either
(a) `import type` (erased) or (b) the single intended `await import()` gate. Two
viable implementations:

- **Bundle-graph assertion:** after `webpack:scenario`, parse the stats/source-map
  and assert none of the *real* stubbed modules appear in the chunk (the
  source-map-explorer JSON already gives per-module presence). This is a direct,
  high-signal check that the removal actually happened.
- **Source-level assertion:** a lint/test that greps each stubbed module's
  importers and fails if any non-`import type` static import appears outside the
  known gate line. This mirrors the "dependency tests" approach in PR #27597.

Either makes "someone added a static reference into the summarizer subgraph" a
**red build**, not a silent regression.

### Layer 3 — Polyfilled-build behavioral run (`tools/polyfill-swap.sh` in CI)

Wire the swap harness into CI as a scheduled/gated job:

1. `polyfill-swap.sh baseline` → record the passing set (control).
2. `polyfill-swap.sh all` → run the suite with the shipped bundle's exact module
   set.
3. Diff. Assert that **every** newly-failing test is in the known exclusion set
   (§2.4). Any failure outside the exclusion set fails CI — that is a validity
   violation (a real path reached a throwing stub).

The exclusion set is maintained as data (a small allow-list keyed by spec name),
so adding a polyfill means adding its subsystem's specs to the list, and an
unexpected failure can never be silently absorbed.

### Layer 4 — End-to-end smoke (highest confidence, lowest frequency)

Neither the drift specs nor the swapped unit run actually *loads a container*
against the shipped bundle. Add one smoke test that, using the real
`encapsulated-no-tree` bundle, creates/attaches a container and performs the
target client's real operations (create a `SharedDirectory`, edit a
`SharedString`, send/receive ops, reconnect). This exercises the unconditional
no-op stubs (GC, signal-telemetry, summary-collection, summarizer-node child-map,
blob-manager summarize) on real code paths and proves the client functions with
the full stub set applied. It is the definitive check that the valid-empty/no-op
stubs are truly behaviorally transparent.

### Summary of the unified strategy

| Layer | Catches | Cost | Status |
|-------|---------|------|--------|
| 1. Drift specs | export surface divergence | ~free (in suite) | **exists** |
| 2. Static-dependency guard | new static edge into a stubbed subgraph | cheap (post-build assert) | **to add** (model: PR #27597) |
| 3. Swapped unit run (`polyfill-swap.sh all` + exclusion allow-list) | real path reaching a throwing stub | one extra suite run | **harness exists; wire into CI** |
| 4. E2E smoke on the real bundle | no-op stubs breaking real operation | one integration test | **to add** |

Layers 1-2 are static and cheap enough to run on every PR; layers 3-4 can run on a
schedule or on changes under `packages/runtime/container-runtime` and the scenario
directory.
