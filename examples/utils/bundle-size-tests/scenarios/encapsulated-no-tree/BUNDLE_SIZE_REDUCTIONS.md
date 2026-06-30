# Bundle-size reductions: `encapsulated-no-tree`

High-level summary of bundle-size reductions for the
`encapsulated-no-tree` scenario. Companion to the detailed
[BUNDLE_SIZE_FINDINGS.md](BUNDLE_SIZE_FINDINGS.md) and
[TREE_CHECKOUT_ANALYSIS.md](TREE_CHECKOUT_ANALYSIS.md). This doc answers two
questions:

1. **What known reductions (>1 KB parsed) have been made?** — with commit
   hash and previously-measured bundle deltas.
2. **What promising reductions are still on the table?** — with approximate
   impact and level-of-effort estimate.

Both sections are ordered **descending by reduction size**.

## Bundle baseline / current state

> **Scope change (this branch): tree removed.** The scenario was renamed from
> `encapsulated-with-shared-tree` to `encapsulated-no-tree` and the
> `@fluidframework/tree/legacy` re-export was deleted from `src/index.ts`. All
> `dds/tree`-specific reductions below (rows 1–3) are therefore **out of scope**
> for the current target — they shrank tree code that is no longer in the bundle.
> They are retained for the historical record only.

### Ground-truth no-tree measurements (single chunk)

> **Metric: single-chunk total bytes.** The consuming target is a **MOBILE app
> bundle**, which ships as a single chunk. Deferring code into separate async
> chunks (`await import(...)` / code-splitting) saves **nothing** — every byte
> still ships in the one download. Therefore **only TRUE removals count**;
> lazy-loading required functionality does not. The scenario pins
> `LimitChunkCountPlugin({ maxChunks: 1 })` so the measured bundle is one chunk.

All figures are **parsed = file size** (source-map-explorer total == `stat -c%s`
for these Terser-minified bundles) for the single chunk
`build/scenarios/encapsulated-no-tree/encapsulated-no-tree.js`.

| Milestone | Parsed | Gzip |
|---|---:|---:|
| **No-tree single chunk, all dep-swaps applied** (`135357c859`) | **617,974 B** | **160,775 B** |
| + id-compressor delay-load seam (no stub swap) | 618,397 B | 160,833 B |
| **+ id-compressor stub polyfill** (`NormalModuleReplacementPlugin`) | **585,184 B** | **151,269 B** |
| **+ summarizer stub polyfill** (`NormalModuleReplacementPlugin`) | **546,425 B** | **142,246 B** |

> **The id-compressor stub polyfill is a TRUE removal of −33,213 B parsed / −9,564 B
> gzip** (618,397 → 585,184), and it holds under the single chunk. Note the
> delay-load seam *alone* (618,397 B) is essentially the same size as the baseline
> — proving deferral by itself saves nothing here; the saving comes entirely from
> replacing the real module with the throwing stub at build time so the
> id-compressor subgraph (incl. `@tylerbu/sorted-btree-es6`) never ships. See the
> id-compressor section below.

> An earlier exploration lazy-loaded id-compressor (`6bde337df1`) to shrink the
> *entry* chunk, but that metric is irrelevant for a single-chunk mobile bundle:
> the deferred bytes still ship, and chunk-splitting overhead made the total
> *larger* (split total 621,343 B vs single-chunk 617,974 B). It was reverted in
> `135357c859`.

### Target (from real FF 2.80.0 consumer bundle)

The consuming app's hard requirement is **total bundle ≤ 200 KB gzip
post-babel**. Translated to this harness's metric (Fluid pre-transpile parsed
bytes):

| Quantity | Bytes |
|---|---:|
| Fluid footprint in consumer (pre-transpile parsed) | 673,792 |
| **Fluid target (pre-transpile parsed)** | **407,532** |
| **Required reduction** | **−266,260** |

The harness measures **absolute byte deltas** that transfer to the consumer for
shared core code; it does not reproduce the consumer's absolute number (their
app uses a narrower API slice plus 2.80→2.101 drift).

### Honest ceiling (non-tree, true removals only)

Under the single-chunk / true-removals-only rule, the landed wins are the
**dep-swaps (≈ −18 KB)** — npm polyfills genuinely replaced by smaller in-tree
code — plus two stub-polyfill exclusions: the **summarizer (≈ −38.8 KB)** and the
**id-compressor (≈ −33 KB)**, both true exclusions (not deferral) of subsystems
this mobile client does not need (server-side summarization; id-compressor off by
default). Pure code-splitting / lazy-loading is still **disqualified**: it defers
bytes that still ship in the single chunk. These wins are *not* deferral — the real
modules are replaced by throwing stubs at build time, so their bytes never ship.

The remaining ~546 KB is dominated by code that is **genuinely reachable** from
the scenario's API surface and cannot be deferred away:
`merge-tree` (92,732) + `sequence` (40,005) pulled by `SharedString`,
`container-runtime` core, `container-loader` (~103 KB), `map` (~36 KB).

A true removal toward the target therefore requires one of:
- **Build-time exclusion of an unused subsystem** behind a replaceable
  dynamic-import seam (the stub-polyfill pattern — summarizer + id-compressor,
  both now landed);
- **Dead-code elimination** terser can't do automatically (back-compat shims
  behind effectively-constant conditions, e.g. the `SharedMap` aqueduct
  registration ≈ 9.5 KB);
- **Lighter reimplementation** of a heavy subsystem (the dep-swap pattern, but
  applied to first-party code);
- **Dropping genuinely-unused API surface** the mobile app does not need (a
  consumer/scope decision about what `index.ts` must export).

Reaching −266,260 B on non-tree FF core via true removals alone is **infeasible**.
The app **confirms it uses `SharedString` and `SharedDirectory`** (and every other
`index.ts` export), so the two largest non-tree blocks — `merge-tree`+`sequence`
(≈133 KB) and `map` (≈36 KB) — are **required code** and off the table. With the
summarizer (≈38.8 KB) and id-compressor (≈33 KB) stub polyfills landed plus the
dep-swaps (≈18 KB) — ~90 KB total — the remaining true-removal candidates are the
`SharedMap` aqueduct back-compat registration (≈9.5 KB, **open compat question**)
and `lz4js` (≈4.7 KB, required on the inbound op path). Even all landed + candidate
removals together reach ~104 KB — under half the 266 KB target. **The target is not
reachable on non-tree FF code while preserving the app's required API surface.** See
the true-removal ledger and research notes below.

### True-removal ledger (single chunk, non-tree) — needs decisions

Every large remaining lever is gated on a product/compat/scope decision, not on
engineering. Ordered by size:

| Lever | True-removal size | Gating decision | Risk |
|---|---:|---|---|
| `SharedString` / `createOverlappingIntervalsIndex` (pulls `merge-tree` 92,732 + `sequence` 40,005) | **~132,737 B** | ❌ **RESOLVED — app uses `SharedString`.** Required; not removable. | — |
| `summarizer` subtree (`summaryDelayLoadedModule` 28,215 + terser DCE of now-dead code) | **−38,759 B (implemented)** | ✅ **IMPLEMENTED.** Client-side summarization not needed (mobile summarizes server-side). Removed via the stub polyfill (PR #27611 stub + `NormalModuleReplacementPlugin`). Public-API names (`Summarizer`, …) preserved as throwing stubs. | Build-config opt-in (low) |
| `SharedDirectory` (pulls `map`) | **~35,738 B** | ❌ **RESOLVED — app uses `SharedDirectory`.** Required; not removable. | — |
| `id-compressor` subtree (id-compressor 17,954 + sorted-btree 15,542) | **−33,213 B (implemented)** | ✅ **IMPLEMENTED.** Off by default. Removed via the summarizer-style stub polyfill: a delay-loaded leaf module + `NormalModuleReplacementPlugin` swap to a throwing stub. True removal that holds in a single chunk. Apps that never enable id-compressor opt in via the webpack replacement. | Build-config opt-in (low) |
| `SharedMap` aqueduct back-compat registration | **~9,506 B** | ❓ **OPEN QUESTION** — are pre-0.10 SharedMap-DataObject documents still in scope? Owner decision pending. | Compat (load-bearing) |
| `lz4js` (`OpDecompressor` inbound + `OpCompressor` outbound) | **~4,672 B** | See research below — `decompress` is genuinely required on the inbound path (any client may receive compressed ops). | Core hot-path |
| Re-include + shrink `tree` | — | ❌ **OUT OF SCOPE** (confirmed). | Scope |

> **Note re: index.ts.** All exports in `src/index.ts` are confirmed in use by the
> app, so the scenario's API surface is representative and will not be trimmed.
> `SharedString`/`SharedDirectory` (the two largest blocks, ~168 KB combined) are
> therefore **required code** — they are not reduction candidates.

### Excluding id-compressor (~33 KB) from a single chunk — IMPLEMENTED

**Result.** Implemented via the summarizer-style **stub polyfill** (delay-loaded
leaf module + build-time module replacement). With the replacement active the
single chunk drops from **618,397 → 585,184 B parsed** (−33,213) and
**160,833 → 151,269 B gzip** (−9,564). (Without the replacement, the delay-load
seam alone measures 618,397 B — i.e. essentially unchanged from the 617,974 B
baseline; this confirms that the dynamic-import seam by itself saves nothing in a
single chunk, and that the saving comes entirely from the stub swap, a TRUE
removal.) The removed bytes are the id-compressor module (17,954) + its sole
non-tree dependency `@tylerbu/sorted-btree-es6` (15,542) + a few hundred bytes of
telemetry-utils helpers used only by the compressor closure. Verified the merged
bundle no longer contains any `sorted-btree`/`tylerbu` code and instead carries the
stub's fail-fast marker.

**Why it is in the bundle at all.** Every importer of `@fluidframework/id-compressor`
in the in-bundle packages is `import type` (erased) **except**
`containerRuntime.ts`, which value-imported `createIdCompressor` / `createSessionId`
/ `deserializeIdCompressor` / `toIdCompressorWithCore`. Those are referenced inside
`createIdCompressorFn`, which is **always constructed and passed to the
`ContainerRuntime` constructor** (even when id-compressor is disabled). That live
reference is what pinned the subtree. The id-compressor package is already
`sideEffects: false`, so once the reference moves behind a replaceable seam the
subtree tree-shakes out cleanly.

**How the stub polyfill works (the real summarizer pattern).** This is *not*
deferral. It is the same mechanism FF already uses to drop the summarizer
implementation from single-chunk mobile bundles:

1. **A delay-loaded leaf module.** `containerRuntime.ts` now reaches the four
   id-compressor functions exclusively through a dynamic
   `await import("./idCompressorDelayLoadedModule/index.js")`, taken only on the
   enabled path inside the async `loadRuntime2`. Every other reference to
   id-compressor in container-runtime is type-only. The import is awaited before any
   synchronous code constructs the compressor, preserving the documented
   *synchronous-initialization* requirement (`createIdCompressorFn` reads the
   already-resolved module). The leaf module — not a barrel — is imported directly,
   so the subgraph does not get folded back into the initial chunk under
   `providedExports: false`.

2. **A throwing stub** (`idCompressorDelayLoadedModuleStub.ts`) re-exports the same
   four value symbols; each throws `… is unavailable: the
   idCompressorDelayLoadedModule chunk was stubbed out of the bundle.` if ever
   called. A compile-time spec
   (`test/idCompressorDelayLoadedModuleStub.spec.ts`) asserts
   `requireAssignableTo<keyof typeof real, keyof typeof stub>` **both directions**,
   so the stub's value exports stay exactly in sync with the real module.

3. **Build-time replacement.** The consuming bundle uses
   `NormalModuleReplacementPlugin(/idCompressorDelayLoadedModule[\\/]index\.js$/, …)`
   to swap the leaf module for the stub. The real id-compressor subgraph never
   enters the module graph, so it is a TRUE removal that survives
   `LimitChunkCountPlugin({ maxChunks: 1 })` — unlike pure deferral, which the
   single-chunk merge pulls right back in.

**Safety / contract.** id-compressor is off by default
(`enableRuntimeIdCompressor`), and a consumer applies the replacement only when it
commits to never enabling it; if it does enable it, the stub throws immediately
(fail fast) rather than corrupting state. The "type-only everywhere outside the
`await import()`" invariant is what keeps the swap runtime-safe and should be guarded
by dependency tests in the consuming/host package (mirroring FF's summarizer
dependency tests).

### Excluding the summarizer (~38.8 KB) from a single chunk — IMPLEMENTED

**Result.** Implemented via the same stub-polyfill mechanism (this is the original
"summarizer approach"; PRs #27611 stub + #27597 dependency tests). With the
replacement active the single chunk drops from **585,184 → 546,425 B parsed**
(−38,759) and **151,269 → 142,246 B gzip** (−9,023). The directly-removed
`summaryDelayLoadedModule` subgraph is 28,215 B (`runningSummarizer` 13,057,
`summaryGenerator` 5,792, `summarizer` 5,228, `summarizerHeuristics` 2,788,
`runWhileConnectedCoordinator` 787, `summaryResultBuilder` 563); the remaining
~10 KB is terser dead-code elimination of code that becomes unreachable once the
summarizer implementation is gone, plus reduced module-concatenation overhead.

**Why it is in the bundle at all.** The summarizer is already factored into a
delay-loaded leaf module (`summary/summaryDelayLoadedModule/index.js`) that
ContainerRuntime reaches only through `await import(...)` (containerRuntime.ts
~line 2311). However, the implementation classes are **also part of the package's
public API** — `summary/index.ts` value-re-exports `Summarizer`,
`RunningSummarizer`, `RunWhileConnectedCoordinator`, `SummarizeHeuristicData`,
`SummarizeHeuristicRunner`, `neverCancelledSummaryToken`, `defaultMaxAttempts`,
`defaultMaxAttemptsForSubmitFailures` from the leaf module, and the package
`index.ts` re-exports `Summarizer`/`neverCancelledSummaryToken`. Those value
re-exports pin the subgraph into any bundle that touches the public API.

**How the stub keeps the public API intact.** The stub
(`summary/summaryDelayLoadedModuleStub.ts`, from PR #27611) re-exports the same
value symbols: the classes are present but **throw on construction**
(`unavailable(name)`), while the constants get their real values
(`defaultMaxAttempts = 2`, `defaultMaxAttemptsForSubmitFailures = 5`,
`neverCancelledSummaryToken`). Because `NormalModuleReplacementPlugin` redirects
**every** import of `summaryDelayLoadedModule/index.js` — the `await import()` seam
*and* the public-API value re-exports — to the stub, the real ~28 KB subgraph never
enters the graph, yet `Summarizer` etc. remain exported (as throwing stubs). A
compile-time spec (`test/summary/summaryDelayLoadedModuleStub.spec.ts`, PR #27611)
asserts `requireAssignableTo` both directions so the stub's value exports stay in
sync with the real module.

**Safety / contract.** Appropriate for clients that summarize **server-side** and
never instantiate a client summarizer. If such a client ever constructs the
summarizer, the stub throws immediately (fail fast). PR #27597's dependency tests
enforce that nothing outside the `await import()` seam takes a *runtime* dependency
on the delay-loaded summarizer internals, keeping the swap runtime-safe.

### Research: where lz4js is used (~4,672 B)

`lz4js` enters the bundle through **two** static imports in container-runtime's
`opLifecycle/`:

- `opCompressor.ts` → `import { compress } from "lz4js"` — **outbound** op
  compression. `OpCompressor` is constructed unconditionally in the
  `ContainerRuntime` constructor (`containerRuntime.ts:2051`). Compression only
  *fires* when the session schema enables lz4 and a batch exceeds
  `minimumBatchSizeInBytes` (the `2.0.0-defaults` config sets this to 614,400 B ≈
  600 KB; the disabled config sets it to `+Infinity`). So `compress` is rarely
  *called*, but the code is always *present*.
- `opDecompressor.ts` → `import { decompress } from "lz4js"` — **inbound** op
  decompression. `OpDecompressor` is also constructed unconditionally
  (`containerRuntime.ts:1822`) and runs on the **inbound op hot path**: when a
  received message has `compression === CompressionAlgorithms.lz4`, it must
  `decompress` it.

**Why it is hard to remove.** `decompress` is not optional for correctness: a
client can receive compressed ops authored by *other* clients (or by its own
earlier session) regardless of whether *this* client ever compresses. Dropping
`decompress` would break reading those ops. So even an app that never compresses
outbound must retain the decompressor. A true removal would require a guarantee
that the document/session never contains lz4-compressed ops — a
collaboration-wide invariant, not a local build choice — which is why this is
classified core hot-path and left as-is. (The `attributor` and a driver-utils
summary-blob adapter also use lz4, but those are not in this scenario's graph.)

---

## 1. Known reductions made (>1 KB parsed)

All commit hashes are on `tbrosman/claude-shrink-bundle` (and its parent
`tbrosman/experiment-shrink-bundle`). Deltas are the values measured at the
time each change landed, against this scenario's bundle.

| # | Commit | Change | Parsed Δ | Gzip Δ |
|---|--------|--------|---------:|-------:|
| 1 | `f39c28c357` | **TypeBox barrel-import rewrite** _(tree-only — OUT OF SCOPE now tree removed)_ — replace `import { Type }` (namespace object, defeats `usedExports`) with named imports of the specific kinds; reconstruct a local `const Type = {…}` so call sites are unchanged. 35 `dds/tree` files. TypeBox: 39,283 → 12,580 B (−68%). | **−25,764** | **−5,541** |
| 2 | `a636e62391` | **`importHelpers` + `tslib` — `dds/tree` only** _(tree-only — OUT OF SCOPE)_. Stops `tsc` emitting `__classPrivateFieldGet/Set` / `__esDecorate` / `__runInitializers` inline per file (12–16× duplicated, un-dedupable by `concatenateModules`). 17 `dds/tree` modules collapse to one `tslib` import. | **−9,466** | −621 |
| 3 | `1517e1b2b7` | **Skip shape-aware chunker on default-policy path** _(tree-only — OUT OF SCOPE)_ — add `basicOnlyChunkField`/`basicOnlyChunkTree` (policy-free, `BasicChunk`-only) and route the 4 default-policy callers through them. DCEs `uniformChunk.ts` (5,908 → 0 B) + the `Chunker`/shape-inference surface. | **−7,526** | −3,176 |
| 4 | `80571ad8fe` | **Replace `events` (npm) polyfill** with in-tree `EventEmitter` (~150 lines, `WeakMap`-backed, fires `newListener`/`removeListener`). Also drops `events_pkg` import in container-loader `quorum.ts`. | **−4,464** | −1,223 |
| 5 | `dde412e121` | **Replace `path-browserify`** with ~35 lines of inline posix path helpers in `dds/map` `directory.ts` (full `..`/`.`/multi-slash semantics). | **−3,590** | −1,332 |
| 6 | `be4b57addd` | **`importHelpers` + `tslib` — 4 more packages** (container-runtime, container-loader, sequence, shared-object-base; 6 files total). Broken down per package below. | **−3,314** | −853 |
| 7 | `004d76ec6c` | **Replace `double-ended-queue` (npm)** with in-tree `Deque<T>` (~80 lines, array-backed w/ head index, amortized O(1) shift). | **−2,157** | −621 |
| 8 | `ec4c2cd96f` | **Replace `base64-js` (npm)** with `btoa`/`atob` inline helpers in `bufferBrowser.ts` (chunked via `String.fromCharCode.apply` to dodge call-stack limit). | **−1,090** | −498 |
| 9 | _(pending)_ | **Replace `debug` (npm)** with in-tree `minimalDebug.ts` (~190 lines) in `container-loader`, used solely by `DebugLogger`. Replicates `debug` v4.4 browser semantics (`localStorage.debug`/`DEBUG` + `process.env.DEBUG`, glob namespace matching, `-` skips, `.enabled` get/set, `.extend`, static `.log`). Drops `debug` (4,669 B) + transitive `ms` (1,402 B); preserves the `localStorage.debug = "fluid:*"` partner diagnostic. | **−5,010** | −1,925 |

> Sub-1 KB treeCheckout cleanups (`0160d61ddb`, `bf19974e42`, `9bd42724a2`,
> `4f3f00e408`; −631 B combined) are omitted from this table — see findings §3.

### `importHelpers` broken down by package

The `dds/tree` rollout (`a636e62391`, **−9,466 B**, #2 above) was measured
standalone. The follow-up commit `be4b57addd` (#6 above) enabled
`importHelpers` for **4 packages / 6 files in a single commit**, measured
only as a combined **−3,314 B / −853 gzip**.

All 6 files carry a **byte-identical private-field helper block** — the
commit confirms the dedup count went 6×→1× for each of `Private method is
not writable`, `Private accessor was defined without a getter`, and
`Cannot read/write private member`. Because the blocks are identical, the
combined saving splits proportionally by file count:

| Package | Files (helpers deduped) | Parsed Δ (est.) | Gzip Δ (est.) | Basis |
|---|---|---:|---:|---|
| `dds/tree` | 17 modules | **−9,466** | **−621** | **measured** (`a636e62391`) |
| `loader/container-loader` | `serializedStateManager.ts`, `snapshotRefresher.ts`, `pendingLocalStateStore.ts` (3) | ~−1,657 | ~−426 | est. (3/6 of `be4b57addd`) |
| `dds/shared-object-base` | `sharedObjectKernel.ts` (1) | ~−552 | ~−142 | est. (1/6 of `be4b57addd`) |
| `dds/sequence` | `sequenceInterval.ts` (1) | ~−552 | ~−142 | est. (1/6 of `be4b57addd`) |
| `runtime/container-runtime` | `runCounter.ts` (1) | ~−552 | ~−142 | est. (1/6 of `be4b57addd`) |
| **`importHelpers` total** | **23 modules / 6 packages** | **−12,780** | **−1,474** | |

Precise per-package figures for the four `be4b57addd` packages would
require a separate per-package build (revert `importHelpers` for one
package, rebuild, measure); the per-file-proportional split above is the
best estimate without that, and is well-grounded because the deduped
helper block is identical across all six files.

---

## 2. Promising reductions not yet landed

Ordered descending by approximate impact. Impact is **for this scenario**
unless noted; several have a much larger ceiling for asymmetric consumers
(read-only, no-array, etc.). LOE = level of effort.

| Reduction | Approx. impact (parsed) | LOE | Status / notes |
|---|---:|---|---|
| **`SharedMap` back-compat in `aqueduct` `DataObjectFactory`** — `dataObjectFactory.ts:84` unconditionally does `sharedObjects.push(SharedMap.getFactory())` (guarded only by `factory.type === MapFactory.Type`), statically pulling `map.js` + `mapKernel.js`. | **9,506 B** (1,901 `map.js` + 7,305 `mapKernel.js` + 300 transitive) — paid by **every `DataObject` consumer**, not just this scenario | **Medium / blocked-compat** | **Verified via `analyzeReasons --root dds/map/lib/map.js`: 9,506 B unique subtree, reachable *only* through this registration.** The package's own `// TODO: Remove SharedMap factory when compatibility with SharedMap DataObject is no longer needed in 0.10` flags it. Load-bearing: removing it breaks loading documents whose root DataObject persisted a `SharedMap` channel. Needs an owner/compat decision (are pre-0.10 SharedMap-DataObject documents still in scope?), so it is **not** a safe surgical bundle-only change. **⚠️ OPEN QUESTION — left unresolved per user; the app owner is unsure whether pre-0.10 SharedMap-DataObject documents are still in scope.** Lazy-loading the factory yields **0 B** here (single-chunk merge); only outright deletion removes the bytes. |
| **Read-only checkout entrypoint** — split `TreeCheckout` so a variant omits `defaultEditBuilder`, dropping the entire write pillar (`sequence-field` + `modularChangeFamily` + `optional-field`). | up to **~70 KB** (read-only consumers only; **0** for read+write) | **Very high** | Surfaced by per-API analysis, **not yet attempted**. Architectural: `TreeCheckout` must expose `editor`/`transaction`/`applyChange` only on the editing variant. Single clean cut point (one import edge). |
| **`SchemaFactory.array`/`.map` prototype detach (#6)** — make array/map node-kind infra opt-in. | **−11,044** ceiling / −2,830 gzip; **0** if the consumer uses any of `array`/`map`/`arrayRecursive`/`mapRecursive` | **Medium** | Stub-measured. This scenario uses both array and map, so saving here is 0 — documented as the upper bound for asymmetric consumers. |
| **Closed-kind-set `ModularChangeFamily` monomorphization** — replace runtime `getFieldKind` map dispatch with a build-time closed set so terser can resolve handlers statically. | **~10 KB** ceiling | **Very high** | Research-grade. Correctness, layer-compat, and persisted-format implications. |
| **F1+F2 branching + revertibles subclass split** — `BranchingTreeCheckout extends TreeCheckout`, paired with a `SharedTree` view-side split so branching is opt-in. | **~9 KB** combined ceiling; **0** without the `SharedTree`-side change | **High** | Cross-cutting public-API impact (`TreeView.fork()`, `TreeBranchAlpha`, `getRevertible`). `SharedTree.view` exposes `fork`/`createSharedBranch` unconditionally today, so both ends must split. |
| **Further `basicChunk`-path specialization** beyond `1517e1b2b7** — drive remaining dynamically-dead chunk-policy branches to static DCE. | ~1–2 KB residual | **Medium** | `1517e1b2b7` already captured the `uniformChunk` (5.9 KB) win; remaining surface is small. |
| **Top-level checkout-API split (#9)** — move transactions/branching/alpha methods to a new `@fluidframework/tree/legacy/branching`-style entrypoint. | **−4,702** / −1,172 gzip | **High** | Stub-measured. New public-API entrypoint + refactor 18+ methods to module-level functions + consumer codemod/shims. |
| **`schemaCompatibilityTester` defer** — skip the open-time stored-schema compat check until first edit/explicit check. | **~4,544 B** | **Medium** | Reached unconditionally during view init; candidate for lazy init for consumers willing to defer the open-time check. |
| **`lz4js` lazy-load** — defer `OpCompressor`/`OpDecompressor`. | **~4,700 B** | **High / blocked** | Both are eagerly instantiated in `containerRuntime.ts` on the op-processing hot path; lazy-loading injects async boundaries into inbound decompression. |
| **`chunked-forest/codec` separation** — split the op-wire codec path (reached SharedTree-direct via `forestSummarizer`) from in-memory chunk representation. | **~7 KB** (of the ~14 KB codec subtree) | **Medium-High** | Distinct logical responsibility (wire format vs. in-memory) in the same directory; flagged as "potentially separable," not yet attempted. |
| **`@tylerbu/sorted-btree-es6` `union`/`decompose` replacement** | **~7 KB** | **High / blocked** | `mergeTupleBTrees` is hot-path compose code; naive merge trades bundle size for runtime perf. |
| **Module-level helper extraction (F5/F6/F7/F8)** — convert checkout instance methods (labels, raw-change apply, constraints, diagnostics) to free functions in an advanced module. | **~5–8 KB** *with consumer-side changes*; **0** for this scenario | **Low–Medium** | `SchematizingSimpleTreeView` still pulls transaction labels, so this scenario sees 0 until paired with a view-side change. |
| **`sequence-field` codec V2+V3 pin at build time** — currently both kept for runtime `ClientVersionDispatching`. | **~4.7 KB** | **Medium** | Requires pinning the wire-codec version at build time instead of `MinimumVersionForCollab` runtime selection. |
| **`ModularChangeFamily` private-method hoist (#8)** | **−1,553** / −204 gzip | **Medium** | Stub-measured; net well below the churn cost (39-method refactor across a 3.2K-line file, loss of `private` encapsulation). |

### Scenario-level lever (REVERTED — single chunk restored)

- **`LimitChunkCountPlugin({ maxChunks: 1 })` is restored** (`135357c859`). The
  mobile target ships a single chunk, so code-splitting saves nothing: the
  summarizer (~28.8 KB) and any `await import()` code are merged back into the one
  measured chunk. This is intentional — it makes the measurement reflect total
  shipped bytes and prevents deferral from masquerading as a reduction.

### DISQUALIFIED under single-chunk / true-removals-only

The following candidates above are **deferral, not removal**, and therefore yield
**0 B** for a single-chunk mobile bundle: `schemaCompatibilityTester` defer,
`lz4js` lazy-load, and `chunked-forest/codec` separation (if implemented via dynamic
import). They are retained only for the web/multi-chunk case.

The **summarizer** and the **id-compressor** are *not* in this list: both are removed
for real via the **stub-polyfill** pattern (a delay-loaded leaf module whose
implementation is replaced by a throwing stub at build time via
`NormalModuleReplacementPlugin`). That is a TRUE removal that survives the
single-chunk merge — the real subgraph never enters the bundle. The id-compressor
stub polyfill is implemented in this scenario (≈ −33 KB, see above); the earlier
id-compressor *lazy-load* (`6bde337df1`, reverted) was deferral and is the failed
approach this replaces.

### Hard pass (documented, not worth pursuing)

**npm-polyfill replacement is now exhausted for non-tree deps.** The
`events` / `path-browserify` / `double-ended-queue` / `base64-js` / `debug`
swaps have removed every replaceable third-party polyfill reachable from
the non-tree dependency graph. The remaining `node_modules` contributors
are all either tree-owned or genuinely-used core:

- `@tylerbu/sorted-btree-es6` `b+tree.js` (15.5 KB) — **pulled by `id-compressor`**
  (`sessions.ts` instantiates `BTree` directly), NOT by tree (tree is removed from
  this bundle). `BTree` is a single monolithic class, so nothing tree-shakes once it
  is instantiated. It therefore rides along with the id-compressor subtree and is
  removed *wholesale, together with id-compressor*, via the id-compressor stub
  polyfill (implemented; see above). **This makes the id-compressor subtree ≈33 KB**
  (17,954 id-compressor + 15,542 sorted-btree), the single largest non-tree block
  that is *functionally* optional (id-compressor is off by default).
- `lz4js` (~4.7 KB, under the 5 KB bar) — `OpCompressor`/`OpDecompressor`
  are eagerly constructed on the op hot path.
- `tslib` (1.9 KB) — intentionally shared via `importHelpers`.
- `semver-ts` (0.8 KB) — pinned by `dds/tree`.
- `id-compressor` (~18 KB) — formerly statically imported; now reached only through a
  replaceable delay-load seam and **excluded via the stub polyfill** when unused
  (off by default). The earlier *lazy-load* experiment (`6bde337df1`, reverted) did
  NOT count under the single-chunk metric because deferred bytes still ship; the
  stub-polyfill replacement is the TRUE removal that supersedes it.

Central runtime/loader plumbing (`containerRuntime.ts` 53.6 KB,
`container.ts` 29.8 KB, `channelCollection.ts`, `dataStoreContext.ts`,
`deltaManager.ts`, `connectionManager.ts`) is on hot paths and not
amenable to package-level lazy-loading without injecting async boundaries
into op processing. See findings §5 and TREE_CHECKOUT_ANALYSIS §7.

- **`dds/merge-tree` exports-granularity audit (N7)** for
  `Marker`/`ReferenceType`/`refGetTileLabels` — **audited, 0 B realizable.**
  The headline "~130 KB" was the full merge-tree (92,732 B) + sequence
  (40,005 B) graph, pulled into this scenario by `SharedString` /
  `createOverlappingIntervalsIndex`, not by these three symbols. Removing
  the three from the entry moved the bundle **−53 B** (noise). Imported
  alone they pull only **9,250 B** of merge-tree (0 B sequence); the enum +
  function are **374 B** and already shake cleanly, while `Marker`'s
  **~8,876 B** is real segment-class coupling (`localReference.ts`,
  `mergeTreeNodes.ts`, …) that a barrel/`exports` reshape cannot break.
  See findings §5 (N7).
