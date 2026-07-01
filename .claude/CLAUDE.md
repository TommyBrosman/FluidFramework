# Fluid Framework — Agent Context

> This file is mirrored in `.github/copilot-instructions.md`. Changes here should be duplicated there, and vice versa.

## Asserts

When writing asserts (from `@fluidframework/core-utils`), use a string literal for the error message, not a hex assert code. This applies only to newly added asserts, not existing ones.

## API Reports (`*.api.md`)

API report files are **generated artifacts** — never hand-edit them. If they need updating, rebuild and regenerate via `build:api-reports`. If you are working in `@fluidframework/tree` or its aggregator (`fluid-framework`) and encounter unexpected API report diffs, read `.claude/skills/ci-readiness-check/tree-api-checks.md` before attempting to fix them.

## Bundle-size stub-polyfills (`encapsulated-no-tree` scenario)

When adding, removing, or changing a stub-polyfill for the
`examples/utils/bundle-size-tests/scenarios/encapsulated-no-tree` bundle (the
`NormalModuleReplacementPlugin` swaps in `webpack.config.cts`), **always update
`examples/utils/bundle-size-tests/scenarios/encapsulated-no-tree/POLYFILL_VALIDITY.md`**
in the same change. Keep these parts in sync with the new stub:

- Add a per-polyfill validity subsection (§1) — stub shape (throwing vs
  no-op/valid-empty), the code-flow gate with `containerRuntime.ts` line numbers,
  and the imported-API argument.
- Add the stub id + real→stub mapping to `tools/polyfill-swap.sh` (the `MAP`
  array) and to the expected-exclusion-set table (§2.4).
- Update the dependency chain (§3) if the new stub depends on or enables another.

## Azure DevOps

The ADO project for work items and pipelines is **`internal`** (not `FluidFramework`).
Use `internal` when calling ADO tools that require a project name.

### Internal Wiki

- **Name:** FF Internal Wiki
- **Wiki ID:** `4b8ab5e8-1add-4e4b-bb65-d9b870a98ad4`
- **Project:** `internal`
- **Mapped path:** `/docs` (page paths are relative to this — e.g. the api-council page is at `/dev/resources/api council`)

Use `mcp__ado__wiki_get_page_content` with `wikiIdentifier: "4b8ab5e8-1add-4e4b-bb65-d9b870a98ad4"` and `project: "internal"` to fetch pages directly by path without searching first.
