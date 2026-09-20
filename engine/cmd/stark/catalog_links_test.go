package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/21StarkCom/bifrost/engine/internal/load"
)

// THE REGRESSION TEST for STARK-6357.
//
// Every skill body carries links like `../../standards/help.md`. From
// catalog/<bundle>/skills/<name>.md that resolves to catalog/standards/<file> — a
// directory that did not exist, so all 68 of them were dead. They are correct under
// dist/**, where standards/ sits beside skills/, and were wrong only in the flattened
// catalog, which IS browsed (on GitHub).
//
// The fix makes the target exist rather than rewriting the links, so this test guards
// the emit in `stark sync`: delete catalog/standards/ and every one of these goes dead
// again, silently, because nothing else in the build looks at a link.
//
// It walks the REAL committed catalog, not a fixture. A fixture would pass while the
// shipped tree rotted, which is the failure mode the whole ticket is about.

// Both markdown link forms, so a wholesale switch to reference-style definitions
// cannot empty the check without tripping the checked==0 guard below. Group 1 is the
// inline destination, group 2 the reference definition's; each stops at whitespace so
// a link title (`](path "Title")`) is not swallowed into the path, and tolerates the
// angle-bracket form (`](<path>)`).
var standardsLinks = []*regexp.Regexp{
	regexp.MustCompile(`\]\(\s*<?([^\s)>]*standards/[^\s)>]*)`),
	regexp.MustCompile(`(?m)^\s*\[[^\]]+\]:\s*<?([^\s>]*standards/[^\s>]*)`),
}

func TestEveryCatalogStandardsLinkResolves(t *testing.T) {
	catalog := filepath.Join(repoRoot(t), "catalog")

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
		for _, re := range standardsLinks {
			for _, m := range re.FindAllStringSubmatch(string(body), -1) {
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
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk catalog: %v", err)
	}

	if len(dead) > 0 {
		t.Fatalf("%d dead standards link(s) in the catalog — is catalog/standards/ missing? run `stark sync --from <stark-skills checkout> ../catalog`:\n  %s",
			len(dead), strings.Join(dead, "\n  "))
	}
	// A test that checks nothing passes for the wrong reason: if the links are ever
	// renamed or removed wholesale, this should fail loudly rather than go quietly green.
	if checked == 0 {
		t.Fatal("found no standards links in the catalog at all — the pattern no longer matches what skills ship, so this test is guarding nothing")
	}
	t.Logf("checked %d standards links, all resolve", checked)
}

// catalog/standards/ is a SECOND copy of the vendored standards/ tree, written from the
// same snapshot by `stark sync`. Nothing in this repo's CI runs `sync --check` — that is
// the cross-repo gate, driven from stark-skills — and every in-repo gate skips the
// reserved directory by name, so a hand-edit here would sail through validate,
// build --check, check-bumps and lint. The link test above only proves the four linked
// files EXIST. This one proves the copy still says what the snapshot says.
func TestCatalogStandardsMatchesTheVendoredSnapshot(t *testing.T) {
	root := repoRoot(t)
	want := treeFiles(t, filepath.Join(root, "vendor", "stark-skills", "standards"))
	got := treeFiles(t, filepath.Join(root, "catalog", load.ReservedCatalogDir))

	if len(want) == 0 {
		t.Fatal("vendor/stark-skills/standards/ is empty — this comparison would pass by guarding nothing")
	}
	var diff []string
	for rel, w := range want {
		g, ok := got[rel]
		if !ok {
			diff = append(diff, "catalog/standards/"+rel+" (missing)")
			continue
		}
		if g != w {
			diff = append(diff, "catalog/standards/"+rel+" (differs from the vendored snapshot)")
		}
	}
	for rel := range got {
		if _, ok := want[rel]; !ok {
			diff = append(diff, "catalog/standards/"+rel+" (not in the vendored snapshot)")
		}
	}
	if len(diff) > 0 {
		t.Fatalf("catalog/standards/ has drifted from vendor/stark-skills/standards/ — it is generated, not hand-edited; run `stark sync`:\n  %s",
			strings.Join(diff, "\n  "))
	}
}

// treeFiles reads every regular file under root, keyed by slash-separated relative path.
func treeFiles(t *testing.T, root string) map[string]string {
	t.Helper()
	out := map[string]string{}
	err := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		out[filepath.ToSlash(rel)] = string(b)
		return nil
	})
	if err != nil {
		t.Fatalf("walk %s: %v", root, err)
	}
	return out
}
