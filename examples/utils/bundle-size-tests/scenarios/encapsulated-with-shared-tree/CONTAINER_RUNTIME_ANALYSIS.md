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

## Known unrealized reductions

### summary/* cluster (~42 KB, easy candidate for code-splitting)

The `summaryDelayLoadedModule/*` subtree (runningSummarizer, summaryGenerator, etc.)
totals ~28 KB in this bundle despite naming suggesting it should be delay-loaded. The
entire `summary/index.js` reaches 68.3 KB and is forced into the initial chunk by
`LimitChunkCountPlugin({ maxChunks: 1 })`.

**Impact:** Removing `maxChunks: 1` would shed these ~42 KB from the initial chunk
(splitting into chunk 0 + chunk 1 for summarizer cluster). **No source changes needed.**

**Level of effort:** Low (config tweak only).

---

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
