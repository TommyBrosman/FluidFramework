# Bundle-size findings: `encapsulated-with-shared-tree`

Scenario: `examples/utils/bundle-size-tests/scenarios/encapsulated-with-shared-tree`.

Consumer surface: re-exports public/legacy API of `aqueduct`, `container-loader`,
`container-runtime`, `map`, `merge-tree`, `sequence`, `tree`, etc. (14 FF
packages, all `/legacy` entry points; identical to `referenceIndex.ts.txt`,
the original consumer's index).

Branch history:
- Pre-session baseline (before any work): **1,019,378 B parsed / ~270 KB gzip**.
- After Experiment #5 (TypeBox barrel-import shrink) on
  `tbrosman/experiment-shrink-bundle`: **993,352 B / 269,712 B gzip**.
- After the `tbrosman/claude-shrink-bundle` follow-up work (10 commits): **968,720 B
  / 258,677 B gzip**. **−50,658 B parsed (−4.97%) / −11,035 B gzip (−4.09%) total
  over both branches.**

---

## 1. Methodology + reproducing

- Bundle measurement: `npm run collect:compare:bundles -- --scenario
  encapsulated-with-shared-tree --base-revision <sha>` orchestrates
  `collectBundle.ts` × 2 + `compareBundles.ts`.
- Per-file byte attribution: `npx source-map-explorer
  build/scenarios/encapsulated-with-shared-tree/encapsulated-with-shared-tree.js
  --tsv`.
- Webpack 5, `mode: production`, `concatenateModules: true`, single chunk
  (`LimitChunkCountPlugin({ maxChunks: 1 })`), terser minified.
- Per-API import-chain analysis: `scripts/analyzeTreeReasons.ts` — webpack
  reasons graph attributed via source-map-explorer to per-module bundle
  bytes, rooted at each runtime-imported API's owning module.

```bash
cd examples/utils/bundle-size-tests
# Compare current branch vs. a base revision
npm run collect:compare:bundles -- \
  --scenario encapsulated-with-shared-tree \
  --base-revision 55272ad

# Per-file breakdown of the current bundle
npx source-map-explorer \
  build/scenarios/encapsulated-with-shared-tree/encapsulated-with-shared-tree.js \
  --tsv | sort -t$'\t' -k2 -n -r | head -40

# HTML report (open in browser)
npm run explore:scenario -- encapsulated-with-shared-tree
# -> bundleAnalysis/report-encapsulated-with-shared-tree.html
```

Quick audit for duplicated TypeScript runtime helpers (post-`importHelpers`
this should be 1× each; pre-fix it was 12-16×):

```bash
node -e "const s=require('fs').readFileSync('build/scenarios/encapsulated-with-shared-tree/encapsulated-with-shared-tree.js','utf8'); for (const t of ['Private method is not writable','Private accessor was defined without a getter']) {let c=0,p=-1; while((p=s.indexOf(t,p+1))!==-1)c++; console.log(c+'x '+t);}"
```

---

## 2. Current bundle state

All numbers below are the **current** post-landing values (`968,720 B
parsed`). The pre-session and pre-`importHelpers` numbers are kept in
the per-experiment entries in §3 / §5 only when they are needed to
explain a delta.

### Top byte contributors (parsed)

| Bytes  | File |
|------:|------|
| 53,571 | `runtime/container-runtime/src/containerRuntime.ts` |
| 29,810 | `loader/container-loader/src/container.ts` |
| 28,059 | `dds/tree/.../modular-schema/modularChangeFamily.ts` |
| 25,506 | `dds/map/src/directory.ts` |
| 25,177 | `dds/merge-tree/src/mergeTree.ts` |
| 17,033 | `dds/tree/.../shared-tree/treeCheckout.ts` |
| 17,000 | `runtime/container-runtime/src/channelCollection.ts` |
| 16,302 | `dds/merge-tree/src/client.ts` |
| 15,854 | `@tylerbu/sorted-btree-es6/b+tree.js` |
| 15,740 | `dds/sequence/src/intervalCollection.ts` |
| 14,997 | `runtime/container-runtime/src/dataStoreContext.ts` |
| 14,636 | `loader/container-loader/src/deltaManager.ts` |
| 13,408 | `loader/container-loader/src/connectionManager.ts` |
| 13,057 | `runtime/container-runtime/.../runningSummarizer.ts` |
| 11,460 | `runtime/container-runtime/src/gc/garbageCollection.ts` |
| 10,589 | `dds/tree/src/shared-tree-core/editManager.ts` |
|  9,030 | `dds/tree/src/core/tree/anchorSet.ts` |
|  8,819 | `dds/merge-tree/src/partialLengths.ts` |
|  8,631 | `runtime/id-compressor/src/idCompressor.ts` |
|  8,351 | `dds/sequence/src/sequence.ts` |
|  8,161 | `dds/sequence/src/intervals/sequenceInterval.ts` |
|  8,126 | `dds/tree/.../chunked-forest/basicChunk.ts` |
|  8,107 | `runtime/container-runtime/src/blobManager/blobManager.ts` |
|  7,816 | `loader/container-loader/src/connectionStateHandler.ts` |
|  7,711 | `runtime/container-runtime/src/pendingStateManager.ts` |

### Per-package roll-up

| Bytes  | Package | Share |
|------:|---------|------:|
| 315,941 | `packages/dds/tree` | 32.6% |
| 234,905 | `packages/runtime/container-runtime` | 24.3% |
| 102,207 | `packages/loader/container-loader` | 10.6% |
|  92,732 | `packages/dds/merge-tree` | 9.6% |
|  40,005 | `packages/dds/sequence` | 4.1% |
|  35,738 | `packages/dds/map` | 3.7% |
|  25,537 | `npm:@tylerbu/sorted-btree-es6` | 2.6% |
|  18,626 | `packages/utils/telemetry-utils` | 1.9% |
|  17,952 | `packages/runtime/id-compressor` | 1.9% |
|  12,580 | `npm:@sinclair/typebox` | 1.3% |
|  10,528 | `packages/dds/shared-object-base` | 1.1% |
|  10,055 | `packages/runtime/runtime-utils` | 1.0% |
|   8,473 | `packages/common/core-utils` | 0.9% |
|   6,542 | `packages/common/client-utils` | 0.7% |
|   6,265 | `[no source]` (webpack runtime + minified vendor) | 0.6% |
|   4,761 | `packages/loader/driver-utils` | 0.5% |
|   4,672 | `npm:lz4js` | 0.5% |
|   4,669 | `npm:debug` | 0.5% |
|   3,391 | `packages/framework/aqueduct` | 0.4% |
|   2,217 | `npm:semver-ts` | 0.2% |
|   1,909 | `npm:tslib` | 0.2% |
|   1,402 | `npm:ms` | 0.1% |
|   1,049 | `npm:uuid` | 0.1% |

### Per-subdirectory breakdown inside `dds/tree`

| Bytes  | Area |
|------:|------|
| ~38,000 | `feature-libraries/modular-schema` (the change family + codecs) |
| ~31,500 | `feature-libraries/sequence-field` (compose/invert/rebase + utils) |
| ~30,500 | `feature-libraries/chunked-forest` |
| ~21,500 | `core/tree` (anchorSet, paths, deltas) |
| ~18,500 | `simple-tree/core` |
| 17,033  | `shared-tree/treeCheckout.ts` |
| ~14,600 | `simple-tree/node-kinds` (array, map, object, record) |
| 10,589  | `shared-tree-core/editManager.ts` |
| ~8,650  | `feature-libraries/flex-tree` |
| ~8,200  | `feature-libraries/optional-field` |
| ~8,150  | `simple-tree/api` |
|  7,189  | `shared-tree-core/sharedTreeCore.ts` |
|  6,914  | `feature-libraries/object-forest` |
| ~6,400  | `feature-libraries/forest-summary` |
| ~5,900  | `feature-libraries/default-schema` |
| ~5,100  | `core/rebase` |
|  5,011  | `shared-tree/schematizingTreeView.ts` |
| ~5,000  | `feature-libraries/treeCursorUtils.ts` |
|  4,797  | `shared-tree/sharedTree.ts` |
|  4,131  | `codec/versioned` |
| (other < 4 KB) | |

`dds/tree` dominates the bundle: ~316 KB / 32.6% / largest single package.
Its bulk is dispersed across many engine files (modular-schema +
sequence-field + chunked-forest = ~100 KB on their own) — the top-by-file
view only catches ~5 of them, which is why the per-package roll-up matters.

---

## 3. Landed wins

Two phases of work, both on `tbrosman/experiment-shrink-bundle` and its
follow-up `tbrosman/claude-shrink-bundle`. The TypeBox win below was
landed first; the 10 commits after it followed once the
`importHelpers` lever was discovered (see §4 lessons).

| # | Commit | Change | Parsed Δ | Gzip Δ |
|---|--------|--------|---------:|-------:|
| 1 | `f39c28c357` | **TypeBox barrel-import rewrite.** Replace `import { Type } from "@sinclair/typebox"` (which defeats webpack's `usedExports` because `Type` is a module-namespace object) with named imports of the specific kinds each file uses, then reconstruct a local `const Type = { Object: _Object, … }` so call sites don't change. 35 files in `dds/tree/src` rewritten by an automated pass. TypeBox in bundle: 39,283 → 12,580 B (−68%). | **−25,764** | **−5,541** |
| 2 | `0160d61ddb` | treeCheckout: drop stray `debugger;` in `EditLock.lock`. | −12 | — |
| 3 | `bf19974e42` | treeCheckout: `EditLock` uses `Object.create(editor)` for prototype-chain pass-through (drops 4 redundant constraint method bodies + schema getter). | −246 | — |
| 4 | `9bd42724a2` | treeCheckout: collapse duplicate `applySerializedChange`/`applyChange` (one canonical body, one `@throwIfBroken` wrapper). | −246 | — |
| 5 | `4f3f00e408` | treeCheckout: drop unused `removedRoots` getter; inline single-use `runWithTransactionLabel`. | −127 | — |
| 6 | `a636e62391` | **`dds/tree`: enable `importHelpers` + add `tslib` dep.** Stops TS from emitting `__classPrivateFieldGet`/`__classPrivateFieldSet`/`__esDecorate`/`__runInitializers` inline at the top of every compiled `.js`. Pre-fix: 12-16× copies in bundle; post-fix: a single `tslib` import. | **−9,466** | (most of −1,400) |
| 7 | `be4b57addd` | Extend `importHelpers` to runtime/container-runtime, loader/container-loader, dds/sequence, dds/shared-object-base. | **−3,314** | (cumulative −1,400) |
| 8 | `80571ad8fe` | client-utils: replace `events` (npm) polyfill with in-tree EventEmitter (~150 lines, WeakMap-backed for clean public type, fires Node's `newListener`/`removeListener` meta-events). Also drops `events_pkg` direct import in container-loader's `quorum.ts`. | **−4,464** | −1,223 |
| 9 | `dde412e121` | dds/map: replace `path-browserify` with ~35 lines of inline posix path helpers in `directory.ts` (full `..`/`.`/multi-slash semantics). | **−3,590** | −1,332 |
| 10 | `004d76ec6c` | client-utils: replace `double-ended-queue` (npm) with in-tree `Deque<T>` (~80 lines, array-backed with head index for amortized O(1) shift). 4 consumer files updated. Also adds static `EventEmitter.listenerCount`/`defaultMaxListeners` for type-validation parity with the previous published version. | **−2,157** | −621 |
| 11 | `ec4c2cd96f` | client-utils: replace `base64-js` (npm) with two ~10-line `btoa`/`atob` helpers in `bufferBrowser.ts`; chunk via `String.fromCharCode.apply` to dodge Chrome's call-stack limit on large blobs. Browser-only path. | **−1,090** | −498 |

**Cumulative: 1,019,378 → 968,720 = −50,658 B parsed (−4.97%) / ~270,000
→ 258,677 = ~−11,300 B gzip (−4.2%).**

---

## 4. Lessons learned

### `importHelpers: true` + `tslib` is the highest-leverage low-risk lever

Without `importHelpers`, every compiled `.js` from a TypeScript source
that uses `#privateField` syntax or class decorators emits ~1 KB of
runtime helpers inline at the top of the file: `__classPrivateFieldGet`,
`__classPrivateFieldSet`, `__esDecorate`, `__runInitializers`. Webpack's
`concatenateModules` cannot dedupe these — each one ends up with unique
scope-local var names after concatenation, so terser sees them as
distinct functions.

In this bundle, **17 such modules across 6 packages** were emitting
inline helpers. The same `Private accessor was defined without a getter`
literal appeared 16× in the bundle pre-fix, and `Private method is not
writable` appeared 12×.

Enabling `importHelpers: true` and adding `tslib` as a runtime dependency
makes `tsc` emit `import { __classPrivateFieldGet, … } from "tslib"`
instead. Webpack collapses every reference to a single `tslib` import.
Two commits (`a636e62391` + `be4b57addd`) saved **−12,780 B parsed**
combined.

### CJS-emit + `require("tslib")` is a trap

A first attempt at the `events` polyfill replacement used `#field`
private syntax inside the `.cts` source file (CommonJS emit). Result:

- The `events` polyfill was correctly removed: **−6 KB parsed.**
- But TS compiled `#field` to `require("tslib").__classPrivateFieldGet(…)`,
  and webpack's CJS tree-shaking was unable to limit the import to
  just the named helpers — it pulled in the **entire `tslib` namespace**:
  **+12 KB.**

Net: **+6 KB regression.**

Fix: in CJS-emitted files, use module-level `WeakMap` for hidden state
instead of `#field`. The class's public TypeScript type stays clean
(no `#private` synthetic member leak), so downstream `class X
implements EventEmitter` keeps type-checking, and no tslib helpers are
needed.

### Stub-and-measure before committing to API removal

For optional API surfaces (alpha methods, debug exports), replacing
the implementation body with `throw new UsageError("stub")` and rebuilding
gives a precise byte saving without committing to the test/API churn.
Used to size F8 (diagnostic exports) at **−1,967 B parsed via stub**
before discovering that 10 test files including snapshot-consistency
suites depend on `contentSnapshot()`. Reverted the stub; the test
rewrite cost vastly exceeds the win.

### Polyfill-replacement work needs a public-type audit, not just a callsite audit

When replacing `events` (npm), the runtime API surface is straightforward
(on/off/emit/once/etc.), but the *type* surface is what trips downstream:

- `@types/events` declares event names as `string | number` (not Node's
  `string | symbol`). Matching this is required so subclasses' narrower
  `on`/`emit` overloads remain assignable.
- Listener args are `(...args: any[])`, not `(...args: unknown[])`.
- The class exports static `listenerCount(emitter, type)` and
  `defaultMaxListeners` properties for backwards compatibility, even
  though they're deprecated since Node v3 — type-validation against
  previous published versions of `client-utils` requires them.
- `MockQuorumClients implements EventEmitter` in test-runtime-utils
  forced the public type to omit `#private` synthetic members; the
  `WeakMap`-backed approach (above) handles this.

---

## 5. Investigated, did NOT land

Numbers are estimates / measurements specifically against this
scenario's bundle.

| # | Lane | Estimated savings | Why skipped |
|---|------|------------------:|-------------|
| #1 | `defaultFieldKinds` lite split | +262 B (regression) for this scenario; −41,726 B for synthetic schema-only consumer | `SharedTree.create` reaches `DefaultChangeFamily` synchronously, so optional-field/sequence-field are pulled in via `defaultEditBuilder` regardless of the lite split. Reverted on this branch. |
| #2 | Lazy-load `SharedTree` at consumer boundary | ~40 KB out of initial chunk (TTI win, total bytes unchanged) | Target consumer cannot benefit from async loading of `SharedTree`. |
| #3 | `containerRuntime.ts` lazy-load surfaces | n/a | Summarizer is **already** delay-loaded (`summary/summaryDelayLoadedModule/*`). Other large subsystems (`GarbageCollector`, `BlobManager`, `Outbox`, `RemoteMessageProcessor`, `IdCompressor`) are eagerly instantiated and called on hot paths (`processMessages`, `nodeUpdated`, `setConnectionState`). Moving any behind dynamic import would inject async boundaries into op processing. |
| #4 | `modularChangeFamily.ts` reshape | n/a | All field-kind dispatch goes through runtime `getFieldKind(this.fieldKinds, kind)` `Map.get`, which terser cannot statically resolve regardless of how the file is reshaped. Real savings would require monomorphizing the change family for a closed set of field kinds — research-grade refactor with persisted-format and layer-compat implications. |
| #6 | `SchemaFactory.array`/`.map` prototype detach | **−11,044 / −2,830 gzip ceiling**, **0 B for symmetric users** | Stub-measured. Saving is 0 if the consumer calls *any* of `factory.array` / `factory.map` / `factory.arrayRecursive` / `factory.mapRecursive`; this scenario uses both. Documented as upper bound for asymmetric consumers. |
| #7 | DCE audit on already-pinned files | 0 | Validated that `arrayNode.ts`, `chunked-forest/*`, and `discrepancies.ts` already have terser-driven DCE working correctly. No "exported function nobody calls" patterns remain. |
| #8 | `ModularChangeFamily` private-method hoist | **−1,553 / −204 gzip** | Measured by stub-and-measure transform of all 39 private methods. Net is well below the 2–4 KB estimated. Not worth the churn (39-method refactor across a 3.2K-line file, loss of `private` encapsulation, every former `this.foo()` becomes explicit `foo(this, …)`). |
| #9 | Top-level checkout-API split (transactions, branching, alpha methods) | **−4,702 / −1,172 gzip** | Measured by stub. Cost to land: new public-API entrypoint (e.g. `@fluidframework/tree/legacy/branching`), refactor of 18+ methods into module-level functions, consumer-side codemod or compatibility shims. Significant API design work for ~5 KB / ~1.2 KB gzip. |
| F4 | `runTransactionAsync` removal | ~1 KB | Cross-cutting interface change in 3 impl classes + 2 alpha interfaces + 4+ test rewrites + API report regen. Cost vs. value too high. |
| F8 | Diagnostic exports (`exportVerbose`, `getRemovedRoots`, `assertNoUntrackedRoots`, plus their `SharedTreeKernel.contentSnapshot`/`exportVerbose` wirings) | **−1,967 B parsed (stubbed)** | 10 test files including snapshot-consistency suites use `contentSnapshot()` for tree comparison. Test-rewrite cost vastly exceeds the win. |
| N5 | `semver-ts` inline (runtime side only) | <500 B realistic | `dds/tree` pins most of the package via `gt`/`lt` in `modular-schema/modularChangeFamily.ts` and `codec/versioned/codec.ts`; removing only the runtime side leaves the polyfill in. Findings doc's earlier ~2.2 KB estimate predates the polyfill swaps that already shrank the surrounding bundle. |
| N6 | `debug` from default Loader path | ~4.7 KB (`debug/src/browser.js` 2,632 B + `ms` 1,402 B + remainder) | `DebugLogger` is part of the loader's legacy public surface; `localStorage.debug = "fluid:*"` is a documented diagnostic for partner teams. Mitigation requires a public-API entry-point split. |
| N7 | `dds/sequence` tree-shake from `Marker`/`ReferenceType`/`refGetTileLabels` | up to ~130 KB theoretical | Re-export shape change in `dds/merge-tree/src/index.ts` plus per-symbol audit and likely package-`exports`-level granularity. Medium-to-high risk; not yet attempted. |
| F1+F2 | Branching + revertibles subclass split | ~6,500 own + ~2,500 transitive | Architectural; introduces `BranchingTreeCheckout extends TreeCheckout` and a feature-flag arg to `createTreeCheckout`. Public-API impact on `TreeView.fork()`, `TreeBranchAlpha`, the `getRevertible` callback. **Caveat**: savings only materialize when a consumer uses the non-branching subclass — since `SharedTree.view` exposes `fork`/`createSharedBranch` unconditionally, this scenario would still get the branching subclass. Needs a `SharedTree`-side split too to land the bytes. |
| — | `lz4js` lazy-load | ~4.7 KB | `OpCompressor`/`OpDecompressor` are eagerly instantiated in `containerRuntime.ts`; making them lazy would inject async boundaries into op processing for inbound-decompression, which can't always know up-front that an op is compressed. |
| — | `@tylerbu/sorted-btree-es6` `union`/`decompose` replacement | ~7 KB | `mergeTupleBTrees` is hot-path code in `modularChangeFamily.ts` compose; replacing the optimized union with naive merge trades bundle size for runtime perf. |

### Read-only checkout split (architectural lever surfaced by per-API analysis)

Per §6 below, ~70 KB of the SharedTree-reachable bundle (`sequence-field`
31,553 B + `modularChangeFamily` 28,417 B + `optional-field` 8,450 B)
hangs off a single edge: `treeCheckout.js → defaultEditBuilder.js`.
A read-only checkout entrypoint that omits `defaultEditBuilder` could in
principle drop the entire write pillar wholesale. Real architectural
change (`TreeCheckout` exposes `editor`, `transaction`, `applyChange`
directly), but cleanly described — lives at exactly one node in the
import tree. Realistic only for consumers who hold `SharedTree` for
read access without performing local edits.

### Side-effects audit in `@fluidframework/tree`

The package declares `"sideEffects": false` in
[packages/dds/tree/package.json](../../../../packages/dds/tree/package.json),
so webpack is allowed to drop unused modules wholesale. Symbol-presence
checks in this consumer's bundle confirm tree-shaking at the import-graph
level is working correctly: `TableSchema`, `SchemaFactoryBeta`,
`ForestTypeOptimized`, `ForestTypeExpensiveDebug`, `adaptEnum`,
`enumFromStrings`, `singletonSchema`, `JsonAsTree`,
`FluidSerializableAsTree`, etc. are all absent from the bundle when not
imported for value.

Module-level statements with side effects, inventoried below:

| Side effect | File | Bundle cost (this scenario) |
|---|---|---|
| `formatters.push(nodeFormatter)` (browser devtools custom formatter for `TreeNode`) | [packages/dds/tree/src/simple-tree/core/treeNodeValid.ts](../../../../packages/dds/tree/src/simple-tree/core/treeNodeValid.ts) (line ~383) | **−414 B parsed / −193 B gzip** if removed (measured) |
| `Object.defineProperty(TreeNodeValid.prototype, customInspectSymbol, …)` (Node `util.inspect` integration) | same file (line ~324) | tens of bytes |
| `markEager(TreeNode)` | [packages/dds/tree/src/simple-tree/core/treeNode.ts](../../../../packages/dds/tree/src/simple-tree/core/treeNode.ts#L142) | tens of bytes |
| `Object.freeze(identifier)` (TreeAlpha singleton freeze) | [packages/dds/tree/src/shared-tree/treeAlpha.ts](../../../../packages/dds/tree/src/shared-tree/treeAlpha.ts#L130) | tens of bytes |
| `(optional/required/sequence as any).changeHandler = …` — patches the real CRDT change handlers onto the lite field-kind singletons at import time | [packages/dds/tree/src/feature-libraries/default-schema/defaultFieldKinds.ts](../../../../packages/dds/tree/src/feature-libraries/default-schema/defaultFieldKinds.ts) (lines 41–46) | **Major** — pins `optional-field` + `sequence-field` (~21 KB combined) for any consumer that imports value-level from `default-schema/defaultFieldKinds.js`. Already addressed for non-`SharedTree` consumers via the lite split (Experiment #1); doesn't help `SharedTree`-using consumers. |

Three `static {}` blocks expose private constructors via friend-pattern
hooks (assign a closure to a module-level variable when the class is
referenced):

- [packages/dds/tree/src/simple-tree/core/allowedTypes.ts](../../../../packages/dds/tree/src/simple-tree/core/allowedTypes.ts#L437) — `SchemaUpgrade`
- [packages/dds/tree/src/simple-tree/fieldSchema.ts](../../../../packages/dds/tree/src/simple-tree/fieldSchema.ts#L425) — `FieldSchemaAlpha`
- [packages/dds/tree/src/simple-tree/node-kinds/array/arrayNode.ts](../../../../packages/dds/tree/src/simple-tree/node-kinds/array/arrayNode.ts#L509) — `IterableTreeArrayContent`

Negligible bundle cost; flagged for inventory only.

#### Latent side-effect hazards (not currently triggered in this scenario)

These files **do** instantiate schemas at module top level; `sideEffects:
false` keeps them out of this consumer's bundle, but a consumer importing
*anything* value-level from them — even a type that webpack can't prove
is type-only — would cascade-pin substantial schema infrastructure
(`SchemaFactoryAlpha` / `SchemaFactoryBeta` constructor, `recordRecursive`,
`arrayRecursive`, leaf schemas, etc.).

| File | Module-level construction |
|---|---|
| [packages/dds/tree/src/jsonDomainSchema.ts](../../../../packages/dds/tree/src/jsonDomainSchema.ts) | `const sf = new SchemaFactoryAlpha("com.fluidframework.json")` then `sf.recordRecursive(...)` and `sf.arrayRecursive(...)` |
| [packages/dds/tree/src/serializableDomainSchema.ts](../../../../packages/dds/tree/src/serializableDomainSchema.ts) | `const sf = new SchemaFactoryBeta("com.fluidframework.serializable")` plus the equivalent `FluidSerializableAsTree.*` schema declarations |

Verified absent from this consumer's bundle (no `com.fluidframework.json`,
no `JsonAsTree`, no `FluidSerializableAsTree` strings present). By
contrast, [packages/dds/tree/src/tableSchema.ts](../../../../packages/dds/tree/src/tableSchema.ts)
**does not** have this hazard — its `TableSchema` namespace exposes
*functions*, and schemas are only constructed when those functions are
called.

---

## 6. Per-API import-chain analysis

Generated with `scripts/analyzeTreeReasons.ts`
([source](../../scripts/analyzeTreeReasons.ts)) — webpack reasons graph
attributed via source-map-explorer to per-module bundle bytes, rooted at
each runtime-imported API's owning module:

| API | Owner module | Reachable B | Unique B |
|---|---|---:|---:|
| `SharedTree` | `tree/treeFactory.js` | 304,143 | 200,794 |
| `SchemaFactory` | `tree/simple-tree/api/schemaFactory.js` | 113,019 | 12,689 |
| `TreeViewConfiguration` | `tree/simple-tree/api/configuration.js` | 89,979 | 0 |

(Type-only imports `ImplicitFieldSchema`, `ITree`, `TreeView` cost 0 B.)

Full pruned tree at
[`bundleAnalysis/tree-reasons-encapsulated-with-shared-tree.md`](../../bundleAnalysis/tree-reasons-encapsulated-with-shared-tree.md)
(run with `--cutoff 5000` to fold subtrees < 5 KB).

### Findings beyond the rollup tables

1. **`treeCheckout.js` is the gatekeeper of 86 % of `SharedTree`'s reach.**
   Σ 260,281 / 304,143 B flows through this single module (own size only
   17,033 B post-cleanup). Three roughly-equal pillars hang directly off
   it:
   - `feature-libraries/object-forest/objectForest.js` — Σ **80,306 B**
     (read path: forest, chunked-forest, anchorSet, default-schema codecs)
   - `feature-libraries/default-schema/defaultEditBuilder.js` —
     Σ **72,109 B** (write path: `sequence-field` 31,553 B +
     `modularChangeFamily` 28,417 B + `optional-field` 8,450 B)
   - `shared-tree/schematizingTreeView.js` — Σ **38,685 B** (view path:
     `simple-tree/*` node-kinds and schema-compat tester)

   Any architecturally-clean cut for a smaller `SharedTree` has to either
   modify `treeCheckout` or split it. There is no other comparably-broad
   cut point. In particular, the write pillar is a ~70 KB block reachable
   only via `defaultEditBuilder`, sitting on a single edge — a hypothetical
   read-only checkout entrypoint could in principle drop the editing engine
   wholesale.

2. **`TreeViewConfiguration` has 0 B unique.** Every byte it reaches is
   already pinned by `SharedTree`. Refactoring or removing this API saves
   **zero bytes** in this scenario.

3. **`SchemaFactory.array`/`map`/`record` is the only `SchemaFactory`-unique
   block.** SchemaFactory's 12,689 B unique is dominated by
   `simple-tree/node-kinds/array/arrayNode.js` (Σ 31,430 B reach, of which
   most is shared with SharedTree). `objectNode` is reached *independently*
   by SharedTree via `schematizingTreeView → objectNode.js` (Σ 22,448 B),
   so even an "object-only" consumer that detached `array`/`map` from
   `SchemaFactory` would still pay for `objectNode`.

4. **`sharedTreeCore` is a sibling of `treeCheckout`, not nested under it.**
   Σ 29,785 B (incl. `editManager` 11,076 B) hangs directly off
   `sharedTree.js`. Any SharedTree consumer always pulls the op-pipeline
   subsystem in parallel with the editing checkout — they're independent
   reachable subgraphs.

5. **`schemaCompatibilityTester` (Σ 4,544 B) is on the SharedTree path.**
   Reached unconditionally during view init via `schematizingTreeView →
   schemaCompatibilityTester` (constructed in `SchematizingSimpleTreeView`'s
   constructor and called from `update()` on every stored-schema change).
   Candidate for "defer to first edit / compatibility check" if a consumer
   is willing to skip the open-time check.

6. **`chunked-forest/codec` (Σ 14,147 B) is reached SharedTree-direct, not
   via `objectForest`.** The §2 rollup lumps `feature-libraries/chunked-forest`
   at 30,524 B; the chain shows roughly half of that is the op-wire codec
   path (`codecs.js`, `schemaBasedEncode`, `chunkDecoding`) hanging
   straight off `sharedTree.js`. Distinct logical responsibility (wire
   format vs. in-memory representation) within the same directory;
   potentially separable.

7. **`defaultFieldKindsLite.js` is the central crossroads.** Appears as
   `(see above)` in roughly two dozen branches across all three APIs (read
   path, write path, schema path, simple-tree layer). Explains why
   Experiment #1's lite split saved ~40 KB on schema-only consumers but
   nothing on `SharedTree` consumers: every reachable subtree converges
   on it.

### Feature boundaries inside `treeCheckout` (read+write consumers)

Assuming every consumer reads *and* writes (so the read/write split above
is not on the table), `treeCheckout.ts` still contains several distinct
optional features layered on top of basic edit + commit. Each is bounded
to a small set of methods/state on `TreeCheckout` and a corresponding
import edge that pins additional infrastructure.

The numbers below are **structural estimates** derived from method bodies
and the chain analysis (file sizes from `analyzeTreeReasons.ts`); precise
parsed-byte savings require stub-and-measure passes.

`treeCheckout.js` itself is **17,033 B** of own bytes. Roughly half of
that is the eight features below; the other half is the basic
edit/commit/load pipeline that every consumer needs (`editor` getter,
`onAfterChange`, `applyInternalChange`, `viewWith`, `dispose`, `load`,
`registerForBranchEvents`, `validateCommit`, `applyValidator`).

#### F1 — Branching (fork / merge / rebaseOnto / switchBranch / mainBranch)

- **In `treeCheckout.ts`:** `fork()`, `merge()`, `rebaseOnto()`, private
  `rebase()`, `switchBranch()`, `mainBranch` getter, `getCheckout` helper,
  plus the cloning logic in `fork()` (forest clone, schema clone, second
  `TreeCheckout` constructor call, `_removedRoots.clone()`).
- **Pinned imports:** `diffHistories` (used in `switchBranch` and the
  revert path), `isAncestor` (used in revert path); `SharedTreeBranch.fork
  / merge / rebaseOnto` on `shared-tree-core/branch.js` (own **2,747 B**),
  `shared-tree-core/transaction.js` (own **2,939 B**, hosts the fork
  hooks), and the trimmer/disposal callbacks (`onForkTransitive`,
  `trackForksForDisposal`).
- **Estimated cost in this scenario:** ~3–5 KB own (methods + inline
  fork/merge logic) plus most of `shared-tree-core/branch.js` and the
  `trackForksForDisposal` machinery only reachable from
  `disposeForksAfterTransaction`. Branching is also pinned by **F2
  (Revertibles)** below — see "co-pinning note".
- **Customer impact:** Apps that don't fork the tree (single-branch
  collab, server-authoritative editors).

#### F2 — Revertibles (undo/redo)

- **In `treeCheckout.ts`:** `createRevertible()`, `revertRevertible()`,
  `purgeRevertibles()`, `disposeRevertible()`, the `revertibles` set, the
  `revertibleCommitBranches` map, the entire `getRevertible` lambda inside
  `onAfterBranchChange`, the metadata `getChange` lambda.
- **Pinned imports:** `RevertibleAlpha`, `RevertibleAlphaFactory`,
  `RevertibleStatus` types from `core/index.js`; `rebaseChange` and
  `tagChange`/`makeAnonChange` from `core/rebase` (revert path);
  `SharedTreeBranch.fork()` (per-revertible commit branches —
  **co-pinning F1's main external dependency**), `isAncestor`.
- **Estimated cost:** ~3 KB own in this file plus the shared bottom
  with F1.
- **Customer impact:** Apps with no undo or app-layer undo.
- **Co-pinning note:** removing F1 alone or F2 alone leaves
  `SharedTreeBranch.fork` reachable from the other. Removing **both**
  drops the entire branch fork/merge surface in
  `shared-tree-core/branch.js` — an estimated **~2.5 KB** otherwise
  unreachable for a single-branch, no-undo consumer.

#### F3 — Transactions (the public surface)

- **In `treeCheckout.ts`:** `runTransaction()` (3 overloads), private
  `mountTransaction()`, private `unmountTransaction()`, the `transaction`
  parameter handling.
- **Pinned imports:** `Transactor` interface; the entire
  `SquashingTransactionStack` machinery from `shared-tree-core` is **also
  pinned by the constructor** (`createTransactionStack` is unconditional),
  so removing only the public methods does not drop the stack — *unless*
  the constructor is also rewired to use a non-squashing branch wrapper.
- **Estimated cost:** ~2–3 KB own bytes for the public method bodies and
  parameter parsing; the underlying `SquashingTransactionStack` (~3 KB
  in `shared-tree-core/transaction.js`) is structural infrastructure.
- **Customer impact:** Apps that always do single-edit operations don't
  need transaction wrappers — but losing transactions affects atomicity
  semantics.

#### F4 — Async transactions (subset of F3)

- **In `treeCheckout.ts`:** the three `runTransactionAsync` overloads and
  their ~70-line implementation, plus the `breaker.break` handling for
  nested-async errors.
- **Pinned imports:** none specific. Pure code in this file.
- **Estimated cost:** ~1 KB own, no transitive cost. Cheapest local win
  on this list. Consumers who don't need cross-await transactions can
  drop the async overloads.
- **Customer impact:** Loses only the ability to await inside a
  transaction body.

#### F5 — Transaction labels (telemetry)

- **In `treeCheckout.ts`:** `pushLabelFrame()`, `popLabelFrame()`,
  `runWithTransactionLabel()`, private `currentLabelNode()`,
  `buildLabelsSet()`, generator `collectTreeLabels()`,
  `labelTreeNode` / `mostRecentlyClosedLabelNode` state, the
  `metadata.label` / `metadata.labels` fields populated in
  `onAfterBranchChange`.
- **Pinned imports:** `LabelTree` and `TransactionLabels` types from
  `core/index.js` (type-only, 0 B).
- **Estimated cost:** ~1.5 KB own, **no transitive cost**. Pure
  diagnostic plumbing.
- **Customer impact:** Apps that don't consume telemetry-side labels.

#### F6 — Raw change application & encoding (alpha)

- **In `treeCheckout.ts`:** `applyChange()`, `isSerializedChange()`
  (file-level), `SerializedChange` interface, the `metadata.getChange`
  lambda (encoder side), the codec round-trip via
  `changeFamily.codecs.resolve(4)`.
- **Pinned imports:** the **codec V4 of `SharedTreeChangeFamily`** is
  reached via this path. Other codec versions are reached via summaries
  / op pipeline regardless, so V4 is the only version uniquely pinned.
- **Estimated cost:** ~1.5 KB own; transitive likely <1 KB after dedup
  with the op-codec path.
- **Customer impact:** Only consumers wiring SharedTree → SharedTree
  replication of raw changes outside the standard op pipeline (rare).

#### F7 — Constraints

- **At file scope:** exported helpers `addConstraintsToTransaction()`,
  `assertValidConstraint()`. Both walk a `TransactionConstraintAlpha`
  and call into the editor.
- **Pinned imports:** the constraint surface on `ISharedTreeEditor`
  (`addNodeExistsConstraint`, `addNodeExistsConstraintOnRevert`,
  `addNoChangeConstraint`, `addNoChangeConstraintOnRevert`) and their
  modular-schema implementations.
- **Estimated cost:** ~0.5 KB own; editor-side methods add a couple
  hundred bytes more.
- **Customer impact:** Apps using transactions without precondition
  checks.

#### F8 — Diagnostic exports (debug / consistency)

- **In `treeCheckout.ts`:** `exportVerbose()`, `getRemovedRoots()`,
  `assertNoUntrackedRoots()`, the file-scope `verboseFromCursor()`
  helper (~25 lines).
- **Pinned imports:** `verboseFromCursor` calls `customFromCursorStored`
  from `simple-tree/api/customTree.js` (own **660 B**, plus four
  node-kind type-id files `*NodeTypes.js` ≈ 60 B each).
  `jsonableTreeFromCursor` from `feature-libraries`.
- **Estimated cost:** ~1.5 KB own + ~1 KB transitive.
- **Customer impact:** Tests and tools. Production consumers don't need
  `exportVerbose` (debug snapshot) or `getRemovedRoots` (consistency
  comparison).

#### F9 — `SharedTreeChangeEnricher` (NOT actually optional)

- **In `treeCheckout.ts`:** `onCommitValid()`, `validateCommit()`,
  `enrich()`, `resetEnrichmentStats()`, `getEnrichmentStats()`,
  `enrichmentStats` field, `applyValidator` getter.
- **Pinned imports:** `SharedTreeChangeEnricher` (sibling file,
  **1,233 B own**).
- **Customer impact:** **None — required.** `enrich` and `onCommitValid`
  are called by `SharedTree`'s outbox path on every outgoing commit.
  Listed only to rule it out.

#### Summary table

| Feature | Own B (est.) | Transitive uniquely pinned | Co-pinning |
|---|---:|---:|---|
| F1 Branching (fork/merge/rebaseOnto/switchBranch) | ~3,500 | + ~1,500 (only with F2 also gone) | shares `branch.js` with F2 |
| F2 Revertibles | ~3,000 | + ~1,000 (only with F1 also gone) | shares `branch.js` with F1 |
| F1 + F2 combined drop | ~6,500 | **~2,500** (`shared-tree-core/branch.js`) | — |
| F3 Transaction public API | ~2,500 | 0 unless constructor rewired | F4 nested |
| F4 Async transactions | ~1,000 | 0 | nested in F3 |
| F5 Transaction labels | ~1,500 | 0 | — |
| F6 Raw change apply | ~1,500 | <1,000 (codec V4 unique surface) | — |
| F7 Constraints | ~500 | ~300 (editor constraint methods) | F3 dependency only |
| F8 Diagnostic exports | ~1,500 | ~800 (`customTree.js` + type-ids) | — |
| F9 Change enricher | (required) | (required) | — |

**Total upper-bound for read+write consumers who drop F1+F2+F4+F5+F6+F7+F8:
roughly 15–20 KB parsed.** (Subset already measured via stubs:
`runTransactionAsync` + the F8 set + Experiment #9's broader checkout-API
split landed −4,702 B parsed in stub form.)

---

## 7. Future work (ordered by realistic value/risk)

1. **Subclass split for F1 + F2 (branching + revertibles)**, paired with a
   `SharedTree` view-side split so the branching surface is opt-in. Without
   the `SharedTree`-side change, byte savings are 0 for any current consumer
   (this scenario included). With both, ~9 KB combined upper bound.
   Public-API impact: `TreeView.fork()`, `TreeBranchAlpha`, the
   `getRevertible` callback. Risk: medium (well-scoped but cross-cutting).
2. **Module-level helper extraction** for F5/F6/F7/F8: convert instance
   methods to free functions that take `TreeCheckout` as an explicit
   argument (similar to how `addConstraintsToTransaction` is already a
   free function). Move to `treeCheckoutAdvanced.ts` or similar.
   Consumers who don't import the new module never pay for them. Risk:
   low. Cumulative estimate: **~5–8 KB** *if combined with consumer-side
   changes* — for this scenario alone, savings are 0 because
   `SchematizingSimpleTreeView` still pulls in transaction labels.
3. **Read-only checkout entrypoint** that omits `defaultEditBuilder`. Up
   to ~70 KB ceiling for read-only consumers. Architectural; requires
   splitting `TreeCheckout` so the `editor`/`transaction`/`applyChange`
   surface only exists on the editing variant.
4. **Closed-kind-set `ModularChangeFamily`** monomorphization. ~10 KB
   ceiling but research-grade — has correctness, layer-compat, and
   persisted-format implications.
5. **`debug` from default Loader path** (N6) via a `DebugLogger`
   entrypoint split. ~4.7 KB. Risk: medium — diagnostic that partner
   teams use today.
6. **`dds/sequence` exports-granularity audit** (N7) for `Marker` /
   `ReferenceType` / `refGetTileLabels`. Theoretical ceiling up to
   ~130 KB but real win likely much smaller given internal coupling.
   Needs an `analyzeTreeReasons`-style audit rooted at the `merge-tree`
   barrel.

### Hard pass — central plumbing

The largest individual contributors after `dds/tree` are not amenable
to package-level wins:

- `containerRuntime.ts` 53.6 KB
- `container.ts` 29.8 KB
- `channelCollection.ts` 17.0 KB
- `dataStoreContext.ts` 15.0 KB
- `deltaManager.ts` 14.6 KB
- `connectionManager.ts` 13.4 KB

The summarizer cluster (`runningSummarizer.ts` 13.1 KB, `summaryGenerator.ts`
5.8 KB, `summaryManager.ts` 6.3 KB, `summaryDelayLoadedModule/summarizer.ts`
5.2 KB; ~42 KB total) is **already factored** as `summaryDelayLoadedModule/*`
for code-splitting — but the scenario uses
`LimitChunkCountPlugin({ maxChunks: 1 })` so it ends up in the initial
chunk. A scenario-level change (drop the plugin and accept two chunks)
would shed ~42 KB from the initial chunk — but that's a **scenario
tweak**, not a package change, and only meaningful if the consumer can
actually load a second chunk.
