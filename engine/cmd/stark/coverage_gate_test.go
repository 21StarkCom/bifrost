package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// WHY THIS TEST EXISTS (STARK-6468).
//
// `docs/scripts/coverage-gate.sh` is the only thing standing between a new stark-skills
// skill and being silently dropped: `stark sync` pulls ONLY skills declared in a
// bundle.yaml's `skills:` list, so an undeclared one vanishes with every other gate
// reporting clean. That is not hypothetical — `agnes` shipped un-membered at v0.31.2
// (STARK-6249) while the same release published `standards/worker-spine.md` naming
// `/agnes`, because the gate lived inline in publish.sh and the path that actually
// publishes (stark-skills' `marketplace-sync.yml`) never invoked it.
//
// The gate is now a standalone script called by BOTH paths, which makes its exit codes and
// the shape of its output a contract between two repos. These tests run the REAL script —
// copied byte-for-byte into a fixture root, never reimplemented — because a gate that has
// only ever been observed passing has not been shown to be capable of failing.

// seedCoverageRepo builds a fixture bifrost root holding the real coverage-gate.sh plus a
// synthetic catalog, and a separate synthetic stark-skills checkout. `claimed` are the
// skills listed in the fixture bundle's `skills:` block; `skills` are the dirs that exist
// upstream, each mapped to whether it carries a SKILL.md.
func seedCoverageRepo(t *testing.T, claimed []string, skills map[string]bool) (repoRoot, starkSkills string) {
	t.Helper()
	repoRoot = t.TempDir()
	starkSkills = t.TempDir()

	src := filepath.Join("..", "..", "..", "docs", "scripts", "coverage-gate.sh")
	b, err := os.ReadFile(src)
	if err != nil {
		t.Fatalf("read the real coverage-gate.sh: %v", err)
	}
	// THREE callers invoke this as an EXECUTABLE (`docs/scripts/coverage-gate.sh "$SK"`),
	// a dependency the inline code it replaced never had: publish.sh here, plus
	// stark-skills' marketplace-sync.yml and tests.yml, which both run it BY PATH out of
	// a checkout of this repo's default branch (STARK-6468). The fixture copy is written
	// 0o755 and run through `bash`, so none of them would notice the committed file
	// losing its exec bit — publish.sh would die on "Permission denied" at publish time
	// and both stark-skills workflows would go red, stopping marketplace publication.
	fi, err := os.Stat(src)
	if err != nil {
		t.Fatalf("stat coverage-gate.sh: %v", err)
	}
	if fi.Mode().Perm()&0o111 == 0 {
		t.Fatalf("docs/scripts/coverage-gate.sh is not executable (mode %v); publish.sh and stark-skills' marketplace-sync.yml + tests.yml all run it directly", fi.Mode().Perm())
	}
	dst := filepath.Join(repoRoot, "docs", "scripts")
	if err := os.MkdirAll(dst, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dst, "coverage-gate.sh"), b, 0o755); err != nil {
		t.Fatal(err)
	}

	// A bundle.yaml whose `skills:` block is followed by another top-level key, so the
	// parser's block-exit branch is actually exercised rather than running to EOF.
	var sb strings.Builder
	sb.WriteString("name: stark-ops\nversion: 0.17.0\ntags:\n  - release\nskills:\n")
	for _, s := range claimed {
		sb.WriteString("  - " + s + "\n")
	}
	sb.WriteString("runtimes:\n  - claude\n")
	bdir := filepath.Join(repoRoot, "catalog", "stark-ops")
	if err := os.MkdirAll(bdir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bdir, "bundle.yaml"), []byte(sb.String()), 0o644); err != nil {
		t.Fatal(err)
	}

	for name, hasManifest := range skills {
		d := filepath.Join(starkSkills, "skill", name)
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
		if hasManifest {
			if err := os.WriteFile(filepath.Join(d, "SKILL.md"), []byte("---\nname: "+name+"\n---\n"), 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	return repoRoot, starkSkills
}

func runCoverageGate(t *testing.T, repoRoot, starkSkills string) (int, string) {
	t.Helper()
	// Same contract as requireJQ in publish_sync_pr_test.go: hard-fail on CI, where the
	// runner image ships bash and a skip would be this gate "passing by finding nothing
	// to measure"; skip on a machine that genuinely has no bash.
	if _, err := exec.LookPath("bash"); err != nil {
		if os.Getenv("GITHUB_ACTIONS") != "" || os.Getenv("CI") != "" {
			t.Fatalf("bash is required to exercise the coverage gate: %v", err)
		}
		t.Skipf("bash not installed: %v", err)
	}
	cmd := exec.Command("bash", filepath.Join(repoRoot, "docs", "scripts", "coverage-gate.sh"), starkSkills)
	out, err := cmd.CombinedOutput()
	code := 0
	if ee, ok := err.(*exec.ExitError); ok {
		code = ee.ExitCode()
	} else if err != nil {
		t.Fatalf("run coverage-gate.sh: %v\n%s", err, out)
	}
	return code, string(out)
}

// THE REGRESSION TEST. This is the exact v0.31.2 state that shipped STARK-6249: a skill
// present upstream and absent from every bundle's membership. If this ever goes green
// again, the automated publish path has silently lost its only defence against dropping a
// skill, which is the whole reason this script was extracted.
func TestCoverageGateFailsOnAnUnclaimedSkill(t *testing.T) {
	repoRoot, sk := seedCoverageRepo(t,
		[]string{"gru", "minion"},
		map[string]bool{"gru": true, "minion": true, "agnes": true})

	code, out := runCoverageGate(t, repoRoot, sk)
	if code != 1 {
		t.Fatalf("want exit 1 for an unclaimed skill, got %d\n%s", code, out)
	}
	if !strings.Contains(out, "agnes") {
		t.Fatalf("the failure must NAME the dropped skill, else it is as silent as the drop:\n%s", out)
	}
	// The claimed ones must not be blamed: a gate that lists innocent skills trains the
	// reader to skim the list, which is how the real orphan gets missed.
	for _, ok := range []string{"gru", "minion"} {
		if strings.Contains(out, " "+ok) {
			t.Fatalf("claimed skill %q named in the violation:\n%s", ok, out)
		}
	}
}

func TestCoverageGatePassesWhenEverySkillIsClaimed(t *testing.T) {
	repoRoot, sk := seedCoverageRepo(t,
		[]string{"gru", "minion", "agnes"},
		map[string]bool{"gru": true, "minion": true, "agnes": true})

	code, out := runCoverageGate(t, repoRoot, sk)
	if code != 0 {
		t.Fatalf("want exit 0 when every skill is claimed, got %d\n%s", code, out)
	}
	if !strings.Contains(out, "coverage gate clean") {
		t.Fatalf("want the clean line, got:\n%s", out)
	}
}

// A dir with no SKILL.md (upstream's `evals/`) is not a skill. The skip is fail-OPEN, so
// the script must REPORT what it skipped — otherwise a real skill whose manifest is
// missing or misnamed disappears from the gate exactly as quietly as the drop it guards.
func TestCoverageGateReportsDirsItSkipped(t *testing.T) {
	repoRoot, sk := seedCoverageRepo(t,
		[]string{"gru"},
		map[string]bool{"gru": true, "evals": false})

	code, out := runCoverageGate(t, repoRoot, sk)
	if code != 0 {
		t.Fatalf("a dir without SKILL.md must not fail the gate, got %d\n%s", code, out)
	}
	if !strings.Contains(out, "evals") {
		t.Fatalf("the skip must be reported, not dropped:\n%s", out)
	}
}

// An empty membership parse means the awk stopped matching the `skills:` block shape — a
// SCRIPT bug. It must be called out as such, because the alternative presentation (every
// upstream skill listed as an orphan) buries the real cause in the noise it generates.
func TestCoverageGateFailsLoudlyWhenMembershipParsesEmpty(t *testing.T) {
	repoRoot, sk := seedCoverageRepo(t, nil, map[string]bool{"gru": true})
	// A bundle.yaml with no `skills:` block at all is the degenerate form of the same bug.
	p := filepath.Join(repoRoot, "catalog", "stark-ops", "bundle.yaml")
	if err := os.WriteFile(p, []byte("name: stark-ops\nversion: 0.17.0\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	code, out := runCoverageGate(t, repoRoot, sk)
	if code != 1 {
		t.Fatalf("want exit 1 on an empty membership parse, got %d\n%s", code, out)
	}
	if !strings.Contains(out, "parser") {
		t.Fatalf("the message must blame the parser, not the catalog:\n%s", out)
	}
	if strings.Contains(out, "not published and not excluded") {
		t.Fatalf("a parser bug must not be reported as an orphan list:\n%s", out)
	}
}

// The script must refuse a stark-skills path that isn't one, rather than reporting a clean
// gate over a tree it never read — a false green here is indistinguishable from success.
func TestCoverageGateRefusesAMissingStarkSkillsCheckout(t *testing.T) {
	repoRoot, _ := seedCoverageRepo(t, []string{"gru"}, map[string]bool{"gru": true})

	code, out := runCoverageGate(t, repoRoot, filepath.Join(repoRoot, "nope"))
	if code != 1 {
		t.Fatalf("want exit 1 for a missing checkout, got %d\n%s", code, out)
	}
	if strings.Contains(out, "coverage gate clean") {
		t.Fatalf("a missing checkout must never report clean:\n%s", out)
	}
}

// A stark-skills checkout whose `skill/` dir exists but holds nothing is the OTHER false
// green: the unmatched `skill/*/` glob leaves the literal pattern in `$d`, which carries
// no SKILL.md, so it fell through the fail-open skip and the gate said "clean" over a tree
// it had read nothing from. Same class as the missing-checkout case above, different route.
func TestCoverageGateRefusesAnEmptyUpstreamSkillTree(t *testing.T) {
	repoRoot, sk := seedCoverageRepo(t, []string{"gru"}, nil)
	if err := os.MkdirAll(filepath.Join(sk, "skill"), 0o755); err != nil {
		t.Fatal(err)
	}

	code, out := runCoverageGate(t, repoRoot, sk)
	if code != 1 {
		t.Fatalf("want exit 1 for an empty skill tree, got %d\n%s", code, out)
	}
	if strings.Contains(out, "coverage gate clean") {
		t.Fatalf("a tree with no skills in it must never report clean:\n%s", out)
	}
}

// A catalog the gate cannot read must SAY so. Before the manifests were collected up
// front, an unmatched `catalog/*/bundle.yaml` handed awk a literal path it could not open:
// `2>/dev/null` ate the diagnostic and `set -e -o pipefail` killed the script at exit 2
// with no output at all — an unexplained failure whose most likely "fix" is deleting the
// gate call, and the parser guard that was written for exactly this was never reached.
func TestCoverageGateNamesAnUnreadableCatalog(t *testing.T) {
	repoRoot, sk := seedCoverageRepo(t, []string{"gru"}, map[string]bool{"gru": true})
	if err := os.RemoveAll(filepath.Join(repoRoot, "catalog")); err != nil {
		t.Fatal(err)
	}

	code, out := runCoverageGate(t, repoRoot, sk)
	if code != 1 {
		t.Fatalf("want exit 1 (not a bare shell abort) for an unreadable catalog, got %d\n%s", code, out)
	}
	if !strings.Contains(out, "catalog") {
		t.Fatalf("the failure must name the catalog it could not read, not exit silently:\n%s", out)
	}
}

// publish.sh must CALL the script rather than carry its own copy. Two implementations of
// one gate is the drift this extraction exists to remove, and it would re-open the exact
// split that let the sync path publish without a coverage check.
func TestPublishShDelegatesToTheCoverageGateScript(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "scripts", "publish.sh"))
	if err != nil {
		t.Fatalf("read publish.sh: %v", err)
	}
	s := string(b)
	// An INVOCATION, not a mention: publish.sh's own comment block explains the
	// extraction, so a bare `strings.Contains` would stay green over a re-inlined gate
	// whose comment still named the script — the mutation this test exists to catch.
	invoked := false
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "#") {
			continue
		}
		if strings.Contains(line, "docs/scripts/coverage-gate.sh") {
			invoked = true
			break
		}
	}
	if !invoked {
		t.Fatal("publish.sh no longer calls docs/scripts/coverage-gate.sh (a comment mentioning it does not count)")
	}
	if strings.Contains(s, "EXCLUDED_SKILLS=(") {
		t.Fatal("EXCLUDED_SKILLS is back in publish.sh; it belongs with the gate, or the three callers can disagree about what is deliberately unpublished")
	}
}
