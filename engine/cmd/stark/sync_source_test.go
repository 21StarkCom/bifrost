package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// These tests pin the one-line statement `stark sync` prints before it regenerates
// anything, and the two ways that line can lie about the source (an inherited GIT_DIR, an
// uncommitted working tree). Why it exists is argued once, at the call site in sync.go
// (STARK-7364) — not restated here.
//
// Note what is deliberately NOT tested, because it is deliberately not implemented: a
// "source is behind origin/main" check. The documented skill-membership recipe
// (STARK-6468) instructs syncing from an UNMERGED branch, so such a check would fire on
// the official happy path, and a warning that cries wolf there is ignored within a week.

// gitRun drives the fixture through production's own gitCommand, so the tests inherit —
// and therefore pin — its scrub of GIT_DIR and friends. Without that scrub this helper is
// a hazard, not a fixture: run under a hook or `git rebase --exec "go test ./..."`, an
// exported absolute GIT_DIR beats `-C dir` and `git commit` lands "the source commit
// subject" on the branch the operator is rebasing. GIT_CONFIG_GLOBAL/_NOSYSTEM pin the
// other half: a developer or CI image with commit.gpgsign=true and no key, a
// core.hooksPath, or an init.templateDir pre-commit hook must not decide these tests.
func gitRun(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := gitCommand(dir, args...)
	cmd.Env = append(cmd.Env,
		"GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_NOSYSTEM=1",
		"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@example.com",
		"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@example.com")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

// seedCommit turns a fixture tree into a one-commit repo, which is what gives check-bumps a
// `HEAD:index.json` to read as the previous index. One helper, through gitRun, because five
// fixtures each carried a bare `exec.Command("git", …)` copy of this with the hazard above.
func seedCommit(t *testing.T, root string) {
	t.Helper()
	gitRun(t, root, "init", "-q")
	gitRun(t, root, "add", ".")
	gitRun(t, root, "commit", "-q", "-m", "seed")
}

func gitInit(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skipf("git not installed: %v", err)
	}
	dir := t.TempDir()
	gitRun(t, dir, "init", "-q")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitRun(t, dir, "add", "f.txt")
	gitRun(t, dir, "commit", "-q", "-m", "the source commit subject")
	return dir
}

func TestSourceRevisionNamesTheCommit(t *testing.T) {
	dir := gitInit(t)

	got := sourceRevision(dir)
	if !strings.Contains(got, "the source commit subject") {
		t.Fatalf("want the commit subject in the source line, got %q", got)
	}
	// The sha is the part an operator compares against origin/main, so it must be there.
	out, err := gitCommand(dir, "log", "-1", "--format=%h").Output()
	if err != nil {
		t.Fatalf("read sha: %v", err)
	}
	sha := strings.TrimSpace(string(out))
	if !strings.Contains(got, sha) {
		t.Fatalf("want sha %q in the source line, got %q", sha, got)
	}
	// A date makes a weeks-old checkout obvious at a glance, which is the whole point.
	// Matched as a real date: "contains a hyphen" is satisfied by any subject with one.
	if !regexp.MustCompile(`\b\d{4}-\d{2}-\d{2}\b`).MatchString(got) {
		t.Fatalf("want a YYYY-MM-DD commit date in the source line, got %q", got)
	}
	if strings.Contains(got, "\n") {
		t.Fatalf("the source line must be one line, got %q", got)
	}
}

// The statement has to reach STDOUT, ahead of the regen — that ordering IS the feature,
// and nothing above pins it: delete the print from runSync and every other test here
// still passes. The catalog dir is bogus on purpose, so the run dies at the very first
// step after the print; the source must already have been named by then.
func TestRunSyncPrintsTheSourceBeforeItReadsAnything(t *testing.T) {
	dir := gitInit(t)
	missingCatalog := filepath.Join(t.TempDir(), "no-such-catalog")
	// Pass the source RELATIVELY, as the documented `--from ../../stark-skills` does:
	// the line has to resolve it, or it names no particular sibling checkout.
	parent, name := filepath.Split(strings.TrimSuffix(dir, string(os.PathSeparator)))
	t.Chdir(parent)

	out := captureStdout(t, func() {
		if code := runSync(name, missingCatalog, t.TempDir(), true); code == 0 {
			t.Errorf("runSync over a missing catalog should fail")
		}
	})

	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) < 3 {
		t.Fatalf("want source path, revision and the load error, got %q", out)
	}
	if !strings.HasPrefix(lines[0], "source: ") {
		t.Fatalf("first line must name the source, got %q", lines[0])
	}
	printed := strings.TrimPrefix(lines[0], "source: ")
	if !filepath.IsAbs(printed) || filepath.Base(printed) != name {
		t.Fatalf("want the relative source %q resolved to an absolute path, got %q", name, printed)
	}
	if !strings.Contains(lines[1], "the source commit subject") {
		t.Fatalf("want the revision on the second line, got %q", lines[1])
	}
	if !strings.Contains(out, "load error") {
		t.Fatalf("expected the run to fail loading the catalog, got %q", out)
	}
}

// `sync` copies the working TREE, not the commit. A sha that matches origin/main while
// uncommitted (or untracked) edits sit in the source is the same false comfort this
// feature exists to end, so the line has to say so.
func TestSourceRevisionMarksAnUncommittedSource(t *testing.T) {
	dir := gitInit(t)
	if clean := sourceRevision(dir); strings.Contains(clean, "UNCOMMITTED") {
		t.Fatalf("a clean source must not be marked dirty, got %q", clean)
	}

	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("edited\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := sourceRevision(dir); !strings.Contains(got, "UNCOMMITTED CHANGES") {
		t.Fatalf("want an uncommitted-changes marker, got %q", got)
	}

	// Untracked counts too: a hand-dropped tools/*.ts is vendored into every bundle.
	gitRun(t, dir, "checkout", "--", "f.txt")
	if err := os.WriteFile(filepath.Join(dir, "new.ts"), []byte("//\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := sourceRevision(dir); !strings.Contains(got, "UNCOMMITTED CHANGES") {
		t.Fatalf("want an untracked file to count as uncommitted, got %q", got)
	}
}

// Hooks, `git rebase --exec` and `git submodule foreach` export an absolute GIT_DIR, and
// it beats `-C dir`. Unscrubbed, the source line names the ENCLOSING repo's HEAD — a
// confidently wrong diagnostic, which is worse than none.
func TestSourceRevisionIgnoresAnInheritedGitDir(t *testing.T) {
	src := gitInit(t)
	other := gitInit(t)
	gitRun(t, other, "commit", "-q", "--allow-empty", "-m", "SOME OTHER REPO")

	t.Setenv("GIT_DIR", filepath.Join(other, ".git"))
	t.Setenv("GIT_WORK_TREE", other)

	got := sourceRevision(src)
	if strings.Contains(got, "SOME OTHER REPO") {
		t.Fatalf("an inherited GIT_DIR retargeted the source revision: %q", got)
	}
	if !strings.Contains(got, "the source commit subject") {
		t.Fatalf("want the source's own commit, got %q", got)
	}
}

// stark-skills' HEAD is normally a GitHub squash-merge, which is signed. With
// log.showSignature=true in the operator's config, `git log` prepends gpg verification
// lines to STDOUT and the one-line statement becomes a four-line dump.
func TestSourceRevisionStaysOneLineOnASignedCommit(t *testing.T) {
	dir := gitInit(t)
	raw, err := gitCommand(dir, "cat-file", "commit", "HEAD").Output()
	if err != nil {
		t.Fatalf("cat-file: %v", err)
	}
	body := string(raw)
	split := strings.Index(body, "\n\n")
	if split < 0 {
		t.Fatalf("unexpected commit object: %q", body)
	}
	signed := body[:split] + "\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n bogus\n -----END PGP SIGNATURE-----" + body[split:]

	hash := gitCommand(dir, "hash-object", "-t", "commit", "-w", "--stdin")
	hash.Stdin = strings.NewReader(signed)
	shaOut, err := hash.Output()
	if err != nil {
		t.Skipf("this git refuses a hand-written signed commit object: %v", err)
	}
	gitRun(t, dir, "update-ref", "HEAD", strings.TrimSpace(string(shaOut)))
	gitRun(t, dir, "config", "log.showSignature", "true")

	got := sourceRevision(dir)
	if strings.Contains(got, "\n") || strings.Contains(strings.ToLower(got), "gpg:") {
		t.Fatalf("signature output leaked into the source line: %q", got)
	}
	if !strings.Contains(got, "the source commit subject") {
		t.Fatalf("want the commit subject, got %q", got)
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

// A machine without git must still sync, and must be told which of the degrade paths it
// is on — "git not found on PATH" is a different problem from "that isn't a checkout".
func TestSourceRevisionSaysWhenGitIsMissing(t *testing.T) {
	dir := gitInit(t)
	t.Setenv("PATH", "")

	got := sourceRevision(dir)
	if !strings.Contains(got, "git not found") {
		t.Fatalf("want an explicit git-not-found message, got %q", got)
	}
}

// A repo with no commits is the other way `git log -1` fails — it EXITS NON-ZERO rather
// than printing nothing, so the degraded line has to carry git's own reason. Reporting a
// bare "git log failed" sends the operator to reproduce by hand what git already said.
func TestSourceRevisionNamesGitsReasonForAnEmptyRepo(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skipf("git not installed: %v", err)
	}
	dir := t.TempDir()
	gitRun(t, dir, "init", "-q")

	got := sourceRevision(dir)
	if !strings.Contains(got, "cannot report a source revision") {
		t.Fatalf("want a degraded message for a commitless repo, got %q", got)
	}
	if !strings.Contains(got, "fatal:") {
		t.Fatalf("want git's own reason in the degraded message, got %q", got)
	}
}
