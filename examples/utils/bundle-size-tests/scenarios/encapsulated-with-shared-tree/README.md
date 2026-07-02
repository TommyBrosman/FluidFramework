# Scenario: `encapsulated-with-shared-tree`

Restored historical scenario. It is the pre-rename definition of what is now
[`encapsulated-no-tree`](../encapsulated-no-tree/) — i.e. the same encapsulated
API surface **plus** the `@fluidframework/tree/legacy` exports
(`SchemaFactory`, `SharedTree`, `TreeViewConfiguration`, …). The scenario was
renamed to `encapsulated-no-tree` in `2c27c80a0d` (tree dropped so the bundle
effort could focus on the non-tree surface); this directory brings the with-tree
variant back so tree's contribution — and the tree-only reductions cataloged in
[`../encapsulated-no-tree/BUNDLE_SIZE_REDUCTIONS.md`](../encapsulated-no-tree/BUNDLE_SIZE_REDUCTIONS.md)
§1b — can be measured against the current codebase without checking out an old
revision.

## Build / measure

```sh
# from examples/utils/bundle-size-tests
npx jiti ./scripts/webpackScenario.ts encapsulated-with-shared-tree
# output: build/scenarios/encapsulated-with-shared-tree/encapsulated-with-shared-tree.js
```

## Metric difference vs `encapsulated-no-tree`

This scenario keeps the **historical entry-chunk metric**: it does **not** pin
`LimitChunkCountPlugin({ maxChunks: 1 })` and does **not** apply the stub-polyfill
`NormalModuleReplacementPlugin`s. Code behind `await import(...)` (e.g. the
summarizer) therefore splits into separate async chunks and is **not** counted in
the entry chunk.

`encapsulated-no-tree`, by contrast, targets a **mobile single-chunk** bundle:
it forces one chunk and applies the stub polyfills, so only true removals count.
The two scenarios' absolute numbers are therefore **not** directly comparable —
this one measures the initial-download (entry) chunk of a code-split build; the
other measures the whole single shipped chunk.
