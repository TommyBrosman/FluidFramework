#!/usr/bin/env bash
#
# polyfill-swap.sh — run a package's compiled test suite against the polyfilled
# ("stubbed") build, exactly mirroring the webpack `NormalModuleReplacementPlugin`
# swaps used by the encapsulated-no-tree bundle.
#
# It works at the compiled-`lib/` level: for each (real -> stub) pair it copies the
# already-compiled stub `*.js` over the real module `*.js` (backing up the original),
# runs mocha, then restores every original. Any importer of the real specifier then
# resolves to the stub — the same substitution webpack performs at bundle time.
#
# Usage:
#   tools/polyfill-swap.sh baseline           # run suite with REAL modules (control)
#   tools/polyfill-swap.sh <stub-id>...       # run suite with the named stub(s) swapped in
#   tools/polyfill-swap.sh all                # run suite with ALL 7 stubs swapped in
#   tools/polyfill-swap.sh list               # print the stub-id -> (real,stub) table
#
# Stub ids: id-compressor summarizer election blob-manager gc summarizer-node
#           summary-collection
#           (telemetry stubs were removed — telemetry is not stubbed in this bundle)
#
# The swap is always restored on exit (even on failure / Ctrl-C).
set -uo pipefail

REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
CR="$REPO_ROOT/packages/runtime/container-runtime"
TU="$REPO_ROOT/packages/utils/telemetry-utils"  # retained for the PKGS logic; no telemetry stubs currently mapped

# stub-id | package-lib-dir | real (relative to lib) | stub (relative to lib)
MAP=(
  "id-compressor|$CR/lib|idCompressorDelayLoadedModule/index.js|idCompressorDelayLoadedModuleStub.js"
  "summarizer|$CR/lib|summary/summaryDelayLoadedModule/index.js|summary/summaryDelayLoadedModuleStub.js"
  "election|$CR/lib|summary/summaryManagerDelayLoadedModule/index.js|summary/summaryManagerDelayLoadedModuleStub.js"
  "blob-manager|$CR/lib|blobManager/index.js|blobManager/blobManagerStub.js"
  "gc|$CR/lib|gc/garbageCollection.js|gc/garbageCollectionStub.js"
  "summarizer-node|$CR/lib|summary/summarizerNode/summarizerNodeWithGc.js|summary/summarizerNode/summarizerNodeWithGcStub.js"
  "summary-collection|$CR/lib|summary/summaryCollection.js|summary/summaryCollectionStub.js"
)
# NOTE: telemetry stubs (connection-telemetry, signal-telemetry, batch-tracker, sampled-telemetry)
# were intentionally removed — telemetry is not stubbed out of this bundle (project decision).

row_for() { local id="$1"; for r in "${MAP[@]}"; do [ "${r%%|*}" = "$id" ] && { echo "$r"; return 0; }; done; return 1; }

if [ "${1:-}" = "list" ]; then
  printf '%-20s %s\n' "STUB-ID" "REAL  <=  STUB"
  for r in "${MAP[@]}"; do IFS='|' read -r id dir real stub <<<"$r"; printf '%-20s %s  <=  %s\n' "$id" "$real" "$stub"; done
  exit 0
fi

BACKUPS=()
restore() {
  for b in "${BACKUPS[@]}"; do
    local target="${b%.polyfillbak}"
    [ -f "$b" ] && mv -f "$b" "$target"
  done
}
trap restore EXIT INT TERM

MODE="${1:-baseline}"; shift || true
declare -a IDS
case "$MODE" in
  baseline) IDS=() ;;
  all)      IDS=(); for r in "${MAP[@]}"; do IDS+=("${r%%|*}"); done ;;
  *)        IDS=("$MODE" "$@") ;;
esac

# Which packages do we need to run tests in? (container-runtime always; telemetry-utils only if sampled-telemetry)
declare -A PKGS=( ["$CR"]=1 )
for id in "${IDS[@]}"; do
  r="$(row_for "$id")" || { echo "unknown stub-id: $id" >&2; exit 2; }
  IFS='|' read -r _ dir real stub <<<"$r"
  [ "$dir" = "$TU/lib" ] && PKGS["$TU"]=1
  src="$dir/$stub"; dst="$dir/$real"
  [ -f "$src" ] || { echo "missing compiled stub: $src (run npm run build first)" >&2; exit 3; }
  cp -f "$dst" "$dst.polyfillbak"; BACKUPS+=("$dst.polyfillbak")
  cp -f "$src" "$dst"
  echo "swapped: $real  <=  $stub"
done

status=0
for pkg in "${!PKGS[@]}"; do
  echo "=== mocha in $(basename "$pkg") (mode=$MODE) ==="
  ( cd "$pkg" && npx mocha --reporter dot ) || status=1
done
exit $status
