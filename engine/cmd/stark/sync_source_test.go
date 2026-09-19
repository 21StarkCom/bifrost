package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// `stark sync` regenerates every bundle's catalog and the shared vendor snapshot from
// whatever checkout it is pointed at, so a source that is behind silently REGRESSES the
// snapshot for every bundle. It happened twice on 2026-09-19, the second time to the
// person who had written the hazard note about it hours earlier (STARK-7364). These tests
// pin the one-line statement that makes the source visible BEFORE the diff.
//
// Note what is deliberately NOT tested, because it is deliberately not implemented: a
// "source is behind origin/main" check. The documented skill-membership recipe
// (STARK-6468) instructs syncing from an UNMERGED branch, so such a check would fire on
// the official happy path, and a warning that cries wolf there is ignored within a week.

func gitInit(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skipf("git not installed: %v", err)
	}
	dir := t.TempDir()
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@example.com",
			"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@example.com")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init", "-q")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", "f.txt")
	run("commit", "-q", "-m", "the source commit subject")
	return dir
}

func TestSourceRevisionNamesTheCommit(t *testing.T) {
	dir := gitInit(t)

	got := sourceRevision(dir)
	if !strings.Contains(got, "the source commit subject") {
		t.Fatalf("want the commit subject in the source line, got %q", got)
	}
	// The sha is the part an operator compares against origin/main, so it must be there.
	out, err := exec.Command("git", "-C", dir, "log", "-1", "--format=%h").Output()
	if err != nil {
		t.Fatalf("read sha: %v", err)
	}
	sha := strings.TrimSpace(string(out))
	if !strings.Contains(got, sha) {
		t.Fatalf("want sha %q in the source line, got %q", sha, got)
	}
	// A date makes a weeks-old checkout obvious at a glance, which is the whole point.
	if !strings.Contains(got, "-") {
		t.Fatalf("want a commit date in the source line, got %q", got)
	}
}

// Diagnostics must never become a new way for the regen to break: an export rather than a
// clone still syncs. But it must SAY so — a silently empty diagnostic is its own small
// false comfort, the same shape as a shallow checkout yielding an empty log.
func TestSourceRevisionSaysSoWhenItCannotTell(t *testing.T) {
	got := sourceRevision(t.TempDir())
	if got == "" {
		t.Fatal("a non-git source must produce an explicit line, not silence")
	}
	if !strings.Contains(got, "not a git checkout") {
		t.Fatalf("want an explicit not-a-checkout message, got %q", got)
	}
}

// A repo with no commits is the other way `git log -1` fails; it must degrade the same way
// rather than surfacing a raw git error as if it were the revision.
func TestSourceRevisionHandlesAnEmptyRepo(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skipf("git not installed: %v", err)
	}
	dir := t.TempDir()
	if out, err := exec.Command("git", "-C", dir, "init", "-q").CombinedOutput(); err != nil {
		t.Fatalf("git init: %v\n%s", err, out)
	}
	got := sourceRevision(dir)
	if !strings.Contains(got, "cannot report a source revision") {
		t.Fatalf("want a degraded message for a commitless repo, got %q", got)
	}
}
