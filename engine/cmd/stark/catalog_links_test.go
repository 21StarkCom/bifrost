package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// THE REGRESSION TEST for STARK-6357.
//
// Every skill body carries links like `../../standards/help.md`. From
// catalog/<bundle>/skills/<name>.md that resolves to catalog/standards/<file> — a
// directory that did not exist, so all 68 of them were dead. They are correct under
// dist/**, where standards/ sits beside skills/, and were wrong only in the flattened
// catalog, which IS browsed (on GitHub: the web SPA renders only metadata from
// index.json/bundles/*.json and the origin serves no catalog/ at all).
//
// The fix makes the target exist rather than rewriting the links, so this test guards
// the emit in `stark sync`: delete catalog/standards/ and every one of these goes dead
// again, silently, because nothing else in the build looks at a link.
//
// It walks the REAL committed catalog, not a fixture. A fixture would pass while the
// shipped tree rotted, which is the failure mode the whole ticket is about.

var standardsLink = regexp.MustCompile(`\]\(([^)]*standards/[^)]*)\)`)

func TestEveryCatalogStandardsLinkResolves(t *testing.T) {
	catalog := filepath.Join("..", "..", "..", "catalog")
	if _, err := os.Stat(catalog); err != nil {
		t.Fatalf("catalog not found at %s: %v", catalog, err)
	}

	checked, dead := 0, []string{}
	err := filepath.WalkDir(catalog, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(path, ".md") {
			return nil
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, m := range standardsLink.FindAllStringSubmatch(string(body), -1) {
			link := m[1]
			if strings.HasPrefix(link, "http://") || strings.HasPrefix(link, "https://") {
				continue
			}
			// Strip a #fragment: the file is what has to exist.
			target := strings.SplitN(link, "#", 2)[0]
			if target == "" {
				continue
			}
			checked++
			resolved := filepath.Join(filepath.Dir(path), filepath.FromSlash(target))
			if fi, err := os.Stat(resolved); err != nil || fi.IsDir() {
				dead = append(dead, path+" -> "+link)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk catalog: %v", err)
	}

	if len(dead) > 0 {
		t.Fatalf("%d dead standards link(s) in the catalog — is catalog/standards/ missing? run `stark sync`:\n  %s",
			len(dead), strings.Join(dead, "\n  "))
	}
	// A test that checks nothing passes for the wrong reason: if the links are ever
	// renamed or removed wholesale, this should fail loudly rather than go quietly green.
	if checked == 0 {
		t.Fatal("found no standards links in the catalog at all — the pattern no longer matches what skills ship, so this test is guarding nothing")
	}
	t.Logf("checked %d standards links, all resolve", checked)
}
