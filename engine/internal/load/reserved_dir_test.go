package load

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// catalog/standards/ is the generated copy of stark-skills' standards/, emitted by
// `stark sync` so the `../../standards/*.md` links in catalog/<bundle>/skills/*.md
// resolve when the catalog is browsed on GitHub (STARK-6357). It is the one directory
// under catalog/ that is not a bundle.
//
// The pair of tests below is the point: the reserved name is skipped, and ANY other
// directory without a bundle.yaml is still a hard error. The tempting shortcut —
// "skip any directory that has no bundle.yaml" — is fail-open, and would let a real
// bundle whose manifest went missing or got misnamed drop silently out of every build,
// validate and drift check while all of them reported clean. That is the same
// silent-drop failure STARK-6249 was, reintroduced one level down.

func seedCatalog(t *testing.T, extraDir string, withManifest bool) string {
	t.Helper()
	root := t.TempDir()
	cat := filepath.Join(root, "catalog")

	demo := filepath.Join(cat, "demo")
	if err := os.MkdirAll(demo, 0o755); err != nil {
		t.Fatal(err)
	}
	manifest := "name: demo\nversion: 0.1.0\ndescription: d\ncategory: ops\n" +
		"owner:\n  name: o\n  email: o@example.com\nmaturity: beta\nruntimes:\n  - claude\n"
	if err := os.WriteFile(filepath.Join(demo, "bundle.yaml"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}

	if extraDir != "" {
		d := filepath.Join(cat, extraDir)
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(d, "help.md"), []byte("# help\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		if withManifest {
			m := strings.Replace(manifest, "name: demo", "name: "+extraDir, 1)
			if err := os.WriteFile(filepath.Join(d, "bundle.yaml"), []byte(m), 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	return cat
}

func TestLoadSkipsTheReservedStandardsDir(t *testing.T) {
	cat, err := Load(seedCatalog(t, ReservedCatalogDir, false))
	if err != nil {
		t.Fatalf("catalog/%s must not be loaded as a bundle: %v", ReservedCatalogDir, err)
	}
	if len(cat.Bundles) != 1 || cat.Bundles[0].Name != "demo" {
		t.Fatalf("want exactly the demo bundle, got %d: %+v", len(cat.Bundles), cat.Bundles)
	}
}

// THE GUARD. If this ever goes green, the skip has been widened from "this one
// reserved name" to "anything without a manifest", and a bundle can disappear in
// silence.
func TestLoadStillFailsOnANonBundleDirThatIsNotReserved(t *testing.T) {
	_, err := Load(seedCatalog(t, "not-a-bundle", false))
	if err == nil {
		t.Fatal("a directory under catalog/ with no bundle.yaml must be a hard error; only the reserved standards/ is exempt")
	}
	if !strings.Contains(err.Error(), "not-a-bundle") {
		t.Fatalf("the error must name the offending directory, got: %v", err)
	}
}

// The reserved name is exempt from being READ as a bundle, not from existing. A real
// bundle legitimately named `standards` would be invisible — so if one is ever added,
// this test fails and forces the collision to be dealt with rather than discovered.
func TestReservedNameCollidesWithNoRealBundle(t *testing.T) {
	cat, err := Load(seedCatalog(t, ReservedCatalogDir, true))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	for _, b := range cat.Bundles {
		if b.Name == ReservedCatalogDir {
			t.Fatalf("bundle %q loaded despite the reserved name — the exemption is no longer unambiguous", b.Name)
		}
	}
	if len(cat.Bundles) != 1 {
		t.Fatalf("want 1 bundle (the reserved dir skipped even with a manifest), got %d", len(cat.Bundles))
	}
}
