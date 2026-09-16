package build

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/21StarkCom/bifrost/engine/internal/digest"
	"github.com/21StarkCom/bifrost/engine/internal/index"
	"github.com/21StarkCom/bifrost/engine/internal/load"
)

// TestVendorAssetsDigestMatchesDigestDir pins the equivalence the whole shared-snapshot
// gate rests on: `build` hashes the snapshot it just READ (digest.Files over vendorAssets'
// map), while `check-bumps` hashes the snapshot ON DISK (digest.Dir) without running a
// build. If the two walks ever diverge — a filter added to one side, a different
// normalization — the gate would compare two unrelated numbers and either fire on every
// clean repo or (worse) never fire at all, which is the bug it exists to catch.
func TestVendorAssetsDigestMatchesDigestDir(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "config.json"), `{"global":true}`)
	mustWrite(t, filepath.Join(dir, "tools", "gru.ts"), "export const s = 1\n")
	mustWrite(t, filepath.Join(dir, "tools", "lib", "deep.ts"), "export const d = 2\r\n")
	mustWrite(t, filepath.Join(dir, "prompts", "claude", "agent.md"), "# agent\n")
	// Entries a plausible future filter would treat differently. Plain regular files alone
	// would keep this test green through exactly the divergence it claims to guard: if one
	// side starts skipping dotfiles or node_modules, or starts FOLLOWING symlinks (neither
	// walk does today — both skip non-regular entries and WalkDir does not follow), only a
	// fixture containing them can notice.
	mustWrite(t, filepath.Join(dir, ".hidden-config"), "dot\n")
	mustWrite(t, filepath.Join(dir, "node_modules", "pkg", "index.js"), "module.exports = 1\n")
	if err := os.Symlink(filepath.Join(dir, "config.json"), filepath.Join(dir, "tools", "link.json")); err != nil {
		t.Fatalf("symlink: %v", err)
	}

	files, err := vendorAssets(dir)
	if err != nil {
		t.Fatalf("vendorAssets: %v", err)
	}
	fromMap := digest.Files(files)
	fromDisk, err := digest.Dir(dir)
	if err != nil {
		t.Fatalf("digest.Dir: %v", err)
	}
	if fromMap != fromDisk {
		t.Fatalf("build and check-bumps disagree on the shared-snapshot digest:\n  build      %s\n  check-bumps %s", fromMap, fromDisk)
	}
}

// TestBuildRecordsSharedAssetDigestForEveryBundle is the build-side half of the gate: the
// shared snapshot is vendored into EVERY bundle, so index.json must carry a row for every
// bundle — a partial set would let the un-covered bundles ship changed bytes under
// unchanged versions, exactly the failure measured on 2026-09-16.
func TestBuildRecordsSharedAssetDigestForEveryBundle(t *testing.T) {
	cat, err := load.Load("../../../catalog")
	if err != nil {
		t.Fatal(err)
	}
	shared := t.TempDir()
	mustWrite(t, filepath.Join(shared, "tools", "gru.ts"), "export const s = 1\n")
	want, err := digest.Dir(shared)
	if err != nil {
		t.Fatalf("digest.Dir: %v", err)
	}

	out, err := Build(cat, Options{AssetsSource: shared})
	if err != nil {
		t.Fatal(err)
	}
	var idx index.Index
	if err := json.Unmarshal(out.Files["index.json"], &idx); err != nil {
		t.Fatalf("unmarshal index.json: %v", err)
	}
	if len(idx.SharedAssets) != len(cat.Bundles) {
		t.Fatalf("sharedAssets rows = %d, want one per bundle (%d)", len(idx.SharedAssets), len(cat.Bundles))
	}
	byBundle := map[string]index.SharedAsset{}
	for _, s := range idx.SharedAssets {
		byBundle[s.Bundle] = s
	}
	for _, b := range cat.Bundles {
		row, ok := byBundle[b.Name]
		if !ok {
			t.Fatalf("no sharedAssets row for bundle %s", b.Name)
		}
		if row.Digest != want {
			t.Fatalf("%s sharedAssets digest = %s, want %s", b.Name, row.Digest, want)
		}
		if row.Version != b.Version {
			t.Fatalf("%s sharedAssets version = %s, want the bundle version %s", b.Name, row.Version, b.Version)
		}
	}
}

// TestBuildRecordsCodexAssetDigestPerOverlayBundle covers the third vendored tree. A Codex
// overlay ships inside `dist/codex-plugins/<bundle>/`, carries no artifact digest, and is
// NOT covered by the shared or plugin rows — so without its own row an overlay edit ships
// changed bytes under an unchanged version, the same hole the shared snapshot had.
func TestBuildRecordsCodexAssetDigestPerOverlayBundle(t *testing.T) {
	cat, err := load.Load("../../../catalog")
	if err != nil {
		t.Fatal(err)
	}
	if len(cat.Bundles) == 0 {
		t.Fatal("catalog has no bundles")
	}
	subject := cat.Bundles[0]

	codexRoot := t.TempDir()
	mustWrite(t, filepath.Join(codexRoot, subject.Name, "tools", "override.ts"), "export const c = 1\n")
	want, err := digest.Dir(filepath.Join(codexRoot, subject.Name))
	if err != nil {
		t.Fatalf("digest.Dir: %v", err)
	}

	out, err := Build(cat, Options{CodexAssetsRoot: codexRoot})
	if err != nil {
		t.Fatal(err)
	}
	var idx index.Index
	if err := json.Unmarshal(out.Files["index.json"], &idx); err != nil {
		t.Fatalf("unmarshal index.json: %v", err)
	}
	if len(idx.CodexAssets) != 1 {
		t.Fatalf("codexAssets rows = %d, want exactly 1 (only %s has an overlay)", len(idx.CodexAssets), subject.Name)
	}
	row := idx.CodexAssets[0]
	if row.Bundle != subject.Name || row.Digest != want || row.Version != subject.Version {
		t.Fatalf("codexAssets row = %+v, want {%s %s %s}", row, subject.Name, subject.Version, want)
	}
}

// A build that vendors no snapshot must write no rows at all, rather than the empty-set
// digest — otherwise every snapshot-less catalog would record a row that can never match
// what check-bumps computes from an absent directory.
func TestBuildOmitsSharedAssetsWhenNothingIsVendored(t *testing.T) {
	cat, err := load.Load("../../../catalog")
	if err != nil {
		t.Fatal(err)
	}
	out, err := Build(cat, Options{})
	if err != nil {
		t.Fatal(err)
	}
	var idx index.Index
	if err := json.Unmarshal(out.Files["index.json"], &idx); err != nil {
		t.Fatalf("unmarshal index.json: %v", err)
	}
	if len(idx.SharedAssets) != 0 {
		t.Fatalf("expected no sharedAssets rows without a vendored snapshot, got %d", len(idx.SharedAssets))
	}
	if len(idx.CodexAssets) != 0 {
		t.Fatalf("expected no codexAssets rows without an overlay root, got %d", len(idx.CodexAssets))
	}
}
