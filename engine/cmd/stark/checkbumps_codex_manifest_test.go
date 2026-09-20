package main

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/21StarkCom/bifrost/engine/internal/digest"
	"github.com/21StarkCom/bifrost/engine/internal/load"
	"github.com/21StarkCom/bifrost/engine/internal/marketplace"
)

// The decision these tests pin (STARK-7977, found by the review of bifrost#294):
//
//	Changing the homepage fallback in `internal/marketplace/codex.go` re-rendered six
//	`dist/codex-plugins/<bundle>/.codex-plugin/plugin.json` files, no bundle version moved,
//	and `check-bumps` printed "OK: no un-bumped source changes". That is DELIBERATE, and the
//	manifest gets no fifth row family, for two reasons — each pinned below so the exemption
//	reddens the day its premise stops being true rather than quietly outliving it:
//
//	1. Spec §11: the gate hashes canonical SOURCE, and display-metadata-only changes
//	   (`description`/`tags`/homepage/owner) deliberately do not force a bump. The manifest is
//	   almost entirely that metadata, so a row digesting its bytes would turn every
//	   bundle.yaml description edit into a violation and contradict the spec.
//	2. The Codex manifest's `version` is the ROOT `VERSION`, not the bundle's. The gate can
//	   only force a BUNDLE bump, which changes no byte of the Codex package — so a violation
//	   here would demand a bump that reaches no consumer of the changed bytes.
//
// It is also the same class as every other engine-driven re-render (an adapter edit
// re-renders every skill body under unchanged bundle versions); spec §7.7 gives that class
// to the adapter target version, not to this gate.

// seedCodexManifestRepo is one Codex-targeted bundle plus an ACCURATE committed index, so
// the only thing a test then changes is what feeds the manifest.
func seedCodexManifestRepo(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "catalog", "stark-ops", "bundle.yaml"),
		"name: stark-ops\nversion: 0.5.0\ndescription: d\nowner: { name: E }\nruntimes: [claude, codex]\n")
	writeFile(t, filepath.Join(root, "catalog", "stark-ops", "commands", "hello.md"),
		"---\nname: hello\ntype: command\ndescription: d\nversion: 0.1.0\n---\nbody\n")

	cat, err := load.Load(filepath.Join(root, "catalog"))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	idx, err := json.Marshal(map[string]any{
		"schemaVersion": 1,
		"artifacts": []map[string]any{{
			"name": "hello", "type": "command", "bundle": "stark-ops",
			"version": "0.1.0", "digest": digest.Source(cat.Bundles[0].Artifacts[0]),
		}},
	})
	if err != nil {
		t.Fatalf("marshal index: %v", err)
	}
	writeFile(t, filepath.Join(root, "index.json"), string(idx)+"\n")

	for _, args := range [][]string{
		{"init"}, {"add", "."},
		{"-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "seed"},
	} {
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		if out, gitErr := cmd.CombinedOutput(); gitErr != nil {
			t.Fatalf("git %v: %v\n%s", args, gitErr, out)
		}
	}
	return root
}

// renderedCodexManifest is the exact bytes `stark build` writes for the seeded bundle.
func renderedCodexManifest(t *testing.T, root string) []byte {
	t.Helper()
	cat, err := load.Load(filepath.Join(root, "catalog"))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	m, err := marketplace.GenerateCodexPlugin(cat.Bundles[0], "1.2.3")
	if err != nil {
		t.Fatalf("GenerateCodexPlugin: %v", err)
	}
	b, err := marketplace.MarshalCodex(m)
	if err != nil {
		t.Fatalf("MarshalCodex: %v", err)
	}
	return b
}

// Reason 1. A change that re-renders ONLY the Codex manifest passes the gate un-bumped. The
// before/after comparison is what keeps this from being vacuous: a fixture whose edit never
// reached the manifest would "pass" while proving nothing.
func TestCheckBumpsExemptsACodexManifestOnlyChange(t *testing.T) {
	root := seedCodexManifestRepo(t)
	before := renderedCodexManifest(t, root)

	writeFile(t, filepath.Join(root, "catalog", "stark-ops", "bundle.yaml"),
		"name: stark-ops\nversion: 0.5.0\ndescription: d\nhomepage: https://example.com/moved\nowner: { name: E }\nruntimes: [claude, codex]\n")
	if after := renderedCodexManifest(t, root); bytes.Equal(before, after) {
		t.Fatal("fixture is vacuous: the homepage edit did not change the rendered plugin.json")
	}

	code, out := captureCheckBumps(t, filepath.Join(root, "catalog"), root)
	if code != 0 {
		t.Fatalf("a Codex-manifest-only change is exempt from the bundle bump gate (STARK-7977, "+
			"CLAUDE.md \"Version-bump immutability\"); got exit %d\n%s", code, out)
	}
}

// Reason 2, against the REAL committed tree: every Codex manifest carries the root VERSION.
// If this reddens because the manifest now carries the bundle version, a bundle bump DOES
// reach Codex consumers and the exemption above needs re-deciding, not this test deleting.
func TestCommittedCodexManifestsCarryTheRootVersion(t *testing.T) {
	root := repoRoot(t)
	raw, err := os.ReadFile(filepath.Join(root, "VERSION"))
	if err != nil {
		t.Skipf("no root VERSION (%v)", err)
	}
	want := strings.TrimSpace(string(raw))
	manifests, err := filepath.Glob(filepath.Join(root, "dist", "codex-plugins", "*", ".codex-plugin", "plugin.json"))
	if err != nil || len(manifests) == 0 {
		t.Skipf("no committed Codex manifests (%v)", err)
	}
	for _, path := range manifests {
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var m struct {
			Version string `json:"version"`
		}
		if err := json.Unmarshal(b, &m); err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		if m.Version != want {
			t.Errorf("%s: version %q, want the root VERSION %q", path, m.Version, want)
		}
	}
}
