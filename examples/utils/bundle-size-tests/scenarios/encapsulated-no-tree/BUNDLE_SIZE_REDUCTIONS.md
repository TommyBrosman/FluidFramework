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

Under the single-chunk / true-removals-only rule, the only landed wins are the
**dep-swaps (≈ −18 KB)** — npm polyfills genuinely replaced by smaller in-tree
code. Code-splitting / lazy-loading (id-compressor, summarizer) is **disqualified**:
it defers bytes that still ship in the single chunk.

The remaining 617,974 B is dominated by code that is **genuinely reachable** from
the scenario's API surface and cannot be deferred away:
`merge-tree` (92,732) + `sequence` (40,005) pulled by `SharedString`,
`container-runtime` core (~150 KB), `container-loader` (~103 KB), `map` (~36 KB).

A true removal toward the target therefore requires one of:
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
(≈133 KB) and `map` (≈36 KB) — are **required code** and off the table. The only
remaining true-removal candidates are the id-compressor subtree (≈33.6 KB, gated on
a build-time opt-out decision), the `SharedMap` aqueduct back-compat registration
(≈9.5 KB, **open compat question**), and `lz4js` (≈4.7 KB, required on the inbound
op path). Even all three together (~48 KB) plus the landed dep-swaps (~18 KB) reach
only ~66 KB — about a quarter of the 266 KB target. **The target is not reachable
on non-tree FF code while preserving the app's required API surface.** See the
true-removal ledger and research notes below.

### True-removal ledger (single chunk, non-tree) — needs decisions

Every large remaining lever is gated on a product/compat/scope decision, not on
engineering. Ordered by size:

| Lever | True-removal size | Gating decision | Risk |
|---|---:|---|---|
| `SharedString` / `createOverlappingIntervalsIndex` (pulls `merge-tree` 92,732 + `sequence` 40,005) | **~132,737 B** | ❌ **RESOLVED — app uses `SharedString`.** Required; not removable. | — |
| `SharedDirectory` (pulls `map`) | **~35,738 B** | ❌ **RESOLVED — app uses `SharedDirectory`.** Required; not removable. | — |
| `id-compressor` subtree (id-compressor 17,954 + sorted-btree 15,542) | **~33,634 B (measured)** | ⚠️ **MAYBE.** Off by default. Cannot be removed by the summarizer pattern in a single chunk (see research below); needs a build-time opt-out (DefinePlugin DCE) or dependency-injection. Changes the enable contract. | Core build-flag (medium) |
| `SharedMap` aqueduct back-compat registration | **~9,506 B** | ❓ **OPEN QUESTION** — are pre-0.10 SharedMap-DataObject documents still in scope? Owner decision pending. | Compat (load-bearing) |
| `lz4js` (`OpDecompressor` inbound + `OpCompressor` outbound) | **~4,672 B** | See research below — `decompress` is genuinely required on the inbound path (any client may receive compressed ops). | Core hot-path |
| Re-include + shrink `tree` | — | ❌ **OUT OF SCOPE** (confirmed). | Scope |

> **Note re: index.ts.** All exports in `src/index.ts` are confirmed in use by the
> app, so the scenario's API surface is representative and will not be trimmed.
> `SharedString`/`SharedDirectory` (the two largest blocks, ~168 KB combined) are
> therefore **required code** — they are not reduction candidates.

### Research: excluding id-compressor (~33,634 B) from a single chunk

**Empirically measured.** Stubbing out the four id-compressor value functions in
`containerRuntime.ts` (the only live references — see below) drops the single
chunk from **617,974 → 584,340 B parsed** (−33,634) and **160,775 → 150,934 B
gzip** (−9,841). The removed bytes are the id-compressor module (17,954) + its
sole non-tree dependency `@tylerbu/sorted-btree-es6` (15,542) + a few hundred
bytes of telemetry-utils helpers (`createSampledLogger`/`toITelemetryLoggerExt`)
used only by the compressor closure.

**Why it is in the bundle at all.** Every importer of `@fluidframework/id-compressor`
in the in-bundle packages is `import type` (erased) **except**
`containerRuntime.ts`, which value-imports `createIdCompressor` / `createSessionId`
/ `deserializeIdCompressor` / `toIdCompressorWithCore`. Those are referenced inside
`createIdCompressorFn`, which is **always constructed and passed to the
`ContainerRuntime` constructor** (even when id-compressor is disabled). That live
reference is what pins the subtree. The id-compressor package is already
`sideEffects: false`, so the moment the reference is gone it tree-shakes out
cleanly — which is exactly what the stub experiment confirmed.

**Why the summarizer pattern does NOT work here (for a single chunk).** The
summarizer is dynamically `import()`-ed from a segregated module
(`summary/summaryDelayLoadedModule/index.js`) so a bundler can split it into its
own lazily-loaded chunk. That removes it from the **initial** chunk only — in a
**single-chunk** build, `LimitChunkCountPlugin({ maxChunks: 1 })` merges the split
chunk straight back in. Verified directly: the `Summarizer` class **is present in
the single-chunk bundle**. The earlier id-compressor lazy-load (`6bde337df1`,
reverted) had the same fate and even added ~3.4 KB of chunk-wrapper overhead.
**Deferral cannot remove bytes from a single chunk; only a true exclusion can.**

**What a true single-chunk exclusion requires.** The consumer must commit *at
build time* that it will never enable id-compressor, so the static reference can be
eliminated and the module tree-shaken. Two viable mechanisms:

1. **Build-time constant + guarded factory (DefinePlugin DCE).** Gate the
   `createIdCompressorFn` body (and thus the four imports) behind a build-time
   boolean, e.g. `declare const FLUID_NO_ID_COMPRESSOR: boolean;` …
   `const createIdCompressorFn = FLUID_NO_ID_COMPRESSOR ? undefined : () => { … }`.
   With the consumer's bundler defining `FLUID_NO_ID_COMPRESSOR = true`, terser
   evaluates the ternary, DCEs the closure (the only references), webpack drops the
   now-unreferenced static import, and the `sideEffects:false` module is
   tree-shaken — yielding the measured −33,634 B. At runtime, attempting to enable
   id-compressor with the flag set must `throw` (fail fast). This is the *least
   invasive* option: one build flag, one guarded factory, one throw. It mirrors how
   `process.env.NODE_ENV === "production"` DCE already strips dev-only code in this
   very bundle. **Cost:** introduces and documents a public build-time switch;
   default (flag unset) keeps current behavior, so it is non-breaking.

2. **Dependency injection (inversion).** Remove the id-compressor factory from core
   entirely; the consumer passes a factory (or the four functions) via
   `runtimeOptions`/the load call. Core then has *zero* static reference, so
   id-compressor is bundled only by apps that actually wire it in. Architecturally
   cleanest and needs no bundler cooperation, but it is a larger public-API change
   (new option, migration for existing enable-via-`enableRuntimeIdCompressor`
   consumers) and warrants FF API-council review.

**Recommendation:** Option 1 is the pragmatic path for the mobile target — small,
local, non-breaking by default, and validated to deliver the full ~33.6 KB. It
should be raised with the container-runtime owners since it adds a supported
build-time contract. (Not implemented here pending that decision.)

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
`lz4js` lazy-load, `chunked-forest/codec` separation (if implemented via dynamic
import), and the reverted id-compressor lazy-load. They are retained only for the
web/multi-chunk case. **The leading non-tree TRUE-removal candidate is the
`SharedMap` aqueduct back-compat registration (≈9.5 KB)** — deleting it (not
lazy-loading it) genuinely removes bytes, pending the compat decision noted above.

### Hard pass (documented, not worth pursuing)

**npm-polyfill replacement is now exhausted for non-tree deps.** The
`events` / `path-browserify` / `double-ended-queue` / `base64-js` / `debug`
swaps have removed every replaceable third-party polyfill reachable from
the non-tree dependency graph. The remaining `node_modules` contributors
are all either tree-owned or genuinely-used core:

- `@tylerbu/sorted-btree-es6` `b+tree.js` (15.5 KB) — **pulled by `id-compressor`**
  (`sessions.ts` instantiates `BTree` directly), NOT by tree (tree is removed from
  this bundle). `BTree` is a single monolithic class, so nothing tree-shakes once it
  is instantiated. It therefore rides along with the id-compressor subtree and can
  only be removed wholesale, together with id-compressor, when id-compressor is
  unused. **This makes the id-compressor subtree ≈33 KB** (17,954 id-compressor +
  15,542 sorted-btree), the single largest non-tree block that is *functionally*
  optional (id-compressor is off by default) — but a TRUE removal requires a
  build-time opt-out (DefinePlugin-gated DCE) so terser can drop the import, since a
  static import keeps it in the single chunk.
- `lz4js` (~4.7 KB, under the 5 KB bar) — `OpCompressor`/`OpDecompressor`
  are eagerly constructed on the op hot path.
- `tslib` (1.9 KB) — intentionally shared via `importHelpers`.
- `semver-ts` (0.8 KB) — pinned by `dds/tree`.
- `id-compressor` (~18 KB) — statically imported, only constructed when enabled
  (off by default). **Lazy-loading does NOT count** under the single-chunk mobile
  metric: the deferred bytes still ship, and the split overhead made the total
  *larger*. The reverted experiment is `6bde337df1` / `135357c859`. A TRUE removal
  would require excluding it from the bundle entirely when unused (a build-time /
  API decision the consumer makes), which is out of scope for an FF-core change.

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
