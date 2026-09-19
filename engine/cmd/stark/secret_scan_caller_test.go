package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The fleet secret scan, from bifrost's side of the contract.
//
// `.github/workflows/secret-scan.yml` is a hand-maintained copy of what
// 21StarkCom/21stark's `repos/templates/secret-scan-caller.yml.tftpl` renders; the
// Terraform in that repo writes the same bytes into the other 63 repos with
// `github_repository_file` and skips bifrost, because `main` here carries
// `enforce_admins = true` plus required PR reviews and the provider's direct commit is
// rejected even for an admin token (STARK-7490, ADR-0006 over there).
//
// So the two halves of the contract live in two repos and neither CI can see the other.
// 21stark's `check "bifrost_runs_the_current_secret_scan_caller"` watches the PIN from
// that side — it reads this file over the API on every plan. These tests watch the
// SHAPE from this side, which is the half that a well-meaning tidy-up here breaks:
// every failure below is one where the working tree is clean, the file looks fine, and
// the check run goes red (or, worse, silently stops being the context anything names).

const (
	secretScanCallerPath = ".github/workflows/secret-scan.yml"
	// The rule id the reusable workflow's self-test asserts fires by default.
	// Defined in 21stark's `repos/templates/gitleaks-seed.toml`.
	fleetSelftestRuleID = "google-oauth-client-secret"
)

// TestSecretScanCallerProducesTheFleetContext pins the halves of the check-run name.
//
// A reusable workflow's check run is named "<caller job> / <called job>", and the called
// half is `secret-scan` at the pinned SHA. So the caller's job id must be `secret-scan`
// and must carry no `name:` of its own, or the context becomes something other than
// `secret-scan / secret-scan` — the one string 21stark's rulesets require on 63 repos.
// bifrost is not enrolled today, but a context that silently renames itself is exactly
// the drift that makes enrolling it later look like a broken gate.
func TestSecretScanCallerProducesTheFleetContext(t *testing.T) {
	body := readSecretScanCaller(t)

	if !strings.Contains(body, "\njobs:\n  secret-scan:\n") {
		t.Errorf("%s: the single job must be keyed `secret-scan` — the left half of the `secret-scan / secret-scan` context", secretScanCallerPath)
	}
	// Any `name:` under jobs: would replace the left half. The top-level `name: secret-scan`
	// is the workflow name and is not part of the context.
	jobs := body[strings.Index(body, "\njobs:\n"):]
	if regexp.MustCompile(`(?m)^\s+name:`).MatchString(jobs) {
		t.Errorf("%s: the calling job must stay unnamed; a `name:` under jobs: renames the left half of the context", secretScanCallerPath)
	}
}

// TestSecretScanCallerPinsAFullCommitSHA refuses a mutable ref.
//
// The caller hands the runner a workflow that installs a binary as root and runs it over
// the tree. `@main` or `@secret-scan-v1` on that line is a remote-code-execution surface
// with no audit trail, on a PUBLIC repo. Only a 40-hex commit SHA is a pin.
func TestSecretScanCallerPinsAFullCommitSHA(t *testing.T) {
	body := readSecretScanCaller(t)

	uses := regexp.MustCompile(`(?m)^\s+uses:\s*(\S+)\s*$`).FindStringSubmatch(body)
	if uses == nil {
		t.Fatalf("%s: no `uses:` line — this file's whole job is to call the fleet's reusable workflow", secretScanCallerPath)
	}
	ref, _, ok := strings.Cut(uses[1], "@")
	if !ok {
		t.Fatalf("%s: `uses: %s` carries no ref at all", secretScanCallerPath, uses[1])
	}
	if ref != "21StarkCom/.github/.github/workflows/secret-scan.yml" {
		t.Errorf("%s: calls %q, want the fleet's reusable workflow 21StarkCom/.github/.github/workflows/secret-scan.yml", secretScanCallerPath, ref)
	}
	sha := uses[1][strings.Index(uses[1], "@")+1:]
	if !regexp.MustCompile(`^[0-9a-f]{40}$`).MatchString(sha) {
		t.Errorf("%s: pinned to %q — must be a full 40-hex commit SHA, never a tag or a branch", secretScanCallerPath, sha)
	}
}

// TestSecretScanSelftestRuleIsCarriedOrOverridden is the one that fires on a tidy-up.
//
// The reusable workflow will not trust a clean scan until it has watched the scanner fire:
// it feeds itself a probe and asserts `selftest_rule_id` appears in the report, defaulting
// to google-oauth-client-secret. bifrost carries that rule in `.gitleaks.toml` precisely so
// its caller needs no `with:` override and stays byte-identical to the fleet's render.
//
// Delete or rename the rule and the check goes RED on a repo with no secrets in it —
// failing in the fleet's workflow, about a probe, on a config whose own full-tree scan in
// `ci` is still green. Nothing else in this repo would say why. The two ways to be correct
// are "carry the rule" and "pass a `selftest_rule_id` the config does carry"; this asserts
// at least one holds.
func TestSecretScanSelftestRuleIsCarriedOrOverridden(t *testing.T) {
	root := repoRoot(t)
	body := readSecretScanCaller(t)

	cfg, err := os.ReadFile(filepath.Join(root, ".gitleaks.toml"))
	if err != nil {
		t.Fatal(err)
	}
	carriesRule := strings.Contains(string(cfg), `id = "`+fleetSelftestRuleID+`"`)
	overrides := strings.Contains(body, "selftest_rule_id:")

	if !carriesRule && !overrides {
		t.Errorf("`.gitleaks.toml` no longer defines the %q rule and %s passes no `selftest_rule_id` override: "+
			"the fleet scan's self-test will fail the check on a clean tree", fleetSelftestRuleID, secretScanCallerPath)
	}
	if carriesRule && overrides {
		t.Errorf("%s overrides `selftest_rule_id` while `.gitleaks.toml` still carries the %q rule: "+
			"drop the override so this file stays byte-identical to the fleet's render", secretScanCallerPath, fleetSelftestRuleID)
	}
}

// TestSecretScanCallerHasNoSkipGuard applies this repo's standing workflow rule to the
// second `pull_request` workflow it now has.
//
// A `paths:` filter or a draft guard makes the job report `skipped`, which GitHub counts
// as SATISFYING a required check and renders identically to a pass. The context is not
// required on bifrost today; it is required on 63 other repos from the same template, and
// a copy that quietly diverges here is how that assumption stops being true.
func TestSecretScanCallerHasNoSkipGuard(t *testing.T) {
	body := readSecretScanCaller(t)

	if regexp.MustCompile(`(?m)^\s+paths(-ignore)?:`).MatchString(body) {
		t.Errorf("%s: a `paths:` filter makes the check never report; a required context that never reports blocks every merge", secretScanCallerPath)
	}
	if strings.Contains(body, "draft ==") || regexp.MustCompile(`(?m)^\s+if:`).MatchString(body) {
		t.Errorf("%s: a job-level `if:` can report `skipped`, which GitHub counts as satisfying a required check", secretScanCallerPath)
	}
	for _, trigger := range []string{"\n  pull_request:\n", "\n  push:\n"} {
		if !strings.Contains(body, trigger) {
			t.Errorf("%s: lost its %q trigger; the push-to-main run is what produces a check run ON the default branch", secretScanCallerPath, strings.TrimSpace(trigger))
		}
	}
}

func readSecretScanCaller(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(repoRoot(t), secretScanCallerPath))
	if err != nil {
		t.Fatalf("%s: %v (it is a hand-maintained copy of 21stark's render — see CLAUDE.md)", secretScanCallerPath, err)
	}
	return string(b)
}
