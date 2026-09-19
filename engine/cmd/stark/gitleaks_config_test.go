package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestGitleaksConfigContract asserts the two contract behaviors of the repo's .gitleaks.toml
// (spec §7.4): a sanctioned `{ secretRef: <key> }` reference produces NO finding, while an inline
// literal credential DOES. The secret gate is a CLI step (no Go code path), so this shells to the
// gitleaks binary and is skipped when it is absent locally. This is also the regression guard for
// the named-capture/secretGroup fix: without it the allowlists target the keyword instead of the
// value.
//
// In CI it FAILS instead of skipping. The `engine` job installs a pinned gitleaks purely for this
// test; before STARK-7490 nothing did, so a t.Skip meant the only assertion that runs the real
// scanner over the real config had never executed in CI while the comment here claimed it had.
// A skip and a pass are indistinguishable in `go test` output without `-v`, which is exactly the
// silent-green shape this repo keeps getting bitten by — so the absence of the binary has to be
// an error where it is supposed to be present, not a shrug.
func TestGitleaksConfigContract(t *testing.T) {
	if _, err := exec.LookPath("gitleaks"); err != nil {
		if os.Getenv("CI") != "" {
			t.Fatalf("gitleaks is not on PATH in CI: %v — ci.yml's `engine` job must install it "+
				"(see the `install gitleaks` step); skipping here would hide whether .gitleaks.toml still fires", err)
		}
		t.Skip("gitleaks not on PATH (install it to run the config contract locally)")
	}
	cfg := filepath.Join(repoRoot(t), ".gitleaks.toml")

	scan := func(t *testing.T, name, content string) int {
		t.Helper()
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		cmd := exec.Command("gitleaks", "dir", dir, "--config", cfg, "--redact", "--exit-code", "1")
		_ = cmd.Run() // non-zero exit on findings is expected; read the code below
		return cmd.ProcessState.ExitCode()
	}

	if code := scan(t, "ref.yaml", "env:\n  GITHUB_TOKEN: { secretRef: stark-gh-token }\n"); code != 0 {
		t.Fatalf("sanctioned secretRef must NOT trip gitleaks, got exit %d", code)
	}
	if code := scan(t, "leak.yaml", "api_key = \"ghp_live0123456789ABCDEF\"\n"); code == 0 {
		t.Fatal("inline literal credential must trip gitleaks (non-zero exit), got 0")
	}

	// ── The fleet secret scan's self-test (STARK-7490) ──
	//
	// `21StarkCom/.github`'s reusable workflow refuses to trust a clean scan until it has
	// watched the scanner fire: it feeds a BARE `GOCSPX-` + 28 hex token through this very
	// config and asserts rule id `google-oauth-client-secret` appears in the report. Assert
	// on the REPORT, not the exit code, for the workflow's own reason — gitleaks exits
	// non-zero both on a finding and on a config it cannot load, so `--exit-code 0` leaves a
	// non-zero exit meaning one thing only: the scanner could not run.
	//
	// This is the half a substring grep of `.gitleaks.toml` cannot cover. A commented-out
	// rule, a renamed id, a regex whose length quantifier drifted or an entropy floor raised
	// past the probe all leave `id = "google-oauth-client-secret"` spelled in the file and
	// turn the fleet check RED on a repo with no secrets in it.
	ruleIDs := func(t *testing.T, name, content string) string {
		t.Helper()
		dir, out := t.TempDir(), filepath.Join(t.TempDir(), "report.json")
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		cmd := exec.Command("gitleaks", "dir", dir, "--config", cfg, "--redact", "--no-banner",
			"--exit-code", "0", "--report-format", "json", "--report-path", out)
		if err := cmd.Run(); err != nil {
			t.Fatalf("gitleaks could not run against %s: %v", cfg, err)
		}
		b, err := os.ReadFile(out)
		if err != nil {
			t.Fatal(err)
		}
		return string(b)
	}

	const selftestRule = "google-oauth-client-secret"
	// 28 characters, the length the rule requires, assembled here so this file never holds
	// a literal any rule would match on its own.
	probe := "GOCSPX-" + "0f1e2d3c4b5a6978" + "8796a5b4c3d2"
	if report := ruleIDs(t, "probe.txt", "note: "+probe+"\n"); !strings.Contains(report, selftestRule) {
		t.Errorf("the %q rule did not fire on a bare GOCSPX- token; the fleet secret scan's self-test "+
			"asserts it does and fails `secret-scan / secret-scan` when it does not. report: %s", selftestRule, report)
	}
	placeholder := "GOCSPX-" + strings.Repeat("x", 28)
	if report := ruleIDs(t, "placeholder.md", "Set it to `"+placeholder+"`.\n"); strings.Contains(report, selftestRule) {
		t.Errorf("the documented GOCSPX-xxxx… placeholder must stay allowlisted, else every doc that "+
			"writes it fails the scan. report: %s", report)
	}
}
