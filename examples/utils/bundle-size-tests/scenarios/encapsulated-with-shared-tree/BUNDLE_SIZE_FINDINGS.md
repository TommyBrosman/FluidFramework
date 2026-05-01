# Bundle-size findings: `encapsulated-with-shared-tree`

Captured on branch `tbrosman/experiment-shrink-bundle`.
Scenario: `examples/utils/bundle-size-tests/scenarios/encapsulated-with-shared-tree`.
Consumer surface: re-exports public/legacy API of `aqueduct`, `container-loader`,
`container-runtime`, `map`, `merge-tree`, `sequence`, `tree`, etc. (14 FF packages,
all `/legacy` entry points; identical to `referenceIndex.ts.txt`, the original
consumer's index).

## Methodology

- Measured with `npm run collect:compare:bundles -- --scenario encapsulated-with-shared-tree --base-revision <sha>`
  (orchestrates `collectBundle.ts` × 2 + `compareBundles.ts`).
- Per-file byte attribution from `npx source-map-explorer build/scenarios/encapsulated-with-shared-tree/encapsulated-with-shared-tree.js --tsv`.
- Webpack 5, `mode: production`, `concatenateModules: true`, single chunk
  (`LimitChunkCountPlugin({ maxChunks: 1 })`), terser minified.

## Top byte contributors (parsed source, post-terser)

| Bytes  | File                                                           |
|------:|---------------------------------------------------------------|
| 53,571 | `container-runtime/src/containerRuntime.ts`                    |
| 29,810 | `container-loader/src/container.ts`                            |
| 28,059 | `tree/.../modular-schema/modularChangeFamily.ts`               |
| 25,177 | `merge-tree/src/mergeTree.ts`                                  |
| 24,956 | `map/src/directory.ts`                                         |
| 22,029 | `[no source]` (webpack runtime + minified vendor)              |
| 17,652 | `tree/.../shared-tree/treeCheckout.ts`                         |
| 17,000 | `container-runtime/src/channelCollection.ts`                   |
| 16,302 | `merge-tree/src/client.ts`                                     |
| 15,854 | `@tylerbu/sorted-btree-es6/b+tree.js`                          |
| 15,740 | `sequence/src/intervalCollection.ts`                           |
| 14,997 | `container-runtime/src/dataStoreContext.ts`                    |
| 14,636 | `container-loader/src/deltaManager.ts`                         |
| 13,408 | `container-loader/src/connectionManager.ts`                    |
| 13,057 | `container-runtime/.../runningSummarizer.ts` (already async chunk) |
| 11,460 | `container-runtime/src/gc/garbageCollection.ts`                |
| 10,589 | `tree/src/shared-tree-core/editManager.ts`                     |
|  9,030 | `tree/src/core/tree/anchorSet.ts`                              |
|  8,631 | `id-compressor/src/idCompressor.ts`                            |
|  8,126 | `tree/.../chunked-forest/basicChunk.ts`                        |
|  6,991 | `tree/.../sequence-field/utils.ts`                             |
|  6,858 | `@sinclair/typebox/.../extends-check.mjs`                      |
|  6,824 | `tree/.../optional-field/optionalField.ts`                     |
|  6,693 | `@tylerbu/sorted-btree-es6/extended/decompose.js`              |
|  6,027 | `tree/.../sequence-field/compose.ts`                           |

## Per-package roll-up (sum across all files in each package)

The top-files table only catches the largest individual files. Summing every
`source-map-explorer --tsv` line by package gives a very different — and more
accurate — picture of where bytes actually live:

| Bytes  | Package                                |
|------:|----------------------------------------|
| 315,422 | `dds/tree`                            |
| 235,027 | `runtime/container-runtime`           |
| 102,231 | `loader/container-loader`             |
|  92,732 | `dds/merge-tree`                      |
|  57,217 | `dds/map`                             |
|  40,005 | `dds/sequence`                        |
|  39,283 | `@sinclair/typebox`                   |
|  25,537 | `@tylerbu/sorted-btree-es6`           |
|  18,626 | `utils/telemetry-utils`               |
|  17,955 | `runtime/id-compressor`               |
|  10,528 | `dds/shared-object-base`              |
|  10,055 | `runtime/runtime-utils`               |
|   8,473 | `common/core-utils`                   |
|   ~50,000 | (everything else combined)          |

`dds/tree` is the **single largest package** in the bundle at ~315 KB — about
38% of total parsed bytes — and is bigger than `container-runtime`. Its bulk
is spread across many files (the top-25 view only catches ~5 of them), which
is why it was under-counted in the by-file table.

## Per-subdirectory breakdown inside `dds/tree`

Grouping every `dds/tree/src/<subdir>/*` file by its top two path levels:

| Bytes  | Area                                                |
|------:|-----------------------------------------------------|
| 38,388 | `feature-libraries/modular-schema` (the change family + codecs) |
| 31,436 | `feature-libraries/sequence-field` (compose/invert/rebase + utils) |
| 30,524 | `feature-libraries/chunked-forest`                  |
| 21,565 | `core/tree` (anchorSet, paths, deltas)              |
| 18,423 | `simple-tree/core`                                  |
| 17,652 | `shared-tree/treeCheckout.ts`                       |
| 14,596 | `simple-tree/node-kinds` (array, map, object, record) |
| 10,589 | `shared-tree-core/editManager.ts`                   |
|  8,650 | `feature-libraries/flex-tree`                       |
|  8,220 | `feature-libraries/optional-field`                  |
|  8,152 | `simple-tree/api`                                   |
|  7,189 | `shared-tree-core/sharedTreeCore.ts`                |
|  6,914 | `feature-libraries/object-forest`                   |
|  6,418 | `feature-libraries/forest-summary`                  |
|  5,933 | `feature-libraries/default-schema`                  |
|  5,137 | `core/rebase`                                       |
|  5,021 | `shared-tree/schematizingTreeView.ts`               |
|  4,989 | `feature-libraries/treeCursorUtils.ts`              |
|  4,797 | `shared-tree/sharedTree.ts`                         |
|  4,131 | `codec/versioned`                                   |
| (other < 4 KB)                                              |

Rolled up further:
- `feature-libraries/*`: **~104 KB** (modular-schema + sequence-field + chunked-forest + flex-tree + optional-field + object-forest + forest-summary + default-schema + cursor utils, etc.)
- `simple-tree/*`: **~42 KB**
- `shared-tree-core/*`: **~30 KB**
- `shared-tree/*`: **~30 KB**
- `core/*`: **~30 KB**
- `codec/*` + `util/*`: **~10 KB**

## Revised roll-up by domain

- **DDS tree (editing + core)**: **~315 KB** — single biggest, ~38% of bundle.
- Container/loader/runtime plumbing: ~360 KB combined (`container-runtime` + `container-loader` + `id-compressor` + `runtime-utils`).
- DDS merge-tree + sequence: ~133 KB.
- DDS map: ~57 KB.
- Vendor (typebox + sorted-btree + events): ~71 KB.

## Experiments tried

### 1. `defaultFieldKinds` lite split (pre-existing on branch)
- Idea: split `defaultFieldKinds.ts` (which imports `optional-field` and
  `sequence-field` change handlers as side effects) into `defaultFieldKindsLite.ts`
  (no editing-runtime imports) plus a patcher module, so schema-only consumers
  could tree-shake the editing runtime.
- Outcome on encapsulated scenario: **+262 bytes** (effectively no savings).
  Reason: `SharedTree.create` reaches `DefaultChangeFamily` synchronously, so
  `optional-field` / `sequence-field` are pulled in via `defaultEditBuilder.ts`
  regardless of the lite split.
- Outcome on a synthetic schema-only scenario (`SchemaFactory` + types only,
  no `SharedTree`): **−41,726 bytes parsed (−19.5%) / −11,469 gzip**. Matches
  the original commit's claimed ~40 KB savings.
- Conclusion: the optimization is real, but only payable by consumers who do
  not bundle `SharedTree` synchronously. **Reverted** in this branch because no
  such consumer exists in the surveyed app shape.

### 2. Lazy-load `SharedTree` at the consumer boundary
- Idea: replace `export { SharedTree }` with `export async function getSharedTree()`
  that does `await import("@fluidframework/tree/legacy")`, and remove
  `LimitChunkCountPlugin` so webpack can emit a separate chunk for the editing
  runtime.
- Expected outcome: ~40 KB out of the initial chunk, ~40 KB into a deferred
  chunk; total bytes unchanged but TTI improved.
- **Not measured / reverted** at user direction: the target consumer cannot
  benefit from async loading of `SharedTree`.

### 3. Inspecting `containerRuntime.ts` (54 KB) for delay-load surfaces
- The summarizer is **already** delay-loaded
  (`summary/summaryDelayLoadedModule/*`); `runningSummarizer.ts` shows up as a
  separate ~13 KB chunk, not in the initial bundle.
- All other large subsystems referenced from `containerRuntime.ts`
  (`GarbageCollector`, `BlobManager`, `Outbox`, `RemoteMessageProcessor`,
  `IdCompressor`) are eagerly instantiated and called on hot paths
  (`processMessages`, `nodeUpdated`, `setConnectionState`). Moving any of them
  behind a dynamic import would insert async boundaries into op processing —
  invasive, not a safe local change.
- No low-risk extract-and-lazy-load candidate identified inside this file.
  The 54 KB is product code on the critical path, not vestigial branches.

### 4. Inspecting `modularChangeFamily.ts` (28 KB)
- 3,229 lines of compose / invert / rebase implementations operating on
  `FieldChangeMap`. All lookups go through runtime
  `getFieldKind(this.fieldKinds, kind)` — `Map.get` calls that terser cannot
  statically resolve regardless of how the file is reshaped.
- Realistic byte savings would require monomorphizing the change family for a
  closed set of field kinds (architectural change to a core CRDT engine, with
  correctness, layer-compat, and persisted-format implications). Not a safe
  local change either.

## Conclusion

For a consumer with this surface (`SharedTree` + `Loader` + `SharedDirectory`
+ `SharedString`, all eagerly imported), most bytes are real product code on
hot paths. But `dds/tree` is materially larger than I initially estimated
(~315 KB, not ~120 KB), so it deserves more attention than the other big
packages.

### 5. TypeBox barrel-import shrink — MEASURED, **−25.7 KB / −2.5% parsed (−5.5 KB gzip)**
- Hypothesis: `import { Type } from "@sinclair/typebox"` defeats webpack
  tree-shaking. `Type` is built as `const Type = TypeBuilder` where
  `TypeBuilder = import * as TypeBuilder from "./type.mjs"` — a module-namespace
  object. Webpack's `usedExports` tracks imported symbols, not property accesses
  on them, so a single use of `Type.Object(...)` keeps the entire TypeBox
  builder tree alive (~39 KB before).
- Mechanical fix: for each tree file using `import { Type, ... }`, replace it
  with named imports of the specific kinds the file uses (`Object`, `String`,
  `Literal`, …) and reconstruct a local `const Type = { Object: _Object, … };`
  so call sites (`Type.Object(...)`) don't need to change. 35 files in
  `dds/tree/src` rewritten by an automated pass.
- Outcome:
  - Total bundle: **1,019,378 → 993,614 bytes** (−25,764 / −2.5% parsed).
  - Gzip:         **269,712 → 264,171** (−5,541 / −2.1%).
  - TypeBox alone: **39,283 → 12,679 bytes** (−26,604 / −68%).
- Why this works: each tree file now imports only the named kinds it uses
  (~3–10 per file instead of all 50+). The union across all 35 files is the
  ~19 kinds tree actually exercises. Modules that previously got pulled in
  transitively (`extends-check.mjs` 6.9 KB, `template-literal/parse.mjs`
  1.8 KB, `mapped/mapped.mjs`, `keyof/*`, `omit/omit.mjs`, `pick/pick.mjs`,
  `partial/partial.mjs`, `transform/transform.mjs`, `composite/composite.mjs`,
  …) are now properly dead and dropped by webpack.
- Risk: low. The rewrite is mechanical and idempotent; no semantic behavior
  changes; the local `Type` object preserves the call-site shape. Type errors
  caught by `tsc` (none after the rewrite). Best to verify with the full
  test suite before landing.
- Status: applied locally on this branch and validated.

### 6. `SchemaFactory.array` / `.map` prototype detach — MEASURED ceiling, **−11,044 / −2,830 gzip** (asymmetric users only)

- Hypothesis: `.array` and `.map` (and their recursive variants and private
  `namedArray`/`namedMap`) live on `SchemaFactory.prototype`. Even when a
  consumer's call sites are gone, the methods are still reachable values on
  the class and pin `arraySchema` / `mapSchema` and their respective
  `arrayNode.ts` (7,457 b) / `mapNode.ts` (2,126 b).
- Stub experiment: replaced `namedArray` / `namedMap` bodies with `throw`
  and dropped the `arraySchema` / `mapSchema` imports. Measured −11,044
  bytes parsed (−2,830 gzip) on top of the TypeBox win — `arrayNode.ts` and
  `mapNode.ts` drop to 0 bytes; `objectNode.ts` (4,514 b) is unchanged
  because its impl is still reached.
- **Hard constraint**: this saving is conditional on the consumer not using
  the method. If the consumer calls *any* of `factory.array` / `factory.map` /
  `factory.arrayRecursive` / `factory.mapRecursive`, the impl is pinned and
  the saving is **0 bytes**. The encapsulated scenario uses both, so it
  would see no benefit from the API change in practice.
- Status: stub reverted; not landed. Documented as upper bound for any
  consumer that uses one node kind but not another.

### 7. DCE audit on already-pinned files — **no opportunities found**

- Validated by symbol-presence search in the bundle:
  - `arrayNode.ts`: `createArrayInsertionAnchor`, `IterableTreeArrayContent`
    (the unused parts), `asIndex` already absent. Only call paths reachable
    from `arraySchema` survive.
  - `chunked-forest/*`: every file is reached via at least one runtime path
    (`objectForest` → `chunkField`/`defaultChunkPolicy`,
    `flex-tree/lazyField` → `combineChunks`, `forest-summary` →
    `chunkFieldSingle`). `ForestTypeOptimized` / `ForestTypeExpensiveDebug`
    are correctly tree-shaken away when the consumer doesn't import them.
  - `discrepancies.ts`: both exports reached via `SchemaCompatibilityTester`,
    which is constructed unconditionally during view init.
- Conclusion: terser already removes everything that isn't reachable. No
  classic "exported function nobody calls" patterns remain in tree's
  contribution to this consumer.

### 8. `ModularChangeFamily` private-method hoist — MEASURED, **−1,553 / −204 gzip**

- Idea: hoist all 39 `private` methods of `ModularChangeFamily` (which only
  read `this.fieldKinds`, never mutate instance state) into module-level
  functions taking the class as the first parameter. Compiled-form intuition
  was that prototype method definitions and `this.method()` call shapes are
  heavier than free-function calls after minification.
- Mechanical transform via `/tmp/hoist_private.mjs`: 39 methods hoisted,
  call sites in remaining public methods rewritten to `name(this, args)`.
- Outcome: bundle 993,614 → 992,061 (**−1,553 / −0.2% parsed**, −204 gzip).
  `modularChangeFamily.ts` attribution: 28,059 → 26,506 (−1,553).
- Net: well below the 2–4 KB I estimated. Not worth the churn (39-method
  refactor across a 3.2 K-line file, loss of `private` encapsulation, every
  former `this.foo()` becomes an explicit `foo(this, …)`) for ~200 B gzip.
- Status: stub reverted; not landed.

### 9. Top-level API split (transactions, branching, alpha methods) — MEASURED, **−4,702 / −1,172 gzip**

- Hypothesis: split optional `TreeCheckout` surface
  (`runTransaction[Async]`, `mountTransaction`, `unmountTransaction`,
  `fork`, `merge`, `rebase`, `rebaseOnto`, `switchBranch`,
  `pushLabelFrame`, `popLabelFrame`, `runWithTransactionLabel`,
  `currentLabelNode`, `applyChange`, `applySerializedChange`,
  `exportVerbose`, `getRemovedRoots`, `addConstraintsToTransaction`,
  `assertValidConstraint`) out of `treeCheckout.ts` into a separate
  entrypoint that this consumer wouldn't import.
- Stub experiment: bodies replaced with `throw`, signatures preserved.
- Outcome: bundle 993,614 → 988,912 (**−4,702 / −0.5% parsed**, −1,172 gzip).
  `treeCheckout.ts` attribution: 17,652 → 13,331 (−4,321);
  `simple-tree/api/customTree.ts`: 660 → 295 (−365).
  Almost all savings are in the method bodies themselves; no significant
  cascading DCE (the underlying `SquashingTransactionStack`, branch-fork
  logic, kernel constraint helpers stay pinned by other reachable paths).
- Cost to land: new public-API entrypoint
  (e.g. `@fluidframework/tree/legacy/branching`), refactor of 18+ methods
  into module-level functions with explicit-checkout-arg signatures,
  consumer-side codemod or compatibility shims. Significant API design
  work for ~5 KB / ~1.2 KB gzip.
- Status: stub reverted; not landed.

### Larger / harder paths

10. **API change at the consumer**: dynamic-import `SharedTree` (and possibly
    `SharedString`) so the editing runtime / merge-tree leaves the initial chunk.
    ~40 KB out of the initial bundle for `SharedTree` alone. Ruled out for the
    target consumer in this experiment.
11. **Drop unused features**: e.g. don't re-export `SharedString` /
    `IntervalCollection` if not needed (~16 KB just for `intervalCollection.ts`),
    or `SharedDirectory` if `SharedMap` would suffice. Consumer-side decision.
12. **Architectural refactors**: closed-kind-set `ModularChangeFamily`
    (~38 KB area), or making GC / BlobManager / Outbox lazy in
    `containerRuntime`. Research-grade; not a session task.
13. **Per-package incremental cleanups** scattered across many files.
    Diminishing returns.

## Side-effects audit in `@fluidframework/tree`

The package declares `"sideEffects": false` in
[packages/dds/tree/package.json](../../../../packages/dds/tree/package.json),
so webpack is allowed to drop unused modules wholesale. Symbol-presence
checks in this consumer's bundle confirm tree-shaking at the import-graph
level is working correctly: `TableSchema`, `SchemaFactoryBeta`,
`ForestTypeOptimized`, `ForestTypeExpensiveDebug`, `adaptEnum`,
`enumFromStrings`, `singletonSchema`, `JsonAsTree`,
`FluidSerializableAsTree`, etc. are all absent from the bundle when not
imported for value.

That said, several files contain module-evaluation side effects — code
that runs the moment the module is imported for value. Inventoried below.

### Module-level statements with side effects

| Side effect | File | Bundle cost (this scenario) |
|---|---|---|
| `formatters.push(nodeFormatter)` (browser devtools custom formatter for `TreeNode`) | [packages/dds/tree/src/simple-tree/core/treeNodeValid.ts](../../../../packages/dds/tree/src/simple-tree/core/treeNodeValid.ts) (line ~383) | **−414 B parsed / −193 B gzip** if removed (measured) |
| `Object.defineProperty(TreeNodeValid.prototype, customInspectSymbol, …)` (Node `util.inspect` integration) | same file (line ~324) | tens of bytes |
| `markEager(TreeNode)` | [packages/dds/tree/src/simple-tree/core/treeNode.ts](../../../../packages/dds/tree/src/simple-tree/core/treeNode.ts#L142) | tens of bytes |
| `Object.freeze(identifier)` (TreeAlpha singleton freeze) | [packages/dds/tree/src/shared-tree/treeAlpha.ts](../../../../packages/dds/tree/src/shared-tree/treeAlpha.ts#L130) | tens of bytes |
| `(optional/required/sequence as any).changeHandler = …` — patches the real CRDT change handlers onto the lite field-kind singletons at import time | [packages/dds/tree/src/feature-libraries/default-schema/defaultFieldKinds.ts](../../../../packages/dds/tree/src/feature-libraries/default-schema/defaultFieldKinds.ts) (lines 41–46) | **Major** — pins `optional-field` + `sequence-field` (~21 KB combined) for any consumer that imports value-level from `default-schema/defaultFieldKinds.js`. Already documented as Experiment #1; doesn't help `SharedTree`-using consumers. |

Three `static {}` blocks expose private constructors via friend-pattern
hooks (they assign a closure to a module-level variable when the class
is referenced):

- [packages/dds/tree/src/simple-tree/core/allowedTypes.ts](../../../../packages/dds/tree/src/simple-tree/core/allowedTypes.ts#L437) — `SchemaUpgrade`
- [packages/dds/tree/src/simple-tree/fieldSchema.ts](../../../../packages/dds/tree/src/simple-tree/fieldSchema.ts#L425) — `FieldSchemaAlpha`
- [packages/dds/tree/src/simple-tree/node-kinds/array/arrayNode.ts](../../../../packages/dds/tree/src/simple-tree/node-kinds/array/arrayNode.ts#L509) — `IterableTreeArrayContent`

These run when the class is referenced. Negligible bundle cost.

### Latent side-effect hazards (not currently triggered in this scenario)

These files **do** instantiate schemas at module top level. `sideEffects: false`
keeps them out of this consumer's bundle, but a consumer importing
*anything* value-level from them — even a type that webpack can't prove is
type-only — would cascade-pin substantial schema infrastructure
(`SchemaFactoryAlpha` / `SchemaFactoryBeta` constructor, `recordRecursive`,
`arrayRecursive`, leaf schemas, etc.).

| File | Module-level construction |
|---|---|
| [packages/dds/tree/src/jsonDomainSchema.ts](../../../../packages/dds/tree/src/jsonDomainSchema.ts) | `const sf = new SchemaFactoryAlpha("com.fluidframework.json")` then `sf.recordRecursive(...)` and `sf.arrayRecursive(...)` for `JsonObject`, `JsonArray` |
| [packages/dds/tree/src/serializableDomainSchema.ts](../../../../packages/dds/tree/src/serializableDomainSchema.ts) | `const sf = new SchemaFactoryBeta("com.fluidframework.serializable")` plus the equivalent `FluidSerializableAsTree.*` schema declarations |

Verified absent from this consumer's bundle (no `com.fluidframework.json`,
no `JsonAsTree`, no `FluidSerializableAsTree` strings present). The
`arrayRecursive` symbol that does appear is `SchemaFactory.prototype.arrayRecursive`,
not these uses. So **`sideEffects: false` is doing its job here**, but
these files would become a multi-KB pin for any consumer that imported
value-level from them.

By contrast,
[packages/dds/tree/src/tableSchema.ts](../../../../packages/dds/tree/src/tableSchema.ts)
**does not** have this hazard: its `TableSchema` namespace exposes
*functions* (`createColumn`, `createRow`, `createTable`), and schemas are
only constructed when those functions are called by a consumer. No
module-level instantiation.

### Net assessment

For this consumer:

- Tree-shaking is working as intended at the module-import-graph level —
  `sideEffects: false` correctly lets webpack drop unimported modules,
  including the latent hazards (`JsonAsTree`, `FluidSerializableAsTree`).
- The only side-effect-related preventer of additional tree-shaking is
  the **default-field-kinds patcher**, which is structural for any
  `SharedTree`-using consumer (they need the editing runtime regardless)
  and was already addressed for non-`SharedTree` consumers via the lite
  split (Experiment #1).
- Smaller side-effects (devtools formatter, `markEager`, `Object.freeze`,
  `customInspectSymbol`) sum to under 1 KB. Removable but not
  consequential.

For other consumers:

- Imports from `JsonAsTree` or `FluidSerializableAsTree` (or any module
  that re-exports them as values) would defeat tree-shaking and pull in
  the full `SchemaFactoryAlpha`/`SchemaFactoryBeta` + recursive node-kind
  stack. Worth flagging if those entrypoints are intended for narrow
  consumer use.



| Change                                                         | Parsed   | Gzip    | Status    |
|----------------------------------------------------------------|---------:|--------:|-----------|
| TypeBox barrel-import rewrite (#5)                             | −25,764  | −5,541  | **Landed** in `f39c28c357` |
| `SchemaFactory.array/.map` detach — asymmetric users only (#6) | −11,044  | −2,830  | Conditional ceiling; 0 for symmetric users |
| `ModularChangeFamily` private-method hoist (#8)                |  −1,553  |   −204  | Not worth churn |
| Top-level checkout-API split (#9)                              |  −4,702  | −1,172  | Significant API work for modest gain |
| **Realistic ceiling beyond TypeBox for this consumer**         | **~5 KB** | **~1.2 KB** | After meaningful refactor |

The TypeBox win remains the only large, broadly-applicable, low-risk lever.
Further bundle-size work in tree faces structural limits: the runtime is
highly cohesive (op send/receive, rebase/compose/invert, view init, schema
compatibility checking all pull in overlapping infrastructure), and the
remaining engine subdirs (modular-schema, sequence-field, chunked-forest)
host genuinely reachable change-family logic, not vestigial code.

## Per-API import-chain analysis

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

### Findings beyond the rollup tables above

1. **`treeCheckout.js` is the gatekeeper of 86 % of `SharedTree`'s reach.**
   Σ 260,281 / 304,143 B flows through this single module (own size only
   17,652 B). Three roughly-equal pillars hang directly off it:
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
   **zero bytes** in this scenario. Useful to know because it's a tempting
   surface-area target ("does the consumer really need a config object?")
   but the chain proves it's pure ceremony over already-pinned
   infrastructure.

3. **`SchemaFactory.array`/`map`/`record` is the only `SchemaFactory`-unique
   block.** SchemaFactory's 12,689 B unique is dominated by
   `simple-tree/node-kinds/array/arrayNode.js` (Σ 31,430 B reach, of which
   most is shared with SharedTree; the truly-unique part is `arrayNode.js`
   itself plus its custom-tree paths). `objectNode` is reached
   *independently* by SharedTree via `schematizingTreeView →
   objectNode.js` (Σ 22,448 B), so even an "object-only" consumer that
   detached `array`/`map` from `SchemaFactory` would still pay for
   `objectNode`. This sharpens Experiment #6's "asymmetric users only"
   constraint: the detach optimization can never reach `objectNode`.

4. **`sharedTreeCore` is a sibling of `treeCheckout`, not nested under it.**
   Σ 29,785 B (incl. `editManager` 11,076 B) hangs directly off
   `sharedTree.js`. Any SharedTree consumer always pulls the op-pipeline
   subsystem in parallel with the editing checkout — they're independent
   reachable subgraphs, so a consumer cannot get one without the other.

5. **`schemaCompatibilityTester` (Σ 4,544 B) is on the SharedTree path.**
   Reached unconditionally during view init via `schematizingTreeView →
   schemaCompatibilityTester` (it is constructed in
   `SchematizingSimpleTreeView`'s constructor and called from `update()`
   on every stored-schema change). Candidate for "defer to first edit /
   compatibility check" if a consumer is willing to skip the open-time
   check. Hook is a single subtree under one module.

6. **`chunked-forest/codec` (Σ 14,147 B) is reached SharedTree-direct, not
   via `objectForest`.** The findings rollup lumps
   `feature-libraries/chunked-forest` at 30,524 B; the chain shows roughly
   half of that is the op-wire codec path (`codecs.js`, `schemaBasedEncode`,
   `chunkDecoding`) hanging straight off `sharedTree.js`. Distinct
   logical responsibility (wire format vs in-memory representation) within
   the same directory; potentially separable.

7. **`defaultFieldKindsLite.js` is the central crossroads.** Appears as
   `(see above)` in roughly two dozen branches across all three APIs (read
   path, write path, schema path, simple-tree layer). Explains why
   Experiment #1's lite split saved ~40 KB on schema-only consumers but
   nothing on `SharedTree` consumers: every reachable subtree converges on
   it.

### New architectural lever surfaced

The findings doc previously concluded "the realistic ceiling is ~5 KB
beyond the TypeBox win" for **local refactors**. The chain analysis
exposes one architectural lever the per-file rollup did not:

- **Split `treeCheckout` into a read-only checkout + an editing-checkout
  extension**, with `defaultEditBuilder` only reachable from the latter.
  That is a ~70 KB block (the entire write pillar) on a single conditional
  import boundary, rather than dispersed across many files. Real
  architectural change (not a local refactor — `TreeCheckout` exposes
  `editor`, `transaction`, `applyChange`, etc. directly), but it is a
  cleanly-described one because it lives at exactly one node in the
  import tree. Realistic only for consumers who hold `SharedTree` for
  read access (e.g. derived views, observers) without performing local
  edits.

## Feature boundaries inside `treeCheckout` (read+write consumers)

Assuming every consumer reads *and* writes (so the read/write split above
is not on the table), `treeCheckout.ts` still contains several distinct
optional features layered on top of basic edit + commit. Each is bounded
to a small set of methods/state on `TreeCheckout` and a corresponding
import edge that pins additional infrastructure.

The numbers below are **structural estimates** derived from method bodies
and the chain analysis (file sizes from `analyzeTreeReasons.ts`); precise
parsed-byte savings would require stub-and-measure passes (Experiment #6
/ #9 methodology). Where a feature's main cost is the file it pulls in,
the size is firm; where it's interleaved with required code in the same
module, the estimate is loose.

`treeCheckout.js` itself is **17,652 B** of own bytes. Roughly half of
that is the eight features below; the other half is the basic
edit/commit/load pipeline that every consumer needs (`editor` getter,
`onAfterChange`, `applyInternalChange`, `viewWith`, `dispose`, `load`,
`registerForBranchEvents`, `validateCommit`, `applyValidator`).

### F1 — Branching (fork / merge / rebaseOnto / switchBranch / mainBranch)

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
  (Revertibles)** below — see "shared bottom".
- **Customer impact:** Apps that don't fork the tree (single-branch
  collab, server-authoritative editors).

### F2 — Revertibles (undo/redo)

- **In `treeCheckout.ts`:** `createRevertible()`, `revertRevertible()`,
  `purgeRevertibles()`, `disposeRevertible()`, the `revertibles` set, the
  `revertibleCommitBranches` map, the entire `getRevertible` lambda inside
  `onAfterBranchChange`, the metadata `getChange` lambda (only used to
  build revertibles' serialized payloads, although also exposed on
  `metadata.getChange` for raw-change consumers — see F6).
- **Pinned imports:** `RevertibleAlpha`, `RevertibleAlphaFactory`,
  `RevertibleStatus` types from `core/index.js`; `rebaseChange` and
  `tagChange`/`makeAnonChange` from `core/rebase` (revert path);
  `SharedTreeBranch.fork()` (per-revertible commit branches —
  **co-pinning F1's main external dependency**), `isAncestor`.
- **Estimated cost:** ~3 KB own in this file (the lambdas, the two
  collections, `revertRevertible`'s ~60-line body) plus the shared bottom
  with F1 (`shared-tree-core/branch.js` 2,747 B, fork/merge logic on
  `SharedTreeBranch`).
- **Customer impact:** Apps with no undo or app-layer undo (CRDT-style
  reconciliation, time-travel via document snapshots, etc.). Many
  authoring scenarios *do* want undo.
- **Co-pinning note:** removing F1 alone or F2 alone leaves
  `SharedTreeBranch.fork` reachable from the other. Removing **both**
  drops the entire branch fork/merge surface in `shared-tree-core/branch.js`
  — an estimated **~2.5 KB** that is otherwise unreachable for a
  single-branch, no-undo consumer.

### F3 — Transactions (the public surface)

- **In `treeCheckout.ts`:** `runTransaction()` (3 overloads),
  `runTransactionAsync()` (3 overloads, ~70 lines), `transaction` getter,
  private `mountTransaction()`, private `unmountTransaction()`, the
  `transaction` parameter handling in callers.
- **Pinned imports:** `Transactor` interface; the entire
  `SquashingTransactionStack` machinery from `shared-tree-core` is **also
  pinned by the constructor** (`createTransactionStack` is unconditional),
  so removing only the public methods does not drop the stack — *unless*
  the constructor is also rewired to use a non-squashing branch wrapper.
- **Estimated cost:** ~2–3 KB own bytes for the public method bodies and
  parameter parsing; **the underlying `SquashingTransactionStack` (~3 KB
  in `shared-tree-core/transaction.js`) is structural infrastructure**
  and would only drop if the constructor is replaced too.
- **Customer impact:** Apps that always do single-edit operations don't
  need transaction wrappers. But losing transactions affects atomicity
  semantics, so this is a deliberate API decision, not just a tree-shake.

### F4 — Async transactions (subset of F3)

- **In `treeCheckout.ts`:** the three `runTransactionAsync` overloads and
  their ~70-line implementation (lines 867–908), plus the breaker.break
  handling for nested-async errors.
- **Pinned imports:** none specific (uses the same `Transactor` as
  sync). Pure code in this file.
- **Estimated cost:** ~1 KB own, no transitive cost. The cheapest local
  win in this list. Consumers who don't need cross-await transactions
  can drop the async overloads.
- **Customer impact:** Sync transactions remain available. Loses only the
  ability to await inside a transaction body.

### F5 — Transaction labels (telemetry)

- **In `treeCheckout.ts`:** `pushLabelFrame()`, `popLabelFrame()`,
  `runWithTransactionLabel()`, private `currentLabelNode()`,
  `buildLabelsSet()`, generator `collectTreeLabels()`,
  `labelTreeNode` / `mostRecentlyClosedLabelNode` state, the
  `metadata.label` / `metadata.labels` fields populated in
  `onAfterBranchChange`.
- **Pinned imports:** `LabelTree` and `TransactionLabels` types from
  `core/index.js` (type-only, 0 B).
- **Estimated cost:** ~1.5 KB own bytes, **no transitive cost**. Pure
  diagnostic plumbing.
- **Customer impact:** Apps that don't consume telemetry-side labels
  emitted on `changed` events.

### F6 — Raw change application & encoding (alpha)

- **In `treeCheckout.ts`:** `applyChange()`, `applySerializedChange()`,
  `isSerializedChange()` (file-level), `SerializedChange` interface,
  the `metadata.getChange` lambda inside `onAfterBranchChange` (encoder
  side), the codec round-trip via `changeFamily.codecs.resolve(4)`.
- **Pinned imports:** the **codec V4 of `SharedTreeChangeFamily`** is
  reached via this path (encode in `getChange`, decode in
  `applySerializedChange`). Other codec versions (V1–V3, V5+) are reached
  via summaries / op pipeline regardless, so V4 is the only version
  uniquely pinned by this feature.
- **Estimated cost:** ~1.5 KB own (the methods + `isSerializedChange` +
  `SerializedChange`); transitive depends on whether V4-only encode/decode
  uniquely pins format files (likely <1 KB after dedup with the op-codec
  path).
- **Customer impact:** Only consumers that wire SharedTree → SharedTree
  replication of raw changes outside of the standard op pipeline (rare).

### F7 — Constraints

- **At file scope (`treeCheckout.ts`):** exported helpers
  `addConstraintsToTransaction()`, `assertValidConstraint()`. Both walk a
  `TransactionConstraintAlpha` and call into the editor.
- **Pinned imports:** the constraint surface on `ISharedTreeEditor`
  (`addNodeExistsConstraint`, `addNodeExistsConstraintOnRevert`,
  `addNoChangeConstraint`, `addNoChangeConstraintOnRevert`) and their
  modular-schema implementations.
- **Estimated cost:** ~0.5 KB own; the editor-side constraint methods
  add a couple hundred bytes more. Modest.
- **Customer impact:** Apps using transactions without precondition
  checks. Constraints are always-optional from the API standpoint.

### F8 — Diagnostic exports (debug / consistency)

- **In `treeCheckout.ts`:** `exportVerbose()`, `getRemovedRoots()`,
  `assertNoUntrackedRoots()`, the file-scope `verboseFromCursor()`
  helper (~25 lines).
- **Pinned imports:** `verboseFromCursor` calls
  `customFromCursorStored` from `simple-tree/api/customTree.js` (own
  **660 B**, plus the four node-kind type-id files
  `*NodeTypes.js` ≈ 60 B each). `jsonableTreeFromCursor` from
  `feature-libraries`. These are uniquely pinned by F8 in this scenario.
- **Estimated cost:** ~1.5 KB own (methods + `verboseFromCursor` helper)
  + ~1 KB transitive (`customTree.js` + node-kind type-id files only
  reachable here in this scenario).
- **Customer impact:** Tests and tools. Production consumers don't need
  `exportVerbose` (debug snapshot) or `getRemovedRoots` (consistency
  comparison).

### F9 — `SharedTreeChangeEnricher` (NOT actually optional)

- **In `treeCheckout.ts`:** `onCommitValid()`, `validateCommit()`,
  `enrich()`, `resetEnrichmentStats()`, `getEnrichmentStats()`,
  `enrichmentStats` field, `applyValidator` getter.
- **Pinned imports:** `SharedTreeChangeEnricher` (sibling file,
  **1,233 B own / Σ 1,233 B**).
- **Customer impact:** **None — this is required.** `enrich` and
  `onCommitValid` are called by `SharedTree`'s outbox path on every
  outgoing commit. Not a feature boundary for read+write consumers;
  listed here only to rule it out.

### Summary table

| Feature | Own B (est.) | Transitive uniquely pinned | Co-pinning |
|---|---:|---:|---|
| F1 Branching (fork/merge/rebaseOnto/switchBranch) | ~3,500 | + ~1,500 (only with F2 also gone) | shares branch.js with F2 |
| F2 Revertibles | ~3,000 | + ~1,000 (only with F1 also gone) | shares branch.js with F1 |
| F1 + F2 combined drop | ~6,500 | **~2,500** (`shared-tree-core/branch.js`) | — |
| F3 Transaction public API | ~2,500 | 0 unless constructor rewired | F4 nested |
| F4 Async transactions | ~1,000 | 0 | nested in F3 |
| F5 Transaction labels | ~1,500 | 0 | — |
| F6 Raw change apply | ~1,500 | <1,000 (codec V4 unique surface) | — |
| F7 Constraints | ~500 | ~300 (editor constraint methods) | F3 dependency only |
| F8 Diagnostic exports | ~1,500 | ~800 (`customTree.js` + type-ids) | — |
| F9 Change enricher | (required) | (required) | — |

**Total upper-bound for read+write consumers who drop F1+F2+F4+F5+F6+F7+F8:
roughly 15–20 KB parsed.** That is a meaningful number — comparable to
the conditional `array`/`map` ceiling (Experiment #6) and roughly 4× the
landed top-level checkout-API split (Experiment #9).

### How to realize this

Two paths, in increasing order of API churn:

1. **Module-level helper extraction** for F5, F6, F7, F8: convert the
   instance methods to free functions that take `TreeCheckout` as an
   explicit argument (similar to how `addConstraintsToTransaction` is
   already a free function). Move them to `treeCheckoutAdvanced.ts` or
   similar. Consumers who don't import the new module never pay for
   them. **Risk: low.** No public-API renames; alpha methods become
   alpha free functions. Cumulative estimate: **~5–8 KB**.

2. **Subclass split for F1 + F2** (branching + revertibles): introduce
   `BranchingTreeCheckout extends TreeCheckout` that adds the fork /
   merge / rebaseOnto / revertible APIs, and have `createTreeCheckout`
   pick the subclass based on a feature-flag arg. Public-API impact:
   `TreeView.fork()`, `TreeBranchAlpha`, the `getRevertible` callback —
   need shimming or signature changes. **Risk: medium.** Cumulative
   estimate (combined with path 1): **~10–15 KB.**

These are structural estimates. Validating any of them follows the
Experiment #6 / #9 pattern: stub the method bodies with `throw new
Error("…")`, drop the imports they uniquely pull, rerun
`collect:compare:bundles`, and confirm the parsed-byte delta.


## Non-tree wins (low-risk, package-level)

Outside `@fluidframework/tree`, the highest-leverage low-risk savings
are confined to **utility/polyfill swaps in two or three files**. All
sizes below are parsed bundle bytes (post-terser), measured against the
current branch HEAD bundle (993,352 B total).

### Tier 1 — polyfill / micro-dep removals (~14.5 KB combined, ~1.5%)

| # | Change | Bytes saved | Files touched | Risk |
|---|---|---:|---|---|
| N1 | Replace `events` polyfill in [packages/common/client-utils/src/eventEmitter.cts](../../../../packages/common/client-utils/src/eventEmitter.cts) with a ~50-line in-tree `EventEmitter` matching the Node API surface (`on`/`off`/`emit`/`once`/`removeListener`/`removeAllListeners`/`listenerCount`). The file is already a single-line re-export of `events_pkg` and carries the TODO `AB#7377 Provide Fluid EventEmitter using support in packages/dds/tree/src/events`. ~40 `TypedEventEmitter` consumers sit on top of this re-export and are unaffected. | ~6,000 | 1 source file + `package.json` dep removal | Low — pure utility, fully covered by existing `TypedEventEmitter` tests |
| N2 | Replace `path-browserify` in [packages/dds/map/src/directory.ts](../../../../packages/dds/map/src/directory.ts) with ~20 lines of inline posix string helpers. Only `posix.sep`, `posix.join`, `posix.resolve` are used (~6 call sites). | ~4,100 | 1 file | Low — narrow API surface, easy parity test |
| N3 | Replace `double-ended-queue` in [packages/runtime/container-runtime/src/pendingStateManager.ts](../../../../packages/runtime/container-runtime/src/pendingStateManager.ts) and [packages/loader/container-loader/src/deltaQueue.ts](../../../../packages/loader/container-loader/src/deltaQueue.ts) with a small array-backed `Deque<T>` (~40 lines, amortised O(1) shift via head index). `dds/sequence` and `dds/matrix` use it too — same swap. | ~3,100 | 2 production files (+ shared helper) | Low |
| N4 | Replace `base64-js` in [packages/common/client-utils/src/bufferBrowser.ts](../../../../packages/common/client-utils/src/bufferBrowser.ts) and [packages/common/client-utils/src/hashFileBrowser.ts](../../../../packages/common/client-utils/src/hashFileBrowser.ts) with `btoa`/`atob` plus the standard 8-line `Uint8Array`⇄base64 helpers via `globalThis`. | ~1,300 | 2 files (browser-only path) | Low — files are already browser-conditional |

### Tier 2 — small but worth a follow-up (~2 KB)

| # | Change | Bytes saved | Notes |
|---|---|---:|---|
| N5 | Inline a 15-line `compareVersions(a, b)` in [packages/runtime/runtime-utils/src/compatibilityBase.ts](../../../../packages/runtime/runtime-utils/src/compatibilityBase.ts) and [packages/runtime/container-runtime/src/summary/documentSchema.ts](../../../../packages/runtime/container-runtime/src/summary/documentSchema.ts) for the runtime-side compat checks; **don't** remove `semver-ts` repo-wide (tree uses it more heavily). | ~2,200 | Runtime-side only |

### Tier 3 — structural, **not** low-risk

| # | Change | Approx. cost in bundle | Why it's not low-risk |
|---|---|---:|---|
| N6 | Remove `debug` from the default `Loader` import path. Pulled in via [packages/loader/container-loader/src/debugLogger.ts](../../../../packages/loader/container-loader/src/debugLogger.ts) (`import debugPkg from "debug"`), which is re-exported through `Loader` itself ([loader.ts](../../../../packages/loader/container-loader/src/loader.ts)) and `createAndLoadContainerUtils.ts`. Total cost in the bundle ≈ 4.7 KB (`debug/src/browser.js` 2,632 B + `ms` 1,402 B + remainder). | ~4,700 | `DebugLogger` is part of the loader's public/legacy surface and `debug`'s namespace pattern (`localStorage.debug = "fluid:*"`) is a documented diagnostic for partner teams. Mitigation: split `DebugLogger` into a separate entry point so the default `Loader` doesn't drag it in; preserves diagnostic for users who explicitly import it. |
| N7 | Make `dds/sequence` truly tree-shakeable from `Marker` / `ReferenceType` / `refGetTileLabels`. The scenario entry exports only those three small symbols, yet drags in the entire `merge-tree` (~92.7 KB) + `sequence` (~40 KB) packages. The fix is to ensure the modules that **declare** those names are leaf-y: no top-level imports of `Client` / `MergeTree` / `PartialSequenceLengths`. | up to ~130 KB (theoretical ceiling; real win likely much smaller due to internal coupling) | Re-export-shape change in `dds/merge-tree/src/index.ts` and the `Marker`-declaring module; needs an `analyzeTreeReasons`-style audit rooted at the `merge-tree` barrel to bound the actual achievable savings. Risk: **medium-to-high**; requires per-symbol audit and likely `package.json`-level `exports` granularity. |

### Hard pass — central plumbing

The largest individual contributors after tree are not amenable to
package-level wins:

- `containerRuntime.ts` 53.6 KB
- `container.ts` 29.8 KB
- `channelCollection.ts` 17.0 KB
- `dataStoreContext.ts` 15.0 KB
- `deltaManager.ts` 14.6 KB
- `connectionManager.ts` 13.4 KB

The summarizer cluster (`runningSummarizer.ts` 13.1 KB,
`summaryGenerator.ts` 5.8 KB, `summaryManager.ts` 6.3 KB,
`summaryDelayLoadedModule/summarizer.ts` 5.2 KB; ~42 KB total) is
**already factored** as `summaryDelayLoadedModule/*` for code-splitting,
but the scenario uses `LimitChunkCountPlugin({ maxChunks: 1 })` so it
ends up in the initial chunk. A scenario-level change (drop the plugin
and accept two chunks) would shed ~42 KB from the initial chunk — but
that's a **scenario tweak**, not a package change, and only meaningful
if the consumer can actually load a second chunk.

### Per-package totals (informational)

| Source | Parsed bytes | Share |
|---|---:|---:|
| `packages/dds/tree` | 316,570 | 31.9% |
| `packages/runtime/container-runtime` | 234,905 | 23.6% |
| `packages/loader/container-loader` | 102,231 | 10.3% |
| `packages/dds/merge-tree` | 92,732 | 9.3% |
| `packages/dds/sequence` | 40,005 | 4.0% |
| `packages/dds/map` | 35,188 | 3.5% |
| `npm:@tylerbu/sorted-btree-es6` | 25,537 | 2.6% |
| `[no source]` (terser-injected runtime) | 21,079 | 2.1% |
| `packages/utils/telemetry-utils` | 18,626 | 1.9% |
| `packages/runtime/id-compressor` | 17,952 | 1.8% |
| `npm:@sinclair/typebox` | 12,580 | 1.3% |
| `packages/dds/shared-object-base` | 10,528 | 1.1% |
| `packages/runtime/runtime-utils` | 10,055 | 1.0% |
| `packages/common/core-utils` | 8,473 | 0.9% |
| `npm:events` | 5,996 | 0.6% |
| `packages/loader/driver-utils` | 4,761 | 0.5% |
| `npm:lz4js` | 4,672 | 0.5% |
| `npm:debug` (+ `ms`) | 4,669 + 1,402 | 0.6% |
| `npm:path-browserify` | 4,112 | 0.4% |
| `packages/common/client-utils` | 3,692 | 0.4% |
| `packages/framework/aqueduct` | 3,391 | 0.3% |
| `npm:double-ended-queue` | 3,087 | 0.3% |
| `npm:semver-ts` | 2,217 | 0.2% |
| `npm:base64-js` | 1,272 | 0.1% |


## Reproducing

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
