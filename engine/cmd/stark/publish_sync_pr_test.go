package main

import (
	"encoding/json"
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

var reviewFilterRe = regexp.MustCompile(`(?s)review_filter='(.*?)'\n`)

func publishWorkflowFilter(t *testing.T) string {
	t.Helper()
	path := filepath.Join(repoRoot(t), ".github", "workflows", "publish-sync-pr.yml")
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	m := reviewFilterRe.FindSubmatch(b)
	if m == nil {
		t.Fatalf("no review_filter in %s — exercise the actual publisher predicate, not a copy", path)
	}
	return string(m[1])
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

// accepted runs the real predicate over `pages` exactly as the workflow does:
// `gh api --paginate --slurp` yields an array of pages, each an array of reviews.
func accepted(t *testing.T, filter string, pages [][]review, want bool) {
	t.Helper()
	if _, err := exec.LookPath("jq"); err != nil {
		t.Skip("jq not installed")
	}
	in, err := json.Marshal(pages)
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("jq", "-e", "--arg", "head", attestedHead, filter)
	cmd.Stdin = strings.NewReader(string(in))
	out, err := cmd.CombinedOutput()
	got := err == nil
	if got != want {
		t.Fatalf("predicate returned %v, want %v\ninput: %s\noutput: %s", got, want, in, out)
	}
}

func TestPublisherRequiresCompletedReviewOnCurrentHead(t *testing.T) {
	f := publishWorkflowFilter(t)

	accepted(t, f, [][]review{{completedReview()}}, true)
	accepted(t, f, [][]review{{with(completedReview(), review{"state": "APPROVED"})}}, true)
	accepted(t, f, [][]review{{}}, false)

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

// The three env/flag facts below are load-bearing enough that the review of
// STARK-6208 caught each one as a defect that would have stopped publication
// entirely. They are cheap to assert and expensive to rediscover.
func TestPublishWorkflowKeepsItsLoadBearingInvocationDetails(t *testing.T) {
	path := filepath.Join(repoRoot(t), ".github", "workflows", "publish-sync-pr.yml")
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	wf := string(b)

	for _, c := range []struct{ needle, why string }{
		{"GH_REPO:", "the job never checks out; gh resolves the repo from git remotes, not GITHUB_REPOSITORY"},
		{"--match-head-commit", "the merge must be bound to the attested head"},
		{"isCrossRepository", "pull_request_review fires for fork PRs and headRefName carries no owner"},
		{"gh workflow run sign-manifest.yml", "a GITHUB_TOKEN push starts no push run, so signing must be dispatched"},
	} {
		if !strings.Contains(wf, c.needle) {
			t.Errorf("publish-sync-pr.yml lost %q — %s", c.needle, c.why)
		}
	}

	// Every `gh pr checks` call must be --required. An unfiltered watch includes
	// THIS job's own check run (a pull_request_review run attaches its check to
	// the PR head just like a pull_request run does), so it waits on itself until
	// the job timeout and publication can never happen.
	// Comment lines are skipped: the block above this rule in the workflow
	// explains it by naming `gh pr checks`, and flagging prose would make the
	// only fix "stop documenting it".
	for _, line := range strings.Split(wf, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") {
			continue
		}
		if strings.Contains(trimmed, "gh pr checks") && !strings.Contains(trimmed, "--required") {
			t.Errorf("`gh pr checks` without --required would wait on this job's own check run:\n  %s", trimmed)
		}
	}
}
