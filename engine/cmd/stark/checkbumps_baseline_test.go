package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The defect these tests pin, measured 2026-09-20 (STARK-8161).
//
// `check-bumps` asks whether content already published on main changed under an unchanged
// version, so it needs main's index.json. `actions/checkout@v4` on a `pull_request` event
// at its default depth fetches ONLY `refs/pull/N/merge` and creates no remote-tracking
// branch, so `origin/main` does not resolve in bifrost's own CI. The old `prevIndexJSON`
// fell through to `HEAD:index.json` — which on that checkout is the PR's own index, and
// `build --check` has already forced that to agree with the change. Previous == current
// for every row, `bumps.Check` finds nothing, and the gate prints OK.
//
// A/B on one violating commit (a line appended to `vendor/stark-skills/tools/*.ts`,
// `build --fix`, committed, no version bump), same tree, same binary:
//
//	refs/remotes/pull/999/merge only  ->  "OK: no un-bumped source changes", exit 0
//	+ refs/remotes/origin/main        ->  7 shared-assets violations,        exit 1
//
// It went unnoticed for the life of the repo because `docs/scripts/ci-local.sh` and
// `docs/scripts/publish.sh` run the identical command in a full local clone, where
// `origin/main` exists and the gate is real — the local mirror was stronger than the gate
// it mirrored. The fixtures in the sibling checkbumps tests cannot catch it either: they
// `git init` with no remote and deliberately commit a STALE index.json, exercising the
// HEAD path in a state the drift gate makes impossible in a real PR.

// seedBaselineRepo makes a minimal catalog whose committed index.json is STALE — the
// shape that must trip the gate whenever a baseline is actually being read.
func seedBaselineRepo(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "catalog", "demo", "bundle.yaml"),
		"name: demo\nversion: 0.1.0\ndescription: d\nowner: { name: E }\nruntimes: [claude]\n")
	writeFile(t, filepath.Join(root, "catalog", "demo", "commands", "hello.md"),
		"---\nname: hello\ntype: command\ndescription: d\nversion: 0.1.0\n---\nbody\n")
	writeFile(t, filepath.Join(root, "index.json"),
		`{"schemaVersion":1,"artifacts":[{"name":"hello","type":"command","bundle":"demo","version":"0.1.0","digest":"sha256:stale"}]}`+"\n")
	seedCommit(t, root)
	return root
}

// A clone that HAS an origin remote but no `origin/main` is the CI shape. The baseline is
// unavailable, so the gate must refuse — never fall through to HEAD and never print OK.
func TestCheckBumpsRefusesWhenOriginMainIsUnfetched(t *testing.T) {
	root := seedBaselineRepo(t)
	// An origin that resolves to nothing fetchable is enough: the probe asks whether the
	// remote is CONFIGURED, which is what `actions/checkout` does before it fetches a
	// single pull ref.
	gitRun(t, root, "remote", "add", "origin", "https://example.invalid/x.git")

	if _, ref, ok := prevIndexJSON(root); ok {
		t.Fatalf("baseline must be unavailable with origin configured and origin/main absent; got ref=%q", ref)
	}

	var code int
	out := captureStdout(t, func() { code = runCheckBumps(filepath.Join(root, "catalog"), root) })
	if code == 0 {
		t.Fatalf("want a refusal (nonzero), got 0 with output:\n%s", out)
	}
	if strings.Contains(out, "OK:") {
		t.Fatalf("a gate with no baseline must not report OK; output:\n%s", out)
	}
	if !strings.Contains(out, "origin/main") {
		t.Fatalf("the refusal must name the missing ref so it is actionable; output:\n%s", out)
	}
}

// The probe coming back empty is not the same as there being nothing to compare against.
// A real checkout whose git cannot ANSWER — not on PATH, `detected dubious ownership`
// under a container or a foreign uid, a corrupt object store — must refuse too: read as
// "no remote configured" it takes the HEAD path, finds nothing there either, and prints
// `OK` having measured no baseline at all, which is STARK-8161 one layer down. Only git's
// ability to answer is removed here; the `.git` is still on disk.
func TestCheckBumpsRefusesWhenGitCannotAnswer(t *testing.T) {
	root := seedBaselineRepo(t) // seeds through git, so do this BEFORE PATH loses it
	t.Setenv("PATH", t.TempDir())

	if _, ref, ok := prevIndexJSON(root); ok {
		t.Fatalf("a checkout git cannot read must yield no baseline; got ref=%q", ref)
	}

	var code int
	out := captureStdout(t, func() { code = runCheckBumps(filepath.Join(root, "catalog"), root) })
	if code == 0 {
		t.Fatalf("want a refusal (nonzero), got 0 with output:\n%s", out)
	}
	if strings.Contains(out, "OK:") {
		t.Fatalf("a gate whose baseline probe failed must not report OK; output:\n%s", out)
	}
	// Name git's OWN reason, not a bare "it failed" — the operator cannot act on the latter.
	if !strings.Contains(out, "git not found on PATH") {
		t.Fatalf("the refusal must carry git's own reason; output:\n%s", out)
	}
}

// With `origin/main` present the same repo must go back to really measuring: the stale
// committed digest is a violation and has to be reported.
func TestCheckBumpsReadsOriginMainWhenItResolves(t *testing.T) {
	root := seedBaselineRepo(t)
	gitRun(t, root, "remote", "add", "origin", "https://example.invalid/x.git")
	// Point the remote-tracking ref at the seeded commit, the way a fetch would.
	gitRun(t, root, "update-ref", "refs/remotes/origin/main", "HEAD")

	_, ref, ok := prevIndexJSON(root)
	if !ok || ref != "origin/main" {
		t.Fatalf("want the origin/main baseline, got ref=%q ok=%v", ref, ok)
	}

	var code int
	out := captureStdout(t, func() { code = runCheckBumps(filepath.Join(root, "catalog"), root) })
	if code == 0 {
		t.Fatalf("stale committed digest at an unchanged version must violate; got 0:\n%s", out)
	}
	// Name the violation, not just a nonzero exit: runCheckBumps also returns 1 for a load
	// error, an unparseable index and a digest error, so "exit != 0" alone would keep this
	// green on a run that never reached bumps.Check at all.
	if !strings.Contains(out, "demo/command/hello") {
		t.Fatalf("want the stale artifact reported as the violation; output:\n%s", out)
	}
	if !strings.Contains(out, "baseline origin/main") {
		t.Fatalf("every run must name the baseline it used; output:\n%s", out)
	}
}

// A repo with no origin at all — a scratch tree or a fixture — is not a broken clone, so
// the HEAD fallback survives there. This is the path every sibling checkbumps test runs on;
// without it this change would silently disarm them instead of the CI gate.
func TestCheckBumpsStillFallsBackToHeadWithNoOrigin(t *testing.T) {
	root := seedBaselineRepo(t)

	_, ref, ok := prevIndexJSON(root)
	if !ok || !strings.HasPrefix(ref, "HEAD") {
		t.Fatalf("want the HEAD fallback with no origin remote, got ref=%q ok=%v", ref, ok)
	}

	var code int
	out := captureStdout(t, func() { code = runCheckBumps(filepath.Join(root, "catalog"), root) })
	if code == 0 {
		t.Fatalf("stale committed digest at an unchanged version must violate; got 0:\n%s", out)
	}
	if !strings.Contains(out, "demo/command/hello") {
		t.Fatalf("want the stale artifact reported as the violation, not some other exit-1 path; output:\n%s", out)
	}
}

// The fix has two halves and each is useless alone: the engine refuses without a baseline,
// and CI supplies one. Pin the workflow step, because dropping it is now a RED job rather
// than a quiet one — and a reader who sees it go red should be able to find out why here.
func TestCIFetchesTheCheckBumpsBaseline(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "..", "..", ".github", "workflows", "ci.yml"))
	if err != nil {
		t.Fatalf("read ci.yml: %v", err)
	}
	ci := string(b)
	// Scoped to the ONE job, not the whole file: each job gets its own runner and its own
	// checkout, so a fetch parked in `secrets` or `actionlint` writes the ref into a tree
	// the gate never sees while a whole-file ordering check still reads as satisfied —
	// green test, dead gate, which is the exact failure mode this file exists to pin.
	job := workflowJob(t, ci, "engine")
	// The refspec, not just the word "fetch": a fetch that does not write
	// refs/remotes/origin/main leaves the gate exactly as dead as no fetch at all.
	fetchAt := strings.Index(job, "refs/heads/main:refs/remotes/origin/main")
	if fetchAt < 0 {
		t.Fatalf("ci.yml's `engine` job must fetch main into refs/remotes/origin/main; job:\n%s", job)
	}
	gateAt := strings.Index(job, "check-bumps ../catalog")
	if gateAt < 0 {
		t.Fatal("ci.yml's `engine` job no longer runs check-bumps")
	}
	if fetchAt > gateAt {
		t.Fatal("the baseline fetch must come BEFORE the check-bumps step")
	}
}

// workflowJob returns the body of one `jobs:` entry — everything from `  <name>:` up to
// the next key at that same two-space indent. Indentation rather than a YAML parse keeps
// this test free of a dependency, and the engine has no workflow reader to reuse.
func workflowJob(t *testing.T, workflow, name string) string {
	t.Helper()
	lines := strings.Split(workflow, "\n")
	start := -1
	for i, ln := range lines {
		if ln == "  "+name+":" {
			start = i + 1
			break
		}
	}
	if start < 0 {
		t.Fatalf("ci.yml has no `%s` job", name)
	}
	for i := start; i < len(lines); i++ {
		ln := lines[i]
		if len(ln) > 2 && ln[0] == ' ' && ln[1] == ' ' && ln[2] != ' ' && strings.HasSuffix(strings.TrimSpace(ln), ":") {
			return strings.Join(lines[start:i], "\n")
		}
	}
	return strings.Join(lines[start:], "\n")
}
