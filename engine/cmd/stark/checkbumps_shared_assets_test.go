package main

import (
	"bufio"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/21StarkCom/bifrost/engine/internal/digest"
	"github.com/21StarkCom/bifrost/engine/internal/load"
)

// The gap these tests close, measured live on 2026-09-16 (bifrost PR #244, the
// `/team-leader-agent` -> `/gru` rename):
//
//	`stark build` vendors the SHARED `vendor/stark-skills/` snapshot into EVERY bundle's
//	`dist/claude/<bundle>/tools/`, so one stark-skills change to a top-level tool changed
//	all seven dist trees. `check-bumps` digested artifact sources plus
//	`vendor/plugins/<bundle>` and never the shared snapshot, so it printed
//	"OK: no un-bumped source changes" while six bundles shipped changed bytes under
//	unchanged versions. Consumers already on those versions never re-fetch, so
//	`/plugin update` is a silent no-op and two different byte trees claim one version.
//
// `docs/scripts/publish.sh` auto-bumps by PARSING check-bumps stdout, so the line SHAPE of
// a shared-snapshot violation is part of the contract, not cosmetics —
// TestPublishShParserExtractsBundlesFromSharedAssetViolations pins it against the real
// script rather than a copy of its regex.

// sharedAssetsBundles is the fixture's bundle set: three bundles that all vendor the one
// shared snapshot, mirroring the real repo where every bundle does.
var sharedAssetsBundles = []string{"stark-analyze", "stark-ops", "stark-plan"}

// seedSharedAssetsRepo builds a git repo whose committed index.json records a
// `sharedAssets` digest per bundle, with `vendor/stark-skills/tools/gru.ts` on disk.
// `prevDigest` is what the committed index claims: pass a stale value to simulate "the
// shared snapshot changed since the last publish". `bundleVersion` is the version now in
// each bundle.yaml; `prevVersion` is the version the committed index recorded.
func seedSharedAssetsRepo(t *testing.T, bundleVersion, prevVersion, prevDigest string) string {
	t.Helper()
	root := t.TempDir()
	for _, b := range sharedAssetsBundles {
		writeFile(t, filepath.Join(root, "catalog", b, "bundle.yaml"),
			"name: "+b+"\nversion: "+bundleVersion+"\ndescription: d\nowner: { name: E }\nruntimes: [claude]\n")
		writeFile(t, filepath.Join(root, "catalog", b, "commands", "hello.md"),
			"---\nname: hello\ntype: command\ndescription: d\nversion: 0.1.0\n---\nbody\n")
	}
	// The shared snapshot: one top-level tool, exactly the shape that slipped through.
	writeFile(t, filepath.Join(root, "vendor", "stark-skills", "tools", "gru.ts"),
		"export const a = 1;\n")

	artifacts := []map[string]any{}
	shared := []map[string]any{}
	for _, b := range sharedAssetsBundles {
		artifacts = append(artifacts, map[string]any{
			"name": "hello", "type": "command", "bundle": b,
			"version": "0.1.0", "digest": digestOfSharedHello(t, root, b),
		})
		shared = append(shared, map[string]any{
			"bundle": b, "version": prevVersion, "digest": prevDigest,
		})
	}
	b, err := json.Marshal(map[string]any{
		"schemaVersion": 1,
		"artifacts":     artifacts,
		"sharedAssets":  shared,
	})
	if err != nil {
		t.Fatalf("marshal index: %v", err)
	}
	writeFile(t, filepath.Join(root, "index.json"), string(b)+"\n")

	git := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		if out, gitErr := cmd.CombinedOutput(); gitErr != nil {
			t.Fatalf("git %v: %v\n%s", args, gitErr, out)
		}
	}
	git("init")
	git("add", ".")
	git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "seed")
	return root
}

// digestOfSharedHello recomputes one bundle's command digest so the ARTIFACT half of the
// gate stays clean and only the shared-snapshot half can trip.
func digestOfSharedHello(t *testing.T, root, bundle string) string {
	t.Helper()
	cat, err := load.Load(filepath.Join(root, "catalog"))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	for _, b := range cat.Bundles {
		if b.Name != bundle {
			continue
		}
		for _, a := range b.Artifacts {
			if a.Name == "hello" {
				return digest.Source(a)
			}
		}
	}
	t.Fatalf("hello artifact not found in %s", bundle)
	return ""
}

// captureCheckBumps runs the gate with stdout redirected, returning the exit code and
// everything it printed. The printed lines are a machine-read contract (publish.sh), so
// they need asserting, not just the exit code.
func captureCheckBumps(t *testing.T, catalogDir, repoRoot string) (int, string) {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("pipe: %v", err)
	}
	orig := os.Stdout
	os.Stdout = w
	code := runCheckBumps(catalogDir, repoRoot)
	os.Stdout = orig
	if closeErr := w.Close(); closeErr != nil {
		t.Fatalf("close pipe: %v", closeErr)
	}
	var sb strings.Builder
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for sc.Scan() {
		sb.WriteString(sc.Text())
		sb.WriteString("\n")
	}
	if scanErr := sc.Err(); scanErr != nil {
		t.Fatalf("read captured stdout: %v", scanErr)
	}
	return code, sb.String()
}

// THE REGRESSION TEST. The shared snapshot changed since the committed index and no bundle
// version moved. Before this gate existed, check-bumps printed "OK: no un-bumped source
// changes" here and every bundle shipped changed content under an unchanged version.
func TestCheckBumpsFailsWhenSharedSnapshotChangedWithoutABump(t *testing.T) {
	root := seedSharedAssetsRepo(t, "0.5.45", "0.5.45", "sha256:stale-from-the-last-publish")
	code, out := captureCheckBumps(t, filepath.Join(root, "catalog"), root)
	if code != 1 {
		t.Fatalf("want exit 1 when the shared snapshot changed un-bumped, got %d\n%s", code, out)
	}
	// EVERY bundle that vendors the snapshot must be named — a partial list would let
	// publish.sh bump some bundles and ship the rest un-bumped, which is the same bug.
	for _, b := range sharedAssetsBundles {
		if !strings.Contains(out, b+"/shared-assets/"+b) {
			t.Fatalf("violation output does not name bundle %s:\n%s", b, out)
		}
	}
}

// Control: the SAME changed snapshot with every bundle version bumped must pass, or the
// gate would be unsatisfiable and publish.sh could never go green.
func TestCheckBumpsPassesWhenSharedSnapshotChangeIsBumped(t *testing.T) {
	root := seedSharedAssetsRepo(t, "0.5.46", "0.5.45", "sha256:stale-from-the-last-publish")
	code, out := captureCheckBumps(t, filepath.Join(root, "catalog"), root)
	if code != 0 {
		t.Fatalf("want exit 0 when the shared-snapshot change carries a bump, got %d\n%s", code, out)
	}
}

// Control: nothing changed. The committed digest matches the tree, so unchanged versions
// are correct and must not be flagged.
func TestCheckBumpsPassesWhenSharedSnapshotIsUnchanged(t *testing.T) {
	probe := t.TempDir()
	writeFile(t, filepath.Join(probe, "vendor", "stark-skills", "tools", "gru.ts"),
		"export const a = 1;\n")
	current, err := digest.Dir(filepath.Join(probe, "vendor", "stark-skills"))
	if err != nil {
		t.Fatalf("digest.Dir: %v", err)
	}
	root := seedSharedAssetsRepo(t, "0.5.45", "0.5.45", current)
	code, out := captureCheckBumps(t, filepath.Join(root, "catalog"), root)
	if code != 0 {
		t.Fatalf("want exit 0 when the shared snapshot is unchanged, got %d\n%s", code, out)
	}
}

// publishShBundleRegex extracts the bundle-name sed expression from the REAL publish.sh so
// this test tracks the script instead of a copy of it. publish.sh auto-bumps by parsing
// check-bumps stdout; if the two ever disagree the script silently extracts NOTHING,
// concludes "version-bump gate clean", and stops bumping while check-bumps alone still
// looks correct in isolation.
func publishShBundleRegex(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "docs", "scripts", "publish.sh")
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read publish.sh: %v", err)
	}
	re := regexp.MustCompile(`(?m)^\s*\| sed -nE '(.*)' \| sort -u\)?\s*$`)
	m := re.FindSubmatch(b)
	if m == nil {
		t.Fatalf("could not find publish.sh's bundle-extraction sed line; if the parser moved, update this test AND re-verify the line shape check-bumps prints")
	}
	return string(m[1])
}

// END-TO-END PROOF that publish.sh's auto-bump loop still works against the NEW failure
// mode: take real check-bumps output and run the real script's real parser over it.
func TestPublishShParserExtractsBundlesFromSharedAssetViolations(t *testing.T) {
	root := seedSharedAssetsRepo(t, "0.5.45", "0.5.45", "sha256:stale-from-the-last-publish")
	code, out := captureCheckBumps(t, filepath.Join(root, "catalog"), root)
	if code != 1 {
		t.Fatalf("fixture must violate; got exit %d\n%s", code, out)
	}

	cmd := exec.Command("bash", "-c", `printf '%s\n' "$CB_OUT" | sed -nE "$SED_EXPR" | sort -u`)
	cmd.Env = append(os.Environ(), "CB_OUT="+out, "SED_EXPR="+publishShBundleRegex(t))
	parsed, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("run publish.sh parser: %v\n%s", err, parsed)
	}
	got := []string{}
	for _, line := range strings.Split(strings.TrimSpace(string(parsed)), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			got = append(got, line)
		}
	}
	want := append([]string(nil), sharedAssetsBundles...)
	sort.Strings(want)
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("publish.sh's parser extracted %v, want %v\nfrom check-bumps output:\n%s", got, want, out)
	}
}

// A previous index generated before `sharedAssets` existed must not break the gate: it
// contributes no previous rows, so the first publish after rollout records them.
func TestLeanPrevToleratesAnIndexWithoutSharedAssets(t *testing.T) {
	var lp leanPrev
	old := `{"schemaVersion":1,"artifacts":[{"name":"x","type":"skill","bundle":"b","version":"0.1.0","digest":"sha256:aa"}]}`
	if err := json.Unmarshal([]byte(old), &lp); err != nil {
		t.Fatalf("unmarshal legacy index: %v", err)
	}
	if len(lp.SharedAssets) != 0 {
		t.Fatalf("expected no shared assets, got %d", len(lp.SharedAssets))
	}
}

// The shared-asset key must collide with neither an artifact key ("<bundle>/<type>/<name>")
// nor the plugin-asset key, or one of the two rows silently loses its gate (the CC-5
// bypass the artifact-key comment warns about).
func TestSharedAssetKeyCannotCollide(t *testing.T) {
	key := sharedAssetKey("stark-ops")
	if key != "stark-ops/shared-assets/stark-ops" {
		t.Fatalf("unexpected key shape: %s", key)
	}
	if key == pluginAssetKey("stark-ops") {
		t.Fatalf("shared-asset key collides with the plugin-asset key: %s", key)
	}
	for _, artifactType := range []string{"skill", "command", "agent", "mcp", "prompt"} {
		if key == "stark-ops/"+artifactType+"/stark-ops" {
			t.Fatalf("shared-asset key collides with artifact type %q", artifactType)
		}
	}
}
