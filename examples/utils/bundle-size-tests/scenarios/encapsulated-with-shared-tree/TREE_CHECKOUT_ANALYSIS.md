# `treeCheckout` dependency analysis

Companion to [BUNDLE_SIZE_FINDINGS.md](BUNDLE_SIZE_FINDINGS.md). The
top-level findings doc identifies `treeCheckout.js` as the gatekeeper for
~260 KB / 86 % of `SharedTree`'s reach. This file walks each terminal or
cutoff node in the
[`tree-reasons-encapsulated-with-shared-tree-treeCheckout.md`](../../bundleAnalysis/tree-reasons-encapsulated-with-shared-tree-treeCheckout.md)
import-chain tree and answers, for each one:

- **What it does** — primary responsibility.
- **Why it is big** — concrete shape of the code.
- **When it runs in a typical SharedTree session** — load, view init,
  every edit, only on transactions, only on summary, etc.
- **Optional?** — whether the typical/default consumer can avoid it.

The tree is reproduced here for reference (own B / Σ subtree B):

```
treeCheckout.js                                            17,652 / 260,019
├── object-forest/objectForest.js                           6,914 / 120,394
│   ├── default-schema/defaultFieldKinds.js                 1,284 /  55,951
│   │   ├── sequence-field/sequenceKind.js                     94 /  31,771
│   │   │   └── sequence-field/sequenceFieldChangeHandler.js  131 /  31,677
│   │   │       └── sequence-field/sequenceFieldChangeRebaser  82 /  15,051  [+6 cutoff 22,188]
│   │   ├── optional-field/optionalField.js                 6,824 /  14,985  [+9 cutoff 11,010]
│   ├── chunked-forest/chunkTree.js                         2,198 /  20,129  [+9 cutoff 20,529]
│   ├── core/tree/visitorUtils.js                           1,047 /  14,538  [+3 cutoff 13,658]
│   └── core/tree/anchorSet.js                              9,030 /  12,246  [+7 cutoff  3,568]
├── shared-tree/schematizingTreeView.js                     5,021 /  38,685
│   └── simple-tree/node-kinds/object/objectNode.js         4,518 /  22,448
│       ├── simple-tree/core/treeNodeKernel.js              5,401 /  20,553  [+6 cutoff 17,138]
│       └── simple-tree/toStoredSchema.js                   3,764 /  12,887  [+9 cutoff 14,352]
├── default-schema/defaultEditBuilder.js                    3,554 /  31,759
│   └── modular-schema/modularChangeFamily.js              28,059 /  28,205  [terminal]
└── chunked-forest/codec/codecs.js                            710 /  14,147  [+8 cutoff 18,734]
```

---

## Read pillar — under `objectForest.js`

### `object-forest/objectForest.js` (~1,600 lines · 6,914 B own / Σ 120,394 B)

**What.** Reference implementation of `IEditableForest` — the in-memory
tree storage. Holds nodes as plain JS `MapTree` objects. Provides cursor
allocation, delta visitors, and field editing.

**Why big.** Big class with cursor lifecycle + state tracking, delta
visitor with pre-edit validation, schema-aware field operations,
path-based navigation. Not heavily optimized — file comment says
"This implementation focuses on correctness and simplicity, not
performance."

**When.** **Always.** Constructed for every `SharedTree` because
`ForestTypeReference` is the default in `defaultSharedTreeOptions`
(see [`sharedTree.ts`](../../../../packages/dds/tree/src/shared-tree/sharedTree.ts)).
Touched on every edit and remote op (delta application).

**Optional?** No — it *is* the default forest. `ForestTypeOptimized` is
an alternative, not an addition; switching forest types swaps which
implementation file is reachable, but the byte cost is comparable.

### `default-schema/defaultFieldKinds.js` (~200 lines · 1,284 B own / Σ 55,951 B)

**What.** Declares the five built-in field kinds — `required`,
`optional`, `sequence`, `identifier`, `forbidden` — by gluing each
kind's change handler + codec config into a `FlexFieldKind`. Also
exports the `fieldKinds` map and per-format-version configuration
tables (v3, v4, v5).

**Why big in transitive reach.** The file itself is small, but it
**imports every field kind's handler module** at top level
(see commit history around the "lite split"). Through the `sequence`
kind alone it pulls 31 KB of rebaser/compose/invert/codec code.
Section §5 of the findings doc flagged this as a side-effect-pinning
hazard.

**When.** Module load. Field kinds are looked up by id whenever a
modular changeset is composed, applied, or encoded.

**Optional?** No — every CRDT operation goes through field-kind
dispatch.

### `sequence-field/sequenceKind.js` (40 lines · 94 B own / Σ 31,771 B)

**What.** One-liner that wraps `sequenceFieldChangeHandler` in a
`FlexFieldKind` and declares which kinds can upgrade to `sequence`.

**Why big.** Itself trivial. The Σ 31,771 B is the chain it pulls in
(see next two entries).

**When.** Module load (touched whenever any sequence/array field is
present). For this consumer, all `SchemaFactory.array` schemas use it.

**Optional?** Not for any consumer who uses arrays.

### `sequence-field/sequenceFieldChangeHandler.js` (28 lines · 131 B own / Σ 31,677 B)

**What.** Aggregator — imports the rebaser, codec factory, editor,
and delta-converter for sequence-field changes from neighbouring
files and assembles them into a single `FieldChangeHandler` value.

**Why big — checked carefully.** The Σ is **real minified source
code from sibling files**, not webpack inflation from the aggregator
shape. Per-file bytes pulled from
`source-map-explorer build/.../encapsulated-with-shared-tree.js --tsv`
filtered to `sequence-field/`:

| File | Bundle B | Source LOC | Role |
|---|---:|---:|---|
| `utils.ts` | 6,991 | 1,013 | 51 helper functions on marks/cells/IDs (terser DCE drops 8 test-only ones; figure reflects live subset) |
| `compose.ts` | 6,027 | 831 | 2-mark-list compose state machine |
| `rebase.ts` | 4,539 | 577 | rebase-over-base mark walker |
| `sequenceFieldCodecV2.ts` | 2,710 | 350 | wire codec, format V2 |
| `invert.ts` | 2,674 | 359 | per-mark inversion |
| `sequenceFieldToDelta.ts` | 1,353 | 203 | mark → `DeltaMark` translation |
| `moveEffectTable.ts` | 1,241 | 219 | cross-field move effect store |
| `sequenceFieldEditor.ts` | 1,223 | 251 | high-level edit-API → mark builder |
| `replaceRevisions.ts` | 1,028 | 146 | revision rewrites for resubmit |
| `formatV2.ts` | 917 | 139 | TypeBox schema for V2 wire |
| `sequenceFieldCodecV3.ts` | 851 | 141 | wire codec, format V3 |
| `markQueue.ts` | 589 | 69 | priority queue over mark lists |
| `markListFactory.ts` | 439 | 51 | merging/eliding mark-list builder |
| `relevantRemovedRoots.ts` | 308 | 57 | detached-roots GC walker |
| `formatV3.ts` | 199 | 67 | TypeBox schema for V3 wire |
| `sequenceFieldChangeHandler.ts` | 131 | 28 | aggregator (this file) |
| `prune.ts` | 112 | 21 | empty-mark elision |
| `sequenceKind.ts` | 94 | 40 | `FlexFieldKind` wrapper |
| `sequenceFieldChangeRebaser.ts` | 82 | 27 | rebaser vtable |
| `sequenceFieldCodecs.ts` | 35 | 28 | version-dispatch builder |
| `types.ts` | 16 | 180 | (type-only — only constants survive) |
| | **31,559** | 4,795 | (source-map-explorer total) |

That's a ~5× minify ratio on dense TS — entirely explained by the
source itself. **`formatV1.ts` (190 lines source) is correctly absent
from the bundle**, confirming module-level tree-shaking is working
under `"sideEffects": false`.

**Side-effect / webpack-defeating constructs in `sequence-field/`:
none.** No module-level `Object.freeze`, `Object.defineProperty(...
prototype...)`, `formatters.push(…)`, `markEager(…)`, `static {}`
init blocks, or singleton-patching of the kind that hurts
`feature-libraries/default-schema/defaultFieldKinds.ts` (findings §5).

**The vtable is not the lever.** The aggregator stores live function
references that `ModularChangeFamily` invokes through
`getChangeHandler(fieldKinds, kind).rebaser.<method>`, but every one
of those methods has a real static call site in
`modular-schema/modularChangeFamily.ts` (compose L568, invert L771/818,
rebase L1065/L1178/L1268/L1338, prune L1498, replaceRevisions L1616,
isEmpty L1502, getNestedChanges L1420, createEmpty L1056/L1265,
getCrossFieldKeys L1648). Removing the vtable and re-exporting the
named functions would not let terser drop anything — the union of
direct call sites already pins them all.

**One real co-pinning cost: codec V2 + V3 both kept.**
2,710 + 851 + 917 + 199 = ~4.7 KB. `sequenceFieldCodecs.ts` builds a
`ClientVersionDispatching` codec so V2 *or* V3 is selected at runtime
by `MinimumVersionForCollab`. Both must be present even though any
given client only ever uses one. This is dynamic version selection,
not vtable dispatch. Removing it would require pinning the codec
version at build time.

**`utils.ts` (6,991 B) is not co-pinned — verified by audit.** I
extracted the named import lists from all 14 sibling importers: the
**union covers 41 of 51 exports**. Of the remaining 10, two are
internally chained inside `utils.ts` (`cloneMarkEffect` via
`cloneMark`, `isNewAttachEffect` via `isNewAttach`) so they're
transitively reachable; the other 8 (`getInputLength`,
`getOutputLength`, `isActiveReattach`, `isReattach`,
`isReattachEffect`, `isRemoveMark`, `areOverlappingIdRanges`,
`compareCellsFromSameRevision`) have **no production caller at all**
— only `test/feature-libraries/sequence-field/utils.ts` imports them.
**Terser correctly DCE's all 8** — verified zero name occurrences in
the minified `.js` for each one — so the 6,991 B figure already
reflects only the live subset. The file is not a tree-shaking hazard;
it's just a wide grab-bag where most helpers have callers and the
rest are correctly pruned.

**When.** Module load. The held methods then run on every sequence
field change in any compose / rebase / invert pass through
`ModularChangeFamily`.

**Optional?** No.

### `sequence-field/sequenceFieldChangeRebaser.js` (27 lines · 82 B own / Σ 15,051 B) — **cutoff (6 subtrees, 22,188 B)**

**What.** Object literal that imports `compose`, `invert`, `rebase`,
`prune`, `replaceRevisions`, and `omitMarkEffect` from sibling files
and bundles them into the `FieldChangeRebaser` shape consumed by
`ModularChangeFamily`. (Not re-exports — the methods live on the
object and are dispatched through `…rebaser.<method>(…)`.)

**Why big.** Almost zero own bytes. The cutoff Σ is the **actual
sequence-field CRDT algorithms** — `compose.ts` (6,027 B),
`rebase.ts` (4,539 B), `invert.ts` (2,674 B), `replaceRevisions.ts`
(1,028 B), `prune.ts` (112 B), and the `markListFactory` /
`markQueue` / `moveEffectTable` helpers they share. The bytes are
real algorithm code — see the table on `sequenceFieldChangeHandler`
above for the full per-file breakdown.

**Could the vtable be flattened to save bytes here?** No. As above,
every member has a static call site in `modularChangeFamily.ts`
(compose L568, invert L771/L818, rebase L1065/L1178/L1268/L1338,
prune L1498, replaceRevisions L1616). `mute` is the only member
without an external call site, but it's a 1-line wrapper around
`omitMarkEffect`.

**When.** Every commit. Compose runs when consecutive local edits land
in the same transaction; rebase runs when a local edit needs to be
reordered against an inbound op; invert runs on undo / redo and on
every commit (for the inverse used by `EditManager`'s ack/rollback
machinery).

**Optional?** **No** — required for any CRDT that contains a sequence
field, which includes every `SchemaFactory.array` user.

### `optional-field/optionalField.js` (~1,600 lines · 6,824 B own / Σ 14,985 B) — **cutoff (9 subtrees, 11,010 B)**

**What.** Same role as the sequence-field bundle but for the
`optional` (0-or-1) kind. Notable export: `RegisterMap` (per-revision
register state used during compose), and `optionalChangeRebaser` with
its full compose/invert/rebase logic for moves and replacements.

**Why big.** Large `compose` function (state machine over
move/replace/attach interactions across registers). The 9 cutoff
subtrees are codec, editor, delta converter and helper modules.

**When.** Every commit on any optional or required field. `required`
field changes are encoded as optional changes plus a constraint, so
this code runs even for plain object properties.

**Optional?** No — pinned by virtually every schema.

### `chunked-forest/chunkTree.js` (~700 lines · 2,198 B own / Σ 20,129 B) — **cutoff (9 subtrees, 20,529 B)**

**What.** Module that exports both the chunk-tree *building blocks*
(`chunkField`, `chunkRange`, `newBasicChunkTree`,
`uniformChunkFromCursor`, `defaultChunkPolicy`) and the *full schema-
driven chunker* (`makeTreeChunker`, `Chunker` class,
`tryShapeFromNodeSchema`, `tryShapeFromFieldSchema`, `basicChunkTree`,
`chunkFieldSingle`, `makePolicy`, `basicOnlyChunkPolicy`). The Σ
20,129 B is dominated by sibling files (`basicChunk.ts` 8,126 B,
`uniformChunk.ts` 5,908 B, `sequenceChunk.ts` 367 B,
`emptyChunk.ts` 747 B) — not by chunkTree.ts itself.

**ObjectForest's actual import.** Two named symbols:

```ts
// packages/dds/tree/src/feature-libraries/object-forest/objectForest.ts:52
import { chunkField, defaultChunkPolicy } from "../chunked-forest/index.js";
```

It does **not** import `makeTreeChunker`, `Chunker`,
`tryShapeFromNodeSchema`, `basicChunkTree`, etc. Those exports of
chunkTree.ts are only reached from `sharedTree.ts:670` inside
`ForestTypeOptimized`, which the bundle does not select — so they are
correctly tree-shaken. **Confirmed by source-map-explorer: chunkTree.ts
contributes only 2,198 B**, which is well below the ~10–15 KB the full
file would minify to. With `"sideEffects": false`, terser kept just the
live subset (`chunkField`, `chunkRange`, `newBasicChunkTree`,
`uniformChunkFromCursor`, `insertValues`, `defaultChunkPolicy`,
`polymorphic`, `Polymorphic`).

**How much of chunkTree.ts is required by ObjectForest at runtime?**
With `defaultChunkPolicy` the answer is *less than what survives
tree-shaking*. The policy literal is:

```ts
// chunkTree.ts:373
export const defaultChunkPolicy: ChunkPolicy = {
  sequenceChunkSplitThreshold: Number.POSITIVE_INFINITY,
  sequenceChunkInlineThreshold: Number.POSITIVE_INFINITY,
  uniformChunkNodeCount: 400,
  shapeFromSchema: () => polymorphic, // always Polymorphic, never TreeShape
};
```

Tracing the call from `ObjectForest.chunkField()`:

| Code path in `chunkRange` | Reached at runtime? | Bundle cost |
|---|---|---|
| `tryGetChunk` reuse fast path | Yes (refcount on existing chunks) | inline |
| `newBasicChunkTree` slow path → `BasicChunk` ctor | **Yes — every node** | `basicChunk.ts` 8,126 B |
| `shape instanceof TreeShape` branch → `uniformChunkFromCursor` → `insertValues` → `new UniformChunk(...)` → `isStableNodeIdentifier` | **No.** `defaultChunkPolicy.shapeFromSchema` always returns `polymorphic`, so `instanceof TreeShape` is statically false at every call site | `uniformChunk.ts` 5,908 B + `node-identifier` helper |
| `chunk.subChunks.length <= sequenceChunkInlineThreshold` inline | Threshold = `+∞` so condition is always true *if* a `SequenceChunk` is encountered, but the cursors ObjectForest passes (built from user `cursorFromInsertable` / replay) never embed `SequenceChunk`s | `sequenceChunk.ts` 367 B (live but unused) |
| `output.length > sequenceChunkSplitThreshold` regrouping | Threshold = `+∞`, condition never true | inline |

So `BasicChunk` is the only chunk type that actually executes from the
ObjectForest path. `UniformChunk` and `SequenceChunk` are
**statically reachable but dynamically dead** under `defaultChunkPolicy`.
Webpack/terser can't prove the `instanceof TreeShape` branch dead
because `shapeFromSchema` is reached through a function reference on
the `ChunkPolicy` value — not a literal.

**Real lever (~6 KB).** If `ObjectForest.chunkField` were rewritten to
call a specialized `basicChunkField(cursor)` that hard-codes the
no-shape policy (no `ChunkPolicy` indirection, no
`shapeFromSchema` call, no `instanceof TreeShape` check), terser could
prove `uniformChunkFromCursor` / `insertValues` / `UniformChunk` /
`isStableNodeIdentifier` unreachable and DCE the `uniformChunk.ts`
file (5,908 B) plus the small `insertValues` / `uniformChunkFromCursor`
chunks of chunkTree.ts. Tradeoff: chunks emitted by `ObjectForest` lose
the ability to ever upgrade to `UniformChunk` representation — which
matches what the runtime is already doing.

**When.** `ObjectForest.chunkField` runs on every node insertion / set
through the simple-tree API (verified call sites: `lazyField.ts:251`,
`schematizingTreeView.ts:236`, `forestSummarizer.ts:112`,
`independentView.ts:255`). With `defaultChunkPolicy` only the
`BasicChunk` slow path executes.

**Optional?** The chunk *representation* is required by the
`IEditableForest.chunkField` interface contract (`forest.ts:97`), so
`BasicChunk` (8 KB) is unavoidable. The shape-aware chunker pieces
(`makeTreeChunker`, `Chunker`, shape inference) are already absent
because `ForestTypeOptimized` is not selected. The remaining
runtime-dead surface (`uniformChunk.ts` 5,908 B + `sequenceChunk.ts`
367 B + the dead branches inside chunkTree.ts) is the bounded-optional
piece — it's reachable from `chunkRange`'s polymorphic
`ChunkPolicy.shapeFromSchema` call shape, not from any feature the
default consumer actually uses.

**Note: the chunked-forest *codec* path is independent.** The
`chunked-forest/codec/codecs.js` subtree (Σ 14,147 B, separate root
edge from `treeCheckout`) is reached via `forestSummarizer` for
summary encode/decode — not through `ObjectForest.chunkField`. See the
"Codec pillar" section below.

### `core/tree/visitorUtils.js` (~600 lines · 1,047 B own / Σ 14,538 B) — **cutoff (3 subtrees, 13,658 B)**

**What.** `combineVisitors()` — the machinery for layering multiple
`DeltaVisitor`s (forest, anchor set, change-tracking) into a single
visitor that the rebase pipeline drives. Plus `applyDelta` /
`announceDelta` helpers.

**Why big in subtree.** The 13.6 KB cutoff is the core delta-visitor
helpers, tagged-change utilities, and visitor announcement plumbing.

**When.** Every delta application — i.e. every local commit and every
remote op.

**Optional?** No.

### `core/tree/anchorSet.js` (~800 lines · 9,030 B own / Σ 12,246 B) — **cutoff (7 subtrees, 3,568 B)**

**What.** `AnchorSet` — the data structure that keeps stable
references to tree locations across edits. Holds `AnchorNode`,
`AnchorSlot`, anchor reuse table, and the update-on-delta state
machine.

**Why big.** Almost all in own bytes (9 KB) — large class with the
delta visitor it installs into `visitorUtils.combineVisitors`, slot
table, refcount lifecycle.

**When.** Constructed once per checkout. Updated on every delta. All
simple-tree node identities ultimately resolve through anchors.

**Optional?** No — the simple-tree node→flex-tree binding stores its
anchors here.

---

## View pillar — under `schematizingTreeView.js`

### `shared-tree/schematizingTreeView.js` (~1,200 lines · 5,021 B own / Σ 38,685 B)

**What.** Bridges the simple-tree user API to the flex-tree checkout.
`SchematizingSimpleTreeView` is what the user sees behind
`tree.viewWith(config)`. Owns schema-compat checking, view init,
field-schema normalization, transaction wrapping.

**Why big.** Big class plus `TreeViewConfigurationAlpha` plumbing,
schema-compatibility tester (Σ 4,544 B per findings §6.5), and
hydration coordination.

**When.** Constructed on the **first** `viewWith()` call. Used for
every user-facing tree access thereafter. Schema-compat tester runs
on every stored-schema change.

**Optional?** No — this is the only path from user code to data.

### `simple-tree/node-kinds/object/objectNode.js` (~1,000 lines · 4,518 B own / Σ 22,448 B) — **cutoff (12 subtrees, 21,443 B)**

**What.** `createObjectNodeSchema()` — generates the property-getter,
property-setter, and method functions for every user-defined object
schema, hooks them onto the prototype, runs default providers.

**Why big.** Code-generation for typed accessors per field, implicit
field-schema coercion, recursive nested schema setup. The 21 KB
cutoff is the generic `simple-tree/core` machinery (proxies,
prototype helpers, value adapters) that every node kind also pulls
in.

**When.** **Schema definition time** (when the user calls
`schemaFactory.object(...)`, the schema object created at module load
walks this code once). Generated accessors then run on every property
read / write.

**Optional?** Not for object schemas — and every realistic SharedTree
user has objects. Per findings §6.3, `objectNode` is independently
pinned by `schematizingTreeView` even when `SchemaFactory.array` /
`.map` are not used, so it is the irreducible simple-tree node kind.

### `simple-tree/core/treeNodeKernel.js` (~1,100 lines · 5,401 B own / Σ 20,553 B) — **cutoff (6 subtrees, 17,138 B)**

**What.** `TreeNodeKernel` — internal companion object every
simple-tree node owns. Tracks the unhydrated → hydrated transition,
caches the underlying flex-tree anchor, dispatches change events,
manages dispose.

**Why big.** State machine (unhydrated, hydrated, disposed),
event-subscription bookkeeping, lazy proxy bridging. The 17 KB cutoff
is `core/tree/anchorSet` (already counted) plus
`simple-tree/core/treeNode`, `core/userFacing/*`, the proxy slot
table — all required for any node to function.

**When.** Constructed for every `TreeNode` the user touches.
Hydration runs on first field access.

**Optional?** No.

### `simple-tree/toStoredSchema.js` (~800 lines · 3,764 B own / Σ 12,887 B) — **cutoff (9 subtrees, 14,352 B)**

**What.** Translates user-facing view schema (`ImplicitFieldSchema`,
`SchemaFactory` output) to the persisted `TreeStoredSchema`. Includes
field-kind translation, type-set normalization, and node-kind dispatch
for object/map/leaf/array.

**Why big.** Multiple per-node-kind translators plus restrictive vs
permissive generation strategies (forward / backward compat). 14 KB
cutoff is shared simple-tree core + the field-kind identifier
constants pulled from `default-schema`.

**When.** Once on first `viewWith()` and again on any schema upgrade.

**Optional?** No — the stored schema must be computed before the tree
can be initialised or schema-checked.

---

## Write pillar — under `defaultEditBuilder.js`

### `default-schema/defaultEditBuilder.js` (~600 lines · 3,554 B own / Σ 31,759 B)

**What.** The default `ChangeFamily` instance + `DefaultEditBuilder`.
Wraps `ModularChangeFamily` with the five built-in field kinds and
exposes the high-level edit methods (`setValue`, `insert`, `move`, …)
that the checkout calls.

**Why big.** Method-per-edit-shape with parameter marshaling.

**When.** Constructed during `SharedTreeKernel` setup. Edit methods
called for every local edit.

**Optional?** No — `SharedTree.create` reaches `DefaultChangeFamily`
synchronously (this is the §3 Experiment-#1 result: lite split could
not avoid pinning the write pillar from `SharedTree`).

### `modular-schema/modularChangeFamily.js` (~2,500 lines · 28,059 B own / Σ 28,205 B) — **terminal**

**What.** The CRDT engine. Implements `ChangeFamily` for the
field-kind-pluggable changeset format. Hosts `compose`, `invert`,
`rebase`, cross-field reference tracking, `toDelta` conversion,
detached-node management, and codec coordination.

**Why big.** ~28 KB own. 39 private methods. Heavy use of B-tree maps
(`@tylerbu/sorted-btree-es6`) for cross-field reference state. Every
operation has rebase/compose/invert symmetry. Per findings §5
Experiment #4 and §5 #8, attempts to flatten or monomorphize this
file produced sub-2 KB savings — its size is structural, dominated by
the runtime field-kind dispatch (`getFieldKind(this.fieldKinds, kind)`)
that terser cannot statically resolve.

**When.** Every commit (local edit), every remote op (rebase), every
ack / rollback (invert), every transaction commit (compose), and on
every summary load (codec).

**Optional?** No — the heart of the system. The `(see above)` cross
references in this file's pruned subtree mostly point to
`feature-libraries/default-schema/defaultFieldKinds.js`, the codec
infrastructure, and the cross-field B-tree — all unavoidable.

---

## Codec pillar — direct child of `treeCheckout`

### `chunked-forest/codec/codecs.js` (~1,000 lines · 710 B own / Σ 14,147 B) — **cutoff (8 subtrees, 18,734 B)**

**What.** Builder for the chunk wire-codec used inside
`forestSummarizer` / `fieldBatchCodec`. Selects between
schema-based and uncompressed encoders by client version.

**Why big in subtree.** The own file is tiny (one builder + dispatch);
the 18.7 KB cutoff is the **actual encoders** — `schemaBasedEncode`,
`compressedEncode`, `uncompressedEncode`, `chunkDecoding`, plus the
TypeBox format schemas for each version.

**When.** **Summary load and summary write.** The bundled chunk
codecs decode the forest blob during `loadCore` and encode it during
`summarize`. Not on the per-op path: per-op messages use
`messageCodecs` which take the change format, not the forest format.

**Optional?** No for any persisted document — every summary download
goes through this. (Findings §6.6 calls out that wire-format codec
work is logically separable from the in-memory representation, but
the savings would be a separate-package refactor.)

---

## Root-level cutoff — 22 subtrees from `treeCheckout.js`, Σ 36,236 B

The remaining 36 KB hanging directly off `treeCheckout.js` (folded
into one cutoff line by the analyzer) is the long tail of small
imports the file pulls in directly:

- `core/rebase/*` — change rebasing primitives, revision tags,
  `tagChange` / `makeAnonChange` / `rebaseChange`.
- `core/index.js` re-exports — many type-only, but `ChangeFamily`,
  `DeltaDetachedNodeId`, `RevisionTag`, `EmptyKey`, `RevertibleAlpha*`
  carry value bytes.
- `events/` event-emitter glue used by `CheckoutEvents`.
- `shared-tree-core/branch.js`, `shared-tree-core/transaction.js`,
  `shared-tree-core/sharedTreeChangeEnricher.js` — all reached
  directly from `treeCheckout`'s constructor, not from the three
  big pillars above.
- `simple-tree/api/customTree.js` (660 B) — the F8 diagnostic path
  (verbose export / removed-roots) called out in findings §3.
- Misc utilities — `util/typedArrayCursor`, default-schema field
  identifiers, etc.

These are individually small (each subtree below the 10 KB cutoff)
and collectively make up the second-tier infrastructure of
`treeCheckout` itself rather than any one feature pillar.

**When.** Mixed — `branch.js` runs on every commit, `transaction.js`
only when transactions are used (F1/F2/F3 in findings §6),
`customTree.js` only on `exportVerbose` / `getRemovedRoots`. This is
exactly the territory where the F1–F8 feature classification in
findings §6 lives; the byte savings reported there
(~15–20 KB upper bound) are taken from this cutoff bucket plus the
co-pinned bits of `branch.js` / `transaction.js`.

---

## Summary: what the typical session actually runs

| Pillar | Σ B | Typical session triggers it? |
|---|---:|---|
| `objectForest` (read pillar) | 120 KB | **Yes — always.** Default forest. Touched on every edit and op. |
| `defaultEditBuilder → modularChangeFamily` (write pillar) | 32 KB | **Yes — always.** Every commit / op / undo / summary. |
| `schematizingTreeView` (view pillar) | 39 KB | **Yes — always.** First `viewWith()` and every property access. |
| `chunked-forest/codec/codecs.js` (summary codec) | 14 KB | **Yes — always.** Every summary load / save. |
| `chunked-forest/chunkTree.js` (chunker building blocks + `BasicChunk`) | 20 KB | **Yes — always.** Used by `ObjectForest.chunkField` on every insert. Only the `BasicChunk` slow path executes; `uniformChunk.ts` (5,908 B) + `sequenceChunk.ts` (367 B) are statically reachable but runtime-dead under `defaultChunkPolicy`. |
| `anchorSet` | 12 KB | **Yes — always.** All node identity. |
| Root-level cutoff (`branch.js`, `transaction.js`, diagnostic exports, …) | 36 KB | **Mixed.** Branching/revertibles/transactions/`exportVerbose` are bounded optional features (findings §6 F1–F8). |

The tested hypothesis from the user prompt — *"chunked-forest is
optional because it's a work-in-progress; only `ForestTypeOptimized`
consumers run it"* — is **partly incorrect, partly under-stated**.

- *Partly incorrect:* `ObjectForest` does pull in chunked-forest code
  (`chunkField` + `defaultChunkPolicy`) from `chunkTree.ts`, and
  `BasicChunk` (8 KB) does execute on every insert. Avoiding
  `ForestTypeOptimized` does **not** eliminate this cost.
- *Under-stated:* `ObjectForest` does **not** depend on the
  whole chunked-forest feature surface. The schema-driven chunker
  (`makeTreeChunker`, `Chunker`, shape inference,
  `tryShapeFromNodeSchema`) lives only inside `ForestTypeOptimized`
  and is correctly tree-shaken from this bundle. The
  chunked-forest *codec* (`codec/codecs.js` Σ 14 KB) reaches the
  bundle through a separate `treeCheckout → forestSummarizer` edge,
  not through `ObjectForest`. `ChunkedForest` and `buildChunkedForest`
  are absent.
- *Genuine bounded-optional surface inside the chunker:*
  `uniformChunk.ts` (5,908 B) and `sequenceChunk.ts` (367 B) are
  statically reachable from `chunkRange` but runtime-dead under
  `defaultChunkPolicy` (which forces `shapeFromSchema → polymorphic`
  and `sequenceChunkSplitThreshold = +∞`). A specialized
  `basicChunkField` for the `ObjectForest` path could let terser
  eliminate them — ~6 KB lever.

The other large nodes that are bounded-optional in the sense the user
described are inside the root-level cutoff (branching, revertibles,
transactions, async transactions, transaction labels, raw change
apply, constraints, diagnostic exports — features F1–F8 in findings
§6). Everything visible above the 10 KB cutoff is on the must-run path
of any read+write SharedTree client, except for the
`UniformChunk`/`SequenceChunk` runtime-dead surface noted above.
