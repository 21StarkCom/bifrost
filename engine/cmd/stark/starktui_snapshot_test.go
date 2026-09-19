package main

import (
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// snapshotDir is the vendored copy of stark-tui's go/help + go/colors that
// cmd/stark/help.go renders every help page through. See its README.md for why
// bifrost carries a copy instead of importing the private module.
const snapshotDir = "internal/starktui"

// TestStarkTuiSnapshotAddsNoDependencies pins the property that made a snapshot
// the viable option at all: upstream's help and colors packages are stdlib-only,
// so copying them here costs engine/go.mod nothing.
//
// It fails on two different regressions, and both matter:
//
//   - A refresh that pulls in an upstream revision with a new third-party import
//     would silently add a module to a repo whose CI cannot fetch private ones
//     and whose public clones must keep building.
//   - An import of bifrost's OWN packages from inside the snapshot. That is the
//     more likely mistake and the more damaging one: it compiles, it passes every
//     other gate, and it makes the documented refresh — a straight `cp -R` over
//     this tree — silently destructive.
func TestStarkTuiSnapshotAddsNoDependencies(t *testing.T) {
	dir := filepath.Join(repoRoot(t), "engine", snapshotDir)
	self := "github.com/21StarkCom/bifrost/engine/" + snapshotDir

	checked := 0
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") {
			return err
		}
		fset := token.NewFileSet()
		f, err := parser.ParseFile(fset, path, nil, parser.ImportsOnly)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(dir, path)
		checked++
		for _, imp := range f.Imports {
			p := strings.Trim(imp.Path.Value, `"`)
			switch {
			case !strings.Contains(strings.Split(p, "/")[0], "."):
				// No dot in the first segment: a standard-library path.
			case strings.HasPrefix(p, self+"/"):
				// A sibling package inside the snapshot (help -> colors).
			default:
				t.Errorf("%s imports %q: the snapshot must import stdlib and its own siblings only — see %s/README.md", rel, p, snapshotDir)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if checked == 0 {
		t.Fatalf("no .go files under %s — the snapshot is missing and the check proved nothing", snapshotDir)
	}
}

// TestStarkTuiSnapshotRecordsItsUpstreamRevision keeps the copy traceable. The
// README's pinned tag is the only record of which stark-tui revision is
// rendering `stark --help`; without it a future refresh cannot tell what it is
// refreshing FROM, and a behavior difference between this repo and the rest of
// the fleet has nothing to diff against.
func TestStarkTuiSnapshotRecordsItsUpstreamRevision(t *testing.T) {
	path := filepath.Join(repoRoot(t), "engine", snapshotDir, "README.md")
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("the snapshot's provenance record is missing: %v", err)
	}
	for _, want := range []string{"21StarkCom/stark-tui", "go/v"} {
		if !strings.Contains(string(body), want) {
			t.Errorf("%s/README.md no longer names %q — the copy's upstream revision is unrecorded", snapshotDir, want)
		}
	}
}
