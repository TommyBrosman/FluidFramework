# Polyfill Validity, Testing, and Dependency Chain

This document explains the build-time **stub-polyfills** used by the
`encapsulated-no-tree` bundle scenario. Each polyfill replaces a real
container-runtime module with a small stub at webpack build
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

> **Maintenance:** This document must be updated whenever a stub-polyfill is
> added, removed, or changed. In the same change, add/update the per-polyfill
> validity subsection (§1), the `tools/polyfill-swap.sh` `MAP` entry and the
> exclusion-set table (§2.4), and the dependency chain (§3). This is also recorded
> as an agent instruction in `.github/copilot-instructions.md` / `.claude/CLAUDE.md`.

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
  exports — no `SharedMap`, no `uploadBlob`/attachment blobs, no id-compression
  enabled);
- **summarizes server-side** — it is never elected summarizer and never writes a
  summary;
- has `clientDetails.type !== summarizerClientType`, so `isSummarizerClient`
  (L1333, assigned L1746 `this.clientDetails.type === summarizerClientType`) is
  **`false`**.

These facts are the root assumptions from which every validity argument below is
derived.

> Note: telemetry is **not** among the stubbed subsystems. Earlier telemetry
> stub-polyfills were removed by project decision (see the note under §1); this
> document covers only the 7 remaining stubs.

---

## 1. Per-polyfill validity

The 7 polyfills, in webpack-config order. For each: the replacement, the stub
shape, the code-flow guarantee (with line numbers), and the API-surface argument.

> **Telemetry is intentionally NOT stubbed.** Four earlier telemetry stub-polyfills
> (op-perf/`connectionTelemetry`, `signalTelemetryProcessing`, `batchTracker`, the
> per-DDS `sampledTelemetryHelper`) were **removed** by project decision: they
> deleted real observability signals for only ~11.4 KB parse / ~2.4 KB gzip
> combined. Telemetry is off-limits for bundle reductions — do not re-propose it.

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

- **The true gate.** The condition inlined at L2329-2330 is exactly
  `SummarizerClientElection.clientDetailsPermitElection` (`summarizerClientElection.ts`
  L141-142):

  ```ts
  details.capabilities.interactive || details.type === summarizerClientType
  ```

  Because this is the `else if` after `if (this.isSummarizerClient)` (L2296) and
  `isSummarizerClient === (clientDetails.type === summarizerClientType)` (L1746),
  the else-branch already guarantees `type !== summarizerClientType`, so the
  **second disjunct is statically dead here**. The effective gate for constructing
  a real `SummaryManager` is therefore `!onRequestMode && interactive`.

- **What the real machinery does (why empty is not trivially safe).** On an
  interactive, non-summarizer, non-on-request client, `setupSummaryManager` builds
  the election (`OrderedClientElection` → `SummarizerClientElection`) and a
  `SummaryManager` that, **if this client wins the election, spawns a summarizer
  container**. This is *client-side (interactive) summarization*. The module's own
  header says it plainly: these classes "exist so an interactive client can be
  elected to spawn a summarizer container. A client that summarizes server-side
  never needs this machinery."

- **Why the stub must be a no-op, not throwing.** An interactive client *does*
  enter this branch (default `interactive === true`, see §0), so the dynamic import
  *is* evaluated and `setupSummaryManager` *is* called. A throwing stub would crash
  normal startup. Hence: no-op.

- **Why returning `{}` is *correct* — and its precise validity scope.** An empty
  result means this client never participates in election, so it is **never
  elected and never spawns a summarizer container**. This is a genuine behavioral
  change, valid **only under a deployment precondition**: summaries must be
  produced *without* relying on this client's election — i.e. **server-side /
  non-interactive-summarizer**, or by other (non-stubbed) clients in the session.
  It is **NOT** valid for a deployment whose summaries depend on client-side
  election, because suppressing election there suppresses all summarization. This
  is the same class of consumer-opt-in precondition as the GC stub (§1.5), **not**
  a universal truth — do not read this stub as "safe for any interactive client."
  It is coherent with the rest of the bundle because this client's own
  `Summarizer` is also stubbed (§1.2): the client can neither *be* a summarizer nor
  *spawn* one, so summarization is necessarily external.

- **Key enabler:** `SummarizerClientElection.clientDetailsPermitElection` was
  **inlined** into the gate condition (comment at L2326-2328) precisely so the
  gate does not *statically* reference the election machinery. Without that
  inlining, the election module would be a static import edge and could not be
  stubbed away.

### 1.4 blob-manager — `blobManager/index.js` → `blobManager/blobManagerStub.js`

- **Scope — what "blob" means here.** `BlobManager` manages **attachment blobs**:
  app-uploaded binary payloads referenced by `IFluidHandle<ArrayBufferLike>`,
  created via `runtime.uploadBlob(...)` and stored under the `_blobs` GC path. This
  is **not** the same concept as a *summary-tree blob* (an `ISummaryBlob` node added
  inside a DDS summary via `SummaryTreeBuilder.addBlob`). The distinction matters
  because merge-tree *does* write a summary-tree blob — `SnapshotLegacy` emits the
  catch-up-ops blob (`mergeTree.ts` `catchUpBlobName`; `snapshotlegacy.ts`
  `builder.addBlob(this.mergeTree.options?.catchUpBlobName ?? SnapshotLegacy.catchupOps, ...)`).
  That path goes through the summary builder, **not** `BlobManager`, and only runs
  during summarization (which this client does server-side). So the merge-tree
  "blob" never reaches this stub.
- **Shape:** **mixed** — valid-empty on the unconditional paths, throwing on the
  optional paths. `summarize()` returns an empty summary tree, `getGCData()`
  returns `{ gcNodes: {} }`, `hasBlob()` returns `false` — these run for every
  client. `createBlob()` / `getBlob()` **throw**, to fail fast if the no-blob
  assumption is violated.
- **Gate:** constructed unconditionally at L2017 `new BlobManager({...})`, and its
  summarize/GC methods are on always-run paths — hence those must be valid-empty.
  The throwing paths are reached only through `containerRuntime.uploadBlob` →
  `blobManager.createBlob` (containerRuntime.ts L4730-4736) and blob-handle
  resolution → `getBlob`. Both require the **app** to explicitly upload/resolve an
  attachment blob.
- **Why the target client never trips the throws — verified.** No DDS in the
  bundle calls `runtime.uploadBlob`: a repo-wide search finds `uploadBlob` callers
  only in runtime/framework glue (`dataStoreRuntime`, `channelCollection`,
  `fluidContainer`/`rootDataObject`) — **none in `packages/dds/*`** (checked
  merge-tree, sequence, map). `SharedString` and `SharedDirectory` store handles
  but never create attachment blobs themselves. Attachment-blob upload is an
  explicit **application-level** API (`IFluidContainer.uploadBlob` /
  `dataObject.uploadBlob`).
- **Validity precondition (consumer opt-in):** the **application** must not call
  `uploadBlob` (nor rely on resolving attachment-blob handles). The DDSes in this
  scenario never do; the API surface (`src/index.ts`) exposes no blob API. If a
  future consumer uploads attachment blobs while keeping this stub, `createBlob`
  throws fast and loud.

### 1.5 gc (garbage collection) — `gc/garbageCollection.js` → `gc/garbageCollectionStub.js`

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

### 1.6 summarizer-node (tree) — `summary/summarizerNode/summarizerNodeWithGc.js` → `summarizerNodeWithGcStub.js`

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
  the `Summarizer` (stubbed, §1.2) with GC disabled (§1.5). With no summarizer and
  no GC, `summarize`/`getGCData`/`startSummary`/etc. are unreachable for this
  client.
- **Enabled by §1.2 + §1.5.** See §3.

### 1.7 summary-collection — `summary/summaryCollection.js` → `summaryCollectionStub.js`

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

---

### 1.8 summary-internals — `summary/summaryInternals.js` → `summaryInternalsStub.js`

- **Shape:** **throwing** — every export (`summarizeInternalCore`, `summarizeCore`,
  `submitSummaryCore`, `refreshLatestSummaryAckCore`) throws
  `"summaryInternals is stubbed out in this build"`; `ISummaryInternalsHost` is re-exported
  as `unknown` (type-only, erased).
- **Unlike §1.1-1.7, this is not a delay-load boundary stub.** The summary-write
  implementation lived as prototype methods on the always-constructed `ContainerRuntime`
  class (`containerRuntime.ts`), so it could not tree-shake. The lever *extracts* those six
  method bodies into this leaf module (free functions taking a structural `host` view of the
  runtime) purely to create a severable module boundary; `ContainerRuntime` keeps four thin
  delegators (`submitSummary`, `refreshLatestSummaryAck`, `summarize`, `summarizeInternal`)
  that call the extracted `*Core` functions via `this as unknown as ISummaryInternalsHost`.
- **Gate:** the four delegators are reachable on the class, but are only ever invoked through
  the `ISummarizerInternalsProvider` interface (`submitSummary` /
  `refreshLatestSummaryAck`) and the summarizerNode factory closure (`summarizeInternal`) —
  all of which run **only** on the delay-loaded client-side `Summarizer` (§1.2). A client
  that summarizes server-side never reaches them, so the throws are unreachable in this
  bundle.
- **Why the target client never trips the throws:** the sole caller of the summary-write
  path is the `Summarizer`, which is itself stubbed (§1.2) and throws before it can drive a
  summary. `maxChunks:1` means the static import + this stub — not the delay-load seam alone
  — is what excludes the code.
- **Enabled by §1.2.** See §3.

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
tools/polyfill-swap.sh all                   # all 8 stubs (the shipped bundle's module set)
```

It backs up each real module, copies the stub over it, runs `npx mocha`, and
**always restores** on exit (including Ctrl-C). Stub ids:
`id-compressor summarizer election blob-manager gc summarizer-node
summary-collection summary-internals`.

### 2.3 Interpreting results — two buckets

Run `baseline` once, then each stub, and diff. Every test that passes at baseline
but fails under a stub falls into exactly one bucket:

- **Expected (subsystem-owned):** the test *directly exercises the stubbed
  subsystem* (e.g. `summaryCollection` specs assert watcher/ack behavior). These
  failures are correct and expected — the subsystem is intentionally gone. Such
  tests belong to the **exclusion set** for the polyfilled build.
- **Unexpected (validity violation):** a test that does *not* target the stubbed
  subsystem fails. This means a real code path reaches the stub — the polyfill is
  **not** actually safe, and either the stub is wrong or a new static dependency
  crept in. This is the signal that must be investigated.

**Empirical confirmation.** Running `tools/polyfill-swap.sh summary-collection`
against the current build produces failures confined to the `summaryCollection`
watcher/ack specs (the tests asserting `createWatcher` / `waitSummaryAck`
behavior). Zero unexpected failures — confirming the summary-collection stub is
safe and that its exclusion set is precisely those subsystem-owned specs.

### 2.4 Expected exclusion set per polyfill

The tests expected to fail (and therefore excluded from a polyfilled-build run)
map directly to each stubbed subsystem's own specs. Non-exhaustive:

| Polyfill | Expected failing specs (subsystem-owned) |
|----------|------------------------------------------|
| id-compressor | id-compressor enablement / serialization specs |
| summarizer | summarizer / running-summarizer / heuristics specs |
| election | summarizer-election / summary-manager specs |
| blob-manager | `blobManager` create/get specs (summary/GC blob specs stay green) |
| gc | `gc/*` collect/sweep/tombstone specs |
| summarizer-node | `summarizerNode` summarize/GC-data specs (child-map lifecycle stays green) |
| summary-collection | `summaryCollection` watcher / ack specs |
| summary-internals | `submitSummary` / `refreshLatestSummaryAck` / `summarize` and pending-ops summary specs (the summary-write path; all throw under the stub) |

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
   │      ├─► (1.5) gc stub            [valid-empty; server-side summary ⇒ this client
   │      │         │                    never writes GC data / runs sweep]
   │      │         │
   │      │         └─► (1.6) summarizer-node stub
   │      │                   [throwing summarize/getGCData require BOTH:
   │      │                    summarizer stubbed (1.2) AND GC disabled (1.5)]
   │      │
   │      ├─► (1.7) summary-collection stub
   │      │        [throwing createWatcher/waitSummaryAck require BOTH consumers
   │      │         stubbed: Summarizer (1.2) AND election SummaryManager (1.3)]
   │      │
   │      └─► (1.8) summary-internals stub
   │                [throwing submitSummary/refreshLatestSummaryAck/summarize path;
   │                 reachable only through the delay-loaded Summarizer (1.2), so
   │                 the extracted summary-write code is dead once (1.2) is stubbed]
   │
   └─► (1.3) election stub             [no-op; interactive non-summarizer clients DO
                                        enter the gate L2324 (effective gate:
                                        !onRequestMode && interactive), so it must
                                        not throw; returns {} = "never elects/spawns a
                                        summarizer". Empty result is correct ONLY under
                                        Root A (server-side summarization) — see §1.3]

Root B: "id-compression is OFF (default)"      ─► (1.1) id-compressor stub   [independent]
Root C: "app does not call uploadBlob (no attachment blobs); DDSes never do" ─► (1.4) blob-manager stub [independent]

NOTE: telemetry is deliberately NOT stubbed. The former "Root D" (accepting the
loss of op-perf / signal-reliability / batch-size / per-DDS-perf signals) was
retired when the four telemetry stubs were removed by project decision.
```

**Reading the chain ("B is valid because A was applied"):**

- **summarizer-node (1.8)** throws in `summarize`/`getGCData`/`startSummary`/etc.
  That is only safe because **(1.2) summarizer** removes the code that would drive
  a summarize pass **and** **(1.5) gc** disables the GC pass that would call
  `getGCData`. Neither alone is sufficient; the throwing methods have two distinct
  callers.
- **summary-collection (1.7)** throws in `createWatcher`/`waitSummaryAck`. That is
  only safe because **both** consumers are stubbed: the `Summarizer` (1.2) and the
  election `SummaryManager` (1.3). If either were real, it would call the throwing
  methods.
- **gc (1.5)** omits GC data from summaries. That is only immaterial because
  **(1.2)** makes this client summarize server-side — it never writes a summary,
  so the omitted data is never serialized by this client.
- **election (1.3)** returns an empty `SummaryManagerSetupResult`, so this client
  never participates in election and never spawns a summarizer container. Its
  effective gate is `!onRequestMode && interactive` (the inlined
  `clientDetailsPermitElection`, with the `summarizerClientType` disjunct
  statically dead in the else-branch), so an interactive client *does* reach it —
  the stub must be a no-op, not throwing. The empty result is *correct* only
  because of **Root A**: summaries are produced server-side, so suppressing
  client-side election removes nothing this client was relied upon to do. Under a
  client-side-summarization deployment this stub would be invalid (see §1.3).

**Independent stubs** (no cross-dependency): id-compressor (1.1) and blob-manager
(1.4). Each rests only on its own root assumption (Root B and Root C respectively)
and could be applied or removed without affecting the others.

> **Telemetry stubs (retired).** Four telemetry stub-polyfills once lived under a
> "Root D" (accepting the loss of op-perf, signal-reliability, batch-size, and
> per-DDS-perf signals). Unlike the summarizer/GC chain — where the stubbed code is
> genuinely *unreachable* — those ran on live, unconditional paths and their removal
> *did* delete real telemetry. Because that observability is a real cost, they were
> **removed** by project decision and Root D was retired. Telemetry is off-limits
> for bundle reductions.

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
no-op stubs (GC, summary-collection, summarizer-node child-map,
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
