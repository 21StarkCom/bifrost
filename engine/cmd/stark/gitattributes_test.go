package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestGitattributesMarksEveryGeneratedCatalogTree pins the `linguist-generated=true`
// rows for the catalog as a CROSS-REPO contract, not a cosmetic diff setting.
//
// stark-skills' `tools/findings_review_post.ts` fetches THIS file at a bifrost PR's head
// and parses it (`parseGeneratedGlobs`) to decide which findings get an inline thread and
// which are demoted to the review body. `main` enforces
// `required_conversation_resolution`, so an inline thread on a path whose fix is upstream
// blocks a publish. Nothing in bifrost CI reads `.gitattributes` otherwise: drop or
// misspell a row and every gate here stays green while routing silently changes in the
// other repo — the same shape as the coverage-gate contract pinned by
// coverage_gate_test.go (STARK-6468).
//
// It walks the REAL committed catalog and the REAL .gitattributes. A fixture would pass
// while the shipped tree drifted, which is the failure mode this guards.
func TestGitattributesMarksEveryGeneratedCatalogTree(t *testing.T) {
	root := repoRoot(t)
	globs := generatedGlobs(t, filepath.Join(root, ".gitattributes"))

	// The generated roots `stark sync` owns outright (see runSync's `managed`).
	for _, want := range []string{"catalog/*/skills/**", "catalog/*/commands/**", "catalog/standards/**"} {
		if !globs[want] {
			t.Errorf("`.gitattributes` no longer declares %q linguist-generated=true", want)
		}
	}

	catalog := filepath.Join(root, "catalog")
	checked := 0
	err := filepath.WalkDir(catalog, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		parts := strings.Split(rel, "/")
		// Generated: catalog/standards/** and a bundle's skills/ + commands/ trees.
		// Curated: everything else under a bundle (bundle.yaml, mcp/**, a future agents/).
		generated := parts[1] == "standards" ||
			(len(parts) > 2 && (parts[2] == "skills" || parts[2] == "commands"))
		checked++
		if matched := matchAnyGlob(rel, globs); matched != generated {
			t.Errorf("%s: linguist-generated=%v, want %v", rel, matched, generated)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if checked == 0 {
		t.Fatal("walked no catalog files — the check proved nothing")
	}
}

// generatedGlobs reads `.gitattributes` the way findings_review_post.ts's
// parseGeneratedGlobs does: comments and `[attr]` macros skipped, a row taken only when
// its attribute list carries `linguist-generated` Set (bare or `=true`), so
// `-linguist-generated` / `linguist-generated=false` never count.
func generatedGlobs(t *testing.T, path string) map[string]bool {
	t.Helper()
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]bool{}
	for _, raw := range strings.Split(string(body), "\n") {
		fields := strings.Fields(strings.TrimSpace(raw))
		if len(fields) < 2 || strings.HasPrefix(fields[0], "#") || strings.HasPrefix(fields[0], "[attr]") {
			continue
		}
		for _, a := range fields[1:] {
			if a == "linguist-generated" || a == "linguist-generated=true" {
				out[strings.TrimLeft(fields[0], "/")] = true
				break
			}
		}
	}
	return out
}

// matchAnyGlob reports whether a repo-relative path matches any declared glob, under the
// one semantics git's gitattributes and node's `path.matchesGlob` (the routing tool's
// matcher) agree on for these patterns: `*` stays inside one segment, a trailing `**`
// matches everything below, and the pattern is anchored at the repo root.
func matchAnyGlob(rel string, globs map[string]bool) bool {
	for glob := range globs {
		if globMatch(strings.Split(rel, "/"), strings.Split(glob, "/")) {
			return true
		}
	}
	return false
}

func globMatch(path, pattern []string) bool {
	for i, seg := range pattern {
		if seg == "**" {
			return i < len(path) // a trailing ** needs at least one segment below
		}
		if i >= len(path) {
			return false
		}
		if seg != "*" && seg != path[i] {
			return false
		}
	}
	return len(path) == len(pattern)
}
