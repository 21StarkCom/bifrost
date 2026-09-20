package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/21StarkCom/bifrost/engine/internal/bumps"
	"github.com/21StarkCom/bifrost/engine/internal/digest"
	"github.com/21StarkCom/bifrost/engine/internal/index"
	"github.com/21StarkCom/bifrost/engine/internal/load"
	"github.com/spf13/cobra"
)

// gitProbe runs a git command and returns its stdout plus git's OWN failure, not a bare
// bool: `gitFailure(err)` turns the error into git's first stderr line, so a refusal can
// say "detected dubious ownership" or "git not found on PATH" instead of leaving the
// operator to reproduce by hand what git already explained (same reasoning as
// sourceRevision's, STARK-7364).
//
// Through gitCommand, not a bare exec: an inherited GIT_DIR wins over `-C repoRoot`, so
// under a hook or `git rebase --exec` every probe below would answer about some OTHER
// repo and the gate would pass or fail by accident.
func gitProbe(repoRoot string, args ...string) ([]byte, error) {
	return gitCommand(repoRoot, args...).Output()
}

// gitShow returns the bytes of a `<rev>:<path>` object, and whether it exists.
func gitShow(repoRoot, revPath string) ([]byte, bool) {
	out, err := gitProbe(repoRoot, "show", revPath)
	if err != nil {
		return nil, false
	}
	return out, true
}

// prevIndexJSON returns the previously committed index.json bytes and a human-readable
// name for where they came from. `ok` is false when the baseline could not be established
// at all — which is a REFUSAL, not a pass.
//
// The baseline is `origin/main`, because the question this gate asks is "did content
// already published on main change under an unchanged version". `HEAD` is a fallback for a
// repo with no REMOTE at all (a scratch tree, a test fixture) and is NOT interchangeable:
// on a `pull_request` checkout HEAD is the PR's own merge commit, whose index.json
// `build --check` has already forced to agree with the change — so a HEAD baseline
// compares the change to itself and the gate cannot fail. Measured 2026-09-20
// (STARK-8161): one violating commit printed "OK: no un-bumped source changes" with only
// `refs/remotes/pull/N/merge` present, and 7 shared-assets violations once
// `refs/remotes/origin/main` was fetched into the identical tree.
func prevIndexJSON(repoRoot string) (data []byte, ref string, ok bool) {
	// Ask git where the repository is FIRST, because every probe below reports failure the
	// same way and the two reasons are NOT the same. "There is no repository here" (an
	// export, a fixture) is a genuine no-baseline that must still run. "git could not
	// answer" — not on PATH, `detected dubious ownership` under a container or a foreign
	// uid, a corrupt object store — is a BROKEN probe, and reading it as "no remote
	// configured" walks straight back into the STARK-8161 silent pass one layer down:
	// every probe false, `git show HEAD:index.json` false too, and the gate prints
	// `OK: no un-bumped source changes` having read no baseline at all.
	//
	// Discriminated WITHOUT matching git's message text, which is translated: a `.git`
	// sitting right there that git still will not open is the broken case. (A repoRoot
	// that is merely a subdirectory of a checkout has no `.git` of its own, but git
	// discovers the repo upward, so it never reaches this branch.)
	if _, err := gitProbe(repoRoot, "rev-parse", "--git-dir"); err != nil {
		if _, statErr := os.Stat(filepath.Join(repoRoot, ".git")); statErr == nil {
			return nil, "git cannot read this checkout: " + gitFailure(err), false
		}
		return nil, "none (not a git checkout)", true
	}

	// The baseline ref itself. `actions/checkout@v4` configures a remote but, on a
	// pull_request event at its default depth, fetches only `refs/pull/N/merge` and no
	// remote-tracking branch — exactly the shape that has to refuse below instead of
	// falling through to HEAD.
	if _, err := gitProbe(repoRoot, "rev-parse", "--verify", "--quiet", "origin/main^{commit}"); err == nil {
		// The ref is there. index.json may not be, on a repo that has never published —
		// that is a real "nothing to compare against", unlike a missing ref.
		if b, found := gitShow(repoRoot, "origin/main:index.json"); found {
			return b, "origin/main", true
		}
		return nil, "origin/main (carries no index.json yet)", true
	}

	// No baseline ref. A configured remote means this is a clone of something, so the
	// baseline MUST have been reachable — refuse. Keyed on "any remote at all" rather than
	// on the name `origin`: a clone made with `-o upstream`, or one whose remote was
	// renamed, is just as much a clone, and keying on the name sends exactly those down
	// the dead HEAD path this gate exists to close.
	if remotes, err := gitProbe(repoRoot, "remote"); err == nil && len(bytes.TrimSpace(remotes)) > 0 {
		return nil, "this clone has a remote but no `origin/main` to compare against", false
	}
	if b, found := gitShow(repoRoot, "HEAD:index.json"); found {
		return b, "HEAD (no remote configured)", true
	}
	return nil, "none (no committed index.json)", true
}

// leanPrev is the minimal shape we read from a previous index.json (CC-2 keys).
// Type is carried so the bump key is per-artifact-identity (bundle/type/name): a bundle
// may hold two same-named artifacts of different types (e.g. a skill and a command both
// named "x") — keying by bundle/name alone would collide them and silently skip the
// version-bump check on one of the two (CC-5 immutability bypass).
type leanPrev struct {
	Artifacts []struct {
		Name    string `json:"name"`
		Type    string `json:"type"`
		Bundle  string `json:"bundle"`
		Version string `json:"version"`
		Digest  string `json:"digest"`
	} `json:"artifacts"`
	// Vendored plugin assets (index.PluginAsset). Absent in indexes generated before
	// the field existed — those simply contribute no previous rows, so the gate skips
	// them for one publish instead of failing the whole repo on rollout.
	PluginAssets []struct {
		Bundle  string `json:"bundle"`
		Version string `json:"version"`
		Digest  string `json:"digest"`
	} `json:"pluginAssets"`
	// Vendored SHARED assets (index.SharedAsset): the one `vendor/stark-skills/`
	// snapshot, recorded once per bundle because every bundle vendors it under its own
	// version. Absent in indexes generated before the field existed — those contribute
	// no previous rows, so the gate skips them for one publish instead of failing the
	// whole repo on rollout.
	SharedAssets []struct {
		Bundle  string `json:"bundle"`
		Version string `json:"version"`
		Digest  string `json:"digest"`
	} `json:"sharedAssets"`
	// Source-owned Codex overlays (index.CodexAsset): vendor/runtime-overrides/codex/
	// <bundle>, layered into the committed dist/codex-plugins/<bundle> package. Same
	// absent-means-skip-one-publish rollout as the two above.
	CodexAssets []struct {
		Bundle  string `json:"bundle"`
		Version string `json:"version"`
		Digest  string `json:"digest"`
	} `json:"codexAssets"`
}

// pluginAssetKey namespaces a bundle's vendored-plugin-asset row so it can never collide
// with an artifact key (`<bundle>/<type>/<name>`); "plugin-assets" is not an artifact type.
func pluginAssetKey(bundle string) string { return bundle + "/plugin-assets/" + bundle }

// sharedAssetKey namespaces a bundle's SHARED-snapshot row. It must collide with neither an
// artifact key (`<bundle>/<type>/<name>`; "shared-assets" is not an artifact type) nor the
// plugin-asset key — a collision would silently drop one of the two rows' gate.
//
// The `<bundle>/...` prefix is also a machine contract: `docs/scripts/publish.sh` auto-bumps
// by sed-ing the bundle name off the front of each violation line. Change the shape here and
// the script extracts nothing, concludes "version-bump gate clean", and stops bumping.
func sharedAssetKey(bundle string) string { return bundle + "/shared-assets/" + bundle }

// codexAssetKey namespaces a bundle's source-owned Codex-overlay row. Same collision and
// line-shape contract as sharedAssetKey; "codex-assets" is not an artifact type.
//
// There is deliberately no row for the engine-rendered `.codex-plugin/plugin.json`
// (STARK-7977): it is display metadata the spec exempts, and it carries the root VERSION,
// which a bundle bump does not move. See checkbumps_codex_manifest_test.go and CLAUDE.md
// "Version-bump immutability". No root-VERSION row either (STARK-7998): `version` only names
// the Codex cache directory, and `codex plugin marketplace upgrade` re-installs from the
// refreshed marketplace snapshot regardless of it — a native consumer tracks the marketplace
// branch (a plain `marketplace add` records no ref and clones the default branch), not a
// version. Every claim in that sentence is an EXTERNAL-CLI fact nothing here pins — two
// separate probes, the `upgrade` behavior and what a plain `add` records, neither of which
// ran against the other's setup (measured 2026-09-20 on codex-cli 0.155.1; CI has no Codex) —
// re-measure before leaning on them. Codex-only: Claude Code does pin an install to
// plugin.json's version.
//
// Refusing the root-VERSION row does NOT reopen the manifest row: the STARK-7977 reasons
// above are permanent, not a deferral on a subsumer that never arrived, so do not add a
// per-bundle codexManifests family here as the replacement.
func codexAssetKey(bundle string) string { return bundle + "/codex-assets/" + bundle }

// emptyDirDigest is `digest.Files` over no files — the value a bundle without a
// vendor/plugins/<bundle> directory produces. Used to skip recording a row for the many
// bundles that have no plugin assets at all, keeping index.json free of empty entries.
func emptyDirDigest() string { return digest.Files(map[string][]byte{}) }

// runCheckBumps loads the previous committed index + the current catalog and
// errors (exit 1) on any version-bump immutability violation (CC-5 / spec §11).
func runCheckBumps(catalogDir, repoRoot string) int {
	prevBytes, baseRef, baseOK := prevIndexJSON(repoRoot)
	if !baseOK {
		// Fail closed, and say what to do. A gate that cannot find the thing it
		// compares against must never print OK — that is how this one spent its whole
		// life green in CI while catching nothing (STARK-8161).
		fmt.Println("check-bumps: no baseline —", baseRef)
		fmt.Println("check-bumps: without one the only other committed index.json is this very")
		fmt.Println("check-bumps: change's own, so the gate would compare the change to itself and pass.")
		fmt.Println("check-bumps: if the ref is merely unfetched — `git fetch --no-tags --depth=1 origin +refs/heads/main:refs/remotes/origin/main`")
		return 1
	}
	// Say which baseline was used, every run. `stark sync` prints its source for the same
	// reason (STARK-7364): a gate that silently changes what it measured is indistinguishable
	// from one that measured nothing.
	fmt.Println("check-bumps: baseline", baseRef)
	prev := map[string]bumps.Previous{}
	if len(prevBytes) > 0 {
		var lp leanPrev
		if err := json.Unmarshal(prevBytes, &lp); err != nil {
			fmt.Println("check-bumps: cannot parse previous index.json:", err)
			return 1
		}
		for _, e := range lp.Artifacts {
			prev[e.Bundle+"/"+e.Type+"/"+e.Name] = bumps.Previous{Version: e.Version, Digest: e.Digest}
		}
		for _, p := range lp.PluginAssets {
			prev[pluginAssetKey(p.Bundle)] = bumps.Previous{Version: p.Version, Digest: p.Digest}
		}
		for _, s := range lp.SharedAssets {
			prev[sharedAssetKey(s.Bundle)] = bumps.Previous{Version: s.Version, Digest: s.Digest}
		}
		for _, c := range lp.CodexAssets {
			prev[codexAssetKey(c.Bundle)] = bumps.Previous{Version: c.Version, Digest: c.Digest}
		}
	}

	cat, err := load.Load(catalogDir)
	if err != nil {
		fmt.Println("check-bumps: load error:", err)
		return 1
	}
	// The SHARED snapshot (`vendor/stark-skills/`) is vendored into EVERY bundle's dist
	// tree, so it is digested ONCE here and charged to every bundle below. `stark build`
	// reads the identical tree with the identical walk (build.vendorAssets + digest.Files
	// == digest.Dir; pinned by build.TestVendorAssetsDigestMatchesDigestDir), so the two
	// sides agree without check-bumps having to run a build.
	sharedDigest, sErr := digest.Dir(defaultAssetsSource(repoRoot))
	if sErr != nil {
		fmt.Println("check-bumps: shared assets:", sErr)
		return 1
	}

	empty := emptyDirDigest()
	cur := map[string]bumps.Current{}
	for _, b := range cat.Bundles {
		for _, a := range b.Artifacts {
			cur[b.Name+"/"+string(a.Type)+"/"+a.Name] = bumps.Current{Version: a.Version, SourceDigest: digest.Source(a)}
		}
		// Vendored plugin assets and Codex overlays live OUTSIDE the catalog dir, so they
		// are recomputed from disk here rather than from the loaded catalog. A bundle with
		// no such directory digests to the empty set and, having no previous row either,
		// never violates.
		d, dErr := digest.Dir(filepath.Join(defaultPluginAssetsRoot(repoRoot), b.Name))
		if dErr != nil {
			fmt.Println("check-bumps: plugin assets:", dErr)
			return 1
		}
		if _, hadPrev := prev[pluginAssetKey(b.Name)]; hadPrev || d != empty {
			cur[pluginAssetKey(b.Name)] = bumps.Current{Version: b.Version, SourceDigest: d}
		}
		// Same treatment for the shared snapshot: a repo with no vendor/stark-skills and
		// no previous row records nothing, so catalogs that never vendored stay clean.
		if _, hadPrev := prev[sharedAssetKey(b.Name)]; hadPrev || sharedDigest != empty {
			cur[sharedAssetKey(b.Name)] = bumps.Current{Version: b.Version, SourceDigest: sharedDigest}
		}
		cd, cErr := digest.Dir(filepath.Join(defaultCodexAssetsRoot(repoRoot), b.Name))
		if cErr != nil {
			fmt.Println("check-bumps: codex assets:", cErr)
			return 1
		}
		if _, hadPrev := prev[codexAssetKey(b.Name)]; hadPrev || cd != empty {
			cur[codexAssetKey(b.Name)] = bumps.Current{Version: b.Version, SourceDigest: cd}
		}
	}
	_ = index.SchemaVersion // keep digest/index contract in one place (CC-2/CC-5)

	violations := bumps.Check(prev, cur)
	if len(violations) == 0 {
		fmt.Println("OK: no un-bumped source changes")
		return 0
	}
	// bumps.Check walks a map, so sort for a stable report. `docs/scripts/publish.sh`
	// sorts the bundle names it extracts anyway, but a human diffing two runs should not
	// see reshuffled lines.
	sort.Slice(violations, func(i, j int) bool { return violations[i].Key < violations[j].Key })
	sharedViolation, codexViolation := false, false
	fmt.Println("VERSION-BUMP GATE: canonical source changed without a version bump:")
	for _, v := range violations {
		// Line shape is a machine contract — publish.sh seds the bundle name off the
		// front of every `  - <bundle>/...` line to decide what to patch-bump.
		fmt.Printf("  - %s (version still %s)\n    old %s\n    new %s\n", v.Key, v.Version, v.OldDigest, v.NewDigest)
		switch {
		case strings.Contains(v.Key, "/shared-assets/"):
			sharedViolation = true
		case strings.Contains(v.Key, "/codex-assets/"):
			codexViolation = true
		}
	}
	fmt.Println("bump the artifact's `version` (semver) and rebuild")
	// A vendored-asset violation names no artifact, so "bump the artifact's version" alone
	// sends an operator hunting for a source file that did not change. Say which tree moved.
	if sharedViolation {
		fmt.Println("the shared vendor/stark-skills snapshot changed: it is vendored into EVERY bundle,")
		fmt.Println("so every bundle listed above must bump (docs/scripts/publish.sh does this for you)")
	}
	if codexViolation {
		fmt.Println("a vendor/runtime-overrides/codex/<bundle> overlay changed: it ships in that bundle's")
		fmt.Println("dist/codex-plugins package, so that bundle's version must bump")
	}
	return 1
}

func newCheckBumpsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "check-bumps [catalog-dir]",
		Short: "Fail if an artifact's canonical source changed without a version bump (spec §11)",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			// repoRoot (for `git show origin/main:index.json`) is the catalog dir's
			// parent, so `check-bumps [../catalog]` works from any CWD (e.g. engine/ in CI).
			catalogDir := "catalog"
			if len(args) == 1 {
				catalogDir = args[0]
			}
			if code := runCheckBumps(catalogDir, filepath.Dir(filepath.Clean(catalogDir))); code != 0 {
				return fmt.Errorf("version-bump gate failed")
			}
			return nil
		},
	}
}
