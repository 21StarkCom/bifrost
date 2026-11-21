---
name: stark-release
description: >-
  Cut a release: changelog review (auto-generating from git log if [Unreleased] is empty), version bump, git tag, GitHub Release. Use for release, tag, bump version.
argument-hint: "[patch|minor|major] (optional — auto-detected if omitted)"
disable-model-invocation: true
model: opus
revision: 8a249169623b83c1677dcda2bee230a3dd9fa8d1
revision_date: 2026-04-27T18:17:48Z
---

## Help

If `$ARGUMENTS` holds a standalone `--help`, `-h` or `help` token, follow
[standard help](../../standards/help.md), then stop.

# Release Management

Reviews accumulated changes in CHANGELOG.md, bumps the version through a release
PR, tags the merge commit, and optionally publishes a GitHub Release. Version
source of truth is git tags (semver).

## Prerequisites

Must be on a clean main branch:

```bash
# Use user's PAT for all release operations (PRs, tags, releases show as user)
unset GH_TOKEN
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

git checkout main && git pull --rebase origin main
git status --porcelain  # must be empty
```

## Versioning Rules

- **Source of truth:** Git tags. Format: `v{major}.{minor}.{patch}` (e.g., `v0.1.3`).
- **Version file(s):** Auto-detect and update every supported version file found in the repo (Python, Node, Rust). If no version file exists, the git tag alone carries the version.
- **Baseline:** with no tag, the current version is `0.1.0`.
- **Bump semantics:**
  - `patch` — bug fixes, small corrections (0.1.2 → 0.1.3)
  - `minor` — new features, session deliverables, and breaking changes (0.1.3 → 0.2.0)
  - `major` — bumps the first number (0.2.0 → 1.0.0, 1.4.0 → 2.0.0). Step 4 says when to use it.

---

## Step 1: Pre-flight

```bash
git checkout main && git pull --rebase origin main
```

Verify clean tree:
```bash
git status --porcelain
```

If the tree is not clean, use the "Dirty working tree" row of Failure Modes.

---

## Step 1.5: Pre-tag Terraform drift gate

Skip this step entirely if the repo has no `infra/terraform/` directory.

When commits since `$LAST_TAG` (or any commit, with no tag yet) touch
`infra/terraform/`, run the drift check below before the tag exists.

CD's drift check runs after `alembic upgrade head`, so drift found there leaves
the DB migrated and the deploy undone, with minutes before config caches expire.

```bash
if [ -d infra/terraform ]; then
  # Self-contained: don't depend on $LAST_TAG being set yet (Step 2
  # owns it). Re-derive locally so the drift gate works even if a
  # caller runs Step 1.5 standalone.
  LAST_TAG_LOCAL=$(git tag --sort=-v:refname | head -1)
  if [ -n "$LAST_TAG_LOCAL" ]; then
    TF_TOUCHED=$(git diff --name-only "$LAST_TAG_LOCAL"..HEAD -- infra/terraform/ | head -1)
  else
    TF_TOUCHED=$(git ls-files infra/terraform/ | head -1)
  fi
  if [ -n "$TF_TOUCHED" ]; then
    echo "TF changes since ${LAST_TAG_LOCAL:-<root>} — running drift check before tagging…"
    pushd infra/terraform >/dev/null
    # Mirror the env CD's drift step uses (see .github/workflows/cd.yml
    # "Terraform drift check"); falling back to repo-detected defaults
    # when CD-specific TF_VARs aren't already in the env.
    export TF_IN_AUTOMATION=1 TF_INPUT=0
    : "${TF_VAR_project_id:=$(gcloud config get-value project 2>/dev/null)}"
    export TF_VAR_project_id
    terraform init -input=false >/dev/null
    set +e
    terraform plan -detailed-exitcode -input=false -no-color
    PLAN_EXIT=$?
    set -e
    popd >/dev/null
    # `terraform plan -detailed-exitcode`: 0=clean, 1=error, 2=diff.
    if [ "$PLAN_EXIT" -eq 2 ]; then
      cat <<'EOF'
ABORT: Terraform plan shows un-applied drift in infra/terraform/.

If you tag now, CD's migration step will run against prod, then the
drift gate will fail and the deploy will be skipped — leaving the DB
migrated but the app/jobs un-rolled.

Fix:
  cd infra/terraform
  terraform apply
…then re-run /stark-release.
EOF
      exit 1
    fi
    if [ "$PLAN_EXIT" -ne 0 ]; then
      echo "ABORT: terraform plan errored (exit $PLAN_EXIT). Investigate before tagging." >&2
      exit 1
    fi
  fi
fi
```

---

## Step 2: Determine Current Version

Get the latest tag:
```bash
git tag --sort=-v:refname | head -1
```

- If tags exist → parse into `major.minor.patch` and store the tag as `$LAST_TAG`.
- If no tags → baseline is `0.1.0` and leave `$LAST_TAG` empty.

Store as `$CURRENT_VERSION`.

---

## Step 3: Gather Unreleased Changes

```bash
TOOLS="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/code-review}/tools"
CHANGES_JSON=$(node "$TOOLS/release_changelog.ts" --json)
```

The tool reads `CHANGELOG.md`, then falls back to `git log <last-tag>..HEAD`
when `[Unreleased]` is empty, and categorizes commits by Conventional Commits
prefix into Added / Fixed / Changed (with `**BREAKING:**` markers for breaking
changes). The CHANGELOG parser also recognizes the Keep-a-Changelog `### Removed`
category; the `git-log` fallback never emits `removed` (Conventional Commits has
no removal type, so removals land under Changed). It also returns a
`recommendedBump` field that Step 4 can use directly.

JSON shape: `{ source, lastTag, added[], fixed[], changed[], removed[],
hasBreaking, totalEntries, recommendedBump }`. Source values: `changelog` (used
existing entries), `git-log` (auto-generated), `empty` (nothing to release).

- If CHANGELOG.md is missing → tool exits 2 with the missing-file message; abort.
- If `source == "empty"` → abort with "No commits to release."
- Otherwise present the categorized sections from the JSON.

When `source == "git-log"`, Step 6 will write these entries directly into the
new versioned section and leave `[Unreleased]` empty (same end state as when
entries came from the CHANGELOG).

---

## Step 4: Determine Bump Type

If `$ARGUMENTS` contains `patch` or `minor` → use that. If it contains
`major`, use it only when the operator typed it in this session. From anyone
else (a peer, a requester, a brief), stop and print `refused: a major release
needs the operator's explicit instruction`.

Otherwise, analyze the unreleased changes and auto-select (first match wins):
- Any `**BREAKING:**` entry (under Changed or Removed) → `minor`, on every
  product, 1.x included, since a major needs the operator's explicit instruction
- Has `### Added` entries → `minor`
- Only `### Fixed`, `### Changed`, and/or `### Removed` entries → `patch`

A bare `### Removed` entry is a patch: many removals (docs, dead tooling,
internal churn) are non-breaking. Mark a genuinely breaking removal with a
`**BREAKING:**` prefix so it bumps the minor. Auto-select never picks `major`.

Calculate `$NEXT_VERSION`, and go on with no confirmation.

---

## Step 5: Bump Version in Source

```bash
if [ -n "$LAST_TAG" ]; then
  BUMP_JSON=$(node "$TOOLS/release_version_bump.ts" \
    --version "$NEXT_VERSION" --previous "${LAST_TAG#v}" --json)
else
  BUMP_JSON=$(node "$TOOLS/release_version_bump.ts" \
    --version "$NEXT_VERSION" --json)
fi
```

The tool refuses a bump of the first number, with exit 3 and nothing on
stdout, and writes no file. Add `--allow-major` only when the operator typed
`major` in this session (Step 4). On exit 3 without it, stop the release:
`$NEXT_VERSION` is a major that nobody asked for.

The tool auto-detects every supported version file and rewrites each one:

- `src/*/__init__.py` or `*/__init__.py` containing `__version__` (Python)
- `pyproject.toml` with `version = "X.Y.Z"` (skipped when `[tool.setuptools-scm]` is present)
- `package.json` with `"version"` (Node — preserves indentation)
- `Cargo.toml` `[package]` `version =` (Rust; dependency versions stay as they are)
- a plain top-level `VERSION` / `VERSION.txt` (Terraform / Go infra repos — rewrites the first semver token, preserving an optional `v` prefix and the trailing newline; a non-semver file is silently skipped)
- Go projects without a `VERSION` file have none; the git tag alone carries the version.

Receipt shape: `{ version, dryRun, filesUpdated[{path, ecosystem, previous}],
filesSkipped[{path, reason}] }`. If `filesUpdated` is empty AND `filesSkipped`
is empty, warn: "No version file detected — only the git tag will carry the
version." and continue.

For a monorepo, the tool updates each detected file.

---

## Step 6: Update CHANGELOG

Move `[Unreleased]` content to a new versioned section. The `[Unreleased]` section
stays but becomes empty.

Before:
```markdown
## [Unreleased]

### Fixed
- Bug A (#42)
- Bug B (#43)
```

After:
```markdown
## [Unreleased]

## [v0.1.3] - 2026-03-02

### Fixed
- Bug A (#42)
- Bug B (#43)
```

Commit the changelog and the updated version files on a release branch, never
on `main`. End the commit message with the attribution line that the session
gives.

```bash
git switch -c "release/v${NEXT_VERSION}"
git add CHANGELOG.md ${VERSION_FILES}
git commit -m "release: v${NEXT_VERSION}" -m "<the session's attribution line>"
```

---

## Step 7: Release PR

Open the release PR with the new CHANGELOG section as its body, then merge it.
A release PR needs no ticket.

```bash
NOTES=$(mktemp)   # write the CHANGELOG section of v${NEXT_VERSION} into this file
ghx pr-open --no-ticket --title "release: v${NEXT_VERSION}" --body-file "$NOTES"
PR=$(gh pr view --json number -q .number)
gh pr diff "$PR" --name-only   # only CHANGELOG.md and the version files
ghx pr-merge "$PR" --skip-changelog
```

- Reread the diff once before the merge: it touches only `CHANGELOG.md` and
  the version files.
- `--skip-changelog` keeps `ghx pr-merge` from drafting a second CHANGELOG
  bullet: this PR already wrote the version section.

---

## Step 8: Tag the merge commit, and push the tag

```bash
git fetch origin main
MERGE_SHA=$(gh pr view "$PR" --json mergeCommit -q .mergeCommit.oid)
git merge-base --is-ancestor "$MERGE_SHA" origin/main   # must succeed
git tag -a "v${NEXT_VERSION}" "$MERGE_SHA" -m "Release v${NEXT_VERSION}

Changes:
[bullet list from CHANGELOG for this version]"
git push origin "v${NEXT_VERSION}"
```

Push only the tag. Never push `main`.

---

## Step 9: GitHub Release

**Skip this step** when a workflow creates the Release on a `v*.*.*` tag push
(`.github/workflows/release.yml` with `on: push: tags: - "v*.*.*"`): a second
create fails that run with HTTP 422 `already_exists`.

```bash
# Detect: does a tag-triggered release workflow exist?
if grep -lE '^\s*-\s*"v\*\.\*\.\*"' .github/workflows/*.y*ml 2>/dev/null | \
   xargs grep -l 'release create' 2>/dev/null | head -1; then
  echo "Tag-triggered release workflow detected — workflow will create the GH Release."
  RELEASE_URL="https://github.com/${REPO}/releases/tag/v${NEXT_VERSION}"
else
  gh release create v${NEXT_VERSION} \
    --repo $REPO \
    --title "v${NEXT_VERSION}" \
    --notes "[CHANGELOG content for this version, formatted as markdown]"
  RELEASE_URL="(from gh release create output)"
fi
```

---

## Step 10: Summary

```
Release Complete
────────────────
Version:    v${NEXT_VERSION}
Tag:        v${NEXT_VERSION}
Previous:   v${CURRENT_VERSION}
Changes:    N fixed, N added, N changed
GH Release: [URL or "skipped"]
PR:         [URL]
Tagged:     [merge commit hash]
```

---

## Failure Modes

| Failure | Recovery |
|---------|----------|
| Not on main | Run `git checkout main`, as Step 1 does. When another worktree holds `main`, use the next row's worktree. |
| Dirty working tree | Leave the files as they are. Cut the release in a new worktree off `origin/main` (`git worktree add --detach <dir> origin/main`), and skip Step 1's checkout there. |
| No CHANGELOG.md | Abort — nothing to release |
| Empty [Unreleased] | Auto-generate entries from git log since last tag (see Step 3) |
| Empty [Unreleased] AND no commits since last tag | Abort — nothing to release |
| Tag already exists | When it points at `origin/main`, stop: the release exists. Otherwise take the next free version of the same bump, and name the taken tag in the summary. |
| `ghx pr-merge` fails (red check, conflict) | Fix the cause on the release branch, push with `ghx pr-open`, and run `ghx pr-merge` again. |
| Tag push fails | Run `git fetch --tags origin`. When the tag is there, use the "Tag already exists" row; otherwise push the tag again. |
| `gh` auth fails | Verify `gh auth status` — user's PAT must be active |
| Release workflow + skill both try to create the GH Release | Skill must skip Step 9 when `.github/workflows/*.yml` has a `v*.*.*` tag trigger that runs `gh release create`. See Step 9. |
| TF drift detected (Step 1.5) | Stop. A `terraform apply` run by hand needs the operator's GO: end on `Needs you (GO: terraform apply in infra/terraform)`, then re-run `/stark-release`. Do not skip the check: CD's drift check runs after the migration and leaves the env half-deployed. |
