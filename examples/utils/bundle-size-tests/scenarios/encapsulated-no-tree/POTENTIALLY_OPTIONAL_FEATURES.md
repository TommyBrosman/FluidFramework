# Potentially optional features

Candidate features that a minimal client (the `encapsulated-no-tree` mobile
scenario) might not need. The
[Code mapping & optionality analysis](#code-mapping--optionality-analysis) maps each
one to source, states **when it is active in the current code (reasoning about the
real modules, *without* any build-time polyfill)**, judges whether it can be made
optional in this bundle, and proposes changes.

> **Scenario recap.** `encapsulated-no-tree` builds a single-chunk bundle for an
> interactive **mobile client** that: uses only `SharedString` + `SharedDirectory`;
> **joins existing** containers (never creates/attaches); **summarizes
> server-side** (never elected summarizer, `isSummarizerClient === false`); uses the
> aqueduct **default single data store**; and imports the surface in `src/index.ts`.
> Seven build-time stub-polyfills already ship for it (id-compressor, summarizer,
> summarizer-election, blob-manager, gc, summarizer-node, summary-collection) — see
> [POLYFILL_VALIDITY.md](./POLYFILL_VALIDITY.md). **Telemetry is off-limits** as a
> reduction lever (project decision) and is therefore *not* proposed for removal
> below even where it is technically isolable.

## Code mapping & optionality analysis

Each feature is numbered **F<n>**. Line
numbers are against `tbrosman/claude-shrink-bundle` at commit
**`fb5629cec5`** ("Remove telemetry stub-polyfills; keep telemetry in the bundle",
2026-07-01) and were
verified while writing this doc. "Optionality" uses three buckets: **tree-shake**
(feature falls out if a customer opts in via import / config; no code in the
minimal path references it), **stub** (replace a module via webpack
`NormalModuleReplacementPlugin`, the pattern used by the existing 7 polyfills), or
**load-bearing** (executes on the minimal path; not removable without a refactor
that introduces a seam).

### F1 — Loader/Container separation, code loaders, code proposal

- **Code.** `Loader` `packages/loader/container-loader/src/loader.ts:236`; `ICodeDetailsLoader` stored `container.ts:764` (`this.codeLoader = codeLoader`); loaded unconditionally at `container.ts:2398` (`this.codeLoader.load(codeDetails)`); code-proposal quorum listeners wired during protocol init, handler `processCodeProposal()` `container.ts:1457`, subscribed at `container.ts:1904`.
- **When active (no polyfill).** Unconditional on every attached load: `codeLoader.load()` runs to obtain the runtime factory, and the quorum `"code"` proposal listeners are always attached. No option disables them.
- **In `encapsulated-no-tree`.** The bundle *is* the code — `ContainerRuntimeFactoryWithDefaultDataStore` is statically imported, so nothing is ever dynamically fetched, yet the `codeLoader` seam still runs (the app passes a trivial loader that returns the static module).
- **Optionality — load-bearing.** The `Loader`→`Container` split and the `codeLoader.load()` call are the container bootstrap; `codeLoader` is a required `ILoaderProps` field (`loader.ts:152`). Not tree-shakeable or stubbable without a bespoke "static single-code" container entry that bypasses `Loader`.
- **Proposal.** *Do not stub.* Longer-term (large, cross-cutting): a `createStaticContainer(runtimeFactory, …)` entry in container-loader that skips code-proposal/codeLoader entirely. High effort, changes public shape — defer.

### F2 — Quorum (members and proposals/values)

- **Code.** `Quorum`/`QuorumClients`/`QuorumProposals` `packages/loader/container-loader/src/protocol/quorum.ts` (classes at :423 / :60 / :143); constructed inside `new ProtocolHandler(...)` at `container.ts:777`; code proposal uses `quorum.propose("code", …)`.
- **When active (no polyfill).** Unconditional. The protocol handler builds the quorum on every load; member add/remove and proposal/approve listeners are always attached.
- **In `encapsulated-no-tree`.** Reached. `IProtocolHandler`/`ProtocolHandlerBuilder` are exported by the bundle, and the quorum backs join/leave + the code proposal.
- **Optionality — load-bearing.** Quorum is directly instantiated by the protocol handler and is protocol-semantic (it carries the client roster and the code proposal state the service expects). A stub would have to faithfully emit member/proposal events, i.e. re-implement it.
- **Proposal.** *Do not stub.* A "quorum-lite" (clients only, no proposals) is conceivable only if F1's static-code path lands, since the sole proposal user here is the code proposal. Bundle with F1.

### F3 — Not providing an `IUrlResolver` implementation

- **Decision.** This scenario deliberately **does not** bundle an `IUrlResolver` implementation, and there is nothing to gain by adding one. This section documents *why* omitting it is correct (not a candidate reduction — it is already absent, and should stay that way).
- **Scope of the "saving" — application bundle, not FF footprint.** Omitting a resolver here does **not** shrink Fluid Framework's own footprint — FF never shipped a concrete resolver to begin with (the framework only depends on the `IUrlResolver` *type*). The resolver source is *application*-side code (owned by the app's driver / service-client). So "not providing an implementation" keeps that 4–11 KB out of the **application** bundle; it is orthogonal to the FF-side reductions (polyfills, tree-shaking) tracked elsewhere in this doc.
- **Code / seam.** The driver `IUrlResolver` is consumed at `loader.ts:141`/`:193` and invoked first thing in `Loader.resolveCore()` at `loader.ts:327` (`this.services.urlResolver.resolve(request)`); also on the create path `container.ts:1282`. The interface lives in `@fluidframework/driver-definitions`; this bundle re-exports only its **type** (`src/index.ts:85`). Only the ~1-call invocation seam is in-bundle — never a concrete class.
- **Why no implementation belongs here.** An `IUrlResolver` maps an app request → `IResolvedUrl` (*which* service/endpoint to talk to). That mapping is inherently **service-specific** (ODSP vs. Azure vs. Routerlicious vs. a customer's own host), so the concrete resolver is owned one layer up — by whichever driver / service-client the app depends on — and is chosen at app-composition time, not by this framework bundle. Bundling any specific resolver here would (a) be wrong for every app using a different service, and (b) pull a service driver into a bundle whose whole point is to exclude that layer. The seam stays typed as the `IUrlResolver` interface so the app can inject its own. (Concrete resolvers — `AzureUrlResolver`, `OdspDriverUrlResolver`, etc. — each run 4–11 KB and live in the app's driver / service-client package.)
- **Optionality — N/A (already omitted, by design).** There is nothing to remove: no `IUrlResolver` implementation is present, and none should be added. The 4–11 KB of resolver source lives in the driver / service-client package the app composes with, which is out of scope here.
- **Proposal.** *No change.* Keep the `IUrlResolver` **type** export as the injection seam; do **not** ship a concrete resolver in this scenario.

### F4 — Message compression

- **Code.** `OpCompressor` `opLifecycle/opCompressor.ts` (uses `lz4js.compress`), `OpDecompressor` `opLifecycle/opDecompressor.ts` (uses `lz4js.decompress`); config `compressionDefinitions.ts` (`enabledCompressionConfig` = `minimumBatchSizeInBytes: 614400`, `disabledCompressionConfig` = `+Infinity`). Constructed unconditionally: `new OpDecompressor(...)` `containerRuntime.ts:1835`, `new OpCompressor(...)` `containerRuntime.ts:2064` (passed into `Outbox`).
- **When active (no polyfill).** **On by default.** `defaultMinVersionForCollab = "2.0.0-defaults"` (`runtime-utils/src/compatibilityBase.ts:33`) selects `enabledCompressionConfig` (`containerCompatibility.ts:112-115`). Outbound: a batch is compressed only when its payload ≥ `minimumBatchSizeInBytes` (`outbox.ts`). Inbound: `OpDecompressor` decompresses **any** peer op flagged compressed — independent of this client's outbound setting.
- **In `encapsulated-no-tree`.** Both classes ship and `lz4js` is bundled. The app *could* pass `compressionOptions: disabledCompressionConfig`, which stops **outbound** compression but does **not** make decompression dead — a peer may still send compressed ops.
- **Optionality — stub, but only under a document-level precondition.** Removing `OpCompressor`/`OpDecompressor`/`lz4js` is safe **only if the whole collaboration session guarantees no client ever compresses** (not merely that *this* client disables outbound compression). That is a stronger precondition than the per-client stubs already shipped, and if violated an inbound compressed op would be undecodable → data loss. `lz4js` is already tracked as a gated candidate in [BUNDLE_SIZE_REDUCTIONS.md](./BUNDLE_SIZE_REDUCTIONS.md).
- **Proposal.** *Gated stub, opt-in.* Provide `opCompressorStub` (throwing `compressBatch`) + `opDecompressorStub` (throws if it ever sees a compressed envelope, so a precondition violation fails loud instead of silently corrupting) + an `lz4js` stub. Guard all three behind an explicit deployment assertion "no peer uses lz4 compression." Wire only if the product accepts that contract. Est. ~5–6 KB parsed incl. lz4js.

### F5 — Message chunking/splitting

- **Code.** `OpSplitter` `opLifecycle/opSplitter.ts` (`isBatchChunkingEnabled` = `chunkSizeInBytes < +Infinity && submitBatchFn !== undefined`); constructed `containerRuntime.ts:1825` and handed to `RemoteMessageProcessor` (inbound reassembly). Default `chunkSizeInBytes = 204800`.
- **When active (no polyfill).** Outbound splitting engages only when a compressed batch exceeds `chunkSizeInBytes` (rare; pairs with F4). Inbound chunk **reassembly** runs whenever a peer chunks — independent of this client.
- **In `encapsulated-no-tree`.** Ships unconditionally via `RemoteMessageProcessor`.
- **Optionality — stub, same precondition class as F4.** The inbound reassembly is required for interop unless the session guarantees no peer chunks. Chunking is downstream of compression (only compressed batches get chunked), so it shares F4's precondition.
- **Proposal.** *Gated stub, bundle with F4.* Only meaningful once F4's "no compression in session" contract is accepted; then large ops can't be produced to chunk either. Small standalone win (~1–2 KB); do it together with F4 or not at all.

### F6 — Reconnect / resubmit

- **Code.** `ConnectionManager` `packages/loader/container-loader/src/connectionManager.ts` (reconnect mode, `reconnectOnError`, read→write upgrade at `:1098`); ops cancelled on disconnect and resubmitted by DDSes (`deltaManager.ts` "we cancel all ops on loss of connectivity, and rely on DDSes to resubmit"); runtime resubmit via `PendingStateManager` (`reSubmit`).
- **When active (no polyfill).** Always wired; actually fires on any transient disconnect. Resubmit is automatic (DDS + pending-state driven), not gated.
- **In `encapsulated-no-tree`.** Load-bearing — a mobile client reconnects constantly, and resubmit preserves un-acked local edits.
- **Optionality — load-bearing.** Removing it would drop edits across reconnects. Not a candidate.
- **Proposal.** *Do not touch.*

### F7 — Stashed ops

- **Code.** `PendingStateManager` `pendingStateManager.ts:264`; `applyStashedOpsAt()` called unconditionally at `containerRuntime.ts:1319` during runtime load and `:3036`; `applyStashedOp()` `containerRuntime.ts:2780`; serialized out via `getPendingLocalState()` `containerRuntime.ts:5234`.
- **When active (no polyfill).** `PendingStateManager` is always constructed (`containerRuntime.ts:1840`) and `applyStashedOpsAt` always runs on load (a no-op when there is no stashed state, but the code path ships). Generating stashed ops is on-demand (see F8).
- **In `encapsulated-no-tree`.** The apply path is load-bearing (it is the offline/rejoin replay); it is entangled with F6 resubmit and normal local-op tracking.
- **Optionality — load-bearing.** `PendingStateManager` also tracks *live* local ops for ack/resubmit, so it cannot be stubbed away even if offline-stash is unused.
- **Proposal.** *Do not stub.* (Only the *serialization output*, F8, is separable.)

### F8 — Serializing a container

- **Code.** `SerializedStateManager` `serializedStateManager.ts:155`, constructed `container.ts:969`; `Container.getPendingLocalState()` `container.ts:1153`; `Container.serialize()` (detached only) `container.ts:1185`; per-op tracking `serializedStateManager.addProcessedOp(...)`; background snapshot refresh loop.
- **When active (no polyfill).** The manager is always constructed and `addProcessedOp` runs on every inbound op; `getPendingLocalState()`/`serialize()` only run when the host explicitly asks. The snapshot-refresh loop runs in the background unless disabled.
- **In `encapsulated-no-tree`.** If the app never serializes (no offline persistence), only the always-on op-tracking + refresh overhead is paid.
- **Optionality — stub (conditional).** Replaceable with a no-op `SerializedStateManager` (dummy `fetchSnapshot`, throwing `getPendingLocalState`) **iff the deployment never persists/rehydrates a container** and does not rely on the background snapshot refresh. This is a real precondition — offline-capable apps need it.
- **Size estimate — small, below the 5 KB bar.** **Measured ceiling** (prototype gutting all offline machinery, reverted): parsed **−4,259 B** (483,822 → 479,563), gzip **−1,054 B** (127,166 → 126,112). See [BUNDLE_SIZE_REDUCTIONS.md](./BUNDLE_SIZE_REDUCTIONS.md) for the full analysis.
- **Proposal.** *Gated stub, opt-in.* Ship a `serializedStateManagerStub` guarded by a "no offline serialize/rehydrate" deployment assertion. This overlaps prior `serializedStateManager` analysis in [BUNDLE_SIZE_REDUCTIONS.md](./BUNDLE_SIZE_REDUCTIONS.md); validate against that before implementing.

### F9 — Start read-only, upgrade to read-write

- **Code (three inputs → one derived `readonly`).** `ReadOnlyInfo` is computed in `ConnectionManager.get readOnlyInfo()` `connectionManager.ts:302` as the OR of three independent inputs:
  1. **`storageOnly`** — the driver returned a storage-only (`FrozenDeltaStream`) connection (`connectionManager.ts:305`, `:514`). Wire-level read-only; can never upgrade.
  2. **`_forceReadonly`** — host called `Container.forceReadonly()` `container.ts:619` → `ConnectionManager.forceReadonly()` `connectionManager.ts:416`. App-driven.
  3. **`_readonlyPermissions`** — derived on every successful connection from the service token: `const readonlyPermission = !connection.claims.scopes.includes(ScopeType.DocWrite)` `connectionManager.ts:828`, then `set_readonlyPermissions(...)` `connectionManager.ts:452`. This is the "no write scope" case.
  The private getter `get readonly()` `connectionManager.ts:298` just returns `readOnlyInfo.readonly`.
- **The read→write upgrade path (the "upgrade" half).** A client that connected `"read"` upgrades **lazily on first op**: `sendMessages()` `connectionManager.ts:1090` sees `this.connectionMode === "read"` `:1098` and, guarded by `pendingReconnect`, schedules `reconnect("write", …)` `:1105` on a clean microtask. Complementary triggers: `connectCore()` forces `requestedMode = "write"` when `shouldJoinWrite()` (unacked pending ops) `:483`; a `write`-nack while lacking permissions closes rather than loops `nackHandler` `:1184`. So "start read, become write" is not a discrete feature toggle — it is emergent from `connectionMode` + this reconnect logic.
- **How it reaches DDSes (why it is safety-critical).** `deltaManager.on("readonly", …)` `container.ts:2078` → `setConnectionStatus()` `container.ts:2491`, which tells the runtime it may send ops only when **connected AND not readonly**: `this.connectionState === Connected && !readonly` `container.ts:2505` (and `canSendOps: !readonly` on the newer path `:2550`). This is the gate that stops a no-write-scope client from emitting ops.
- **When active (no polyfill).** Always active. The permission check runs on every successful connection (`:828`); the readonly OR is recomputed on every access; the lazy write-upgrade is armed on every `"read"` connection.
- **In `encapsulated-no-tree`.** Load-bearing safety: (a) prevents a client without `DocWrite` scope from emitting ops, and (b) enables the lazy `read → write` upgrade on first edit. An interactive editor client depends on both — it may legitimately connect `read` (view-only until it edits) and must upgrade correctly.
- **"Could we add a Container parameter to start clients in *write* mode?"** The knob **already exists** — `ILoaderProps`/`ILoaderOptions` carries an optional `client: IClient`, threaded via `options.client` → `Container.setupClient()` `container.ts:802`; its `.mode` becomes `defaultReconnectionMode` `connectionManager.ts:350`, which `connectCore()` uses as `requestedMode` `:476`. Passing `client: { mode: "write", … }` makes the client join the delta stream as a writer up front, skipping the lazy `read → write` upgrade **for the initial connection**. But it is a deliberate **anti-pattern for scale, and yields no bundle win**: (i) the default is `"read"` precisely because a write connection is more expensive server-side — it occupies a write slot and participates in join/leave and quorum tracking — so view-only clients are meant to *not* connect write until they actually edit; forcing write for every client regresses that. (ii) It removes **no** F9 code: the `_readonlyPermissions` check still runs on every connection (`:828` — a `write` *request* is still downgraded to readonly if the token lacks `DocWrite`), `storageOnly`/`_forceReadonly` still apply, and the `read → write` upgrade branch (`sendMessages` `:1098`, `shouldJoinWrite` `:270`, reconnect-as-read fallback) stays reachable at runtime and can't be tree-shaken. So the mode is already app-configurable, but starting in write mode neither shrinks the bundle nor makes F9 stubbable — it just trades server-side scalability for skipping one lazy upgrade.
- **Optionality — load-bearing (not stubbable).** The three inputs and the upgrade path are threaded directly through `ConnectionManager`'s connect/reconnect/send flow — there is no module seam to redirect. Stubbing `readonly` to a constant `false` would let a no-scope client *think* it can send (nacks/data loss); stubbing to `true` would break editing. No size win here regardless: this is a handful of fields and branches inside already-required connection code, not a separable module.
- **Proposal.** *Do not touch.*

### F10 — Aliased data stores

- **Code.** `ContainerMessageType.Alias` `messageTypes.ts`; inbound routing `containerRuntime.ts:3373` (`case ContainerMessageType.Alias`) → `channelCollection.processMessages(...)`; `processAliasMessageCore()` `channelCollection.ts:594`; retrieval `getAliasedDataStoreEntryPoint()` `containerRuntime.ts:3772`; stashed-alias case `containerRuntime.ts:2786`.
- **When active (no polyfill).** **Inbound routing is unconditional** — if any client sends an alias op, every client processes it. **Creating** an alias (`aliasDataStore`/`.trySetAlias`) is on-demand and not exercised by this bundle's default-store flow. Note aqueduct's `getDefaultFluidObject` uses the *root* datastore path, which is alias-adjacent.
- **In `encapsulated-no-tree`.** The default single data store does not send alias ops, but the inbound `case` still ships.
- **Optionality — load-bearing (inbound), and the outbound "creation API" does *not* actually tree-shake.**
  - **Inbound (must stay).** The `case ContainerMessageType.Alias` arms are reached by any peer's alias op and cannot be dropped. There are several, each a distinct lifecycle phase, all unconditionally reachable: initial processing `containerRuntime.ts:3373` → `channelCollection.processMessages` → `processAliasMessages`/`processAliasMessageCore` `channelCollection.ts:941`/`:594` (mutates `aliasMap`, `aliasedDataStores`, `context.setInMemoryRoot()`); resubmit `channelCollection.ts:800` (`reSubmitContainerMessage`); apply-stashed `channelCollection.ts:858` (no-op return, but the arm is present); plus container-runtime stashed/rollback arms `containerRuntime.ts:2786`/`:5003`. A single client cannot know a peer won't alias, so none of these are removable without a session-wide "nobody ever aliases" guarantee.
  - **Outbound / creation (does NOT tree-shake — earlier claim corrected).** The creation surface is `DataStore.trySetAlias()`/`trySetAliasInternal()` `dataStore.ts:79`/`:129`, which submits the `Alias` op (`dataStore.ts:149`). `trySetAlias` is an **instance method of the `DataStore` class**, and that class is instantiated unconditionally by `channelToDataStore()` `dataStore.ts:57` — wired as `channelToDataStoreFn` into **every** `FluidDataStoreContext` (`channelCollection.ts:770`) and also called from `containerRuntime.ts:3821`. Terser cannot prove that closure is never invoked, so it retains `channelToDataStore` → the `DataStore` class → all its methods, including `trySetAlias`. **Therefore the creation API ships even though this bundle's default-store flow never calls it** — class methods of an instantiated class are not dead-code-eliminated. (It is *runtime*-unreached, but not *tree-shaken*.)
- **What "a peer could alias" actually means (and the homogeneous-feature-set caveat).** The precise claim is: *some other writer to this durable document could emit an `Alias` op that this client must process*, and this client has no control over that. It does **not** rest on clients within one app build having different features. Even granting that every client "intends" the same feature set, that is not a safe basis for removing the inbound arm, because:
  - **A Fluid document is durable and multi-version over time.** The op stream and persisted/stashed state are a **wire + persistence contract**, not a per-build feature toggle. The same document can be opened later (or concurrently) by an **older or newer app build**, a **different app** pointed at the same document, or a **replayed stashed alias op** from pending local state. Any of those can carry an `Alias` op into a client running the stubbed bundle.
  - **Rollouts are not atomic — this is the eventual-consistency point.** Even if the *intended* end state is "all clients run the alias-free bundle," clients do not switch versions simultaneously. During any staged rollout there is necessarily a window where a still-connected older client (which *does* alias) coexists with new stubbed clients. Because aliasing travels on the shared op stream, one aliasing writer affects **every** peer.
  - **The failure mode is catastrophic and session-wide, not a local degradation.** Unlike the summarizer/GC stubs (which remove a *local* capability this client controls), the alias arm handles **remote** input. If the arm is absent, an inbound alias op falls through to the `default` case, which calls `this.closeFn(error)` and throws `containerRuntime.ts:3412`-`:3419` — i.e. the container **closes** for that client. So a violated "nobody aliases" assumption doesn't silently no-op; it takes down the session for any client that received the op. That asymmetry (remote-triggered, close-on-violation) is exactly why this can't be gated on a mere convention that clients share a feature set.
- **Proposal.** *Do not stub.* The inbound arms are genuinely load-bearing, and the outbound `trySetAlias` rides along inside the always-instantiated `DataStore` class, so there is no free tree-shake to capture. Removing either would require a session-wide, all-time "no aliasing" precondition (inbound) or a refactor splitting `trySetAlias` out of `DataStore` behind a separate entry point (outbound) — both high-effort for a small `switch` arm + one method. Not worth it.

### F11 — Signals

- **Code (full footprint — send, receive, tracking, transport, and the pieces I originally undercounted).**
  - **Send chain (forwarders):** `ContainerRuntime.submitSignal()` `containerRuntime.ts:3886` → `submitSignalFn` `:1723` → **`sequenceAndSubmitSignal` `:1714`** (this is the piece I missed: it calls `signalTelemetryManager.applyTrackingToBroadcastSignalEnvelope(envelope)` `:1719` before submitting, so *send* is entangled with telemetry) → `Container.submitSignal` `container.ts:2359` → `DeltaManager.submitSignal` `deltaManager.ts:347` → `ConnectionManager.submitSignal` `connectionManager.ts:1082` → driver `documentDeltaConnection.submitSignal` `driver-base/.../documentDeltaConnection.ts:373`. Per-datastore submit plumbing: `channelCollection.submitSignal` `channelCollection.ts:299`/`:1793`, `DataStoreContext.submitSignal` `dataStoreContext.ts:967`, `FluidDataStoreRuntime.submitSignal` `dataStoreRuntime.ts:1263`. Extension send: `submitExtensionSignal` `:1729`.
  - **Receive chain:** driver `connection.on("signal", …)` → `ConnectionManager.signalHandler` `connectionManager.ts:1177` (+ `assertExpectedSignals`) → **`DeltaManager._inboundSignal` — a dedicated `DeltaQueue<ISignalMessage>` `deltaManager.ts:221`/`:489`** (another piece I missed: signals get their own queue, paused/resumed/cleared alongside the op queue `:611`/`:819`/`:824`) → `ContainerRuntime.processSignal()` `:3453` → `routeNonContainerSignal()` `:3487` → container ⇒ `emit("signal")` `:3480`; datastore ⇒ `channelCollection.processSignal` `:3505` → `DataStoreContext.processSignal` → `channel.processSignal`; `/ext/…` ⇒ extension `:3514`.
  - **Signal telemetry — the one genuinely sizeable dedicated module:** `SignalTelemetryManager` `signalTelemetryProcessing.ts` (**8,990 B source / ≈3.05 KB parsed**), tracking lost/out-of-order/round-trip latency. Reached from **both** send (`applyTrackingToBroadcastSignalEnvelope`) and receive (`trackReceivedSignal` `:3470`, `resetTracking` on reconnect). **This is F22 → off-limits.**
  - **Connection-state gating & signal-based audience (also previously uncounted):** `canSendSignals` state recomputed in the connection-state handler `containerRuntime.ts:1811`/`:3014`-`:3030`; and an **optional** `signalAudience?: IAudience` `:3851` that "maintains member list using signals only" — `undefined` unless explicitly enabled, so **already absent** in this scenario (does not tree-shake away the *plumbing*, but carries no instance cost here).
- **When active (no polyfill).** Unconditional public protocol surface; no gate. The dedicated `DeltaQueue`, `canSendSignals` bookkeeping, and `SignalTelemetryManager` are all constructed regardless.
- **In `encapsulated-no-tree`.** The only **first-party** signal *sender* is **presence** (`presence-runtime`'s `presenceDatastoreManager.submitSignal` calls), a **separate, opt-in package not in this bundle**. No in-bundle FF code sends signals on the minimal path; `SharedString`/`SharedDirectory` do not use signals; `signalAudience` is not enabled. The transport receive-wiring, inbound signal queue, and telemetry are still present.

#### F11 under a "client never touches the Signal APIs" guarantee

- **Assumptions (as stated).**
  - **A1 — No app sends.** App code never calls any signal *send* API (`ContainerRuntime.submitSignal`, `IFluidDataStoreRuntime.submitSignal`, or a channel-level submit), directly or transitively (no presence, no custom signaler).
  - **A2 — No app receives.** App code never subscribes to inbound `"signal"` events in a way that matters (no handler whose absence changes correctness).
  - **A3 — Guard shape.** On the send side FF replaces the API with either **(a) throw-on-use** or **(b) no-op + telemetry**; you prefer **(b)** as safer in production (a stray call degrades instead of crashing).
- **What changes vs. the original "load-bearing / do not touch".**
  - **Send path becomes legitimately stubbable — but is entangled with telemetry.** Under A1, `submitSignal` and the datastore/channel submit plumbing can be replaced with (b) no-op-plus-telemetry safely. This is a **real** reclassification — *not* load-bearing the way F9 (read-only) or F10 (alias inbound) are. **Correction to my earlier claim of "no subgraph":** there *is* dedicated machinery behind the send path — but it is precisely `sequenceAndSubmitSignal`'s call into `SignalTelemetryManager` (F22). The forwarders themselves are thin, and the actual wire send lives in `ConnectionManager`/driver, which is required for ops regardless. So stubbing send removes only a few lines *unless* you also cut the telemetry hook — which is off-limits.
  - **Receive path is *safe to no-op* but does not cleanly remove, and now includes a dedicated queue.** Asymmetry vs. F10 aliasing: an inbound signal with no route does **not** close the container — `routeNonContainerSignal` just logs `SignalAddressNotFound` `:3520` (contrast the alias/unknown-op `default` arm, which calls `closeFn` and throws). Signals are **ephemeral** (never persisted/stashed), so unlike aliasing there is no durable-document exposure — only the same non-atomic-rollout window. But `processSignal`/`routeNonContainerSignal`/`channelCollection.processSignal` are **methods on unconditionally-instantiated classes**, and the receive path also drags in the **`_inboundSignal` `DeltaQueue`** and the `trackReceivedSignal` telemetry — none of which tree-shake. Removing them is a manual, multi-site stub, not a free DCE win.
  - **Telemetry stays (F22, off-limits) and it is the bulk.** `SignalTelemetryManager` (~3 KB parsed) is the single largest dedicated signal artifact, and it is reached from **both** directions. It is excluded from reduction by project decision. So the one piece with real size is exactly the piece we've agreed not to touch — and because send/receive both route *through* it, even the thin stubs can't cleanly drop it.
- **Conclusion.** The guarantee **does** change the *classification*: the **send** API is safely gate-able (prefer **A3(b) no-op + telemetry**) and the **receive** path is safe to no-op because an unhandled signal logs rather than closes — so F11 is **not** load-bearing in the strong sense I originally stated. **But it does not change the recommendation.** Having now enumerated the full footprint (forwarders + dedicated `DeltaQueue` + `canSendSignals` gating + optional-and-absent `signalAudience` + `SignalTelemetryManager`), the touchable, non-telemetry portion is thin forwarders and a queue that don't tree-shake, while the only sizeable dedicated module (`SignalTelemetryManager`, ~3 KB) is F22/off-limits and sits on both paths. **Net practical reduction ≈ negligible (well under the 5 KB bar).** Recommend **no dedicated stub** unless it falls out of a broader transport/telemetry refactor; if a guard is added for API-hygiene reasons, use **no-op + telemetry**, not throw.

### F12 — Join/leave handling (messages or signals)

- **Code.** Protocol/quorum + `Audience.addMember`/`removeMember` (`audience.ts`); driven by the protocol handler on join/leave ops.
- **When active (no polyfill).** Unconditional whenever connected.
- **In `encapsulated-no-tree`.** Load-bearing — audience/quorum rosters depend on it; the service expects join/leave semantics.
- **Optionality — load-bearing.** Protocol-level; not removable.
- **Can we remove F12 without removing F11 (Signals)?** **No** — the two are entangled in both directions, verified by code:
  - **(a) For read-mode clients, join/leave _is_ a signal — it rides F11's exact receive path.** In this scenario the default `client.mode` is `"read"` (F9; `container.ts:1964`). Read-client membership is not delivered as ops — it is delivered as **system signals** `SignalType.ClientJoin` / `ClientLeave` / `Clear` handled by `ProtocolHandler.processSignal` (`protocol.ts:162`-`194`; only these three types, gated by `protocolHandlerShouldProcessSignal` on `clientId === null` at `protocol.ts:206`). The comment at `protocol.ts:128` is explicit: *"Join / leave signals are ignored for 'write' clients in favor of join / leave ops"* — i.e. read clients rely on the **signal** form. These arrive through the same inbound signal dispatch F11 uses: `connection.on("signal", this.signalHandler)` (`connectionManager.ts:860`), plus the synthesized `Clear` + per-`initialClients` `ClientJoin` signals fed to `props.signalHandler` (`connectionManager.ts:917`-`956`). So you cannot "keep signals but drop join/leave" — for a read client, dropping the join/leave handling means dropping a mandatory consumer wired into the shared signal transport that F11 depends on.
  - **(b) F11's own send/self-identification depends on the membership F12 establishes.** The signal receive path keys telemetry and self-detection on `message.clientId === this.clientId` (`containerRuntime.ts:3469`) and honors directed `targetClientId` (`:3465`); "self" `clientId` is only established once the client reaches the **Connected** state, and that transition is gated on observing our own join and the prior client's leave (`connectionStateHandler.ts:512`-`521`, wired via the `addMember`/`removeMember` membership events at `:728`-`745`). F11's *send* is likewise gated by `canSendSignals`, which is tied to connection state. Remove F12 → the client never reaches Connected → no self `clientId` → F11 send and self/targeted-signal identification break.
  - **Conclusion.** F12 is not a separable module layered on top of F11; it is (a) partly delivered _as_ F11 signals for read clients and (b) a prerequisite for F11's connected-state/`clientId` machinery. Removing F12 while keeping F11 is not possible.
- **Proposal.** *Do not touch.*

### F13 — Heartbeats (no-op / keep-alive)

- **Definition (unambiguous).** "Heartbeat" here = the periodic, idle-time messages a client emits that carry **no application payload** and exist only to keep the session healthy. There are exactly **two** such mechanisms in the client, one per half of the title:
  - **H1 — No-op heartbeat ("no-op", MSN keep-up).** Periodic `MessageType.NoOp` ops that advance the client's reference sequence number so the service can move the **minimum sequence number (MSN)** forward and trim the collab window. **Server-visible protocol behavior.**
  - **H2 — Ping/pong heartbeat ("keep-alive", latency probe).** A driver socket `ping` emitted once per minute whose `pong` round-trip time is recorded. **Purely observational** — it feeds latency telemetry and has **no** protocol/server effect (the actual socket transport keep-alive is socket.io's own internal heartbeat, which is not FF code).
- **Code — H1 (no-op).** `NoopHeuristic` (`noopHeuristic.ts`, whole module, 4,916 B source) emits `"wantsNoop"` on time (2000 ms) / count (50 ops) thresholds; wired in `container.ts` — field `:573`, lazily constructed on first `"connected"` `:2333` from `IClientConfiguration.noopTimeFrequency`/`noopCountFrequency` (`config.ts:30`/`:37`; `+Infinity` disables), `"wantsNoop"` → `submitMessage(MessageType.NoOp)` `:2337`-`:2345`, `notifyMessageSent` `:2297`, `notifyMessageProcessed` `:2348`, `notifyDisconnect` `:2057`. Plus the surrounding no-op protocol plumbing: `immediateNoOp` accept-path in `protocol/protocol.ts:104`/`:142`/`:153`; `deltaManager.ts` NoOp handling (`:335`, unacked-noop accounting `:200`, `:1088`-`:1102`); `messageRecognition.ts:33` (`NoOp`/`Accept` are service-coalescable).
- **Code — H2 (ping/pong keep-alive).** `documentDeltaConnection.ts` (driver-base): `"pong"` in `eventsToForward` `:58`; `trackLatencyTimeout` `:92`; the `sendPingLoop` that `socket.volatile.emit("ping", …)` then `emit("pong", Date.now() - start)` and re-arms after `1000*60` ms `:185`-`:202`; teardown `:450`-`:452`. Consumed **only** by connection telemetry: `ReportOpPerfTelemetry` registers `deltaManager.on("pong", …)` `connectionTelemetry.ts:200` → `recordPingTime` `:323`-`:340` (fields `pingLatency` `:77`, `LatencyTooLong`/`DeltaLatency` events), surfaced in the `OpRoundtripTime` log `:434`.
- **When active (no polyfill).**
  - **H1:** Lazy (only after first connect) and **service-tunable**; it is fundamentally a **write-client** behavior — a read-only client that never sends ops does not advance MSN and does not emit noops (`noopHeuristic.ts:27`, `config.ts:22`: "a client with 'write' connection needs to send noop").
  - **H2:** **Self-gating** — the ping loop is only started when a `"pong"` listener is registered (`documentDeltaConnection.ts:184`-`:185`), and the *sole* registrant is the op-perf telemetry (`ReportOpPerfTelemetry`, constructed in `containerRuntime.ts:2176`). No telemetry listener ⇒ no ping loop ⇒ zero cost.
- **In `encapsulated-no-tree`.**
  - **H1:** Only engages once the client upgrades to **write** on first edit (F9). While purely viewing (read) it is dormant. When writing, it is load-bearing for MSN/collab-window health, and its effect is **server-visible**.
  - **H2:** Runs in practice because op-perf telemetry is wired unconditionally, but it is **pure telemetry** and produces no protocol effect.
- **Optionality.**
  - **H2 — telemetry, off-limits and already gated.** The "keep-alive" half is entirely observability. It falls under **F22 (telemetry — excluded as a reduction lever by project decision)**, *and* it is naturally gated behind a telemetry listener, so there is no independent bundle lever here regardless.
  - **H1 — stub (risky), server-visible.** `NoopHeuristic` is a clean module seam and stubbable, but suppressing noops has a **server-visible** effect (delayed MSN advancement / collab-window growth), unlike the pure-observability H2. Only safe if the service tolerates a silent write client.
- **Proposal.** *Prefer config over code; do not treat telemetry as a lever.*
  - **H1:** Recommend the service set `noopTimeFrequency`/`noopCountFrequency = +Infinity` for this client class rather than a bundle stub; do not stub without server-side sign-off. Small win (~<1 KB; `noopHeuristic.ts` ≈ 4.9 KB source, far less parsed).
  - **H2:** *Do not touch* — telemetry (F22) and self-gating; no dedicated stub. Net practical reduction for F13 overall ≈ negligible.

### F14 — Audience

- **Code.** `Audience` class `audience.ts:15` (`getMembers`/`getMember`/`getSelf`/`addMember`/`removeMember`/`setCurrentClientId`). **Two** instances, both constructed unconditionally: the primary `new Audience()` at `container.ts:781` (exposed as `container.audience` `:678` and handed to the runtime as `_audience`), and a dedicated **`signalAudience = new Audience()`** at `container.ts:436`. Interfaces `IAudience`/`IAudienceOwner`/`ISelf`/`IAudienceEvents` live in `container-definitions/audience.ts`.
- **When active (no polyfill).** Unconditional; public API + protocol-integrated member tracking. Both `Audience` instances are always live.
- **In `encapsulated-no-tree`.** `container.audience` is public API; the runtime consumes it (`getAudience()` `containerRuntime.ts:3841`, connection-state self-check `:2918`, extension host `:5465`/`:5475`).

- **Size — is splitting it out a significant win? No, even with API changes.**
  - The entire *runtime* footprint of F14 is the single `Audience` **class** (`audience.ts` ≈ 3,453 B source → well under ~1.5 KB minified+parsed). Two instances share **one** class definition, so instance count does not add bundle bytes.
  - The interface surface (`IAudience`/`IAudienceOwner`/`ISelf`/`IAudienceEvents`, `container-definitions/audience.ts` ≈ 7,654 B source) is **type-only** — fully erased at compile time, **zero** runtime bytes. Removing it from the public API changes the `.d.ts`/API report but frees no shipped code.
  - So even granting your willingness to make API changes, the reachable saving is one small class (~1–1.5 KB parsed) — **below the 5 KB candidate bar**. There is no large hidden subgraph behind `Audience` to shed (it is a `Map` plus a `TypedEventEmitter`).

- **Intertwined with Signals — agreed, they are not separable.** Audience is *both fed by* signals and *a dependency of* the signal receive path:
  1. **Population of read-client membership is delivered _as_ signals.** For read-mode clients (the default here, F9), membership is not carried by ops — it arrives as `SignalType.ClientJoin`/`ClientLeave`/`Clear` **system signals** handled by `ProtocolHandler.processSignal` (`protocol.ts:162`-`194`) and the synthesized initial-clients signals (`connectionManager.ts:917`-`956`), i.e. the exact F11/F12 inbound signal transport. (Write-client membership comes from the quorum via ops; read clients are signal-only — see the `mode === "read"` gates at `protocol.ts:168`/`:177`/`:185`.)
  2. **The signal _receive_ path depends on Audience for self/local detection.** `Container.processSignal` — the dispatcher for **every** non-system inbound signal (F11) — computes the `local` flag from `this.signalAudience.getSelf()?.clientId` on each signal (`container.ts:2363`-`2377`). So there is no signal delivery without an Audience to answer "is this mine?".
  3. **There is a _dedicated_ second Audience just for signals.** `signalAudience` (`container.ts:436`) exists solely to track the signal-visible roster (including read clients), always wired through `wrapProtocolHandlerBuilder` (`container.ts:770`-`785`, `protocol.ts:217`-`260`) and maintained by signal join/leave (`protocol.ts:236`-`249`). The container-extension host also sources `getClientId`/`getAudience` off it (`containerRuntime.ts:5462`-`5475`).
- **Optionality — load-bearing, and inseparable from Signals.** Cannot be split from Signals in either direction: read-client population *is* signals (1), and the signal receive path *consumes* Audience (2), with a whole second instance dedicated to signals (3). Public API surface too. Not removable, and not independently reducible.
- **Proposal.** *Do not touch.* Even under a willingness to break API, the standalone code is a single ~1–1.5 KB class (no subgraph), so it is below the reduction bar; and the Signals entanglement means it cannot be cleanly split regardless. Treat Audience and Signals as one feature for reduction purposes.

### F15 — Batching modes / configurations

- **Reframing (per review).** The proposal is *"we don't need **any of the existing** batching modes/configurations on the default codepath — pick one reasonable default, and let a client opt back into the others."* The question is therefore: **what are the individual batching modes/configurations, and does dropping the non-default ones from the default path remove code?**
- **Authoritative source.** The [`opLifecycle` README](../../../../../packages/runtime/container-runtime/src/opLifecycle/README.md) ("Configs and feature gates for solving the 1MB limit") is the ground truth. It frames batching as **one subsystem** with **three virtualization features** — *grouped batching*, *compression*, *chunking* — **all enabled by default**, plus the `FlushMode` that governs batch formation. Two facts from it shape this analysis:
  - **`FlushMode` is immutable for the entire runtime/container lifetime** (README "How batching works"), and **`FlushMode.Immediate` is just a degenerate `TurnBased`** ("for all intents and purposes, `Immediate` enables all batches to have only one op"). So Immediate is not a distinct implementation to ship/shed — it is the same pipeline with single-op batches.
  - **The three features are a strict outbound *pipeline*: `groupBatch → compress → chunk`** (README "Outbound" state diagram), with **compression enabled only if grouped batching is enabled**, and **chunking only over already-compressed batches**. Inbound is the symmetric reverse.
- **The individual modes/configurations (exhaustive).** They are **runtime *option* values** on `ContainerRuntimeOptionsInternal` (`containerRuntime.ts:396`-`528`), not separate code units:
  1. **`flushMode`** `FlushMode.Immediate | FlushMode.TurnBased` (`containerRuntime.ts:521`; default **TurnBased**, immutable per README). Consumed by a 2-arm inline `switch` in `scheduleFlush` (`containerRuntime.ts:4870`-`4889`) and a guard at `:3631`.
  2. **`enableGroupedBatching`** `boolean` (`:456`/`:527`; default **true**). Selects whether `OpGroupingManager.groupBatch` collapses a batch to one message. Flag threaded via `groupedBatchingEnabled` into the always-constructed `new OpGroupingManager(...)` (`:1817`). First stage of the pipeline.
  3. **`maxBatchSizeInBytes`** `number` (`:426`; default **700 KB** — the README's `716800`/1MB-margin knob) — a *threshold value* checked in `Outbox`; no per-value code.
  4. **`compressionOptions`** (`:415`) — pipeline stage 2 = **F4**, analyzed separately.
  5. **`chunkSizeInBytes`** (`:440`) — pipeline stage 3 = **F5**, analyzed separately.
  - (Adjacent, not a wire-batching mode: `stagingModeAutoFlushThreshold` `:483`, a staging-mode flush count.)
- **Why you couldn't find "individual batching modes" as code.** There are none to find: **the modes are data (enums/booleans/numbers) interpreted over one shared implementation** (`Outbox` `opLifecycle/outbox.ts` ≈ 24.4 KB, `BatchManager` `batchManager.ts` ≈ 6.8 KB). Selecting a different mode flips a branch at runtime; it does not swap in/out a module. Every mode's code is compiled into the same `Outbox`/`BatchManager`/`OpGroupingManager` classes, all instantiated unconditionally (`containerRuntime.ts:1817`, `:2059`). `FlushMode` being lifetime-immutable underscores this — there is not even a per-mode state machine, just a fixed branch.
- **Does dropping non-default modes from the default path remove code? Essentially no.**
  - **`flushMode`:** Immediate is a degenerate TurnBased (README), implemented as ~3 lines *inside* `scheduleFlush`; it is not a separable module and does not tree-shake. Hard-coding TurnBased and letting clients opt into Immediate frees ≈ 0 bytes.
  - **`enableGroupedBatching`:** grouping is the **default (on)** and the pipeline's first stage, so the default path *uses* it — nothing to drop. The inbound side is **load-bearing for interop**: `RemoteMessageProcessor` calls `isGroupedBatch` / `opGroupingManager.ungroupOp` on every inbound batch (`remoteMessageProcessor.ts:156`,`:161`-`:166`). The README is explicit that a client **must still read legacy ops** it no longer produces ("As of 2.20.0, we no longer compress ungrouped batches, but we do need to read such ops"), which is exactly why the inbound reverse-pipeline cannot be stubbed on a per-client basis. `OpGroupingManager` (≈ 6.7 KB) is strictly required.
  - **`maxBatchSizeInBytes`:** a number; nothing to remove.
- **When active (no polyfill).** Unconditional. Defaults (2.0.0-defaults): `flushMode = TurnBased`, `enableGroupedBatching = true` (`containerCompatibility.ts:108`-`115`,`142`-`148`). Every op submission flows through the one `Outbox` pipeline.
- **In `encapsulated-no-tree`.** Load-bearing — outbound op formation + inbound reverse-pipeline (ungroup/decompress/dechunk). All modes share the same `Outbox`/`BatchManager`/`OpGroupingManager` code, so choosing "Immediate / no-group" removes no module.
- **Optionality — load-bearing; the only real code weight lives in F4/F5.** The batching *core* (Outbox/BatchManager) is the submit path and is not stubbable without replacing op submission. The mode *selectors* are data, not code. Of the README's three virtualization features, the two with genuinely-separable code — **compression (F4)** and **chunking (F5)** — are already carved out as gated-stub candidates; the third (**grouped batching**) is default-on and interop-required. F15 has no additional separable subgraph.
- **Proposal.** *Do not touch (as a batching-modes lever).* Even granting API changes to make modes opt-in, the reclaimable bytes within F15 proper are ≈ nil (a degenerate inline `FlushMode` arm + a default-on, interop-required grouping manager). Pursue size **only** via F4/F5 (compression/chunking), which is where the removable pipeline stages actually live — and per the README's pipeline ordering, only under the session-wide "no peer compresses/chunks" precondition those features already document.

### F16 — Container garbage collector

- **Code.** `GarbageCollector.create(...)` `containerRuntime.ts:1932`; `gc/garbageCollection.ts` (+ `gcConfigs.ts`, `gcTelemetry.ts`, unreferenced/summary-state trackers).
- **When active (no polyfill).** Instantiated unconditionally. **Mark** runs on all clients when `shouldRunGC` (= `gcAllowed`, default true for new docs) and connected (`garbageCollection.ts:468`); **sweep** is off by default (`enableGCSweep` unset); tombstone-throw only on non-summarizer clients with sweep on.
- **In `encapsulated-no-tree`.** **Already stubbed** — `gc/garbageCollection.js` → `garbageCollectionStub.js` (`shouldRunGC === false`). Valid because this client summarizes server-side and doesn't rely on sweep. See [POLYFILL_VALIDITY.md](./POLYFILL_VALIDITY.md) §1.5.
- **Optionality — stub (done).** ~−20.9 KB parsed already realized.
- **Proposal.** *No new work.* Reference existing stub.

### F17 — Summarizer election / task manager

- **Code.** Gate at `containerRuntime.ts:2324-2331` (`!onRequestMode && (clientDetails.capabilities.interactive || clientDetails.type === summarizerClientType)`), reached only via `await import("./summary/summaryManagerDelayLoadedModule/index.js")` `:2338`; `SummarizerClientElection`/`OrderedClientElection`/`SummaryManager` under `summary/`.
- **When active (no polyfill).** For interactive non-summarizer clients the gate is true, so the election module *is* dynamically loaded and `setupSummaryManager` runs; it just never wins for a server-side-summarizing deployment.
- **In `encapsulated-no-tree`.** **Already stubbed** — the delay-loaded module → `summaryManagerDelayLoadedModuleStub.js` returns an empty `SummaryManagerSetupResult`. The gating condition is *inlined* precisely so the bundler can drop the real subgraph. See [POLYFILL_VALIDITY.md](./POLYFILL_VALIDITY.md) §1.3.
- **Optionality — stub (done).** ~−15.6 KB parsed already realized. (No separate `TaskManager`/agent-scheduler in this graph — election is the mechanism.)
- **Proposal.** *No new work.* Reference existing stub.

### F18 — Delayed (lazy) loading of channels (DDS)

- **Code — the three channel contexts (all in `packages/runtime/datastore/src/`).** DDS realization is mediated by `IChannelContext` (`channelContext.ts:37`) with three implementations, **all referenced unconditionally** by `FluidDataStoreRuntime` (`dataStoreRuntime.ts:109`-`114`) and therefore all retained in the bundle:
  - `LocalChannelContext` (`localChannelContext.ts:324`) — a **freshly created** DDS. The channel already exists; `super(...)` is handed `Promise.resolve(channel)` and `_channel = channel` (`:348`-`:349`), so it is effectively **eager** already.
  - `RehydratedLocalChannelContext` (`localChannelContext.ts:210`) — a locally-created DDS rehydrated from a detached snapshot; **lazy** via `Lazy<ChannelServiceEndpoints>` + `LazyPromise<IChannel>` (`:227`,`:249`).
  - `RemoteChannelContext` (`remoteChannelContext.ts:42`) — a DDS loaded from an **existing document / peer snapshot**; **lazy** via `channelP = new LazyPromise(...)` (`:90`) that calls `loadChannelFactoryAndAttributes` + `loadChannel` on first `getChannel()` (`:154`). **This is the path a client that opens an existing document takes.**
- **What the delay-load machinery actually is (how much code).** Lazy loading is **not** a separable module — it is a handful of mechanisms interwoven into the three context classes:
  1. **Deferred realization wrappers:** `LazyPromise<IChannel>` (remote `:90`, rehydrated `:249`) and `Lazy<ChannelServiceEndpoints>` (local/rehydrated `:227`,`:338`). ~2–3 lines each.
  2. **Pending-op buffering:** `pendingMessagesState` queue + the `else` branch in `processMessages` that stores ops arriving before the channel materializes (remote `:47`,`:182`-`:197`; local `:46`,`:97`-`:107`), replayed inside the `LazyPromise` once loaded (remote `:112`-`:118`, rehydrated `:266`-`:268`), plus a `ThresholdCounter` for pending-op telemetry (remote `:56`,`:147`).
  3. **`isLoaded` state + guards:** early-returns/asserts in `setConnectionState`, `reSubmit`, `rollback`, `applyStashedOp` (remote `:158`-`:210`; local `:71`-`:125`), and the "re-apply connection state after the await" fix-up (remote `:125`-`:127`).
  - Everything *else* in these ~28.7 KB of source (summarizer-node wiring, `getGCData`, `summarize`, delta-connection/storage plumbing, attach-summary, resubmit/rollback) is **channel lifecycle that is required whether loading is lazy or eager.**
- **Why we delay-load in general (perf first, correctness second).**
  - **Primary: startup performance / scale.** A document can contain many DDSes. Eagerly realizing every channel at data-store load means reading and deserializing **every** channel's `.attributes` blob from storage and running every `factory.load` up front. Lazy loading pays only for DDSes actually touched, so container load is independent of DDS count. This is the dominant motivation.
  - **Secondary: async construction is intrinsic.** Channel realization is unavoidably **async** — `loadChannelFactoryAndAttributes` awaits `objectStorage.contains`/`readAndParse` and `loadChannel` awaits `factory.load` (`channelContext.ts:140`-`213`). A constructor cannot be async, so *some* deferral is inherent; "eager" would just mean "await all channels during data-store load" rather than "no async."
  - **Correctness accommodation: ops-before-load.** A remote peer can sequence ops for a channel this client has not yet materialized. The `pendingMessagesState` queue exists to hold those ops and replay them in order once the channel loads (`remoteChannelContext.ts:112`; comment at `localChannelContext.ts:92`-`94`). Any design still has to handle this window.
- **Can it be refactored to exclude the delay-load parts, and does that reduce the bundle? No.**
  - **The context classes cannot be removed.** `RemoteChannelContext` is *the* mechanism by which a client opening an existing document realizes `SharedString`/`SharedDirectory`; an interactive editor loads existing documents, so it is load-bearing (cannot be tree-shaken on a "create-only" assumption). Making it eager would replace `LazyPromise` with a direct `await` **elsewhere** — the class, its summarizer/GC/connection/resubmit surface, and `loadChannel` all still ship.
  - **The removable lines free ≈ 0 bundle bytes.** The delay-load-specific code is a few dozen interwoven lines, not a subgraph. Its helpers are **already in the bundle for other reasons**: `LazyPromise` is used for the data-store/container entry points (`dataStoreRuntime.ts:509`, `containerRuntime.ts:2179`), `Lazy` at `containerRuntime.ts:5350`, `ThresholdCounter` in `dataStoreContext.ts` — so dropping their use in channel contexts removes no module.
  - **It would likely *add* code and cost.** Removing lazy forces an eager-orchestration path (await/realize all channels at load) **plus** you must *still* keep the pending-op buffer for the async load window — a net wash or increase in code, a definite regression in load-time performance, and no bundle win.
- **When active (no polyfill).** Lazy by design for remote/rehydrated channels; eager for freshly-created local channels. All three contexts are retained unconditionally.
- **In `encapsulated-no-tree`.** Load-bearing — this *is* how `SharedString`/`SharedDirectory` get realized, both on create (`LocalChannelContext`) and on open-existing (`RemoteChannelContext`).
- **Optionality — load-bearing; not a size lever even with API changes.** The lazy mechanism is inseparable from the channel-context classes that must ship anyway; its dedicated code is tiny and its helpers are already bundled. Refactoring to eager yields no reduction (plausibly a regression) and costs startup performance.
- **Proposal.** *Do not touch.* Not a bundle-size opportunity: removing delay-load frees ≈ 0 bytes, cannot remove the required `RemoteChannelContext`, and would trade a load-time perf optimization for nothing.

### F19 — Delayed loading of data stores / more than one

- **Code.** Context creation in `ChannelCollection` (snapshot iteration); `FluidDataStoreContext.realize()` `dataStoreContext.ts:578`; multi-store create APIs `ContainerRuntime.createDataStore` `containerRuntime.ts:3813` / `createDetachedDataStore` `:3806`, delegating to `ChannelCollection.createDataStoreContext` `channelCollection.ts:739` / `createDetachedDataStore` `:727` → `createContext` `:751`.
- **When active (no polyfill).** Contexts for existing stores are created on load; `realize()` is on-demand. `createDataStore`/`createDetachedDataStore` only *run* if the app makes more stores.
- **In `encapsulated-no-tree`.** The single default store's `realize()` is load-bearing. The **multi-store create** APIs are runtime-**unreached** but — see below — are **not** dead-code-eliminated.
- **DCE re-evaluation (correcting an earlier claim).** The prior note that "the multi-store create paths tree-shake / already dead-code if unused" is **wrong** — same trap as F10 (`trySetAlias`):
  - `createDataStore`/`createDetachedDataStore` are **`public` methods on `ContainerRuntime`** (class `containerRuntime.ts:870`), which is instantiated unconditionally by `loadRuntime`. Their delegates are **`public`/`protected` methods on `ChannelCollection`** (`channelCollection.ts:319`), instantiated unconditionally at `containerRuntime.ts:2003`.
  - **Class methods of an instantiated class are not DCE'd.** A bundler (webpack/terser) cannot prove a public instance method is never dynamically dispatched, so it is retained even when statically unreached. These APIs therefore **ship regardless** of whether the app creates additional stores.
  - There is also **no separable subgraph** to shed even in principle: the create path funnels through `createContext` `:751`, which statically references `LocalFluidDataStoreContext`/`LocalDetachedFluidDataStoreContext` and `channelToDataStore` — and those are **already on the container-create/attach path** for the *single* default store (the initial store is itself created via a local/detached context). So "multi-store create" reuses machinery that is present anyway; it is not distinct removable code.
- **Optionality — load-bearing (single) / present-but-unreached (multi-create).** The context/`realize` infrastructure ships regardless. The create-more APIs are **not** free to drop via DCE; removing them would require an **explicit API change** (deleting/gating the methods), and even then the shared context machinery (`createContext`, the local context classes, `channelToDataStore`) stays because the single-store create/attach path uses it. Net removable bytes ≈ nil.

- **Multi-store vs single-store code partition (proper decomposition).** The user asked for an honest split — which of `ChannelCollection`'s 1,900 lines is *only* needed when there is more than one data store, versus what the single default store already requires. The answer is that the multi-store-exclusive surface is **much narrower** than it first appears, because the single default store is itself *created, attached, and op-routed through the same machinery*:
  - **Both `FluidDataStoreContext` subclasses are baseline.** The constructor's snapshot-load loop news up `RemoteFluidDataStoreContext` (`channelCollection.ts:403`) when joining an existing (attached) document, and `LocalFluidDataStoreContext` (`:383`) on the detached-load path. These are the *same* classes the create/attach paths use (`:545`, `createContext` `:758`). So neither context class can be excluded for a single-store client — the one store is loaded/created via them.
  - **The create\* API is baseline (ships regardless), even though a join-only client may not exercise it.** Two independent reasons it is not a removable "multi-store" surface: **(i) DCE trap** — `createDataStore`/`createDetachedDataStore` are public methods on the unconditionally-instantiated `ContainerRuntime`/`ChannelCollection`, so they **ship whether or not this client calls them** (see the DCE re-evaluation above). **(ii) It is the *creation* path for the one default store** whenever a client *does* create a document: aqueduct calls `containerRuntime.createDataStore(...)` (`containerRuntimeFactoryWithDefaultDataStore.ts:113`) and `createDetachedDataStore(...)` (`pureDataObjectFactory.ts:424`, `:447`) → `ChannelCollection.createDataStoreContext`/`createDetachedDataStore` → `createContext` `:751` → `createDataStoreId` `:703`. The `encapsulated-no-tree` client is described as **join-only**, so at *runtime* it typically realizes the default store from the snapshot via `RemoteFluidDataStoreContext` (constructor loop `:403`) rather than creating it — but the create\* code is still bundled (i), and the `createContext` machinery references the same `LocalFluidDataStoreContext`/`LocalDetachedFluidDataStoreContext` used by the detached-load branch (`:383`). Either way the single store forces the context classes into the bundle. (`LocalDetachedFluidDataStoreContext` is reached only via `createDetachedDataStore`.)
  - **The attach-SEND path is baseline.** `makeDataStoreLocallyVisible` is wired as `makeLocallyVisibleFn` into *every* context including the initial one (`:392`). When the default store is created against an already-attached container, it emits an attach op via `makeDataStoreLocallyVisible` `:660` → `submitAttachChannelOp` `:677` → `generateAttachMessage` `:637` (see the comment at `:664`-`668`: attached ⇒ send attach op; detached ⇒ folded into the container summary). So `generateAttachMessage`/`submitAttachChannelOp`/`makeVisibleAndAttachGraph` are required for the single store.
  - **The local-ack branch of inbound attach is baseline.** `processAttachMessages` `:485`-`493` (the `if (local)` arm) confirms the default store's own attach op round-trip and clears `pendingAttach`. Op routing (`processMessages` `:931` / `processChannelMessages` `:956`) is address-based and required for one store as much as many.
  - **What is *genuinely* multi-store-only** (reachable only when a **second** store appears at runtime): (1) the **remote branch of `processAttachMessages`** `:495`-`568` (~75 lines) — building a `RemoteFluidDataStoreContext` for a **peer-attached** store, with `buildSnapshotTree`/`StorageServiceWithAttachBlobs`/`processAttachMessageGCData`; (2) **`applyStashedAttachOp`** `:881`-`930` (~50 lines) — re-applying a stashed *dynamic* attach on offline reconnect (also gated behind F8 offline); (3) **aliasing** (the whole `processAliasMessages`/`pendingAliasMap`/`aliasedDataStores` subsystem — tracked separately as **F10**). Even these reference only *baseline* classes (`RemoteFluidDataStoreContext` is already loaded by the constructor loop), so removing them frees their own bodies plus at most the small `StorageServiceWithAttachBlobs` module and `processAttachMessageGCData`.

- **Refactor plausibility for the two proposed end-patterns.** The user is willing to make API changes and wants either (a) a build-time polyfill that strips multi-store code, or (b) an injected `DataStoreHandler` (single- vs multi-store kind) chosen at FF init. Both are **architecturally plausible** but bounded by the partition above:
  - **(a) Polyfill-away.** The severable code is a *branch inside a synchronous hot-path method* (`processAttachMessages`) plus one method (`applyStashedAttachOp`) — **not** an existing `await import()` leaf like the summarizer/id-compressor stubs. To swap it at build time you must first **extract** the remote-attach branch into a leaf module (e.g. a `RemoteDataStoreAttacher`) and inject it, then `NormalModuleReplacementPlugin`-swap it for a **fail-loud** stub. That is a real production refactor, not a config change.
  - **(b) Inject a `DataStoreHandler`.** The cleanest framing: an interface (`processInboundAttach`, `applyStashedAttach`, and the dynamic-`createDataStore` surface) that `ChannelCollection` delegates the `Attach` switch arm to; a `MultiStoreHandler` (current behavior) living in a delay-loaded leaf, and a `SingleStoreHandler` stub the single-store build substitutes. **Caveat:** the `SingleStoreHandler` **still needs create\*** (the one default store is created through it), so only the *remote-attach* + *stashed-attach* code actually moves into the swappable multi-store leaf — create\* stays baseline.
  - **Hard precondition (same class as F4/F5/F8).** The inbound remote-attach stub **cannot safely no-op**: if a peer legitimately attaches a second store and the op is dropped, a later channel op to that address throws `"No context for op"` (`:996`) — data corruption. So the refactor is valid **only under a session-wide "no dynamic data stores" guarantee** (no participant ever creates a store beyond the default), and the stub must **fail loud**.
  - **Realistic ceiling.** ~125 lines of `channelCollection.ts` + the small `StorageServiceWithAttachBlobs` module + `processAttachMessageGCData` ≈ **~2–3 KB minified — below the 5 KB bar** — because the heavy parts (both context classes, `realize`, create\*, attach-send, op routing) are all on the single default store's baseline path and cannot be excluded.
- **Proposal.** *No stub; do not treat as a DCE win.* The multi-store create APIs do not tree-shake (methods on instantiated classes) and are in fact the single-store baseline creation path. A `DataStoreHandler`/polyfill seam is *feasible* if the user accepts a session-wide single-store precondition + a fail-loud inbound stub + a prod refactor to extract the remote-attach branch — but the realistic win is **~2–3 KB (below the 5 KB bar)**, so it is **not recommended** as a size lever. Revisit only if bundled with F10 (aliasing) and F8 (offline stashed-attach) under one "single-store, online-only" profile.

### F20 — DDS reentrancy checks

- **Code.** `RunCounter` `packages/runtime/container-runtime/src/runCounter.ts`; `dataModelChangeRunner = new RunCounter()` `containerRuntime.ts:1482`; `ensureNoDataModelChanges()` `:1490` wraps inbound processing at `:3053`; exposed as `opReentrancy` telemetry.
- **When active (no polyfill).** Unconditional wrapper around every inbound message batch; cost is a counter inc/dec.
- **In `encapsulated-no-tree`.** Load-bearing correctness guard (detects illegal reentrant model mutation during op apply). Tiny.
- **Optionality — load-bearing.** Negligible size; removing weakens a correctness invariant.
- **Proposal.** *Do not touch.*

### F21 — Returning the container before fully loaded

- **Code.** `IContainerLoadMode` handling `container.ts:1644` (`switch (loadMode.opsBeforeReturn)`); default `{ opsBeforeReturn: "cached" }` `container.ts:337`; `deltaConnection` deferral; `LoaderHeader.loadMode`.
- **When active (no polyfill).** Config-driven, not a separable subsystem — the same `load()` handles `undefined`/`"cached"`/`"all"`. Default returns after cached ops.
- **In `encapsulated-no-tree`.** The infrastructure is inline in `load()`; a customer already controls behavior via `loadMode`.
- **Optionality — tree-shake/config (marginal).** Nothing to stub; the branches are small and share the load path.
- **Proposal.** *No change.* If early-return is wanted, pass `loadMode` — no code change.

### F22 — Tracking e2e time of messages

- **Code.** `OpPerfTelemetry`/`ReportOpPerfTelemetry` `connectionTelemetry.ts` (called `containerRuntime.ts:2176`); `SignalTelemetryManager` `signalTelemetryProcessing.ts` (`new SignalTelemetryManager()` `containerRuntime.ts:1519`, tracked in `processSignal`).
- **When active (no polyfill).** Unconditional instrumentation on op/signal round-trips (op-perf, signal latency).
- **In `encapsulated-no-tree`.** Ships in full — these are exactly the modules a prior telemetry-stub experiment removed and then **restored by project decision**.
- **Optionality — technically stub, but OFF-LIMITS.** Isolable module seams exist, but telemetry is a retained observability signal. See the telemetry decision in [POLYFILL_VALIDITY.md](./POLYFILL_VALIDITY.md) and [BUNDLE_SIZE_REDUCTIONS.md](./BUNDLE_SIZE_REDUCTIONS.md).
- **Proposal.** *Do not remove.* Explicitly excluded from reduction work.

### F23 — Transitive dependencies (e.g., lz4js)

- **Code.** `lz4js` imported only by `opCompressor.ts` / `opDecompressor.ts` (F4). Other notable deps (`uuid`, `semver-ts`, `@tylerbu/sorted-btree-es6`) are pulled by core or by already-stubbed subsystems (the btree came in via id-compressor, already stubbed).
- **When active (no polyfill).** `lz4js` loads whenever the compressor/decompressor modules do — i.e., always today.
- **In `encapsulated-no-tree`.** Bundled today (~4.7 KB). Removable **only** with F4/F5's session-wide "no compression" precondition.
- **Optionality — stub, coupled to F4.** A `lz4js` module stub is the concrete lever; its validity is entirely F4's precondition.
- **Proposal.** *Bundle with F4.* Do not stub `lz4js` alone — a stray compressed inbound op would then be undecodable.

### F24 — Aqueduct SharedMap legacy-compat factory

> Also from the import-trace pass. This is *accidental* coupling: aqueduct pins
> `SharedMap` for legacy back-compat even though this app only uses `SharedDirectory`.

- **Code.** `DataObjectFactory` unconditionally registers the SharedMap factory —
  `dataObjectFactory.ts:84` `sharedObjects.push(SharedMap.getFactory())` — guarded only
  by a stale comment (`dataObjectFactory.ts:81`): *"TODO: Remove SharedMap factory when
  compatibility with SharedMap DataObject is no longer needed in 0.10."* This is the
  **sole importer** keeping `SharedMap` in the bundle; `DataObject` itself uses only
  `SharedDirectory` (`dataObject.ts:69`). `dataObject.ts:56-64` explains why the compat
  exists: a pre-0.10 document's root may be an `ISharedMap` masquerading as
  `ISharedDirectory`.
- **When active (no polyfill).** Registered on every `DataObjectFactory`; only
  *exercised* when loading a legacy document whose DataObject root channel was created as
  a `SharedMap`.
- **In `encapsulated-no-tree`.** Bundled: **~9,484 B parsed dead weight** —
  `mapKernel.ts` 7,246 + `map.ts` (SharedMap) 1,892 + `mapFactory.ts` 346.
  `SharedDirectory` has its own kernel (`directory.ts` does **not** import `mapKernel`),
  so dropping SharedMap removes `mapKernel` entirely.
- **Optionality — stub (precondition: no legacy SharedMap-rooted documents).** Because
  `@fluidframework/map` is `sideEffects:false`, the *only* edge pinning SharedMap is the
  aqueduct registration. Remove it (an app-level `DataObjectFactory` that omits the
  SharedMap registration, or a `SharedMap`/`mapFactory` module stub) and
  `SharedMap` + `mapKernel` + `mapFactory` tree-shake away. Safe **only** if this client
  never opens a document whose DataObject root was a `SharedMap` — i.e., all documents
  were created by DataObject ≥ 0.10 (which uses `SharedDirectory`). Fail mode: loading a
  legacy SharedMap-rooted doc throws "unknown channel type" — **loud, not corrupting**.
- **Proposal.** *Candidate — above the 5 KB bar and the cleanest of the new levers* (no
  deep refactor; the map package already tree-shakes, only the aqueduct edge pins it).
  Gated on a "no pre-0.10 SharedMap-rooted documents" precondition — plausible for a
  greenfield mobile deployment.

## Summary matrix

| # | Feature | Active by default? | Reached in `no-tree`? | Optionality | Recommendation |
|---|---------|--------------------|-----------------------|-------------|----------------|
| F1 | Loader/Container split, code loaders/proposal | Unconditional | Yes (seam) | load-bearing | keep; static-code entry is a big future refactor |
| F2 | Quorum | Unconditional | Yes | load-bearing | keep (bundle w/ F1) |
| F3 | URL resolver | Unconditional | Yes (impl external) | tree-shake (external) | no change |
| F4 | Message compression | **On (2.0 defaults)** | Yes | **stub (session precondition)** | **candidate** — gated stub + lz4js |
| F5 | Message chunking/splitting | On (paired w/ F4) | Yes | stub (w/ F4) | candidate — bundle w/ F4 |
| F6 | Reconnect/resubmit | Unconditional | Yes | load-bearing | keep |
| F7 | Stashed ops | Unconditional (apply) | Yes | load-bearing | keep |
| F8 | Serializing a container | Manager always on | Yes | **stub (no-offline precondition)** | **candidate** — gated stub |
| F9 | Read-only → read-write | Unconditional | Yes | load-bearing | keep |
| F10 | Aliased data stores | Inbound unconditional | Yes (routing) | load-bearing / tree-shake | keep |
| F11 | Signals | Unconditional | Yes | load-bearing (telemetry-entangled) | keep — send gate-able / receive no-op-able, but net <5 KB (only sizeable module is F22 telemetry on both paths) |
| F12 | Join/leave | Unconditional | Yes | load-bearing (inseparable from F11) | keep — cannot remove without F11 |
| F13 | Heartbeats (no-op / keep-alive) | H1 on/lazy/service-tunable; H2 self-gated | Yes | H1 stub (server-visible) / H2 telemetry (off-limits) | prefer service config for H1; H2 not a lever — net negligible |
| F14 | Audience | Unconditional | Yes | load-bearing (Signals-entangled) | keep — ~1–1.5 KB even w/ API change, below bar; treat as one feature w/ F11 |
| F15 | Batching modes | Unconditional | Yes | load-bearing (modes = option-data) | keep; size only via F4/F5 |
| F16 | Garbage collector | Instantiated always | **Already stubbed** | stub (done) | — done (−20.9 KB) |
| F17 | Summarizer election/task mgr | Delay-loaded, gated | **Already stubbed** | stub (done) | — done (−15.6 KB) |
| F18 | Lazy channel loading | Lazy by design | Yes | load-bearing | keep — 0 bytes even if made eager (perf regression) |
| F19 | Lazy/multi data stores | Lazy; multi present (no DCE) | Yes (single) | load-bearing (no DCE) | keep — multi-create doesn't tree-shake; refactor ~2–3 KB < bar, not a DCE win |
| F20 | DDS reentrancy checks | Unconditional | Yes | load-bearing | keep |
| F21 | Return before fully loaded | Config-driven | Yes | config | no change |
| F22 | E2E message timing | Unconditional | Yes | **off-limits (telemetry)** | do not remove |
| F23 | Transitive deps (lz4js) | With F4 | Yes | stub (w/ F4) | bundle w/ F4 |
| F24 | Aqueduct SharedMap legacy factory | Registered always | Yes (~9.3 KB) | **stub (no legacy SharedMap-rooted docs)** | **candidate** — cleanest; map already tree-shakes |

## Proposal for code changes

Ordered by value/effort. Everything below is **opt-in per deployment** and follows
the existing pattern (a `*Stub.ts` beside the real module + a
`NormalModuleReplacementPlugin` entry in `webpack.config.cts` + a
`requireAssignableTo` drift spec + a `POLYFILL_VALIDITY.md` section, per the
project memory). **No telemetry** (F22) is in scope.

### Tier 0 — already implemented (reference only)
- **F16 GC** and **F17 summarizer-election** are shipped stubs (−20.9 KB and
  −15.6 KB parsed). No new work; listed so the matrix is complete.

### Tier 1 — new gated stubs worth prototyping
1. **F24 — Aqueduct SharedMap legacy-compat factory, behind a "no pre-0.10
   SharedMap-rooted documents" precondition.** Drop the
   `sharedObjects.push(SharedMap.getFactory())` registration
   (`dataObjectFactory.ts:84`) — via an app-level `DataObjectFactory` or a
   `SharedMap`/`mapFactory` stub. Since `@fluidframework/map` is `sideEffects:false`,
   `SharedMap` + `mapKernel` + `mapFactory` (~9.3 KB parsed) then tree-shake away.
   **Cleanest new lever** (no deep refactor). Loud fail mode ("unknown channel type")
   if a legacy SharedMap-rooted doc is opened.
2. **F4+F5+F23 — compression/chunking + `lz4js`, behind a session-wide "no lz4
   compression" precondition.** Add `opCompressorStub` (throwing `compressBatch`),
   `opDecompressorStub` (**throws on encountering any compressed envelope** so a
   violated precondition fails loudly rather than corrupting data), and an `lz4js`
   stub. Gate the three `NormalModuleReplacementPlugin` entries together. **Risk:**
   correctness — only valid if *no client in the collaboration* compresses. Requires
   explicit product sign-off; document as a new "Root" in `POLYFILL_VALIDITY.md`
   analogous to the blob/no-attachment precondition. Est. ~5–6 KB parsed.
3. **F8 — `serializedStateManager` stub, behind a "no offline serialize/rehydrate"
   precondition.** No-op manager (dummy `fetchSnapshot`, throwing
   `getPendingLocalState`, no background refresh). Cross-check against the prior
   `serializedStateManager` offline analysis already in
   `BUNDLE_SIZE_REDUCTIONS.md` before implementing. Medium risk (breaks offline
   persistence if the precondition is wrong). *Note: prior prototype measured only
   −4,259 B — below the 5 KB bar; kept here for completeness.*

### Tier 2 — config, not code (no bundle change)
4. **F13 heartbeats** — ask the service to set `noopTimeFrequency`/
   `noopCountFrequency = +Infinity` for this client class instead of stubbing
   `NoopHeuristic` (server-visible behavior). 
5. **F21 return-before-loaded** — pass the desired `IContainerLoadMode`; no code
   change.

### Tier 3 — large refactors (defer)
6. **F1/F2 static-code container** — a `createStaticContainer(runtimeFactory)` entry
   in container-loader that bypasses `codeLoader`/code-proposal (and enables a
   quorum-lite). Removes real bootstrap weight but changes public shape and is
   cross-cutting. Design-review gated; not a quick stub.

*Evaluated and rejected as size levers* (feasible but below the 5 KB bar, so not
worth the refactor): **F14** Audience split (~1–1.5 KB, and inseparable from F11
Signals); **F19** single-store `DataStoreHandler`/polyfill seam (~2–3 KB — the
create/attach/op-route machinery is the single default store's baseline path; only
the inbound remote-attach branch + `applyStashedAttachOp` are multi-store-only, and
they need a session-wide "no dynamic data stores" precondition + a fail-loud stub).
Revisit F19 only if bundled with F10 (aliasing) + F8 (offline stashed-attach) under
one "single-store, online-only" profile.

### Explicitly not changing (load-bearing on the minimal path)
F3 (external), F6, F7, F9, F10 (inbound), F11, F12, F14, F15, F18, F19 (single
store), F20 — each executes on the normal join/edit/reconnect path and cannot be
stubbed without breaking correctness or the protocol. F22 (incl. F11 signal
telemetry and F13 H2 keep-alive) is excluded by the telemetry decision.

### Verification for any Tier-1 stub (reuse existing harness)
- Add a `requireAssignableTo` drift spec (both directions) beside each stub.
- Run `tools/polyfill-swap.sh <stub-id>` to swap the compiled stub over the real
  module and run the package suite; the only failures must be that subsystem's own
  specs (see `POLYFILL_VALIDITY.md` §2). Any unexpected failure means a live path
  reaches the stub → the precondition is unsafe.
- Rebuild the scenario and re-measure parsed/gzip (`npm run webpack:scenario --
  encapsulated-no-tree`; clear `node_modules/.cache` first).

## Maintenance (note to future me)

**Pinned revision.** Every `file.ts:NNN` reference in this doc is anchored to
`tbrosman/claude-shrink-bundle` @ **`fb5629cec5`**. This is the *analysis baseline*,
not necessarily the working-tree tip (`POTENTIALLY_OPTIONAL_FEATURES.md` and other
scenario docs may be uncommitted on top of it — the *source* files whose lines are
cited are as of `fb5629cec5`).

The owner is fine with **some line-number drift** and does **not** integrate `main`
often, so do **not** proactively re-baseline. Only do the re-analysis below when
explicitly asked.

**When asked to re-analyze / update the doc, do all of the following:**

1. **Update the pinned SHA.** Capture the new baseline and replace it in **two**
   places: the intro line above ("Line numbers are against … at commit `…`") and
   this section. Record it as: `git rev-parse --short HEAD` +
   `git log -1 --format='%h %ci %s'`.
2. **Re-verify the Summary matrix.** Any feature whose classification changed
   (`load-bearing` / `stub` / `tree-shake`, active-by-default, reached-in-`no-tree`)
   must be updated in both its **F<n> section** and its **matrix row** — keep them
   in sync (they drifted before; see the F11/F13/F14/F15/F18/F19 corrections).
3. **Re-verify the Proposal section.** Re-check the Tier 0–3 lists and the
   "Evaluated and rejected as size levers" / "Explicitly not changing" notes against
   the new analysis. Re-confirm size estimates and which candidates clear the **5 KB
   bar** (currently two: **F24** SharedMap legacy factory ~9.3 KB, and the **F4+F5+F23**
   compression bundle ~5–6 KB).
4. **Re-verify the size numbers.** Realized stubs (F16 −20.9 KB, F17 −15.6 KB) and
   the measured F8 ceiling (−4,259 B parsed) should be re-measured if the underlying
   modules changed; update `remeasure`/`features` session tables accordingly.

**Line-number re-anchoring procedure (previous-rev → new-rev).** Line numbers are
the most fragile part. To rewrite them without re-reading every file from scratch:

1. **Diff the two baselines, cited files only.** For each source file this doc
   references, run `git diff <old-sha> <new-sha> -- <path>` (or
   `git log <old-sha>..<new-sha> -- <path>` to see whether it changed at all). Files
   with **no** diff need **no** line-number edits — skip them.
2. **For changed files, re-anchor by symbol, not by number.** For each cited
   `file.ts:NNN`, grep the **stable anchor** (the function/class/identifier the
   number was pointing at — e.g. `createDataStore`, `processAttachMessages`,
   `sequenceAndSubmitSignal`) in the **new** revision and read the new line number
   from there. Do **not** trust `old_line ± hunk_offset` arithmetic across large
   diffs — always confirm against the symbol.
3. **Prefer symbol + short quote over bare numbers** when rewriting, so the next
   drift is self-correcting (e.g. keep the method name adjacent to the number).
4. **Spot-check a few** with `git blame -L <new>,<new> <path>` to confirm the line
   still contains the cited construct before committing the rewrite.
5. **Record what moved.** Note in the commit / session table which references were
   re-anchored, so a partial re-analysis can be resumed.



