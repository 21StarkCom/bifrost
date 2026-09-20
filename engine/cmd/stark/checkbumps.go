package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"github.com/21StarkCom/bifrost/engine/internal/bumps"
	"github.com/21StarkCom/bifrost/engine/internal/digest"
	"github.com/21StarkCom/bifrost/engine/internal/index"
	"github.com/21StarkCom/bifrost/engine/internal/load"
	"github.com/spf13/cobra"
)

// prevIndexJSON returns the previously committed index.json bytes, preferring
// origin/main and falling back to HEAD. Returns nil (skip) when neither ref has
// the file (first commit / fresh repo).
//
// Through gitCommand, not a bare exec: an inherited GIT_DIR wins over `-C repoRoot`, so
// under a hook or `git rebase --exec` the gate would read some OTHER repo's index as the
// previous one and pass or fail by accident.
func prevIndexJSON(repoRoot string) []byte {
	for _, ref := range []string{"origin/main:index.json", "HEAD:index.json"} {
		cmd := gitCommand(repoRoot, "show", ref)
		var stdout, stderr bytes.Buffer
		cmd.Stdout, cmd.Stderr = &stdout, &stderr
		if err := cmd.Run(); err == nil {
			return stdout.Bytes()
		}
	}
	return nil
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
// "Version-bump immutability". No root-VERSION row either (STARK-7998): a Codex consumer
// re-installs from the marketplace git ref, and `version` only names its cache directory.
func codexAssetKey(bundle string) string { return bundle + "/codex-assets/" + bundle }

// emptyDirDigest is `digest.Files` over no files — the value a bundle without a
// vendor/plugins/<bundle> directory produces. Used to skip recording a row for the many
// bundles that have no plugin assets at all, keeping index.json free of empty entries.
func emptyDirDigest() string { return digest.Files(map[string][]byte{}) }

// runCheckBumps loads the previous committed index + the current catalog and
// errors (exit 1) on any version-bump immutability violation (CC-5 / spec §11).
func runCheckBumps(catalogDir, repoRoot string) int {
	prevBytes := prevIndexJSON(repoRoot)
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
