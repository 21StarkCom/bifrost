#!/usr/bin/env bash
set -euo pipefail

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
# Both paths now call THIS file. Do not reimplement the check in a workflow: two
# copies of a gate is how it ends up enforced in one place and not the other,
# which is the same bug one level up.
#
# Usage:  docs/scripts/coverage-gate.sh <stark-skills-checkout>
# Exit:   0 = every skill claimed or excluded · 1 = orphans (or a parser bug)

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

STARK_SKILLS="${1:-${STARK_SKILLS:-$REPO_ROOT/../stark-skills}}"
[ -d "$STARK_SKILLS/skill" ] || {
  echo "coverage-gate: stark-skills not found at $STARK_SKILLS" >&2
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
' "$REPO_ROOT"/catalog/*/bundle.yaml 2>/dev/null | sort -u)"

# An empty parse is a SCRIPT bug (a `skills:` block shape the awk above stopped
# matching), not an unpublished fleet. Without this the gate would report every
# upstream skill as an orphan and bury the real cause in that list.
[ -n "$claimed" ] || {
  echo "coverage-gate: parsed no 'skills:' membership from $REPO_ROOT/catalog/*/bundle.yaml" >&2
  echo "  → the coverage gate's awk parser, not the catalog, is what to fix." >&2
  exit 1
}

orphans="" nonskill=""
for d in "$STARK_SKILLS"/skill/*/; do
  s="$(basename "$d")"
  # A dir with no SKILL.md (e.g. evals/) is not a skill. Record the skips instead
  # of dropping them: this branch is fail-OPEN, so a real skill whose manifest is
  # missing or misnamed vanishes from the gate exactly as silently as the drop the
  # gate exists to catch.
  if [ ! -f "$d/SKILL.md" ]; then nonskill="$nonskill $s"; continue; fi
  printf '%s\n' "$claimed" | grep -qxF "$s" && continue
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
