package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The failure this workflow exists to end, measured live 2026-09-20 (STARK-8164):
// `publish-sync-pr` refuses unless `compare(main...head).status` is `ahead`, and it runs
// only on `pull_request_review: [submitted]`. The precondition is invalidated by a
// DIFFERENT event — any merge to `main` — which starts no publication attempt, so nothing
// evaluates it and nothing reports it. PR #293 opened 03:52, six hand merges landed
// between 08:10 and 13:30, and the strand was found by hand at ~15:24: 11.5 hours, six
// causing events, zero runs, zero alarms, publication stopped for the whole repo.
//
// As with the attestation predicate in publish_sync_pr_test.go, the decision is exercised
// by EXTRACTING it from the shipped workflow and running it through the real jq. A copy
// here would pin the copy and let the shipped filter drift free.

const watchdogWorkflowPath = ".github/workflows/sync-pr-watchdog.yml"

var verdictFilterRe = regexp.MustCompile(`(?s)verdict_filter='(.*?)'\r?\n`)

func watchdogWorkflow(t *testing.T) string {
	t.Helper()
	path := filepath.Join(repoRoot(t), filepath.FromSlash(watchdogWorkflowPath))
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(b)
}

func watchdogFilter(t *testing.T) string {
	t.Helper()
	m := verdictFilterRe.FindStringSubmatch(watchdogWorkflow(t))
	if m == nil || strings.TrimSpace(m[1]) == "" {
		t.Fatalf("no verdict_filter in %s — exercise the shipped predicate, not a copy", watchdogWorkflowPath)
	}
	return m[1]
}

// verdict runs the real filter over the same object shape the workflow assembles.
func verdict(t *testing.T, filter, compare, createdAt, now, maxAgeHours string) string {
	t.Helper()
	requireJQ(t)
	in, err := json.Marshal(map[string]any{
		"number":      293,
		"headRefOid":  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		"createdAt":   createdAt,
		"compare":     compare,
		"now":         now,
		"maxAgeHours": maxAgeHours,
	})
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("jq", "-r", filter)
	cmd.Stdin = bytes.NewReader(in)
	out, runErr := cmd.CombinedOutput()
	if runErr != nil {
		var exitErr *exec.ExitError
		if errors.As(runErr, &exitErr) {
			t.Fatalf("the verdict filter is broken (exit %d): %s", exitErr.ExitCode(), out)
		}
		t.Fatalf("run jq: %v\n%s", runErr, out)
	}
	return strings.TrimSpace(string(out))
}

func TestWatchdogVerdicts(t *testing.T) {
	filter := watchdogFilter(t)
	const created = "2026-09-20T03:52:09Z"

	cases := []struct {
		name       string
		compare    string
		now        string
		wantPrefix string
	}{
		// The only publishable state, and the only one that may be quiet.
		{"ahead and fresh", "ahead", "2026-09-20T04:52:09Z", "ok"},
		// The measured strand: a hand merge to main leaves the sync branch with commits
		// main lacks AND main with commits it lacks.
		{"diverged by a hand merge", "diverged", "2026-09-20T04:52:09Z", "stale"},
		// `behind` and `identical` are equally unpublishable — publish-sync-pr tests for
		// `ahead`, not for `not diverged`, so all three must report.
		{"behind", "behind", "2026-09-20T04:52:09Z", "stale"},
		{"identical", "identical", "2026-09-20T04:52:09Z", "stale"},
		// The backstop: still ahead, so the fast check is silent, but publication has not
		// happened. Covers a spent attestation whose publish run failed.
		{"ahead but long past the age limit", "ahead", "2026-09-20T15:52:09Z", "aging"},
		// Exactly at the limit is not yet over it: the boundary must not be an alarm, or
		// the backstop fires on a legitimate 7.3-hour publication.
		{"ahead at exactly the age limit", "ahead", "2026-09-20T11:52:09Z", "ok"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := verdict(t, filter, tc.compare, created, tc.now, "8")
			if !strings.HasPrefix(got, tc.wantPrefix) {
				t.Fatalf("compare=%s now=%s: want a %q verdict, got %q", tc.compare, tc.now, tc.wantPrefix, got)
			}
			// A verdict an operator cannot act on is not worth going red for.
			if tc.wantPrefix != "ok" && !strings.Contains(got, tc.compare) && !strings.Contains(got, "h ") {
				t.Fatalf("the verdict must name what it saw; got %q", got)
			}
		})
	}
}

// Both triggers, because neither covers the other: `push` names the causing merge at the
// instant it happens but cannot see a merge made with GITHUB_TOKEN (GitHub starts no run
// for one), and the cron covers that plus every strand the `ahead` question cannot see.
// Dropping either leaves a silent window, which is the whole defect.
//
// Asserted as KEYS inside the `on:` block, not as substrings of the file. An earlier draft
// looked for `"cron:"` anywhere and stayed green when the entry was renamed to `noncron:`
// — "cron:" is a substring of "noncron:" — which is the same "passes by finding something
// that is not what it was looking for" shape this whole ticket is about (measured by
// mutation, 2026-09-20).
func TestWatchdogWatchesOnBothPushAndSchedule(t *testing.T) {
	on := workflowSection(t, watchdogWorkflow(t), "on")
	hasKey := func(indent, key string) bool {
		for _, ln := range strings.Split(on, "\n") {
			if strings.TrimRight(ln, " ") == indent+key+":" || strings.HasPrefix(ln, indent+key+": ") {
				return true
			}
		}
		return false
	}
	if !hasKey("  ", "push") {
		t.Fatalf("%s must keep the `push` trigger: it is the only thing that fires at the instant a merge to main strands the sync PR", watchdogWorkflowPath)
	}
	if !strings.Contains(on, "branches: [main]") {
		t.Fatalf("%s's push trigger must be scoped to main", watchdogWorkflowPath)
	}
	if !hasKey("  ", "schedule") {
		t.Fatalf("%s must keep the `schedule` trigger: push alone cannot see a merge made with GITHUB_TOKEN", watchdogWorkflowPath)
	}
	// A real cron expression, not just the word: five whitespace-separated fields.
	cron := ""
	for _, ln := range strings.Split(on, "\n") {
		if _, rest, found := strings.Cut(strings.TrimSpace(ln), "- cron:"); found {
			cron = strings.Trim(strings.TrimSpace(rest), "'\"")
		}
	}
	if len(strings.Fields(cron)) != 5 {
		t.Fatalf("%s's schedule needs a 5-field cron expression, got %q", watchdogWorkflowPath, cron)
	}
}

// The alarm IS the red run. A watchdog that reports a problem and exits 0 is the same
// "gate that cannot fail" shape it was written to end.
//
// Anchored to the annotation, not to the file: the step carries several other `exit 1`
// guards, so a bare `strings.Contains(wf, "exit 1")` stayed green when the one that
// matters was flipped to `exit 0` (measured by mutation, 2026-09-20).
func TestWatchdogFailsTheRunOnANonOkVerdict(t *testing.T) {
	wf := watchdogWorkflow(t)
	lines := strings.Split(wf, "\n")
	errAt := -1
	for i, ln := range lines {
		if strings.Contains(ln, "::error::") {
			errAt = i
		}
	}
	if errAt < 0 {
		t.Fatalf("%s must annotate the failure with ::error:: so it surfaces on the run", watchdogWorkflowPath)
	}
	for _, ln := range lines[errAt+1:] {
		switch strings.TrimSpace(ln) {
		case "exit 1":
			return // annotated, then failed the run
		case "exit 0":
			t.Fatalf("%s exits GREEN after announcing a problem — that is the gate-that-cannot-fail shape it exists to end", watchdogWorkflowPath)
		}
	}
	t.Fatalf("%s must `exit 1` after the ::error:: annotation; nothing follows it", watchdogWorkflowPath)
}

// workflowSection returns the body of one top-level block — everything after `<name>:` at
// column 0, up to the next column-0 key.
func workflowSection(t *testing.T, workflow, name string) string {
	t.Helper()
	lines := strings.Split(workflow, "\n")
	start := -1
	for i, ln := range lines {
		if ln == name+":" {
			start = i + 1
			break
		}
	}
	if start < 0 {
		t.Fatalf("%s has no top-level `%s:` block", watchdogWorkflowPath, name)
	}
	for i := start; i < len(lines); i++ {
		if ln := lines[i]; len(ln) > 0 && ln[0] != ' ' && ln[0] != '#' {
			return strings.Join(lines[start:i], "\n")
		}
	}
	return strings.Join(lines[start:], "\n")
}

// It must never try to repair the branch itself. A stale regeneration rebased onto a newer
// `main` silently reverts whatever that `main` changed under `catalog/` or `dist/` — the
// web-registry removal touched six `.codex-plugin/plugin.json` files — which is precisely
// the damage `publish-sync-pr`'s refusal exists to prevent. Repair is a regeneration in
// stark-skills, and bifrost has no token for that repo.
func TestWatchdogNeverRewritesTheSyncBranch(t *testing.T) {
	wf := watchdogWorkflow(t)
	// Command invocations, not bare words: the comment this workflow posts explains in
	// prose why the repair is "not a rebase", and banning the word would forbid saying so.
	for _, forbidden := range []string{"git push", "git rebase", "gh pr merge", "gh pr ready"} {
		if strings.Contains(wf, forbidden) {
			t.Fatalf("%s must only report; found %q", watchdogWorkflowPath, forbidden)
		}
	}
	// It also must not hold the permission to do it. `contents: write` is what a push
	// needs; a watchdog that reports has no use for it, and a token it never holds cannot
	// be spent by a later edit that forgets why.
	if strings.Contains(wf, "contents: write") {
		t.Fatalf("%s must not take `contents: write` — it reports, it does not push", watchdogWorkflowPath)
	}
}
