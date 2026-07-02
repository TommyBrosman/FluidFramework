# Using bundleAnalysisRepo for local bundle measurements

## Use case

There are cases where a developer may need to compare specific versions and webpack configurations
to test out a change. The CI tooling is great for catching regressions, but relies on PR builds for
stats. When making local changes (or using an LLM to autonomously look for reductions) it is
beneficial to have a "fast" local option that provides more detail at the expense of verbosity.

This is where we can use [bundleAnalysisRepo](../../../../../build-tools/packages/build-cli/docs/bundleAnalysisRepoDetails.md).

## Example change

Say are implementing changes that shrink the bundle in a mobile app that has no dependency on
the Summarizer because their changes are all made server-side. There are a couple approaches for
removing the Summarizer, such as finding a way to introduce code boundaries that can be statically
analyzed (for example: making a SummarizerFeature an opaque injectable parameter exposed in the
API). The "easy" approach is to leverage existing webpack boundaries and polyfill the module.
This approach has some drawbacks from a testability perspective, but will give us an upper bound
estimate for the reduction size.

See: https://github.com/microsoft/FluidFramework/pull/27611

This change introduces a stub polyfill implementation matching summary/summaryDelayLoadedModule/index.ts.

## Testing the change

We will use `flub generate bundleAnalysisReposWithComparison` to orchestrate the stats collection
and comparison process. (Note: the script names are subject to change, suggestions are welcome.)

### What does the script do?

- Builds and collects stats from the current repo
- Creates an inner repo at the "base" comparison revision
- Builds and collects stats from the base repo
- Generates a comparison (see linked docs for details on the output)

### Isn't that slow?

The first time can be slow, but the point is that you can manage both your outer and base repo
like regular repos (incremental build works). It's also completely autonomous, running
`pnpm install`, fetching branches from the outer repo when checking out the inner repo (no external
remote pull), and even handling cleanup by default.

Timing on my machine

- New base repo: 9.7 minutes
- Cached base repo: 1.5 minutes

### Testing the webpack change

The PR linked above does nothing on its own. It introduced a stub file and doesn't wire it up.
We don't want to change the webpack configuration used to generate CI stats, and it wouldn't
provide an accurate target for this change. There are two ingredients needed:

- Webpack scenarios
- A temp branch with the polyfill replacement implemented

### Webpack scenarios

The Fluid Framework is a platform. We ship code in many form factors: web apps, mobile apps, even
services. Each of these applications will package our code differently. This is where webpack
scenarios come in.

Each scenario consists of a webpack configuration and an index.ts barrel. They are defined under
bundle-size-tests/scenarios/. No new package.json is needed (they reuse bundle-size-tests/package.json).

For this test, [encapsulated-no-tree/webpack.config.cjs](webpack.config.cjs) was modified to
substitute the the summaryDelayLoadedModule with the stub polyfill.

### Using the tool

Our setup:

- The tbrosman/bundle-analysis-demo branch (this branch) polyfills in the
encapsulated-no-tree scenario
- tbrosman/bundle-repo-fixes introduced encapsulated-no-tree scenario
- Both branches have the same main ancestor

```bash
npm run dev-flub -- generate bundleAnalysisReposWithComparison --base-revision tbrosman/bundle-repo-fixes --exact-base --webpack-dir scenarios/encapsulated-no-tree --keep-base-repo
```

Note: `dev-flub` runs the dev (source) build of flub, so it has unreleased commands and works in
any shell. Run it from the `examples/utils/bundle-size-tests` directory.

### Analyzing

See [encapsulated-no-tree/compareBundlesOutput](compareBundlesOutput) for the output:

```text
=== All assets (parsed size in bytes) ===
Asset                                           Base     Current        Diff  % Change
--------------------------------------------------------------------------------------
encapsulated-no-tree.js *                     639760      601037      -38723     -6.1%

=== Gzip sizes for changed assets ===
Asset                                           Base     Current        Diff
----------------------------------------------------------------------------
encapsulated-no-tree.js                       167933      158622       -9311
```

Note that when using the targeted webpack bundles (single entry point) there will be
less detail in the output. This is a tradeoff: multi-asset bundles give more detail
but do not capture production behavior.
