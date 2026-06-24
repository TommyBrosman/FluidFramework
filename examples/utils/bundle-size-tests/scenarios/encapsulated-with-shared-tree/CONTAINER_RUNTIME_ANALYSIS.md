<!-- spell-checker: ignore EROFS -->

# Container Runtime Bundle Analysis

Companion to [BUNDLE_SIZE_FINDINGS.md](./BUNDLE_SIZE_FINDINGS.md) and
[TREE_CHECKOUT_ANALYSIS.md](./TREE_CHECKOUT_ANALYSIS.md), with focus on
`packages/runtime/container-runtime` — the runtime plumbing for op processing,
summaries, and data store lifecycle.

## Current state

**Scenario:** `encapsulated-with-shared-tree`
**Measurement tool:** `scripts/analyzeReasons.ts --root runtime/container-runtime/lib/containerRuntime.js --cutoff 2000`
**Date:** 2026-06-12

| Metric | Value |
|---|---|
| **Bundle total** | 960,994 B |
| **container-runtime package** | 234,905 B (24.4%) |
| **containerRuntime.js own bytes** | 53,571 B (5.6% of bundle, 22.8% of package) |
| **container-runtime modules reachable from containerRuntime.js** | 62 modules |

## Exports from `containerRuntime.ts` and their uses

### Value exports (runtime cost > 0 B)

**Big:**
- `ContainerRuntime` class — dominates the 53.6 KB own size. Instantiated by
  `loadContainerRuntime` (entry point from aqueduct).
- `loadContainerRuntime`, `loadContainerRuntimeAlpha` — async factory functions.
  Single chokepoint for pulling in the container-runtime graph in this scenario.

**Small:**
- `isContainerMessageDirtyable` — function, imported by `pendingStateManager.ts` and
  `opLifecycle/batchManager.ts`.
- `isUnpackedRuntimeMessage`, `getDeviceSpec`, `makeLegacySendBatchFn`,
  `getSingleUseLegacyLogCallback` — functions (small).
- `DeletedResponseHeaderKey`, `TombstoneResponseHeaderKey`,
  `InactiveResponseHeaderKey`, `agentSchedulerId` — string constants (tiny).
- `defaultRuntimeHeaderData`, `defaultPendingOpsWaitTimeoutMs`,
  `defaultPendingOpsRetryDelayMs` — const data.

### Type-only exports (0 B at runtime)

`ContainerRuntimeOptions`, `IContainerRuntimeOptions`, `ContainerRuntimeOptionsInternal`,
`IContainerRuntimeOptionsInternal`, `ISummaryRuntimeOptions`, `RuntimeHeaderData`,
`IPendingRuntimeState`, `LoadContainerRuntimeParams`, etc. — all type-only, free.

## Consumption path in this scenario

```
scenario entry (index.ts)
└─ imports CompressionAlgorithms, IContainerRuntimeOptions
   (neither from containerRuntime.ts; reached transitively)

   ↓ (via aqueduct/legacy)

   ContainerRuntimeFactoryWithDefaultDataStore
   └─ imports type IContainerRuntimeOptions

      ↓ extends

      BaseContainerRuntimeFactory
      └─ imports loadContainerRuntime ← ONLY live value import from containerRuntime.ts

         ↓ calls loadContainerRuntime(params)

         instantiates ContainerRuntime (constructor)
         ├─ statically references channelCollection.js (17 KB)
         ├─ statically references dataStoreContext.js (15 KB)
         ├─ statically references summary/* (68 KB reachable)
         ├─ statically references garbageCollection.js (11.5 KB)
         ├─ statically references opLifecycle/* (6+ KB)
         ├─ statically references pendingStateManager.js (7.7 KB)
         └─ …
```

**Key insight:** `loadContainerRuntime` is the only value-level anchor. Everything else
pulled into the bundle from this path is statically reachable from the `ContainerRuntime`
class body.

## Top contributors by reachable bytes

From forward BFS starting at `containerRuntime.js`:

| Module | Own B | Σ Reachable B | Notes |
|---|---:|---:|---|
| `containerRuntime.js` | 53,571 | 234,905 | Class itself. |
| `summary/index.js` | ~0 | 68,276 | Barrel imports: runningSummarizer (13 KB), summaryGenerator (5.8 KB), summarizer (5.2 KB), summaryManager (6.3 KB), summarizerHeuristics (2.8 KB), summarizerNode/* (10+ KB). **Reaches eagerly** despite `summaryDelayLoadedModule/*` prefix. |
| `channelCollection.js` | 17,000 | 108,790 | Data store channel registry + bootstrapping. |
| `dataStoreContext.js` | 14,997 | 86,964 | (reached from channelCollection) |
| `deltaManagerProxies.js` | 3,205 | 71,503 | (reached from dataStoreContext) |
| `garbageCollection.js` | 11,460 | 27,805 | GC graph, blob manager. |
| `pendingStateManager.js` | 7,711 | 9,989 | Pending state tracking. |
| `blobManager.js` | 8,107 | 8,203 | Blob handling. |
| `outbox.js` | 6,184 | 6,184 | Op batching/queueing. |
| `connectionTelemetry.js` | 5,844 | 5,844 | Telemetry for connection events. |

(Others: `documentSchema`, `orderedClientElection`, `summarizerNode/*`, `gcTelemetry`,
`opLifecycle/*`, `summaryManager`, etc. all in the 2–6 KB range, totaling ~17 KB in
cutoff-pruned subtrees.)

## Summarizer code-split fix (landed)

### Background

Only the elected **summarizer client** ever runs the summary-generation code. To keep
that code off every interactive client, it was factored into
`summary/summaryDelayLoadedModule/*` (runningSummarizer, summaryGenerator, summarizer,
summarizerHeuristics, runWhileConnectedCoordinator, summaryResultBuilder — ~28 KB
minified) and pulled in with a dynamic `await import(...)` gated on
`this.isSummarizerClient` in `ContainerRuntime.initializeSummarizer`.

### The bug: the delay-load was inert

The dynamic import targeted the **`./summary/index.js` barrel**:

```ts
const module = await import(/* … */ "./summary/index.js");
this._summarizer = new module.Summarizer(/* … */);
```

That same barrel is **also statically imported** at the top of `containerRuntime.ts`
for the summarization infrastructure every client loads (`SummaryManager`,
`SummaryCollection`, `SummarizerClientElection`, `OrderedClientElection`,
`DocumentsSchemaController`, the metadata/blob-name constants, …). When a module is
reachable through **both** a static import and a dynamic `import()`, a bundler must keep
it in the chunk that the static import lands in — the initial chunk. So
`summaryDelayLoadedModule/*` (reached via the barrel's re-export of `Summarizer`,
`RunningSummarizer`, etc.) sat in the initial chunk for **every** client. The
`summaryDelayLoadedModule` naming and the `import()` were both present, but the split
never happened. Confirmed: the `summarizerDelayLoadedModule` chunk name appears `0×` in
the emitted bundle.

### The fix (one line)

Point the dynamic import at the delay-loaded module **directly**, so it is no longer in
the statically-reachable graph:

```ts
const module = await import(
    /* webpackChunkName: "summarizerDelayLoadedModule" */ "./summary/summaryDelayLoadedModule/index.js"
);
```

`module.Summarizer` and `module.RunWhileConnectedCoordinator` still resolve — both are
exported from `summaryDelayLoadedModule/index.js`. The barrel keeps re-exporting them for
the package's public API and for test/internal value consumers; only the dynamic import's
target changed.

### Effect

- **This scenario:** **0 B** change to the measured total. The scenario's webpack config
  uses `LimitChunkCountPlugin({ maxChunks: 1 })`, which merges every async chunk back into
  the single output file, so the summarizer is present regardless. (The single-chunk
  measurement is intentional — it captures total reachable bytes.)
- **Real multi-chunk consumers:** the summarizer cluster now splits into its own
  lazily-loaded chunk, removing ~28 KB (plus transitive-only code; see below) from the
  **initial** load for the ~99 % of clients that never become the summarizer. This is a
  time-to-interactive win, not a total-bytes win.

### Verifying the split (multi-chunk build)

Because `maxChunks: 1` hides the split in this scenario, verification used a temporary
build with that plugin removed (so `import()` boundaries may form their own chunks):

- **Before the fix:** no `summarizerDelayLoadedModule` chunk is emitted; the summarizer
  source maps into the main chunk.
- **After the fix:** a separate `summarizerDelayLoadedModule.js` chunk is emitted and the
  main chunk shrinks by the summarizer cluster.

### Excluding the summarizer entirely (single chunk, non-summarizer builds)

A second capability the fix unlocks: a consumer who **knows** a given build target will
never run the summarizer (e.g. a view-only / read-only client, or any deployment where
summarization runs in a separate summarizer build) can now drop the summarizer code
*entirely*, even while keeping a single chunk. Before the fix this was impossible — the
summarizer was only reachable through the `./summary/index.js` barrel, which also carries
the summary infrastructure every client needs, so stubbing the barrel would have removed
`SummaryManager` / `SummaryCollection` / election too.

Now that the summarizer sits behind a single dedicated module boundary
(`summaryDelayLoadedModule/index.js`), it can be replaced with a stub via webpack's
[`NormalModuleReplacementPlugin`](https://webpack.js.org/plugins/normal-module-replacement-plugin/).
That plugin rewrites the *resolved resource* of any module whose path matches a regex to a
replacement module, before the module is built — so the original (and everything reachable
**only** through it) is never included.

```js
// webpack.config — for a build target that never becomes the summarizer client
new webpack.NormalModuleReplacementPlugin(
    /summaryDelayLoadedModule[\\/]index\.js$/,
    require.resolve("./summarizerExcludedStub.cjs"),
);
```

```js
// summarizerExcludedStub.cjs
// Stands in for summaryDelayLoadedModule/index.js. The dynamic import() branch is gated on
// `isSummarizerClient`, so on a client that never summarizes it is never evaluated. Throw on
// any access so a misconfigured build that *does* try to summarize fails loudly rather than
// silently constructing a broken Summarizer.
module.exports = new Proxy(
    {},
    {
        get(_t, prop) {
            throw new Error(
                `summaryDelayLoadedModule was excluded from this build but "${String(prop)}" was accessed`,
            );
        },
    },
);
```

> Safety: this is only valid for a build whose clients never get elected summarizer.
> Eligibility for election is gated by `SummarizerClientElection.clientDetailsPermitElection`
> / connection mode, so read-only and view-only clients qualify; a build that may host the
> summarizer must **not** apply this replacement.

### Measured removal (single chunk, stub applied)

Diffing the per-source-file source-map attribution of the baseline build against the
stubbed build (both single-chunk, identical except for the replacement plugin):

| Bytes | Removed source file | Declarations |
|---:|---|---|
| 13,057 | `summaryDelayLoadedModule/runningSummarizer.ts` | `RunningSummarizer` |
| 5,792 | `summaryDelayLoadedModule/summaryGenerator.ts` | `SummaryGenerator` |
| 5,228 | `summaryDelayLoadedModule/summarizer.ts` | `Summarizer`, `SummarizingWarning`, `createSummarizingWarning`, `defaultMaxAttempts`, `defaultMaxAttemptsForSubmitFailures` |
| 2,788 | `summaryDelayLoadedModule/summarizerHeuristics.ts` | `SummarizeHeuristicData`, `SummarizeHeuristicRunner` |
| 787 | `summaryDelayLoadedModule/runWhileConnectedCoordinator.ts` | `RunWhileConnectedCoordinator`, `neverCancelledSummaryToken`, `ICancellableSummarizerController` (type) |
| 563 | `summaryDelayLoadedModule/summaryResultBuilder.ts` | `SummarizeResultBuilder` |
| 153 | `opProperties.ts` | `opSize` — **transitive-only**: reachable only through the summarizer path, so it drops out too |

- **Fully removed: 7 files / 28,368 B.**
- **Net bundle delta: −42,904 B (−41.9 KiB)** (960,990 → 918,086 B). The difference above
  the 28,368 B of removed files is net shrinkage spread across many surviving files at
  1–80 B each, dominated by source-map re-attribution noise from terser repacking a smaller
  bundle; only the 7 fully-removed files are claimed as unambiguous.

**Level of effort:** Low (one-line source change for the split; a small config + stub for
the optional exclusion).

---

## Known unrealized reductions

### containerRuntime.js own-size reduction (~53.6 KB)

The class body itself is large. Known candidates:

1. **Unused or dead-code-elimination opportunities** — profile the class methods;
   categorize which are reachable from `loadContainerRuntime`.
2. **Helper inlining** — detect small helper methods that could be inlined to reduce
   method table overhead.
3. **Optional feature flags** — any constructor parameters or feature gates that
   conditionally load subsystems? (e.g., GC off, summaries off)
4. **Diagnostic / verbose APIs** — exported methods like `exportVerbose` that are only
   used for debugging/testing.

No measurements yet; needs investigation via source-map-explorer breakdown or class method
audit.

---

### dataStoreContext.js cross-cutting refactor (~15 KB own)

Part of the channel → dataStoreContext → summary/deltaManager chain. Reached eagerly
from container construction. Opportunity unclear without diving into design.

---

## Measurement methodology

```bash
cd examples/utils/bundle-size-tests
npx jiti scripts/analyzeReasons.ts \
  --root runtime/container-runtime/lib/containerRuntime.js \
  --cutoff 2000
```

Output: `bundleAnalysis/reasons-encapsulated-with-shared-tree-containerRuntime.md`

Iteration time: ~90s per measurement (40s tsc + 10s webpack + 10s SME + 30s graph).

## Comparison points

- **Tree package** (from tree-reasons report): 316.6 KB (32.9%), 174 modules.
- **Container-runtime package:** 234.9 KB (24.4%), 62 modules.
- **Loader package** (container-loader): not yet measured, but expected ~50–100 KB
  based on code size.

Tree is larger by count and bytes, but containerRuntime.js itself (53.6 KB) is a
single-file hotspot comparable to the biggest tree modules (treeCheckout: 17.7 KB
own, objectForest: 6.9 KB own).

## Notes

- The `summary/summaryDelayLoadedModule/*` finding reproduces the known issue documented
  in `BUNDLE_SIZE_REDUCTIONS.md` (§ "Scenario-level lever"). Confirms the single-chunk
  plugin is the bottleneck.
- No type-only exports contribute to bundle size; all 234.9 KB is from value code.
- The `loadContainerRuntime` entry point makes container-runtime inescapable if using
  aqueduct's factory; there's no tree-style "read-only variant" that could shed the
  op-processing / summary paths.
