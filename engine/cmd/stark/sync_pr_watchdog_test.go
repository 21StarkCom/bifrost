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
func verdict(t *testing.T, filter, compare, headCommittedAt, now, maxAgeHours string) string {
	t.Helper()
	requireJQ(t)
	in, err := json.Marshal(map[string]any{
		"number":          293,
		"headRefOid":      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		"headCommittedAt": headCommittedAt,
		"compare":         compare,
		"now":             now,
		"maxAgeHours":     maxAgeHours,
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
	// The head commit's time, NOT the PR's creation time. The sync branch is
	// long-lived and force-pushed onto one reused PR, so the two diverge by however
	// long that PR has been open: #293 was created 03:52 and its head pushed 15:24.
	const headAt = "2026-09-20T03:52:09Z"

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
			got := verdict(t, filter, tc.compare, headAt, tc.now, "8")
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

// The invocation details every case above is blind to, because they live in the shell
// around the filter rather than in it. Each needle is the GUARD, not a word near it —
// the same shape (and the same reason) as
// TestPublishWorkflowKeepsItsLoadBearingInvocationDetails.
func TestWatchdogKeepsItsLoadBearingInvocationDetails(t *testing.T) {
	wf := watchdogWorkflow(t)

	for _, c := range []struct{ needle, why string }{
		// Without this the filter above can be assigned and then never run — swap in
		// a literal `jq -r '"ok"'` and every other assertion in this file still
		// passes, because they exercise the string the workflow happens to define,
		// not the one it happens to execute.
		{`jq -r "$verdict_filter"`, "the extracted verdict must be the verdict the job actually runs"},
		{"isCrossRepository", "`--head` matches the ref NAME with no owner, so a fork PR on that branch reads identically to the sync branch"},
		{"select(.isCrossRepository == false)", "gh answers newest-first, so an unfiltered `.[0]` lets any fork PR take the watch and silence the real strand"},
		{"git/commits/${head}", "the branch is long-lived and force-pushed, so `createdAt` ages while the regeneration on it does not"},
		{"--paginate --slurp", "`--jq` with `--paginate` alone runs the filter once per PAGE, so a marker comment on two pages yields a two-line id"},
		// The other half of the shape TestWorkflowsNeverCombineSlurpWithJq bans: that
		// test forbids the inline filter, and the needle above pins the slurp, but
		// neither notices if the slurped pages are then never filtered at all. Drop
		// this pipe and `existing_id` is always empty — the watchdog re-POSTS a fresh
		// comment every cron tick instead of editing one, with every test still green.
		{`printf '%s' "$comments"`, "the slurped pages must still reach the marker filter; `gh api` cannot apply it inline"},
		{"GH_REPO:", "the job never checks out; gh resolves the repo from git remotes, not GITHUB_REPOSITORY"},
	} {
		if !strings.Contains(wf, c.needle) {
			t.Errorf("%s lost %q — %s", watchdogWorkflowPath, c.needle, c.why)
		}
	}

	// The age anchor, asserted on the predicate itself: reading `.createdAt` again
	// would call a freshly regenerated PR a 12-hour strand and leave an alarm that
	// the prescribed repair — which moves the head, never the creation time — can
	// never clear.
	if strings.Contains(watchdogFilter(t), ".createdAt") {
		t.Errorf("%s times the backstop from the PR's creation, not from its head commit", watchdogWorkflowPath)
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
	// The third trigger is the only way to re-ask after a run died for an unrelated
	// reason, and a scheduled workflow GitHub has auto-disabled for inactivity.
	if !hasKey("  ", "workflow_dispatch") {
		t.Fatalf("%s must keep `workflow_dispatch`: it is the only manual re-drive", watchdogWorkflowPath)
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

// The flags `gh api` refuses alongside `--slurp`, in every spelling it accepts for them.
// The refusal names two options and each has a shorthand, so the same fatal command line
// has FOUR forms — all measured on gh 2.101.0, all rejected identically. A gate that knew
// only `--jq` would have passed three of them, which is the whole failure mode below
// repeated: a pin that looks right and catches a quarter of the bug.
var ghFlagsSlurpRefuses = []string{"--jq", "-q", "--template", "-t"}

// ghAPIHasFlag reports whether one of `names` appears as its OWN argument in the `gh api`
// invocation on this line. Token-wise, not `strings.Contains`: `-t` and `-q` are two
// characters and would otherwise fire on any path, URL or jq program that happens to
// spell them. The scan starts at `gh api` so a flag belonging to a command piped after it
// is not read as gh's.
func ghAPIHasFlag(line string, names ...string) bool {
	i := strings.Index(line, "gh api")
	if i < 0 {
		return false
	}
	for _, tok := range strings.Fields(line[i:]) {
		for _, n := range names {
			if tok == n || strings.HasPrefix(tok, n+"=") {
				return true
			}
		}
	}
	return false
}

// `gh api` REFUSES `--slurp` together with `--jq` or `--template`: "the `--slurp` option is
// not supported with `--jq` or `--template`". Not a runner quirk — reproduced on gh 2.101.0
// too, for the shorthands `-q` and `-t` as well.
//
// This killed sync-pr-watchdog's first live run (35523084147, 2026-09-20): it printed gh's
// usage text and exited 1 before reaching any verdict. The workflow was merged green,
// because nothing that ran before that could see it — the line is valid shell and valid
// YAML, so `actionlint` and `shellcheck` pass it; the Go suite exercises the jq predicate,
// not the gh command line; and the review round that introduced the flag verified it
// against a STUBBED `gh`, which accepts every flag the real binary rejects.
//
// So the pin is on the command line itself, across every file that can carry one rather
// than just this workflow, because the mistake is a copy of `publish-sync-pr`'s flag
// without its shape — slurp into a variable, then pipe to `jq` — and the next copy will be
// somewhere else. "Somewhere else" is deliberately read wide: `.yaml` as well as `.yml`
// (GitHub Actions reads both, so a scan that stops at one is blind to half the directory)
// and `docs/scripts/`, which runs the same shell in the same CI and is under no rule that
// keeps a copied flag out of it.
//
// One scanned file is not this repo's to fix: `.github/workflows/secret-scan.yml` is a
// byte-identical copy of a Terraform render owned by 21stark. It is still scanned — losing
// the coverage silently would be worse — but the fix for a hit there is in that template,
// never here; see CLAUDE.md.
func TestWorkflowsNeverCombineSlurpWithJq(t *testing.T) {
	root := repoRoot(t)
	var files []string
	for _, scope := range []struct {
		dir  string
		exts []string
	}{
		{filepath.Join(".github", "workflows"), []string{".yml", ".yaml"}},
		{filepath.Join("docs", "scripts"), []string{".sh"}},
	} {
		dir := filepath.Join(root, scope.dir)
		entries, err := os.ReadDir(dir)
		if err != nil {
			t.Fatalf("read %s: %v", scope.dir, err)
		}
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			for _, ext := range scope.exts {
				if strings.HasSuffix(e.Name(), ext) {
					files = append(files, filepath.Join(dir, e.Name()))
					break
				}
			}
		}
	}
	// A gate that scanned nothing passes for the wrong reason; a moved directory must
	// redden rather than go quiet.
	if len(files) == 0 {
		t.Fatal("scanned no files — this gate would pass vacuously")
	}

	for _, path := range files {
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		// One `gh api` invocation may span continuation lines, so join them before
		// looking — the broken call had `--slurp` and `--jq` on different physical
		// lines. CRLF is normalized first, or a file checked out with CRLF endings
		// leaves `\`+`\r\n` unjoined and splits the pair back apart.
		joined := strings.ReplaceAll(strings.ReplaceAll(string(b), "\r\n", "\n"), "\\\n", " ")
		for _, line := range strings.Split(joined, "\n") {
			if !strings.Contains(line, "gh api") || strings.HasPrefix(strings.TrimSpace(line), "#") {
				continue
			}
			if !ghAPIHasFlag(line, "--slurp") || !ghAPIHasFlag(line, ghFlagsSlurpRefuses...) {
				continue
			}
			t.Errorf("%s combines --slurp with one of %v, which `gh api` refuses outright:\n  %s\n"+
				"slurp into a variable and pipe to jq instead (publish-sync-pr.yml does)",
				filepath.Base(path), ghFlagsSlurpRefuses, strings.TrimSpace(line))
		}
	}
}
