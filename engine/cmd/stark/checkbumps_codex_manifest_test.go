package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// The decision these tests pin (STARK-7977, found by the review of bifrost#294):
//
//	Changing the homepage fallback in `internal/marketplace/codex.go` re-rendered six
//	`dist/codex-plugins/<bundle>/.codex-plugin/plugin.json` files, no bundle version moved,
//	and `check-bumps` printed "OK: no un-bumped source changes". That is DELIBERATE, and the
//	manifest gets no fifth row family, for two reasons — each pinned below so the exemption
//	reddens the day its premise stops being true rather than quietly outliving it:
//
//	1. Spec §11: the gate hashes canonical SOURCE — "only body + type-specific canonical
//	   fields" force a bump; display-metadata-only changes (the spec names
//	   `description`/`tags`/`summary`) deliberately do not. `homepage` and `owner` are
//	   bundle-level metadata `digest.Source` never reads, so they fall outside by the same
//	   rule. The manifest is almost entirely that metadata, so a row digesting its bytes
//	   would turn every bundle.yaml description edit into a violation and contradict the spec.
//	2. The Codex manifest's `version` is the ROOT `VERSION`, not the bundle's. The gate can
//	   only force a BUNDLE bump, which changes no byte of the Codex package — so a violation
//	   here would demand a bump that reaches no consumer of the changed bytes.
//
// It is also the same class as every other engine-driven re-render (an adapter edit
// re-renders every skill body under unchanged bundle versions). Spec §7.7 hands ADAPTER
// re-renders to the adapter target version; `internal/marketplace` is not an adapter target,
// so no target version covers the manifest either (bifrost#294 moved none). Nothing forces the
// root VERSION to move, and nothing needs to (STARK-7998): `version` only names the Codex cache
// directory, and `codex plugin marketplace upgrade` re-installs from the refreshed marketplace
// snapshot regardless of it.
//
// UNLIKE the two reasons above, that last premise is pinned by NOTHING in this file and no test
// below reddens when it stops being true — CI has no Codex. It was measured on 2026-09-20 on
// codex-cli 0.155.1: the upgrade behavior against a hand-written `source_type = "git"`
// marketplace, and separately what a real `codex plugin marketplace add` over HTTPS records
// (source, no ref, default branch — no SHA pin). Re-measure both on any newer codex-cli before
// leaning on them, and read CLAUDE.md "Version-bump immutability" for what each probe did and
// did not establish.
//
// Refusing the root-VERSION row is not a reason to add a per-bundle codexManifests row instead:
// reasons 1 and 2 above rule the manifest out on their own.

const codexFixtureBundle = "stark-ops"

// writeCodexManifestFixture (re)writes the one-bundle catalog. `extraBundleYAML` is appended
// to bundle.yaml verbatim, which is how a test changes what feeds the manifest and nothing
// else. The artifact carries the bundle's version, as every `stark sync`-generated one does,
// so a "bundle bump" here moves the same two lines a real one moves.
func writeCodexManifestFixture(t *testing.T, root, bundleVersion, extraBundleYAML string) {
	t.Helper()
	writeFile(t, filepath.Join(root, "catalog", codexFixtureBundle, "bundle.yaml"),
		"name: "+codexFixtureBundle+"\nversion: "+bundleVersion+"\ndescription: d\n"+extraBundleYAML+
			"owner: { name: E }\nruntimes: [claude, codex]\n")
	writeFile(t, filepath.Join(root, "catalog", codexFixtureBundle, "commands", "hello.md"),
		"---\nname: hello\ntype: command\ndescription: d\nversion: "+bundleVersion+"\n---\nbody\n")
}

// buildCodexManifestFixture runs the REAL `stark build` into the fixture root.
func buildCodexManifestFixture(t *testing.T, root string) {
	t.Helper()
	if code := runBuild(filepath.Join(root, "catalog"), root, "", "", false); code != 0 {
		t.Fatalf("stark build into the fixture: exit %d", code)
	}
}

// seedCodexManifestRepo is one Codex-targeted bundle committed exactly as `stark build`
// leaves it — index.json INCLUDED. That is the point, not a convenience: `bumps.Check`
// skips any current key with no previous row, so a hand-rolled index listing only
// `artifacts` makes this fixture blind to the very thing it guards. Measured: with such a
// seed, a fifth row family digesting the manifest was added to the gate and
// TestCheckBumpsExemptsACodexManifestOnlyChange stayed green. Seeding from the real build
// means any row family the engine starts recording is a previous row here the same day.
func seedCodexManifestRepo(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	// A root VERSION distinct from the bundle's, as in the real repo (0.32.3 vs 0.17.3).
	writeFile(t, filepath.Join(root, "VERSION"), "1.2.3\n")
	writeCodexManifestFixture(t, root, "0.5.0", "")
	buildCodexManifestFixture(t, root)

	seedCommit(t, root)
	return root
}

func codexFixturePackage(root string) string {
	return filepath.Join(root, "dist", "codex-plugins", codexFixtureBundle)
}

// builtCodexManifest is the plugin.json the real build wrote — read off disk rather than
// re-derived through the generator, so it cannot drift from what `stark build` ships.
func builtCodexManifest(t *testing.T, root string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(codexFixturePackage(root), ".codex-plugin", "plugin.json"))
	if err != nil {
		t.Fatalf("the build wrote no Codex manifest for the fixture bundle: %v", err)
	}
	return string(b)
}

// Reason 1. A change that re-renders the Codex manifest and touches no canonical source
// passes the gate un-bumped. The before/after comparison is what keeps this from being
// vacuous: a fixture whose edit never reached the manifest would "pass" while proving nothing.
func TestCheckBumpsExemptsACodexManifestOnlyChange(t *testing.T) {
	root := seedCodexManifestRepo(t)
	before := builtCodexManifest(t, root)

	writeCodexManifestFixture(t, root, "0.5.0", "homepage: https://example.com/moved\n")
	buildCodexManifestFixture(t, root)
	if after := builtCodexManifest(t, root); before == after {
		t.Fatal("fixture is vacuous: the homepage edit did not change the built plugin.json")
	}

	code, out := captureCheckBumps(t, filepath.Join(root, "catalog"), root)
	if code != 0 {
		t.Fatalf("a Codex-manifest-only change is exempt from the bundle bump gate (STARK-7977, "+
			"CLAUDE.md \"Version-bump immutability\"); got exit %d\n%s", code, out)
	}
}

// Reason 2, the half the argument actually turns on: a BUNDLE bump changes no byte of the
// Codex package, so a violation that demanded one would reach no Codex consumer. If this
// reddens, a bundle bump DOES reach them and the exemption needs re-deciding.
func TestABundleBumpChangesNoByteOfTheCodexPackage(t *testing.T) {
	root := seedCodexManifestRepo(t)
	before := treeFiles(t, codexFixturePackage(root))
	if len(before) == 0 {
		t.Fatal("the build wrote no Codex package — this comparison would pass by guarding nothing")
	}

	writeCodexManifestFixture(t, root, "0.5.1", "")
	buildCodexManifestFixture(t, root)

	// Vacuity guard: the bump must have reached the build. The Claude package carries the
	// bundle version, so it is where a bump that landed is visible.
	claude, err := os.ReadFile(filepath.Join(root, "dist", "claude", codexFixtureBundle, ".claude-plugin", "plugin.json"))
	if err != nil {
		t.Fatalf("read the Claude plugin manifest: %v", err)
	}
	if !strings.Contains(string(claude), `"0.5.1"`) {
		t.Fatalf("fixture is vacuous: the bundle bump never reached the build\n%s", claude)
	}

	after := treeFiles(t, codexFixturePackage(root))
	var changed []string
	for rel, b := range before {
		if a, ok := after[rel]; !ok || a != b {
			changed = append(changed, rel)
		}
	}
	for rel := range after {
		if _, ok := before[rel]; !ok {
			changed = append(changed, rel)
		}
	}
	if len(changed) > 0 {
		sort.Strings(changed)
		t.Fatalf("a bundle bump (0.5.0 -> 0.5.1) changed the Codex package, so a bundle bump now DOES "+
			"reach Codex consumers — re-decide the STARK-7977 exemption, do not delete this test:\n  %s",
			strings.Join(changed, "\n  "))
	}
}

// Reason 2, against the REAL committed tree: every Codex manifest carries the root VERSION.
// If this reddens because the manifest now carries the bundle version, a bundle bump DOES
// reach Codex consumers and the exemption above needs re-deciding, not this test deleting.
//
// A missing VERSION or an empty glob FAILS rather than skips. repoRoot has already proved
// this is the real checkout, where both are committed — so the only way either goes missing
// is that the thing being pinned moved, which is exactly when this must not go quietly green
// (a skip and a pass are indistinguishable in `go test` output without -v).
func TestCommittedCodexManifestsCarryTheRootVersion(t *testing.T) {
	root := repoRoot(t)
	raw, err := os.ReadFile(filepath.Join(root, "VERSION"))
	if err != nil {
		t.Fatalf("read the root VERSION: %v", err)
	}
	want := strings.TrimSpace(string(raw))
	pattern := filepath.Join(root, "dist", "codex-plugins", "*", ".codex-plugin", "plugin.json")
	manifests, err := filepath.Glob(pattern)
	if err != nil {
		t.Fatalf("glob %s: %v", pattern, err)
	}
	if len(manifests) == 0 {
		t.Fatalf("no committed Codex manifest matches %s — if the package layout moved, re-point "+
			"this test; it would otherwise pass by guarding nothing", pattern)
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
