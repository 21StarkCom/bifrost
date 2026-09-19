package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The attestation predicate is the ONLY thing standing between "a regeneration
// exists" and "it is published to every installed plugin", so it is tested
// against the real jq program the workflow runs — extracted from the workflow
// file, never restated here. A copy would pin the copy and let the shipped
// predicate drift free.
//
// This suite moved here with the predicate (STARK-6208). It previously lived in
// stark-skills as `tools/marketplace_sync.test.ts`, against that repo's
// `marketplace-sync.yml`; every case it had is below, plus the ones the
// `pull_request_review` event shape adds.

var reviewFilterRe = regexp.MustCompile(`(?s)review_filter='(.*?)'\r?\n`)

const publishWorkflowPath = ".github/workflows/publish-sync-pr.yml"

func publishWorkflow(t *testing.T) string {
	t.Helper()
	path := filepath.Join(repoRoot(t), filepath.FromSlash(publishWorkflowPath))
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(b)
}

func publishWorkflowFilter(t *testing.T) string {
	t.Helper()
	m := reviewFilterRe.FindStringSubmatch(publishWorkflow(t))
	if m == nil || strings.TrimSpace(m[1]) == "" {
		t.Fatalf("no review_filter in %s — exercise the actual publisher predicate, not a copy", publishWorkflowPath)
	}
	return m[1]
}

const attestedHead = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

type review map[string]any

func completedReview() review {
	return review{
		"id":           1,
		"user":         map[string]any{"login": "aryeh-stark"},
		"commit_id":    attestedHead,
		"state":        "COMMENTED",
		"submitted_at": "2026-09-15T12:00:00Z",
		"body":         "<!-- stark-code-review:complete -->\n/code-review xhigh --fix completed; findings fixed or answered.",
	}
}

// with returns a copy of r with the given fields overridden, so each case names
// only what it changes.
func with(r review, over review) review {
	out := review{}
	for k, v := range r {
		out[k] = v
	}
	for k, v := range over {
		out[k] = v
	}
	return out
}

// requireJQ skips locally but FAILS in CI. The point of this suite is to be the
// gate on the publisher's only authorization check; a gate that quietly reports
// green because its tool is missing is the same "passes by finding nothing to
// measure" shape the workflow's own check-count loop exists to avoid. jq ships
// in the ubuntu-latest runner image, so requiring it there costs nothing.
func requireJQ(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("jq"); err != nil {
		if os.Getenv("GITHUB_ACTIONS") != "" || os.Getenv("CI") != "" {
			t.Fatalf("jq is required to exercise the publisher predicate: %v", err)
		}
		t.Skip("jq not installed")
	}
}

// accepted runs the real predicate over `pages` exactly as the workflow does:
// `gh api --paginate --slurp` yields an array of pages, each an array of reviews.
//
// Only jq exit 0 (true) and exit 1 (false/null under -e) are verdicts. A compile
// error (3) or a runtime error (5) is a BROKEN predicate, and reading either as
// "rejected" would let a real regression ship green: dropping the `// ""` null
// guard makes jq abort on a null body, which every negative case would then
// happily accept as a rejection.
func accepted(t *testing.T, filter string, pages [][]review, want bool) {
	t.Helper()
	requireJQ(t)
	in, err := json.Marshal(pages)
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("jq", "-e", "--arg", "head", attestedHead, filter)
	cmd.Stdin = bytes.NewReader(in)
	out, runErr := cmd.CombinedOutput()
	code := 0
	var exitErr *exec.ExitError
	switch {
	case runErr == nil:
	case errors.As(runErr, &exitErr):
		code = exitErr.ExitCode()
	default:
		t.Fatalf("run jq: %v\noutput: %s", runErr, out)
	}
	if code != 0 && code != 1 {
		t.Fatalf("jq exited %d — the predicate itself is broken, not a verdict\ninput: %s\noutput: %s", code, in, out)
	}
	if got := code == 0; got != want {
		t.Fatalf("predicate returned %v, want %v\ninput: %s\noutput: %s", got, want, in, out)
	}
}

func TestPublisherRequiresCompletedReviewOnCurrentHead(t *testing.T) {
	f := publishWorkflowFilter(t)

	// Subtests, not bare calls: `accepted` fatals, so a bare first assertion that
	// regressed would hide every case below it.
	t.Run("a completed attestation on the head", func(t *testing.T) {
		accepted(t, f, [][]review{{completedReview()}}, true)
	})
	t.Run("APPROVED attests exactly as COMMENTED does", func(t *testing.T) {
		accepted(t, f, [][]review{{with(completedReview(), review{"state": "APPROVED"})}}, true)
	})
	t.Run("no reviews at all", func(t *testing.T) {
		accepted(t, f, [][]review{{}}, false)
	})

	for name, change := range map[string]review{
		"a bot review is not the operator's":  {"user": map[string]any{"login": "stark-meridian-ci[bot]"}},
		"an attestation on another head":      {"commit_id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
		"a review that was never submitted":   {"submitted_at": nil},
		"a pending review":                    {"state": "PENDING"},
		"changes requested":                   {"state": "CHANGES_REQUESTED"},
		"a dismissed review":                  {"state": "DISMISSED"},
		"the command named but not completed": {"body": "/code-review xhigh --fix is still running."},
		"the marker quoted, not asserted":     {"body": "Example marker:\n" + completedReview()["body"].(string)},
		"the marker without the command":      {"body": "<!-- stark-code-review:complete -->\nAn unrelated review passed."},
		"no body at all":                      {"body": nil},
		"a weaker review level":               {"body": "<!-- stark-code-review:complete -->\n/code-review high --fix completed."},
		"the marker sharing its line":         {"body": "<!-- stark-code-review:complete --> /code-review xhigh --fix"},
		"a review with no author record":      {"user": nil},
		"an empty body":                       {"body": ""},
	} {
		t.Run(name, func(t *testing.T) {
			accepted(t, f, [][]review{{with(completedReview(), change)}}, false)
		})
	}
}

func TestPublisherAcceptsTheCRLFBodyTheWebUISubmits(t *testing.T) {
	f := publishWorkflowFilter(t)

	// GitHub returns web-UI-authored review bodies with \r\n. Matching the raw
	// text would reject the attestation an operator actually types and report it
	// as "no completed head review" — blaming the human, not the parser.
	crlf := strings.ReplaceAll(completedReview()["body"].(string), "\n", "\r\n")
	accepted(t, f, [][]review{{with(completedReview(), review{"body": crlf})}}, true)

	accepted(t, f, [][]review{{with(completedReview(), review{
		"body": strings.ReplaceAll(crlf, "/code-review xhigh --fix", "/code-review high"),
	})}}, false)

	// The marker must still own the whole first line, CRLF or not.
	accepted(t, f, [][]review{{with(completedReview(), review{"body": "Example marker:\r\n" + crlf})}}, false)
}

func TestPublisherHonorsTheLatestOperatorVerdictAcrossPages(t *testing.T) {
	f := publishWorkflowFilter(t)
	later := func(over review) review {
		return with(completedReview(), with(review{"id": 2, "submitted_at": "2026-09-15T12:01:00Z"}, over))
	}

	// A later verdict on the same head overrides an earlier attestation, even
	// when it arrives on a different API page.
	accepted(t, f, [][]review{{completedReview()}, {later(review{"state": "CHANGES_REQUESTED"})}}, false)
	accepted(t, f, [][]review{{completedReview()}, {later(review{"state": "DISMISSED"})}}, false)

	// Re-attesting after a block publishes.
	accepted(t, f, [][]review{{with(completedReview(), review{"state": "CHANGES_REQUESTED"})}, {later(nil)}}, true)

	// A later block on a DIFFERENT head says nothing about this one.
	accepted(t, f, [][]review{{completedReview()}, {later(review{
		"commit_id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "state": "CHANGES_REQUESTED",
	})}}, true)

	// Neither does a later review by anyone else.
	accepted(t, f, [][]review{{completedReview()}, {later(review{
		"user": map[string]any{"login": "unrelated-bot"}, "state": "COMMENTED", "body": "FYI",
	})}}, true)

	// Equal timestamps resolve by monotonically increasing review id, not by the
	// order the pages happened to arrive in.
	accepted(t, f, [][]review{{with(completedReview(), review{"id": 2, "state": "DISMISSED"})}, {completedReview()}}, false)
}

// publishWorkflowFunc lifts a shell function out of the workflow's `run:` block
// and dedents it, so what runs below is the function the job actually ships. The
// filter above is extracted for the same reason: a restated copy pins the copy.
func publishWorkflowFunc(t *testing.T, name string) string {
	t.Helper()
	lines := strings.Split(publishWorkflow(t), "\n")
	for i, l := range lines {
		if strings.TrimSpace(l) != name+"() {" {
			continue
		}
		indent := l[:len(l)-len(strings.TrimLeft(l, " "))]
		for j := i + 1; j < len(lines); j++ {
			// The closing brace at the definition's own indent, so a nested
			// block's `}` cannot end the extraction early.
			if lines[j] != indent+"}" {
				continue
			}
			out := make([]string, 0, j-i+1)
			for _, b := range lines[i : j+1] {
				out = append(out, strings.TrimPrefix(b, indent))
			}
			return strings.Join(out, "\n")
		}
		t.Fatalf("%s: %s() has no closing brace at its own indent", publishWorkflowPath, name)
	}
	t.Fatalf("%s no longer defines %s() — the publisher's only authorization check", publishWorkflowPath, name)
	return ""
}

func writeStub(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte("#!/usr/bin/env bash\n"+body), 0o755); err != nil {
		t.Fatalf("write stub %s: %v", path, err)
	}
}

// runCompletedReview runs the workflow's real completed_review() against stubbed
// `gh` and `jq` whose exit codes the case chooses, and reports the function's own
// status plus its stderr. Exit codes are the entire contract under test, so they
// are the only thing stubbed — the predicate's semantics are covered above,
// against real jq.
func runCompletedReview(t *testing.T, ghExit, jqExit int) (int, string) {
	t.Helper()
	if _, err := exec.LookPath("bash"); err != nil {
		t.Skipf("bash not installed: %v", err)
	}
	dir := t.TempDir()
	writeStub(t, filepath.Join(dir, "gh"), fmt.Sprintf("printf '%%s' '[[]]'\nexit %d\n", ghExit))
	// The jq stub DRAINS stdin exactly as jq does. Without that `printf` dies of
	// SIGPIPE and `pipefail` hands the function a status jq never returned — the
	// stub would be testing the harness, not the workflow.
	writeStub(t, filepath.Join(dir, "jq"), fmt.Sprintf("cat >/dev/null\nexit %d\n", jqExit))

	script := strings.Join([]string{
		"set -euo pipefail",
		`review_filter='.'`,
		publishWorkflowFunc(t, "completed_review"),
		"rc=0",
		"completed_review " + attestedHead + " || rc=$?",
		`exit "$rc"`,
	}, "\n")

	cmd := exec.Command("bash", "-c", script)
	cmd.Env = append(os.Environ(),
		"PATH="+dir+string(os.PathListSeparator)+os.Getenv("PATH"),
		"GITHUB_REPOSITORY=21StarkCom/bifrost",
		"PR=1",
	)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	cmd.Stdout = nil

	runErr := cmd.Run()
	var exitErr *exec.ExitError
	switch {
	case runErr == nil:
		return 0, stderr.String()
	case errors.As(runErr, &exitErr):
		return exitErr.ExitCode(), stderr.String()
	default:
		t.Fatalf("run completed_review: %v\nstderr: %s", runErr, stderr.String())
		return -1, ""
	}
}

// THE regression test for the defect the suite above exposed. Only jq's 0 and 1
// are verdicts; every other status is the predicate failing to produce one. The
// caller reads any non-2 status as "not attested" and exits GREEN on purpose, so
// returning jq's status raw made a typo in the predicate — or a payload shape it
// cannot handle — indistinguishable from "nobody attested": publication stops
// forever, every run green, no alarm anywhere. That is the silent stall
// STARK-6208 was filed to end, and the 20-minute window it replaced at least
// went red.
//
// It is pinned on the REAL function because the mapping is three lines of shell:
// a refactor back to `return "$status"` leaves every other test in this file
// green while the gate quietly stops being a gate.
func TestPublisherFailsClosedWhenThePredicateReturnsNoVerdict(t *testing.T) {
	for _, c := range []struct {
		name           string
		ghExit, jqExit int
		want           int
		wantStderr     string
	}{
		// The verdicts. These must NOT become red: an ordinary review comment is
		// "not attested", and reddening the sync PR for one is the behaviour the
		// green path exists to avoid.
		{"attested", 0, 0, 0, ""},
		{"not attested is a verdict", 0, 1, 1, ""},

		// Everything else is "could not tell" and must withhold publication.
		{"jq usage or system error", 0, 2, 2, "could not evaluate the attestation predicate"},
		{"jq compile error", 0, 3, 2, "could not evaluate the attestation predicate"},
		{"jq produced no result at all", 0, 4, 2, "could not evaluate the attestation predicate"},
		{"jq runtime error", 0, 5, 2, "could not evaluate the attestation predicate"},
		{"jq missing from the runner", 0, 127, 2, "could not evaluate the attestation predicate"},
		{"the reviews API is unreadable", 1, 0, 2, "could not read the PR's reviews"},
	} {
		t.Run(c.name, func(t *testing.T) {
			got, stderr := runCompletedReview(t, c.ghExit, c.jqExit)
			if got != c.want {
				t.Fatalf("completed_review returned %d, want %d (gh exit %d, jq exit %d)\nstderr: %s",
					got, c.want, c.ghExit, c.jqExit, stderr)
			}
			// A verdict says nothing on stderr; a non-verdict must name itself,
			// because the callers' message covers both causes and cannot.
			if c.wantStderr == "" {
				if strings.TrimSpace(stderr) != "" {
					t.Fatalf("a verdict must not announce a failure; got stderr: %s", stderr)
				}
				return
			}
			if !strings.Contains(stderr, c.wantStderr) {
				t.Fatalf("stderr does not name the cause; want %q, got: %s", c.wantStderr, stderr)
			}
		})
	}
}

// The facts below are load-bearing enough that the review of STARK-6208 caught
// several of them as defects that would have stopped publication entirely — or,
// worse, let it happen unauthorized. They are cheap to assert and expensive to
// rediscover.
//
// Each needle is the GUARD, not a word that merely appears near it: asserting
// `isCrossRepository` alone passes while the `[ "$cross" != false ]` test that
// reads it is deleted, because the identifier survives in the `gh pr view
// --json` field list. Pin both halves — the field must be fetched AND compared.
func TestPublishWorkflowKeepsItsLoadBearingInvocationDetails(t *testing.T) {
	wf := publishWorkflow(t)

	for _, c := range []struct{ needle, why string }{
		{"GH_REPO:", "the job never checks out; gh resolves the repo from git remotes, not GITHUB_REPOSITORY"},
		{"isCrossRepository", "the fork guard needs the field fetched, or $cross is empty"},
		{`[ "$cross" != false ]`, "pull_request_review fires for fork PRs and headRefName carries no owner"},
		{`[ "$ref" != "auto/marketplace-sync" ]`, "workflow_dispatch skips the event-shape `if:`, so any PR could be published"},
		{`''|*[!0-9]*)`, "$PR is workflow_dispatch free text interpolated into gh api URL paths"},
		{`''|*[!0-9a-f]*)`, `jq -r prints the string "null" for a missing field and exits 0, so an unusable head would match no review and exit GREEN`},
		{"gh workflow run sign-manifest.yml", "a GITHUB_TOKEN push starts no push run, so signing must be dispatched"},
		// Without this the predicate above can be swapped for `jq -e "true"` —
		// an attestation gate that accepts every review — and every assertion in
		// this file still passes, because they only exercise the string the
		// workflow happens to assign, not the one it happens to run.
		{`jq -e --arg head "$1" "$review_filter"`, "the extracted predicate must be the predicate the job actually runs"},
	} {
		if !strings.Contains(wf, c.needle) {
			t.Errorf("publish-sync-pr.yml lost %q — %s", c.needle, c.why)
		}
	}

	// A flag on the invocation is not pinnable by a bare `strings.Contains` over
	// the file: the header comment block names `--match-head-commit`, so deleting
	// it from the merge leaves the word behind and a whole-file needle green.
	// Assert it on every non-comment line that runs the command instead.
	//
	// `--required` on `gh pr checks`: an unfiltered watch includes THIS job's own
	// check run (a pull_request_review run attaches its check to the PR head just
	// like a pull_request run does), so it waits on itself until the job timeout
	// and publication can never happen.
	requireFlag(t, wf, "gh pr checks", "--required",
		"an unfiltered watch waits on this job's own check run and can never converge")
	requireFlag(t, wf, "gh pr merge", "--match-head-commit",
		"the merge must be bound to the attested head, not to whatever the branch holds now")
}

// requireFlag asserts that every invocation of `cmd` in the workflow carries
// `flag`. Comment lines are skipped — the workflow documents both of these rules
// by naming the command, and flagging prose would make the only fix "stop
// documenting it". Backslash continuations are folded first, so a call split
// across lines is judged whole rather than reported missing a flag that sits on
// the next line.
func requireFlag(t *testing.T, wf, cmd, flag, why string) {
	t.Helper()
	seen := false
	for _, line := range strings.Split(strings.ReplaceAll(wf, "\\\n", " "), "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") || !strings.Contains(trimmed, cmd) {
			continue
		}
		seen = true
		if !strings.Contains(trimmed, flag) {
			t.Errorf("`%s` without %s — %s:\n  %s", cmd, flag, why, trimmed)
		}
	}
	if !seen {
		t.Errorf("publish-sync-pr.yml no longer runs `%s` at all", cmd)
	}
}
