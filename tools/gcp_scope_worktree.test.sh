#!/usr/bin/env bash
#
# End-to-end harness for the `gcp_scope.ts` CLI. `gcp_scope_lib.test.ts` covers
# the library surface exhaustively (splice, render, worktree inclusion, the
# ambient-default checker); what only this file covers is that the CLI actually
# WIRES those functions together — that `install` writes both `.envrc` and
# `.worktreeinclude` from one invocation, that a second run is byte-identical,
# and that `check` reaches its success line. Driven from `gcp_scope_worktree.test.ts`
# so `npm test` and CI run it; it was an orphan advertising a gate nobody ran.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node_bin="$(command -v node)"
# Not a hardcoded /private/tmp: CI runs this harness on ubuntu, where that
# directory does not exist. Nothing below compares an absolute path, so the
# macOS /var -> /private/var realpath difference cannot bite.
fixture="$(mktemp -d "${TMPDIR:-/tmp}/gcp-scope-worktree.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT
root="$fixture/Code"
repo="$root/Mapped/demo"
map="$fixture/map.json"
direnvrc="$fixture/config/direnv/direnvrc"
mkdir -p "$repo"
git -C "$repo" init -q
printf '%s\n' '# human comment survives' '.local-safe' > "$repo/.worktreeinclude"
printf '%s\n' \
  '{' \
  '  "repos": [' \
  '    {' \
  '      "repo": "Mapped/demo",' \
  '      "project": "fixture-scope-project",' \
  '      "region": "us-central1",' \
  '      "why": "isolated test fixture"' \
  '    }' \
  '  ]' \
  '}' > "$map"

node --experimental-strip-types "$SCRIPT_DIR/gcp_scope.ts" install \
  --root "$root" --map "$map" --direnvrc "$direnvrc" --no-allow >/dev/null
grep -Fqx '# human comment survives' "$repo/.worktreeinclude"
grep -Fqx '.local-safe' "$repo/.worktreeinclude"
[[ "$(grep -Fxc '.envrc' "$repo/.worktreeinclude")" == 1 ]]
grep -Fq '# >>> gcp scope (direnv) >>>' "$repo/.envrc"

first="$(shasum -a 256 "$repo/.envrc" "$repo/.worktreeinclude" "$direnvrc")"
node --experimental-strip-types "$SCRIPT_DIR/gcp_scope.ts" install \
  --root "$root" --map "$map" --direnvrc "$direnvrc" --no-allow >/dev/null
[[ "$first" == "$(shasum -a 256 "$repo/.envrc" "$repo/.worktreeinclude" "$direnvrc")" ]]

# Hide live direnv/gcloud and use a disposable HOME so this exercises the
# checker's static contract without reading or mutating host state.
HOME="$fixture/home" PATH=/usr/bin:/bin GCP_SCOPE_SHELL_RC="$fixture/home/.zshrc" \
  "$node_bin" --experimental-strip-types "$SCRIPT_DIR/gcp_scope.ts" check \
    --root "$root" --map "$map" --direnvrc "$direnvrc" > "$fixture/check.out"
grep -Fq 'All 1 repo(s) scoped correctly; no ambient default survives.' "$fixture/check.out"

printf 'PASS gcp scope: .envrc + .worktreeinclude install, preservation, static check, idempotency\n'
