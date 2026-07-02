# Bundle-size reductions: encapsulated bundle (non-tree & tree)

High-level summary of bundle-size reductions for the encapsulated bundle
scenarios. Companion to the detailed
[BUNDLE_SIZE_FINDINGS.md](BUNDLE_SIZE_FINDINGS.md) and
[TREE_CHECKOUT_ANALYSIS.md](TREE_CHECKOUT_ANALYSIS.md).

This file tracks **all** reductions — both **non-tree** and **tree** — in one
place, split into two top-level parts:

- **[Part 1 — Non-tree reductions](#part-1--non-tree-reductions)** — in scope for
  the current `encapsulated-no-tree` target (the mobile single-chunk bundle).
- **[Part 2 — Tree reductions](#part-2--tree-reductions)** — `@fluidframework/tree`
  reductions, **out of scope** now that tree is removed from the
  `encapsulated-no-tree` bundle, retained for the historical record and for
  with-tree / asymmetric consumers. Re-measurable against the restored
  `../encapsulated-with-shared-tree` scenario.

Within each part, both **landed** reductions (with commit hash and measured
parsed + gzip deltas) and **promising / not-yet-landed** reductions (with
approximate impact and level-of-effort) are listed, ordered **descending by
reduction size**. The shared measurement harness and baseline are described
first.

## Scenario context & baseline (non-tree)

> **Scope change (this branch): tree removed.** The scenario was renamed from
> `encapsulated-with-shared-tree` to `encapsulated-no-tree` and the
> `@fluidframework/tree/legacy` re-export was deleted from `src/index.ts`. All
> `dds/tree`-specific reductions (see Part 2) are therefore **out of scope**
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
| **+ summarizer-election stub polyfill** (`NormalModuleReplacementPlugin`) | **530,849 B** | **138,528 B** |
| **+ blobManager stub polyfill** (`NormalModuleReplacementPlugin`) | **513,858 B** | **134,712 B** |
| **+ garbage-collection stub polyfill** (`NormalModuleReplacementPlugin`) | **492,972 B** | **129,369 B** |
| **+ summarizer-node tree stub polyfill** (`NormalModuleReplacementPlugin`) | **483,822 B** | **127,166 B** |
| **+ summaryCollection stub polyfill** (`NormalModuleReplacementPlugin`) | **479,772 B** | **126,210 B** |
| **+ F24 SharedMap legacy-factory stub** (`70c0293161`) | **479,659 B** | — |
| **+ F25 summary-write cluster stub** (`b25e862c34`, current build) | **471,428 B** | **124,815 B** |

> **Measurement-context caveat (telemetry).** Several intermediate rows above
> (through the summaryCollection stub) were measured with four telemetry
> stub-polyfills present. Those stubs were later **reverted** and are **excluded
> from the landed reductions** — see ["Telemetry stubs — scoped out"](#telemetry-stubs--scoped-out-not-a-landed-reduction)
> below. As a result their absolute figures no longer match the current build. The
> F24 / F25 rows were measured **after** telemetry was restored, off the post-revert
> **7-stub baseline** of **488,566 B parsed / 127,894 B gzip** — which is why the
> step from the summaryCollection row into F24 spans a measurement-context change.
> The **current build** (9 stubs, incl. F24 + F25; HEAD `b25e862c34`) is
> **471,428 B parsed / 124,815 B gzip** (re-measured this pass) — the last row.

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

### Telemetry stubs — scoped out (not a landed reduction)

**We are scoping telemetry reductions out for now.** Four telemetry stub-polyfills
(op-perf `connectionTelemetry`, `signalTelemetryProcessing`, `batchTracker`,
per-DDS `sampledTelemetryHelper`) were prototyped and briefly landed, then
**reverted by project decision**. They are deliberately **kept out of the
ground-truth landed-reductions table above** and out of the non-tree landed total.

- Combined win was only **~11,387 B parsed / ~2,437 B gzip** (−8,794 then −2,593
  across two rounds).
- In exchange they delete **real observability** — op round-trip perf,
  signal-latency, batch-size, and per-DDS op/callback duration.

That trade is not acceptable, so **telemetry is off-limits as a bundle-reduction
lever** and the stubs were removed. The post-revert **7-stub baseline** (telemetry
restored, before F24/F25) is **488,566 B parsed / 127,894 B gzip**, the
measurement context for the F24/F25 rows in the table above. The per-file
breakdown is in the detailed writeup ["Telemetry stubs — REMOVED"](#telemetry-stubs--removed-project-decision-114-kb-not-taken)
under Part 1. **Do not re-propose telemetry stubbing.**

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

## Part 1 — Non-tree reductions

> **In scope** for the current `encapsulated-no-tree` target. Landed non-tree
> reductions total **−166,421 B parsed / −43,231 B gzip** (see "Known reductions
> made" below).

### True-removal ledger (single chunk, non-tree) — needs decisions

Every large remaining lever is gated on a product/compat/scope decision, not on
engineering. Ordered by size:

| Lever | True-removal size | Gating decision | Risk |
|---|---:|---|---|
| `SharedString` / `createOverlappingIntervalsIndex` (pulls `merge-tree` 92,732 + `sequence` 40,005) | **~132,737 B** | ❌ **RESOLVED — app uses `SharedString`.** Required; not removable. | — |
| `summarizer` subtree (`summaryDelayLoadedModule` 28,215 + terser DCE of now-dead code) | **−38,759 B (implemented)** | ✅ **IMPLEMENTED.** Client-side summarization not needed (mobile summarizes server-side). Removed via the stub polyfill (PR #27611 stub + `NormalModuleReplacementPlugin`). Public-API names (`Summarizer`, …) preserved as throwing stubs. | Build-config opt-in (low) |
| `summarizer-election` machinery (`SummaryManager` + `OrderedClientElection` + `SummarizerClientElection` + terser DCE) | **−15,576 B (implemented)** | ✅ **IMPLEMENTED.** A client that summarizes server-side never participates in summarizer election, so the election + `SummaryManager` graph is dead weight. Extracted into a `summaryManagerDelayLoadedModule` leaf behind an `await import()`; the app swaps in a **no-op** `setupSummaryManager` stub via `NormalModuleReplacementPlugin`. Unlike the throwing stubs above, this path runs on every normal client, so the stub returns an empty result (== "does not elect"). See section below. | Build-config opt-in (low) |
| `blobManager` (`BlobManager` attachment-blob support + snapshot/summary helpers) | **−8,197 B (implemented)** | ✅ **IMPLEMENTED.** App uses only SharedString / SharedDirectory and never creates/references attachment blobs. Whole `blobManager/index.js` replaced with a stub: valid-empty summary tree (omitted by the consumer guard) + empty GC data on the always-run paths, throwing only on actual `createBlob`/`getBlob`. A runtime drift test pins the reproduced path constants. See section below. | Build-config opt-in (low; no-blob assumption) |
| `SharedDirectory` (pulls `map`) | **~35,738 B** | ❌ **RESOLVED — app uses `SharedDirectory`.** Required; not removable. | — |
| `id-compressor` subtree (id-compressor 17,954 + sorted-btree 15,542) | **−33,213 B (implemented)** | ✅ **IMPLEMENTED.** Off by default. Removed via the summarizer-style stub polyfill: a delay-loaded leaf module + `NormalModuleReplacementPlugin` swap to a throwing stub. True removal that holds in a single chunk. Apps that never enable id-compressor opt in via the webpack replacement. | Build-config opt-in (low) |
| Summarizer-node tracking tree (`summary/summarizerNode/summarizerNode` 5,612 + `summary/summarizerNode/summarizerNodeWithGc` 3,690 + terser DCE) | **−9,150 B (implemented)** | ✅ **IMPLEMENTED.** The node tree tracks per-node summary/GC state so the summarizer client can build incremental summaries. This client summarizes server-side (summarizer stubbed) and runs with GC disabled (`garbageCollection` stubbed), so the tree's reference / used-route / change tracking is dead weight. `createRootSummarizerNodeWithGC` is the single value site (containerRuntime.ts), and `summarizerNode.js` is imported only by `summarizerNodeWithGc.js`, so replacing the latter via `NormalModuleReplacementPlugin` drops both. The stub keeps every-client lifecycle faithful (createChild/getChild/deleteChild maintain a child map; recordChange/invalidate are no-ops; isReferenced ⇒ true since GC is disabled) and throws on summarizer-only/GC methods. Verified-tolerant consumers: `getChild` undefined is guarded (dataStoreContext.ts), `referenceSequenceNumber` has no datastore-infra readers, `invalidate`/`recordChange` affect only summary state. See section below. | Build-config opt-in (consumer summarizes server-side + GC disabled) |
| Garbage collection (`gc/garbageCollection` 11,404 + `gc/gcTelemetry` 2,895 + `gc/gcUnreferencedStateTracker` 1,789 + `gc/gcSummaryStateTracker` 1,680 + `gc/gcConfigs` 1,282 + `gc/gcReferenceGraphAlgorithm` + terser DCE) | **−20,886 B (implemented)** | ✅ **IMPLEMENTED.** This client summarizes server-side (the summarizer is already stubbed) and the consuming app does not rely on GC sweep / tombstone deletion enforcement. The single value site `GarbageCollector.create(...)` (containerRuntime.ts:1932, all ~20 usages via the `IGarbageCollector` interface) is reached only through `gc/garbageCollection.js`; replacing that file with a no-op stub (`shouldRunGC === false`, `isNodeDeleted === false`, valid-empty summary/metadata) drops it plus its **exclusive** deps. `gcHelpers`/`gcDefinitions` (`GCNodeType` enum) stay alive via `summarizerNodeWithGc`/`channelCollection` but are small. See section below. | Build-config opt-in (consumer asserts no reliance on GC sweep) |
| `SummaryCollection` summary-ack tracking (`summary/summaryCollection` + terser DCE) | **−4,050 B (implemented)** | ✅ **IMPLEMENTED.** `SummaryCollection` watches inbound summary-ack/nack ops so a *summarizing* client can await its own summaries. It is constructed unconditionally (containerRuntime.ts:2290) but its only consumers — the client-side `Summarizer` and the `setupSummaryManager` election — are **already stubbed out**, and ContainerRuntime never calls a method on the instance on the non-summarizer path. `SummaryCollection` is the module's only value export and is not re-exported by the scenario `index.ts`, so replacing `summary/summaryCollection.js` with a no-op stub (faithful event-emitter + trivial accessors; throws on the summarizer-only `createWatcher`/`waitSummaryAck`, which are never reached) drops it cleanly. Below the 5 KB bar but zero-risk and a true removal. See section below. | Build-config opt-in (consumer summarizes server-side) |
| `BatchTracker` + `SampledTelemetryHelper` + `connectionTelemetry` + `signalTelemetryProcessing` (pure-telemetry) | **~11,387 B (REJECTED — telemetry off-limits)** | ❌ **REJECTED by project decision.** These four telemetry stubs were prototyped and landed earlier (≈11,387 B parsed / ≈2,437 B gzip combined) but **removed**: they delete real observability (op round-trip perf, signal-latency, batch-size, per-DDS op/callback duration) for a small win. Telemetry is not an acceptable bundle-reduction lever. Do not re-propose. | — (removed) |
| `SharedMap` aqueduct back-compat registration | **~9,506 B** | ❓ **OPEN QUESTION** — are pre-0.10 SharedMap-DataObject documents still in scope? Owner decision pending. | Compat (load-bearing) |
| `lz4js` compress+decompress + `OpCompressor` + `OpDecompressor` | **~4,412 B (measured)** | ⏸️ **GATED — below threshold + highest interop risk; not landed.** Op compression is **ON by default** (grouped batching ⇒ `minimumBatchSizeInBytes: 614400`, `compressionDefinitions.ts:42`). `lz4js` is a CJS module (compress/decompress cannot be tree-shaken apart); redirecting the `lz4js` request to a throwing stub was measured at only **−4,412 B parsed / −1,719 B gzip** (the 12.7 KiB raw source minifies down hard). `decompress` is required inbound because **any participant** may send a batch > ~600 KB as a compressed op, so removal needs a session-wide guarantee that no client ever compresses (or compression is disabled document-wide). Both **below the 5 KB candidate bar** and the **riskiest** change considered (a violated precondition fails the op stream, not just a local feature). Documented, not landed. | Wire-format interop (session-wide) |
| Re-include + shrink `tree` | — | ❌ **OUT OF SCOPE** (confirmed). | Scope |

> **Note re: index.ts.** All exports in `src/index.ts` are confirmed in use by the
> app, so the scenario's API surface is representative and will not be trimmed.
> `SharedString`/`SharedDirectory` (the two largest blocks, ~168 KB combined) are
> therefore **required code** — they are not reduction candidates.

> **Note re: `serializedStateManager` (~5.9 KB) + `snapshotRefresher` (~2.1 KB).**
> Investigated as a stub candidate; **not a clean whole-module removal.** Its
> `fetchSnapshot` online path (`getSnapshot` local + `getSnapshotTree` /
> `getDocumentAttributes` from `utils.js`) is essential container-LOAD logic, intertwined
> in the same module with the offline/pending-state machinery. Only the offline portion
> (`snapshotRefresher`, pending-state serialization, processed-op accumulation) is
> freely removable, and extracting it requires refactoring production code to split the
> online snapshot-fetch into a shared leaf.
>
> **MEASURED upper bound (prototype, reverted):** gutting *all* offline machinery —
> stubbing `snapshotRefresher.ts` to a no-op and throwing from `getPendingLocalState` /
> `getLatestSnapshotInfo` / the snapshot-blob conversions — yields only
> **483,822 → 479,563 B parsed (−4,259) / 127,166 → 126,112 B gzip (−1,054).** That is
> the absolute ceiling and it is **below the 5 KB candidate bar**, while a real version
> would need a genuine prod refactor (extract the offline machinery into a separately
> stubbable module, thread an interface through `SerializedStateManager`, and special-case
> the `pendingLocalState` rehydrate branch of `fetchSnapshot`). The risk/byte ratio is
> poor — **deferred** unless a prod refactor is independently justified. `offlineLoadEnabled`
> also defaults to **true** for interactive clients (`container.ts:964`,
> `options.enableOfflineLoad !== false`), so nothing here tree-shakes without that refactor
> plus a consumer opt-out.

### Known reductions made (>1 KB parsed)

All commit hashes are on `tbrosman/claude-shrink-bundle` (and its parent
`tbrosman/experiment-shrink-bundle`). Deltas are the values measured **at the
time each change landed** (or, where noted, re-measured against the current
build). This part lists the **non-tree** landed reductions (in scope for the
current `encapsulated-no-tree` target); the **tree** landed reductions are in
[Part 2](#part-2--tree-reductions). Rows are ordered descending by parsed
reduction and carry a **total in both parsed and gzip bytes**.

> **Measurement contexts (why totals compose).** Two harnesses were used over the
> life of the branch:
> - **Dep-swaps** (the dependency-swap table below) were measured against the older
>   `encapsulated-with-shared-tree` scenario. They replace *non-tree* npm deps
>   with in-tree code, so their byte deltas **transfer** to the no-tree bundle.
> - **Build-time exclusions** (the stub-polyfill table below) and the **tree
>   reductions** (Part 2) were measured against their respective scenarios at
>   landing time.
>
> The no-tree stub-polyfill journey has an authoritative ground-truth anchor: the
> dep-swap baseline **617,974 B parsed / 160,775 B gzip** (`135357c859`) →
> current build **471,428 B parsed / 124,815 B gzip** (re-measured this pass;
> HEAD `b25e862c34`). See the milestone table under "Ground-truth no-tree
> measurements" above.

#### Detail: dependency swaps + build-time exclusions

##### Dependency swaps (npm polyfill → in-tree code)

Measured against `encapsulated-with-shared-tree` at landing; deltas transfer to
the no-tree bundle (all changes are in non-tree packages).

| Commit | Change | Parsed Δ | Gzip Δ |
|--------|--------|---------:|-------:|
| `da2468bdfc` | **Replace `debug` (npm)** with in-tree `minimalDebug.ts` (~190 lines) in `container-loader`, used solely by `DebugLogger`. Replicates `debug` v4.4 browser semantics (`localStorage.debug`/`DEBUG` + `process.env.DEBUG`, glob namespace matching, `-` skips, `.enabled` get/set, `.extend`, static `.log`). Drops `debug` (4,669 B) + transitive `ms` (1,402 B); preserves the `localStorage.debug = "fluid:*"` partner diagnostic. | **−5,010** | **−1,925** |
| `80571ad8fe` | **Replace `events` (npm) polyfill** with in-tree `EventEmitter` (~150 lines, `WeakMap`-backed, fires `newListener`/`removeListener`). Also drops `events_pkg` import in container-loader `quorum.ts`. | **−4,464** | **−1,223** |
| `dde412e121` | **Replace `path-browserify`** with ~35 lines of inline posix path helpers in `dds/map` `directory.ts` (full `..`/`.`/multi-slash semantics). | **−3,590** | **−1,332** |
| `be4b57addd` | **`importHelpers` + `tslib` — 4 non-tree packages** (container-runtime, container-loader, sequence, shared-object-base; 6 files total). Broken down per package below. | **−3,314** | **−853** |
| `004d76ec6c` | **Replace `double-ended-queue` (npm)** with in-tree `Deque<T>` (~80 lines, array-backed w/ head index, amortized O(1) shift). | **−2,157** | **−621** |
| `ec4c2cd96f` | **Replace `base64-js` (npm)** with `btoa`/`atob` inline helpers in `bufferBrowser.ts` (chunked via `String.fromCharCode.apply` to dodge call-stack limit). | **−1,090** | **−498** |
| **Dep-swap subtotal** | **6 commits** | **−19,625** | **−6,452** |

##### Build-time exclusions (stub polyfills)

Whole subsystems this mobile client does not need, severed at a replaceable
module seam via `NormalModuleReplacementPlugin` in the scenario
`webpack.config.cts`. Each is a **true removal** that holds under the single
chunk (`maxChunks: 1`), not deferral. Measured against `encapsulated-no-tree`.
Each has a detailed section below.

| Commit | Change | Parsed Δ | Gzip Δ |
|--------|--------|---------:|-------:|
| `895b47a93f` | **Summarizer** — exclude client-side `Summarizer` / `RunningSummarizer` (`summaryDelayLoadedModule`). Client summarizes server-side; public names preserved as throwing stubs. | **−38,759** | **−9,023** |
| `81f6768733` | **id-compressor** — exclude `createIdCompressor` subtree + `@tylerbu/sorted-btree-es6`. Off by default; delay-loaded leaf swapped for a throwing stub. | **−33,213** | **−9,564** |
| `af7bd02b97` | **Garbage collection** — replace `gc/garbageCollection.js` with a valid-empty no-op stub (`shouldRunGC === false`), dropping `gcTelemetry` / `gcUnreferencedStateTracker` / `gcSummaryStateTracker` / `gcConfigs` / `gcReferenceGraphAlgorithm`. | **−20,886** | **−5,343** |
| `43ddaf632f` | **Summarizer election / `SummaryManager`** — extract election + `SummaryManager` into a delay-loaded leaf; app swaps a **no-op** `setupSummaryManager` stub (returns `{}` == "does not elect"). | **−15,576** | **−3,718** |
| `062d19b5a1` | **Summarizer-node tracking tree** — replace `summarizerNodeWithGc.js` (drops base `summarizerNode.js` too) with a lifecycle-faithful no-op stub; summarizer-only/GC methods throw. | **−9,150** | **−2,203** |
| `70c0293161` | **F24 — Aqueduct `SharedMap` legacy factory** — swap `mapFactory.js` for a stub that keeps `MapFactory.Type`/`Attributes` + the `SharedMap` kind but drops the `./map.js` import, tree-shaking `map.js` + `mapKernel.js`. _(gzip re-measured this pass: 480,335 → 471,428 parsed / 126,174 → 124,815 gzip.)_ | **−8,907** | **−1,359** |
| `3b386f0f46` | **BlobManager** — replace `blobManager/index.js` with a valid-empty stub (empty summary tree + empty GC data on always-run paths; `createBlob`/`getBlob` throw). App never uses attachment blobs. | **−8,197** | **−2,064** |
| `b25e862c34` | **F25 — summary-write cluster** — extract the `ISummarizerInternalsProvider` write path (`submitSummary` / `refreshLatestSummaryAck` / `summarize` helpers) into `summary/summaryInternals.js`; swap it for a throwing stub. | **−8,058** | **−2,549** |
| `2f3db17909` | **`SummaryCollection`** — replace `summary/summaryCollection.js` with a no-op event-emitter stub; summarizer-only `createWatcher`/`waitSummaryAck` throw (never reached). | **−4,050** | **−956** |
| **Exclusion subtotal** | **9 commits** | **−146,796** | **−36,779** |

> **Reconciliation.** The exclusion subtotal (sum of individually-measured
> deltas, **−146,796 parsed / −36,779 gzip**) agrees with the ground-truth
> no-tree journey **617,974 → 471,428 parsed (−146,546) / 160,775 → 124,815 gzip
> (−35,960)** to within ~250 B parsed / ~820 B gzip. The small gap is
> measurement-context drift: the id-compressor "before" was the delay-load seam
> (618,397 B, not 617,974 B), and several intermediate rows in the milestone
> table were measured with the since-removed telemetry stubs present. The
> ground-truth journey is authoritative for the absolute; the per-lever deltas
> are authoritative for attributing the win to each commit.

##### Non-tree landed total

| Group | Parsed Δ | Gzip Δ |
|-------|---------:|-------:|
| Dependency swaps (above) | −19,625 | −6,452 |
| Build-time exclusions (above) | −146,796 | −36,779 |
| **Non-tree total** | **−166,421** | **−43,231** |

### `importHelpers` broken down by package

The `dds/tree` rollout (`a636e62391`, **−9,466 B**; a **tree** reduction, see
[Part 2](#part-2--tree-reductions)) was measured standalone. The follow-up
commit `be4b57addd` (a **non-tree** dep-swap, in the dependency-swap table above)
enabled `importHelpers` for **4 packages / 6 files in a single commit**, measured
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

### Detailed writeups (implemented non-tree exclusions)

Byte-level rationale for each landed build-time exclusion in the table
above.

#### Excluding id-compressor (~33 KB) from a single chunk — IMPLEMENTED

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

#### Excluding the summarizer (~38.8 KB) from a single chunk — IMPLEMENTED

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

#### Excluding the summarizer election / SummaryManager (~15.6 KB) from a single chunk — IMPLEMENTED

**Result.** Single chunk drops from **546,425 → 530,849 B parsed** (−15,576) and
**142,246 → 138,528 B gzip** (−3,718). The directly-removed classes are
`SummaryManager` (~6.2 KB), `OrderedClientElection` + `OrderedClientCollection`
(~5.9 KB) and `SummarizerClientElection` (~1.7 KB); the rest is terser DCE of code
(e.g. `Throttler`/`formExponentialFn`, `formCreateSummarizerFn`) that becomes
unreachable once the election graph is gone.

**Why it needed a different stub flavor.** Unlike id-compressor and the summarizer
implementation — which are only reached on an opt-in/summarizer-only path and can
therefore be replaced with **throwing** stubs — the election branch runs on **every
normal (non-summarizer) interactive client** during `initializeSummarizer`. A
throwing stub would break ordinary clients. The election machinery is also **not
part of the package's public API** (`index.ts` does not re-export `SummaryManager`,
`OrderedClientElection`, etc.; only the `summary/index.ts` barrel and
`containerRuntime.ts` referenced them), so the only thing pinning it was
`containerRuntime.ts` itself.

**How it is removed.** The election + `SummaryManager` construction/wiring was
extracted verbatim into a delay-loaded leaf module
(`summary/summaryManagerDelayLoadedModule/index.js`) exposing a single
`setupSummaryManager(context, forwardEvent)` function that builds the collection /
election / `SummaryManager`, registers the `default`-op listener, forwards lifecycle
events, calls `.start()`, and returns `{ summaryManager, summarizerClientElection }`.
`containerRuntime.ts` now reaches it **only** through `await import()` and holds
every other reference as `type`-only (the gating check
`SummarizerClientElection.clientDetailsPermitElection` was inlined to its one-line
body so the condition does not statically reference the class). The app swaps the
leaf for a **no-op** stub (`summary/summaryManagerDelayLoadedModuleStub.ts`) via
`NormalModuleReplacementPlugin`; `setupSummaryManager` returns `{}`, which is
behaviorally equivalent to "this client does not participate in summarizer
election" — correct for a server-side-summarizing client whose summarizer
implementation is itself stubbed. The result-type fields are optional so `{}`
typechecks.

**Safety / contract.** A compile-time spec
(`test/summary/summaryManagerDelayLoadedModuleStub.spec.ts`) asserts
`requireAssignableTo` both directions so the stub's value exports stay in sync with
the real module. The full container-runtime suite (957 tests) passes unchanged — the
tests exercise the *real* leaf, not the stub. Appropriate only for clients that do
not summarize client-side.

#### Telemetry stubs — REMOVED (project decision, ~11.4 KB not taken)

Four telemetry stub-polyfills were prototyped and briefly landed, then **removed**
by project decision. They are documented here only so the decision is not
re-litigated:

- `connectionTelemetry.ts` (`OpPerfTelemetry`, ~5.7 KB) — op round-trip /
  connection-performance telemetry.
- `signalTelemetryProcessing.ts` (`SignalTelemetryManager`, ~3.05 KB) —
  broadcast-signal round-trip latency telemetry.
- `batchTracker.ts` (`BindBatchTracker`, ~0.9 KB) — `Batching:Length` /
  `Batching:LengthTooBig` batch-size telemetry.
- `sampledTelemetryHelper.ts` (`SampledTelemetryHelper`, telemetry-utils, ~1.7 KB) —
  per-DDS `ddsOpProcessing` / `ddsEventCallbacks` duration sampling.

**Why removed.** Empirically these four together saved only **~11,387 B parsed /
~2,437 B gzip**. Unlike the summarizer/GC/blob stubs — where the stubbed code is
genuinely unreachable for the target client — these run on live, unconditional
paths and their removal *deletes real observability* (op-perf, signal-latency,
batch-size, per-DDS perf). That is a real, quantified cost, so **telemetry is
off-limits as a bundle-reduction lever.** The stubs and their drift specs were
deleted and the four `NormalModuleReplacementPlugin` blocks removed from
`webpack.config.cts`. Do not re-propose telemetry stubbing.

#### Excluding BlobManager (~8.2 KB) from a single chunk — IMPLEMENTED

**Result.** Single chunk drops from **522,055 → 513,858 B parsed** (−8,197) and
**136,776 → 134,712 B gzip** (−2,064). The whole `blobManager/index.js` module (the
`BlobManager` class plus its snapshot/summary helpers) is replaced with a stub
shipped by container-runtime.

**Why it is removable here.** `BlobManager` implements attachment-blob support —
uploading binary blobs and referencing them via handles. This app uses only
`SharedString` / `SharedDirectory` and never creates or references attachment blobs,
so none of that machinery is needed. `blobManager/index.js` is the single
value-import entry point: `containerRuntime.ts` imports the class + helpers from it,
and the package `index.ts` imports only the `IBlobManagerLoadInfo` *type* (erased).

**Why the stub is not purely no-op.** Unlike a pure observability stub, `BlobManager`
contributes to the **summary tree** (`summarize()`, containerRuntime.ts ~2689) and
the **GC graph** (`getGCData()`, ~4080) on paths that run for *every* client. The
stub therefore returns *valid empty* results there: `summarize()` returns an empty
`SummaryTreeBuilder().getSummaryTree()` (the consumer already omits the blobs tree
when it is empty — "Some storage (like git) doesn't allow empty tree"), and
`getGCData()` returns `{ gcNodes: {} }` (an empty `addNodes`). `loadBlobManagerLoadInfo`
returns `{}` (a blob-free snapshot has no `.blobs` tree). Methods only reached when
the app actually uses blobs (`createBlob`, `getBlob`) **throw** (fail fast). All
other methods (`processBlobAttachMessage`, `patchRedirectTable`, `reSubmit`,
`deleteSweepReadyNodes` → `[]`, `getPendingBlobs` → `undefined`, etc.) are no-ops.

**Safety / contract.** Appropriate for clients that never use attachment blobs. The
tiny path constants/helpers (`blobManagerBasePath`, `blobsTreeName`,
`redirectTableBlobName`, `getGCNodePathFromLocalId`, `isBlobPath`) are reproduced in
the stub (re-exporting them from the real module would pull the implementation back
in); a **runtime drift test** (`test/blobManager/blobManagerStub.spec.ts`) asserts
they equal the real values, and additional tests verify the empty summary/GC shapes.
Compile-time `requireAssignableTo` specs keep the value exports and public method
signatures in sync. The full container-runtime suite (960 tests, +3 new) passes —
the suite still exercises the *real* BlobManager.

#### Excluding the summarizer-node tracking tree (~9.2 KB) from a single chunk — IMPLEMENTED

**Result.** Single chunk drops from **492,972 → 483,822 B parsed** (−9,150) and
**129,369 → 127,166 B gzip** (−2,203). `summary/summarizerNode/summarizerNodeWithGc.js`
is replaced with a no-op stub shipped by container-runtime; because the base
`summary/summarizerNode/summarizerNode.js` is imported **only** by `summarizerNodeWithGc.js`,
the replacement drops both modules.

**Why it is removable here.** The summarizer-node tree tracks per-node summary and GC
state (change sequence numbers, used routes, base-summary handles, referenced state) so a
summarizer client can build **incremental** summaries. This client summarizes
**server-side** (the summarizer is already stubbed out) and runs with **GC disabled** (the
`garbageCollection` stub above ⇒ `createRootSummarizerNodeWithGC` is constructed with
`gcDisabled: true` at `containerRuntime.ts`), so the tree's reference / used-route / change
tracking is dead weight — it is never read to produce a summary. The seam is clean:
`createRootSummarizerNodeWithGC` is the single value site in `containerRuntime.ts`, and all
usages go through the `IRootSummarizerNodeWithGC` / `ISummarizerNodeWithGC` interfaces.

**Why the stub is mixed no-op / throwing.** Several methods run on **every** client and
must stay faithful, so the stub keeps a real child `Map`: `createChild` (idempotent per
id) → `getChild` → `deleteChild` maintain it; `recordChange` / `invalidate` /
`updateBaseSummaryState` / `updateUsedRoutes` are no-ops (they only mutate summary state);
`isReferenced()` returns `true` (with GC disabled nothing is ever unreferenced);
`isSummaryInProgress()` returns `false`. The **summarizer-only / GC** methods (`summarize`,
`getGCData`, `startSummary`, `validateSummary`, `completeSummary`, `refreshLatestSummary`)
throw, because they only run on a summarizing client, which this is not.

**Verified-tolerant consumers.** `getChild(...)` returning `undefined` is guarded at the
call site (`dataStoreContext.ts` `if (channelSummarizerNode)`); `referenceSequenceNumber`
has no readers in `channelCollection` / `dataStoreContext` / `dataStore`; `invalidate` and
`recordChange` only affect summary state, which is never serialized on this client.

**Safety / contract.** Appropriate for clients that summarize server-side **and** run with
GC disabled (both already true via the summarizer + GC stubs). The swap is a **consumer
build-config opt-in**, exactly like the other stubs. A compile-time `requireAssignableTo`
spec keeps the value exports (`createRootSummarizerNodeWithGC`, `SummarizerNodeWithGC`) and
the factory signature in sync with the real module, and runtime tests assert the child-map
behavior, the no-op lifecycle methods, and that the summarizer-only methods throw. The
regex `/[\\/]summarizerNodeWithGc\.js$/` does not match the replacement module itself
(`summarizerNodeWithGcStub.js`). The full container-runtime suite (965 tests, +3 new)
passes — the suite still exercises the *real* summarizer-node tree.

#### Excluding garbage collection (~20.9 KB) from a single chunk — IMPLEMENTED

**Result.** Single chunk drops from **513,858 → 492,972 B parsed** (−20,886) and
**134,712 → 129,369 B gzip** (−5,343). `gc/garbageCollection.js` (the `GarbageCollector`
class) is replaced with a no-op stub shipped by container-runtime, which drops it plus
its exclusive dependencies (`gcTelemetry`, `gcUnreferencedStateTracker`,
`gcSummaryStateTracker`, `gcConfigs`, `gcReferenceGraphAlgorithm`) and lets Terser DCE
the now-dead GC handling in `containerRuntime.ts`.

**Why it is removable here.** `GarbageCollector` performs reference tracking, the
unreferenced→tombstone→sweep lifecycle, and writes/reads the GC blob in summaries. This
client summarizes **server-side** (the summarizer is already stubbed out), so it never
writes a summary or its GC data, and the consuming app does not rely on GC **sweep /
tombstone deletion enforcement**. The seam is clean: `GarbageCollector.create(...)` is
the single value site (`containerRuntime.ts:1932`), and all ~20 usages go through the
`IGarbageCollector` interface field (`this.garbageCollector`). The heavy GC files are
reachable only through `gc/garbageCollection.js`; the only GC code still needed elsewhere
is the small `gcHelpers` (`cloneGCData`, `unpackChildNodesGCDetails`, `urlToGCNodePath`,
used by `summarizerNodeWithGc`/`channelCollection`) and the `GCNodeType` enum in
`gcDefinitions` — both stay and are tiny.

**Why the stub is valid-empty, not throwing.** Several `IGarbageCollector` members run on
always-executed paths (`nodeUpdated` on the op hot path, `isNodeDeleted` on load,
`getBaseGCDetails`/`getMetadata` during init/summary-format negotiation), so the stub
returns *valid empty / disabled* results rather than throwing: `shouldRunGC === false`
(the runtime then skips GC entirely), `isNodeDeleted === false` (nothing is ever treated
as swept — **this is the precondition**: the app must not rely on GC deletion
enforcement), `getMetadata() === {}` (`gcFeature` undefined ⇒ "GC disabled" per the
`IGCMetadata` contract), `getBaseGCDetails() === {}`, `summarize()`/`collectGarbage()`
return `undefined`, and all reference-tracking / message entry points are no-ops.

**Safety / contract.** Appropriate for clients that summarize server-side and do not
enable GC sweep (sweep/tombstone enforcement is non-default in FF). The swap is a
**consumer build-config opt-in** (the app author asserts the precondition), exactly like
the id-compressor / summarizer / blobManager stubs. A compile-time `requireAssignableTo`
spec keeps the value exports and the `create` signature in sync with the real module, and
runtime tests assert the disabled/valid-empty behavior. The regex
`/[\\/]garbageCollection\.js$/` does not match the replacement module itself
(`garbageCollectionStub.js`). The full container-runtime suite (962 tests, +2 new) passes
— the suite still exercises the *real* `GarbageCollector`.

#### Excluding `SummaryCollection` summary-ack tracking (~4.1 KB) from a single chunk — IMPLEMENTED

**Result.** Single chunk drops from **483,822 → 479,772 B parsed** (−4,050) and
**127,166 → 126,210 B gzip** (−956). `summary/summaryCollection.js` (the
`SummaryCollection` class) is replaced with a no-op stub shipped by container-runtime;
source-map confirms only `summaryCollectionStub.ts` remains and the real module is gone.

**Why it is removable here.** `SummaryCollection` listens to inbound summary-ack/summary-nack
ops and exposes watchers so a *summarizing* client can await acknowledgement of its own
summaries. It is constructed unconditionally (`containerRuntime.ts:2290`), but on this
interactive (non-summarizer) client its only consumers are dead weight: the client-side
`Summarizer` and the `setupSummaryManager` election are **already replaced by stubs**, and
ContainerRuntime never calls a method on the `SummaryCollection` instance itself outside the
`isSummarizerClient` branch (never taken here). `SummaryCollection` is the module's **only**
value export — every other symbol (`ISummaryOpMessage`, `IAckedSummary`, `IClientSummaryWatcher`,
etc.) is a type/interface (erased) — and it is **not** re-exported by the scenario's
`index.ts`, so the replacement is a clean module-seam removal.

**Why the stub mixes no-op and throwing members.** Several members are referenced on the
always-run constructor/wiring path, so the stub keeps them faithful: it `extends
TypedEventEmitter`, `latestAck`/`opsSinceLastAck` return empty values, and
`addOpListener`/`removeOpListener`/`waitFlushed` are no-ops. The two summarizer-only entry
points (`createWatcher`, `waitSummaryAck`) **throw**, because they are only reachable through
the already-stubbed `Summarizer` and are never invoked on this client.

**Safety / contract.** Appropriate for clients that summarize server-side (same precondition
as the summarizer / election stubs), so it is a **consumer build-config opt-in**. A
compile-time `requireAssignableTo` spec keeps the value exports and constructor signature in
sync with the real module (both directions), and runtime tests assert the no-op accessors and
the throwing summarizer-only methods. The regex `/[\\/]summaryCollection\.js$/` does not match
the replacement module itself (`summaryCollectionStub.js`). The full container-runtime suite
(968 tests, +3 new) passes — the suite still exercises the *real* `SummaryCollection`.

#### Pure-telemetry helpers `BatchTracker` + `SampledTelemetryHelper` — REMOVED (see telemetry decision above)

These two helpers were briefly stubbed (a no-op `BindBatchTracker` and a
passthrough `SampledTelemetryHelper.measure`) for ≈2,593 B parsed / ≈753 B gzip,
then **reverted** along with the op-perf/signal telemetry stubs by project
decision. See "Telemetry stubs — REMOVED" above. Telemetry is off-limits as a
bundle-reduction lever; do not re-introduce these stubs.

#### Research: where lz4js is used (~4,672 B)

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

### Promising reductions not yet landed (non-tree)

Non-tree levers not yet landed, ordered descending by approximate parsed
impact. LOE = level of effort.

| Reduction | Approx. impact (parsed) | LOE | Status / notes |
|---|---:|---|---|
| **`SharedMap` back-compat in `aqueduct`** — **two** references statically pull `mapFactory.js` → `map.js` → `mapKernel.js`: (1) `dataObjectFactory.ts:84` `sharedObjects.push(SharedMap.getFactory())` (the legacy-channel registration); (2) `dataObject.ts:59` `this.internalRoot.attributes.type === MapFactory.Type` (legacy-masquerade detection). `MapFactory` is hard-coupled to the `SharedMap` impl (its `create`/`loadCore` do `new SharedMapInternal(...)`), so even a bare `MapFactory.Type` reference drags the whole subtree in. | **−9,471 B parsed / −1,432 B gzip (MEASURED)** — paid by **every `DataObject` consumer**, not just this scenario | **Medium / blocked-compat** | **⚠️ OPEN QUESTION — owner decision pending.** Hard number obtained by prototype (both refs decoupled, then reverted): single chunk **483,822 → 474,351 B parsed (−9,471) / 127,166 → 125,734 B gzip (−1,432)**; `map.ts`/`mapKernel.ts`/`mapFactory.ts` leave the bundle entirely. **Removing BOTH refs is required** — decoupling only `dataObject.ts` (inlining the `"https://graph.microsoft.com/types/map"` type string, which is **free + safe** and keeps masquerade detection) yields **0 B** while the factory registration still references `MapFactory`. The **factory registration is the load-bearing one**: dropping it breaks loading documents whose root `DataObject` persisted a `SharedMap` channel (no factory to rehydrate it). The package's own `// TODO: Remove SharedMap factory ... no longer needed in 0.10` flags it. Needs an owner/compat decision (are pre-0.10 SharedMap-DataObject documents still in scope?). Lazy-loading yields **0 B** here (single-chunk merge); only outright deletion removes the bytes. |
| **`lz4js` lazy-load** — defer `OpCompressor`/`OpDecompressor`. | **~4,700 B** | **High / blocked** | Both are eagerly instantiated in `containerRuntime.ts` on the op-processing hot path; lazy-loading injects async boundaries into inbound decompression. |

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

### Investigated this session — REJECTED (load-bearing / used)

- **Sequence interval collections (~28 KB: `intervalCollection.ts` 15.6 KB +
  `sequenceInterval.ts` 8.1 KB + supporting).** The single biggest remaining file-level
  lever, but **the app uses intervals**: the scenario's `index.ts` re-exports
  `SequenceInterval`, `ISequenceOverlappingIntervalsIndex`, and the value
  `createOverlappingIntervalsIndex`. `IntervalCollectionMap` is also constructed
  unconditionally in the `SharedSegmentSequence` base (`sequence.ts:552`) and woven into
  the op path (`tryProcessMessage`/`tryResubmit`/`tryRollback`/`populate`). Load-bearing —
  not removable.
- **`documentSchema.ts` (~5.7 KB).** `DocumentsSchemaController` gates feature enablement
  and validates schema ops on **every** client (not just summarizers); it is on the
  always-run init + inbound-op path. Load-bearing — not removable.
- **`telemetry-utils` core (~17 KB: logger / errorLogging / config).** Core logging
  infrastructure used throughout the runtime — load-bearing, not removable. (Telemetry
  is off-limits for bundle reductions regardless; see the telemetry decision above.)

### Reachability audit (this session) — bundle is tight; no orphans

Re-traced the import graph from the scenario's entry value-export set (the non-type
exports in `src/index.ts`: `ContainerRuntimeFactoryWithDefaultDataStore`, `DataObject`,
`Loader`, `ConnectionState`, `SharedDirectory`, `SharedString`, `Side`,
`createOverlappingIntervalsIndex`, `Marker`, `ReferenceType`, `refGetTileLabels`,
`CompressionAlgorithms`, `SummaryType`/`MessageType`/`ScopeType`, `LoaderHeader`,
`createChildLogger`). Findings:

- **All bundled packages declare `sideEffects: false`** (sequence, map, merge-tree,
  container-runtime, container-loader, aqueduct, …), so webpack already tree-shakes pure
  re-export barrels. Every one of the ~250 modules remaining in the chunk is reachable via
  a **real** (non-barrel) import edge — there is no statically-unreachable dead code left
  for webpack to drop.
- **Our 9 stub-polyfills leave no residual heavy edges.** Audited every `*Stub.ts`: all
  imports of the heavy real modules they replace are `import type` (erased at compile time).
  The only *value* import in any stub is `SummaryTreeBuilder` (tiny, already shared). So no
  stub keeps an orphan alive.
- **No orphaned modules.** Checked the modules whose only non-barrel importer is a stubbed
  subsystem (e.g. `summary/summaryHelpers.ts`, whose only static importer besides the barrel
  is the stubbed `summaryManagerDelayLoadedModule`). They remain only because *live* code
  (`containerRuntime.ts` uses `DefaultSummaryConfiguration` / `isSummariesDisabled` /
  `summarizerRequestUrl` / `validateSummaryHeuristicConfiguration` on every client) genuinely
  uses other exports of the same module. Reachable, not orphaned.
- **The merge-tree summary WRITE path is reachable via attach, not just summarize.**
  `SharedObject.getAttachSummary` → `summarizeCore` → `client.snapshot()` →
  `SnapshotV1`/`SnapshotLegacy`. Any client that *creates/attaches* a SharedString needs it,
  so it cannot be removed under the generic-factory assumption (see gated candidate below).

**Conclusion:** the clean per-client module-seam levers are exhausted. The remaining ≥5 KB
blocks are required core orchestration (`containerRuntime`/`channelCollection`/
`dataStoreContext`/`container`/`deltaManager`/`connectionManager`), required DDSs
(`merge-tree`/`sequence`/`directory`), load-bearing negotiation (`documentSchema`), or the
already-tabled gated candidates (SharedMap, serializedStateManager-offline, lz4js).

#### Sub-threshold / gated candidates found by the audit

- **`BatchTracker` (`batchTracker.ts`, ~0.9 KB parsed) — REJECTED (telemetry off-limits).**
  Pure telemetry (bound at `containerRuntime.ts:2177`, only `sendPerformanceEvent`, zero
  functional effect). It was briefly stubbed together with `SampledTelemetryHelper`
  (−2,593 B parsed / −753 B gzip) but **removed** by project decision along with the
  op-perf/signal telemetry stubs — telemetry is not an acceptable bundle-reduction lever
  (see "Telemetry stubs — REMOVED" above). Do not re-propose.
- **Merge-tree summary WRITE path (`snapshotV1.ts` 3,697 + the write half of `snapshotlegacy.ts`
  ~2,000 + DCE of `summarizeMergeTree`/`client.snapshot`) ≈ 6 KB parsed — GATED on a "load-only
  client" precondition.** Only reachable through `getAttachSummary`/`summarize`. A mobile client
  that **only joins existing sessions and never creates/attaches a document** never executes it,
  so it could be stubbed to throw — but (a) the precondition is strong and unsafe if violated (a
  single attach would throw mid-create), and (b) the seam is **not clean**: `snapshotLoader.ts`
  (the READ path, required for load) shares the `SnapshotLegacy.header`/`.body` constants with
  the writer, so the two cannot be separated by a whole-file replacement without a prod refactor
  to split read constants from write logic. Documented, not landed.

## Part 2 — Tree reductions

> **Out of scope** for the current `encapsulated-no-tree` target — these shrank
> `@fluidframework/tree` code that no longer ships in this scenario (tree was
> removed in `2c27c80a0d`). They are retained for the historical record and for
> with-tree / asymmetric consumers, and can be re-measured against the restored
> [`../encapsulated-with-shared-tree`](../encapsulated-with-shared-tree/) scenario.
> Landed tree reductions total **−43,387 B parsed / −9,338 B gzip**.

### Landed reductions (tree)

> **Cannot be recomputed against the current build.** These shrank
> `@fluidframework/tree` code that **no longer ships** — the scenario was renamed
> `encapsulated-with-shared-tree` → `encapsulated-no-tree` (`2c27c80a0d`) and the
> `@fluidframework/tree/legacy` re-export was deleted from `src/index.ts`. The
> figures below are therefore the deltas **as measured at landing time against the
> old `encapsulated-with-shared-tree` scenario**; re-running them against the
> current no-tree bundle would report 0 (the tree code is gone). They are retained
> for the historical record only and are **excluded from the non-tree total** and
> from progress against the current target. To reproduce them, check out the
> pre-rename revision (`2c27c80a0d^`) and rebuild the with-tree scenario.

| Commit | Change | Parsed Δ | Gzip Δ |
|--------|--------|---------:|-------:|
| `f39c28c357` | **TypeBox barrel-import rewrite** — replace `import { Type }` (namespace object, defeats `usedExports`) with named imports of the specific kinds; reconstruct a local `const Type = {…}` so call sites are unchanged. 35 `dds/tree` files. TypeBox: 39,283 → 12,580 B (−68%). | **−25,764** | **−5,541** |
| `a636e62391` | **`importHelpers` + `tslib` — `dds/tree` only**. Stops `tsc` emitting `__classPrivateFieldGet/Set` / `__esDecorate` / `__runInitializers` inline per file (12–16× duplicated, un-dedupable by `concatenateModules`). 17 `dds/tree` modules collapse to one `tslib` import. | **−9,466** | **−621** |
| `1517e1b2b7` | **Skip shape-aware chunker on default-policy path** — add `basicOnlyChunkField`/`basicOnlyChunkTree` (policy-free, `BasicChunk`-only) and route the 4 default-policy callers through them. DCEs `uniformChunk.ts` (5,908 → 0 B) + the `Chunker`/shape-inference surface. | **−7,526** | **−3,176** |
| `4f3f00e408`, `9bd42724a2`, `bf19974e42`, `0160d61ddb` | **Sub-1 KB `treeCheckout` cleanups** (combined) — drop unused `removedRoots` getter + inline `runWithTransactionLabel`; collapse duplicate `applySerializedChange`/`applyChange`; prototype-chain unlocked editor methods in `EditLock`; drop stray `debugger;`. See findings §3. | **−631** | _(not split)_ |
| **Tree total** | **4 landed reductions** (`b150d4d520` defaultFieldKinds split was reverted) | **−43,387** | **−9,338**¹ |

¹ Tree-total gzip covers the three levers with separately-measured gzip; the
sub-1 KB `treeCheckout` cleanups (−631 B parsed combined) were not gzip-split.

### Promising reductions not yet landed (tree)

Tree levers not yet landed. **Out of scope** for the current
`encapsulated-no-tree` target (tree is no longer in the bundle); retained for
asymmetric/with-tree consumers and re-measurable against the restored
`encapsulated-with-shared-tree` scenario. Ordered descending by approximate
parsed impact (impact is for the with-tree scenario unless noted). LOE = level
of effort.

| Reduction | Approx. impact (parsed) | LOE | Status / notes |
|---|---:|---|---|
| **Read-only checkout entrypoint** — split `TreeCheckout` so a variant omits `defaultEditBuilder`, dropping the entire write pillar (`sequence-field` + `modularChangeFamily` + `optional-field`). | up to **~70 KB** (read-only consumers only; **0** for read+write) | **Very high** | Surfaced by per-API analysis, **not yet attempted**. Architectural: `TreeCheckout` must expose `editor`/`transaction`/`applyChange` only on the editing variant. Single clean cut point (one import edge). |
| **`SchemaFactory.array`/`.map` prototype detach (#6)** — make array/map node-kind infra opt-in. | **−11,044** ceiling / −2,830 gzip; **0** if the consumer uses any of `array`/`map`/`arrayRecursive`/`mapRecursive` | **Medium** | Stub-measured. This scenario uses both array and map, so saving here is 0 — documented as the upper bound for asymmetric consumers. |
| **Closed-kind-set `ModularChangeFamily` monomorphization** — replace runtime `getFieldKind` map dispatch with a build-time closed set so terser can resolve handlers statically. | **~10 KB** ceiling | **Very high** | Research-grade. Correctness, layer-compat, and persisted-format implications. |
| **F1+F2 branching + revertibles subclass split** — `BranchingTreeCheckout extends TreeCheckout`, paired with a `SharedTree` view-side split so branching is opt-in. | **~9 KB** combined ceiling; **0** without the `SharedTree`-side change | **High** | Cross-cutting public-API impact (`TreeView.fork()`, `TreeBranchAlpha`, `getRevertible`). `SharedTree.view` exposes `fork`/`createSharedBranch` unconditionally today, so both ends must split. |
| **Further `basicChunk`-path specialization** beyond `1517e1b2b7** — drive remaining dynamically-dead chunk-policy branches to static DCE. | ~1–2 KB residual | **Medium** | `1517e1b2b7` already captured the `uniformChunk` (5.9 KB) win; remaining surface is small. |
| **Top-level checkout-API split (#9)** — move transactions/branching/alpha methods to a new `@fluidframework/tree/legacy/branching`-style entrypoint. | **−4,702** / −1,172 gzip | **High** | Stub-measured. New public-API entrypoint + refactor 18+ methods to module-level functions + consumer codemod/shims. |
| **`schemaCompatibilityTester` defer** — skip the open-time stored-schema compat check until first edit/explicit check. | **~4,544 B** | **Medium** | Reached unconditionally during view init; candidate for lazy init for consumers willing to defer the open-time check. |
| **`chunked-forest/codec` separation** — split the op-wire codec path (reached SharedTree-direct via `forestSummarizer`) from in-memory chunk representation. | **~7 KB** (of the ~14 KB codec subtree) | **Medium-High** | Distinct logical responsibility (wire format vs. in-memory) in the same directory; flagged as "potentially separable," not yet attempted. |
| **`@tylerbu/sorted-btree-es6` `union`/`decompose` replacement** | **~7 KB** | **High / blocked** | `mergeTupleBTrees` is hot-path compose code; naive merge trades bundle size for runtime perf. |
| **Module-level helper extraction (F5/F6/F7/F8)** — convert checkout instance methods (labels, raw-change apply, constraints, diagnostics) to free functions in an advanced module. | **~5–8 KB** *with consumer-side changes*; **0** for this scenario | **Low–Medium** | `SchematizingSimpleTreeView` still pulls transaction labels, so this scenario sees 0 until paired with a view-side change. |
| **`sequence-field` codec V2+V3 pin at build time** — currently both kept for runtime `ClientVersionDispatching`. | **~4.7 KB** | **Medium** | Requires pinning the wire-codec version at build time instead of `MinimumVersionForCollab` runtime selection. |
| **`ModularChangeFamily` private-method hoist (#8)** | **−1,553** / −204 gzip | **Medium** | Stub-measured; net well below the churn cost (39-method refactor across a 3.2K-line file, loss of `private` encapsulation). |
