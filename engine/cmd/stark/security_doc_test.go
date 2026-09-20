package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The governance docs, from the side CI can actually see.
//
// `docs/SECURITY.md` §4 is a hand-written copy of `ci.yml`'s gate list, and it drifted:
// it still called `stark lint` "non-blocking (surfaced only)" two gate-additions after
// CI started running `lint --strict` under a step named BLOCKING, and it never listed
// `gofmt`, `go vet` or `stark allowlist --check` at all (STARK-8166). Nothing noticed,
// because nothing in this repo reads the doc. A security doc that understates its own
// gates is the same failure shape as a gate that passes over content it never read —
// and re-syncing it by hand is a fix with no half-life, so this is the tripwire.
//
// The blocking-list half is a real derivation from the workflow; the rest are string
// tripwires on claims that were measured false against the live API on 2026-09-20 and
// are cheap to reintroduce from memory.

const securityDocPath = "docs/SECURITY.md"

func readRepoDoc(t *testing.T, rel string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(repoRoot(t), rel))
	if err != nil {
		t.Fatalf("read %s: %v", rel, err)
	}
	return string(b)
}

// section returns the body of the `## <prefix>…` heading up to the next `## ` heading.
func section(t *testing.T, body, prefix string) string {
	t.Helper()
	lines := strings.Split(body, "\n")
	start := -1
	for i, ln := range lines {
		if strings.HasPrefix(ln, "## "+prefix) {
			start = i + 1
			break
		}
	}
	if start < 0 {
		t.Fatalf("%s: no `## %s…` heading — the section was renamed or removed; "+
			"update this test in the same change", securityDocPath, prefix)
	}
	for i := start; i < len(lines); i++ {
		if strings.HasPrefix(lines[i], "## ") {
			return strings.Join(lines[start:i], "\n")
		}
	}
	return strings.Join(lines[start:], "\n")
}

// engineJobGates derives the blocking gates of ci.yml's `engine` job from the workflow
// itself: every `go run ./cmd/stark <sub> [--flag]` invocation plus the three plain Go
// steps. Deriving rather than listing is the point — a gate added to the workflow and
// not to the doc is exactly the drift this catches.
func engineJobGates(t *testing.T) []string {
	t.Helper()
	wf := readRepoDoc(t, ".github/workflows/ci.yml")

	// Narrow to the `engine` job: from its `  engine:` key to the next job key at the
	// same indent. §4 lists the other two jobs' gates by name (gitleaks, actionlint),
	// which the tripwires below cover.
	jobStart := strings.Index(wf, "\n  engine:\n")
	if jobStart < 0 {
		t.Fatalf(".github/workflows/ci.yml: no `engine` job — a renamed job orphans the " +
			"required context; update the ruleset and this test in the same change")
	}
	rest := wf[jobStart+1:]
	body := rest
	if next := regexp.MustCompile(`\n  [a-z][a-z0-9_-]*:\n`).FindStringIndex(rest[1:]); next != nil {
		body = rest[:next[0]+1]
	}

	gates := []string{}
	if strings.Contains(body, "gofmt -l") {
		gates = append(gates, "`gofmt`")
	}
	if strings.Contains(body, "go vet ./...") {
		gates = append(gates, "`go vet`")
	}
	if strings.Contains(body, "go test ./...") {
		gates = append(gates, "`go test ./...`")
	}
	re := regexp.MustCompile(`go run \./cmd/stark ([a-z][a-z-]*)((?: --[a-z][a-z-]*)?)`)
	for _, m := range re.FindAllStringSubmatch(body, -1) {
		gates = append(gates, "`stark "+m[1]+strings.TrimRight(m[2], " ")+"`")
	}

	// Fail closed: a parser that matches nothing would make every assertion below
	// vacuously true, which is the failure mode this whole file exists to flag.
	if len(gates) < 8 {
		t.Fatalf("derived only %d gates from ci.yml's engine job (%v) — the parser stopped "+
			"matching the workflow, so this test measured nothing", len(gates), gates)
	}
	return gates
}

// TestSecurityDocListsEveryBlockingEngineGate pins §4's blocking list to ci.yml.
func TestSecurityDocListsEveryBlockingEngineGate(t *testing.T) {
	gates := engineJobGates(t)
	sec := section(t, readRepoDoc(t, securityDocPath), "4. CI gates")

	for _, g := range gates {
		if !strings.Contains(sec, g) {
			t.Errorf("%s §4 does not list the blocking gate %s that ci.yml's `engine` job runs — "+
				"a security doc that understates its own gates is how `stark lint` stayed "+
				"documented as non-blocking for two gate-additions (STARK-8166)", securityDocPath, g)
		}
	}
	for _, other := range []string{"gitleaks", "actionlint"} {
		if !strings.Contains(sec, other) {
			t.Errorf("%s §4 does not name `%s`, which is a required context of its own", securityDocPath, other)
		}
	}
}

// TestGovernanceDocsDoNotClaimAnAdminCannotBypass is the tripwire on the claim
// STARK-8166 removed. Measured 2026-09-20: `branches/main/protection` carries no
// `required_status_checks` key, so the three required contexts live only in the
// `Required CI on main` ruleset, whose `bypass_actors` is
// `[{actor_id: 5, actor_type: RepositoryRole, bypass_mode: "always"}]` — repository
// admin, which on a one-human repo is the only human. Three docs asserted the
// opposite in three different spellings; they are all cheap to write again from
// memory, which is why this is a string gate and not a comment.
func TestGovernanceDocsDoNotClaimAnAdminCannotBypass(t *testing.T) {
	banned := []string{"no admin bypass", "no bypass", "non-bypassable", "nonbypassable"}
	for _, doc := range []string{securityDocPath, "README.md", "CONTRIBUTING.md"} {
		body := strings.ToLower(readRepoDoc(t, doc))
		for _, phrase := range banned {
			// The quoted disclaimer in SECURITY.md §4 ("Not \"non-bypassable\".") is the
			// correction itself, so allow the phrase when it appears inside quotes.
			for _, hit := range indexesOf(body, phrase) {
				if quoted(body, hit, len(phrase)) {
					continue
				}
				t.Errorf(`%s claims %q at offset %d. The required CI contexts live in a ruleset `+
					`that grants repository admin bypass_mode "always" — see %s §1 and `+
					`docs/operations/branch-protection.md §3. Re-measure before reinstating it.`,
					doc, phrase, hit, securityDocPath)
			}
		}
	}
}

func indexesOf(hay, needle string) []int {
	out := []int{}
	for off := 0; ; {
		i := strings.Index(hay[off:], needle)
		if i < 0 {
			return out
		}
		out = append(out, off+i)
		off += i + len(needle)
	}
}

// quoted reports whether hay[at:at+n] is wrapped in `"` or a markdown code span.
func quoted(hay string, at, n int) bool {
	if at == 0 || at+n >= len(hay) {
		return false
	}
	before, after := hay[at-1], hay[at+n]
	return (before == '"' && after == '"') || (before == '`' && after == '`')
}
