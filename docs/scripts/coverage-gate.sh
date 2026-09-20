#!/usr/bin/env bash
set -euo pipefail

# Bare help is operational; use -- help or ./help for a literal checkout.
show_help=0
literal=0
checkout=""
for arg in "$@"; do
  if [ "$literal" = 0 ]; then
    case "$arg" in
      --) literal=1; continue ;;
      help|-h|--help) show_help=1; continue ;;
      -*) echo "unknown arg: $arg" >&2; exit 2 ;;
    esac
  fi
  [ -z "$checkout" ] || { echo "expected one checkout" >&2; exit 2; }
  checkout="$arg"
done
if [ "$show_help" = 1 ]; then
  printf 'Usage: docs/scripts/coverage-gate.sh [--] <stark-skills-checkout>\n'
  exit 0
fi

# coverage-gate.sh — every stark-skills skill must be claimed by a bundle or
# deliberately excluded.
#
# Kills the "new skill silently dropped" papercut: `stark sync` only pulls skills
# already declared in a bundle.yaml's `skills:` list, so a freshly-added
# stark-skills skill with no membership vanishes without a trace. Fail loudly
# instead.
#
# WHY THIS IS ITS OWN SCRIPT (STARK-6468). The gate used to live inline in
# publish.sh, which is the MANUAL regen path. The path that actually publishes is
# stark-skills' `marketplace-sync.yml`, which regenerates bifrost and opens the
# sync PR on ~every release and never invoked publish.sh — its gate list is
# `validate`, `sync --check`, `build --check`, `check-bumps`, every one of which
# is an internal-consistency check between bifrost's own catalog and dist. None
# of them looks back at the stark-skills source tree to ask whether every skill
# is claimed. So the automated path had no coverage gate at all, and `agnes`
# shipped un-membered at v0.31.2 (STARK-6249) with every gate reporting clean:
# the published `standards/worker-spine.md` named `/agnes` while the skill itself
# was in no bundle, no catalog copy and neither dist tree.
#
# Every path now calls THIS file. Do not reimplement the check in a workflow: two
# copies of a gate is how it ends up enforced in one place and not the other,
# which is the same bug one level up.
#
# THREE CALLERS, and two of them live in ANOTHER REPO (STARK-6468 part 2):
#   1. bifrost   docs/scripts/publish.sh                  (before its VERSION bump)
#   2. stark-skills .github/workflows/marketplace-sync.yml (before the regen)
#   3. stark-skills .github/workflows/tests.yml            (every pull_request)
# Callers 2 and 3 invoke this file BY PATH out of a checkout of bifrost's DEFAULT
# BRANCH. This path and this file's exec bit are therefore a cross-repo contract:
# moving, renaming or un-chmod-ing it reddens stark-skills CI and stops marketplace
# publication. Both callers check `-x` first and emit a named ::error:: instead of
# dying at 126/127, but they still fail. Change them in the same window, or not at
# all. engine/cmd/stark/coverage_gate_test.go pins the path + exec bit from here.
#
# Usage:  docs/scripts/coverage-gate.sh <stark-skills-checkout>
# Exit:   0 = every skill claimed or excluded
#         1 = orphans found, OR the gate could not run (missing/empty stark-skills
#             checkout, no readable catalog, a membership parse that came back
#             empty). Every non-zero path names itself on stderr with an `ERROR:`
#             prefix — the one thing this script must never do is exit 0, or exit
#             silently, over a tree it did not actually read.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

STARK_SKILLS="${checkout:-${STARK_SKILLS:-$REPO_ROOT/../stark-skills}}"
[ -d "$STARK_SKILLS/skill" ] || {
  echo "ERROR: coverage-gate: stark-skills not found at $STARK_SKILLS" >&2
  echo "  → pass the checkout as \$1, or set STARK_SKILLS." >&2
  exit 1
}

# Skills deliberately NOT published to the marketplace (personal/experimental).
# A skill must be either a member of some bundle.yaml OR listed here.
#
# This list lives WITH the gate, not in a caller. Split across callers, the
# manual path and the sync path could disagree about what is deliberately
# unpublished — the same drift this script exists to prevent, just smaller.
#
# Empty today: `stark-voice` used to sit here while it was also a member of
# stark-write, which made the entry dead config that would have masked a real
# orphan the day it left that bundle.
EXCLUDED_SKILLS=()

# Collect the manifests BEFORE parsing them. Passing the bare glob to awk meant an
# unmatched `catalog/*/bundle.yaml` (a wrong $REPO_ROOT, a sparse checkout, a
# renamed dir) handed awk a literal path it could not open: `2>/dev/null` ate the
# only diagnostic, `set -e -o pipefail` aborted on awk's status, and the script
# died at exit 2 having printed NOTHING — with the explanatory guard below
# unreachable in the very case it was written for.
bundle_manifests=()
for f in "$REPO_ROOT"/catalog/*/bundle.yaml; do
  [ -f "$f" ] && bundle_manifests+=("$f")
done
[ "${#bundle_manifests[@]}" -gt 0 ] || {
  echo "ERROR: coverage-gate found no catalog/*/bundle.yaml under $REPO_ROOT" >&2
  echo "  → membership is read from a bifrost checkout, located relative to this" >&2
  echo "    script; \$REPO_ROOT resolved to $REPO_ROOT, which has no catalog/." >&2
  exit 1
}

# Covers EVERY skill dir, not just `stark-*`. The fleet renames skills out of
# that prefix (`gru`, `minion`, `agnes`), and a prefix-scoped gate would have left
# each of them silently droppable — the exact papercut this gate exists to stop.
# That also means `claimed` can no longer be a bare `- stark-` grep, since an
# unprefixed name would collide with the `tags:`/`runtimes:` list items; read the
# `skills:` block only.
claimed="$(awk '
  FNR == 1 { inskills = 0 }
  /^skills:[[:space:]]*$/ { inskills = 1; next }
  inskills && /^[[:space:]]*-[[:space:]]+/ {
    sub(/^[[:space:]]*-[[:space:]]+/, ""); sub(/[[:space:]]+$/, ""); print; next
  }
  inskills && /^[^[:space:]#]/ { inskills = 0 }
' "${bundle_manifests[@]}" | sort -u)"

# An empty parse is a SCRIPT bug (a `skills:` block shape the awk above stopped
# matching), not an unpublished fleet. Without this the gate would report every
# upstream skill as an orphan and bury the real cause in that list.
[ -n "$claimed" ] || {
  echo "ERROR: coverage-gate parsed no 'skills:' membership from $REPO_ROOT/catalog/*/bundle.yaml" >&2
  echo "  → the coverage gate's awk parser, not the catalog, is what to fix." >&2
  exit 1
}
# One newline-delimited haystack, matched with bash's own pattern test. The
# per-skill `printf | grep` this replaces forked two processes per upstream skill
# to re-scan a list that never changes inside the loop.
claimed_nl=$'\n'"$claimed"$'\n'

# Same reason as the catalog glob above: an unmatched `skill/*/` leaves the literal
# pattern in `$d`, which carries no SKILL.md, so it fell through the fail-OPEN skip
# and the gate reported `coverage gate clean … (not checked, no SKILL.md: *)` and
# exited 0 over a tree it had read nothing from. The `-d "$STARK_SKILLS/skill"`
# check at the top catches a MISSING checkout; this catches an empty or
# restructured one, which is the same false green by another route.
skill_dirs=()
for d in "$STARK_SKILLS"/skill/*/; do
  [ -d "$d" ] && skill_dirs+=("$d")
done
[ "${#skill_dirs[@]}" -gt 0 ] || {
  echo "ERROR: coverage-gate found no skill dirs under $STARK_SKILLS/skill" >&2
  echo "  → a clean report over a tree with nothing in it is indistinguishable" >&2
  echo "    from success; check the checkout path, or that skills still live in skill/." >&2
  exit 1
}

orphans="" nonskill=""
for d in "${skill_dirs[@]}"; do
  s="$(basename "$d")"
  # A dir with no SKILL.md (e.g. evals/) is not a skill. Record the skips instead
  # of dropping them: this branch is fail-OPEN, so a real skill whose manifest is
  # missing or misnamed vanishes from the gate exactly as silently as the drop the
  # gate exists to catch.
  if [ ! -f "$d/SKILL.md" ]; then nonskill="$nonskill $s"; continue; fi
  [[ "$claimed_nl" == *$'\n'"$s"$'\n'* ]] && continue
  [[ " ${EXCLUDED_SKILLS[*]:-} " == *" $s "* ]] && continue
  orphans="$orphans $s"
done

if [ -n "$orphans" ]; then
  echo "ERROR: stark-skills skill(s) not published and not excluded:$orphans" >&2
  echo "  → add each to a bundle's catalog/<bundle>/bundle.yaml 'skills:' list" >&2
  echo "    (or run bifrost's docs/scripts/publish.sh --add-skill NAME --bundle B)," >&2
  echo "    OR add to EXCLUDED_SKILLS in docs/scripts/coverage-gate.sh if it is" >&2
  echo "    intentionally unpublished." >&2
  exit 1
fi

echo "→ coverage gate clean: every stark-skills skill is claimed or excluded"
if [ -n "$nonskill" ]; then
  echo "  (not checked, no SKILL.md:$nonskill)"
fi
