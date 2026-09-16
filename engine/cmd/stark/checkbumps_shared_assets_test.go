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
	return seedAssetsRepo(t, bundleVersion, prevVersion, prevDigest, nil)
}

// seedAssetsRepo is the general form: `codexPrev` maps bundle -> the `codexAssets` digest
// the committed index claims for that bundle's `vendor/runtime-overrides/codex/<bundle>`
// overlay. Bundles in the map get an overlay file on disk AND a previous row; the rest get
// neither, which is what lets a test assert that only the overlay-carrying bundle is flagged.
func seedAssetsRepo(t *testing.T, bundleVersion, prevVersion, prevDigest string, codexPrev map[string]string) string {
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
	codex := []map[string]any{}
	for _, b := range sharedAssetsBundles {
		artifacts = append(artifacts, map[string]any{
			"name": "hello", "type": "command", "bundle": b,
			"version": "0.1.0", "digest": digestOfSharedHello(t, root, b),
		})
		shared = append(shared, map[string]any{
			"bundle": b, "version": prevVersion, "digest": prevDigest,
		})
		d, ok := codexPrev[b]
		if !ok {
			continue
		}
		writeFile(t, filepath.Join(root, "vendor", "runtime-overrides", "codex", b, "tools", "override.ts"),
			"export const c = 1;\n")
		codex = append(codex, map[string]any{
			"bundle": b, "version": prevVersion, "digest": d,
		})
	}
	idx := map[string]any{
		"schemaVersion": 1,
		"artifacts":     artifacts,
		"sharedAssets":  shared,
	}
	if len(codex) > 0 {
		idx["codexAssets"] = codex
	}
	b, err := json.Marshal(idx)
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

// currentSharedDigest is the digest the seeded `vendor/stark-skills` tree actually has, so a
// test can make the shared rows accurate and isolate whichever other half it is exercising.
// Computed over an identical probe tree rather than hardcoded, so a change to digest.Files'
// framing does not silently turn these fixtures into permanent violations.
func currentSharedDigest(t *testing.T) string {
	t.Helper()
	probe := t.TempDir()
	writeFile(t, filepath.Join(probe, "vendor", "stark-skills", "tools", "gru.ts"),
		"export const a = 1;\n")
	d, err := digest.Dir(filepath.Join(probe, "vendor", "stark-skills"))
	if err != nil {
		t.Fatalf("digest.Dir: %v", err)
	}
	return d
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
	// Drain CONCURRENTLY. runCheckBumps writes synchronously, so reading only after it
	// returns deadlocks the moment its output exceeds the OS pipe buffer (64KiB on
	// darwin/linux) — reachable the first time this helper is pointed at a catalog with
	// many violations, and it hangs with no error rather than failing.
	type captured struct {
		out string
		err error
	}
	done := make(chan captured, 1)
	go func() {
		defer func() { _ = r.Close() }()
		var sb strings.Builder
		sc := bufio.NewScanner(r)
		sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
		for sc.Scan() {
			sb.WriteString(sc.Text())
			sb.WriteString("\n")
		}
		done <- captured{out: sb.String(), err: sc.Err()}
	}()

	orig := os.Stdout
	// Restore even if runCheckBumps panics: otherwise os.Stdout stays pointed at a closed
	// pipe and every later test in this package loses its failure output.
	defer func() { os.Stdout = orig }()
	os.Stdout = w
	code := runCheckBumps(catalogDir, repoRoot)
	os.Stdout = orig
	if closeErr := w.Close(); closeErr != nil {
		t.Fatalf("close pipe: %v", closeErr)
	}
	got := <-done
	if got.err != nil {
		t.Fatalf("read captured stdout: %v", got.err)
	}
	return code, got.out
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
	root := seedSharedAssetsRepo(t, "0.5.45", "0.5.45", currentSharedDigest(t))
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
	// Require EXACTLY one match. Taking the first would silently test some other sed line
	// if a second one is ever added above the bump loop — the test would keep passing while
	// the parser it is supposed to pin went unexercised.
	ms := re.FindAllSubmatch(b, -1)
	if len(ms) != 1 {
		t.Fatalf("want exactly 1 bundle-extraction sed line in publish.sh, found %d; if the parser moved or a second one was added, update this test AND re-verify the line shape check-bumps prints", len(ms))
	}
	return string(ms[0][1])
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

// THE SECOND REGRESSION TEST. `vendor/runtime-overrides/codex/<bundle>` ships inside
// `dist/codex-plugins/<bundle>/` and is covered by neither the artifact digests nor the
// shared/plugin rows, so before `codexAssets` existed an overlay edit was the identical
// un-bumped-content hole for Codex installs that the shared snapshot was for Claude ones.
func TestCheckBumpsFailsWhenCodexOverlayChangedWithoutABump(t *testing.T) {
	subject := sharedAssetsBundles[0]
	// The SHARED rows must be accurate so only the Codex half can trip.
	root := seedAssetsRepo(t, "0.5.45", "0.5.45", currentSharedDigest(t),
		map[string]string{subject: "sha256:stale-codex-overlay"})
	code, out := captureCheckBumps(t, filepath.Join(root, "catalog"), root)
	if code != 1 {
		t.Fatalf("want exit 1 when a Codex overlay changed un-bumped, got %d\n%s", code, out)
	}
	if !strings.Contains(out, subject+"/codex-assets/"+subject) {
		t.Fatalf("violation output does not name the overlay bundle %s:\n%s", subject, out)
	}
	// Only the overlay bundle may be flagged — the overlay is per bundle, not shared, so
	// blaming the others would force six pointless version bumps on every Codex edit.
	for _, b := range sharedAssetsBundles[1:] {
		if strings.Contains(out, b+"/codex-assets/") {
			t.Fatalf("bundle %s has no overlay but was flagged:\n%s", b, out)
		}
	}
}

// A previous index generated before `sharedAssets` / `codexAssets` existed must not break
// the gate: it contributes no previous rows, so the first publish after rollout records them.
func TestLeanPrevToleratesAnIndexWithoutSharedAssets(t *testing.T) {
	var lp leanPrev
	old := `{"schemaVersion":1,"artifacts":[{"name":"x","type":"skill","bundle":"b","version":"0.1.0","digest":"sha256:aa"}]}`
	if err := json.Unmarshal([]byte(old), &lp); err != nil {
		t.Fatalf("unmarshal legacy index: %v", err)
	}
	if len(lp.SharedAssets) != 0 {
		t.Fatalf("expected no shared assets, got %d", len(lp.SharedAssets))
	}
	if len(lp.CodexAssets) != 0 {
		t.Fatalf("expected no codex assets, got %d", len(lp.CodexAssets))
	}
}

// Every vendored-asset key must collide with neither an artifact key
// ("<bundle>/<type>/<name>") nor another asset key, or one of the colliding rows silently
// loses its gate (the CC-5 bypass the artifact-key comment warns about).
func TestSharedAssetKeyCannotCollide(t *testing.T) {
	keys := map[string]string{
		"shared": sharedAssetKey("stark-ops"),
		"codex":  codexAssetKey("stark-ops"),
		"plugin": pluginAssetKey("stark-ops"),
	}
	if keys["shared"] != "stark-ops/shared-assets/stark-ops" {
		t.Fatalf("unexpected shared key shape: %s", keys["shared"])
	}
	if keys["codex"] != "stark-ops/codex-assets/stark-ops" {
		t.Fatalf("unexpected codex key shape: %s", keys["codex"])
	}
	seen := map[string]string{}
	for kind, key := range keys {
		if other, dup := seen[key]; dup {
			t.Fatalf("%s key collides with the %s key: %s", kind, other, key)
		}
		seen[key] = kind
		for _, artifactType := range []string{"skill", "command", "agent", "mcp", "prompt"} {
			if key == "stark-ops/"+artifactType+"/stark-ops" {
				t.Fatalf("%s key collides with artifact type %q", kind, artifactType)
			}
		}
	}
}
