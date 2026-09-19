package help

import (
	"flag"
	"os"
	"testing"

	"github.com/21StarkCom/bifrost/engine/internal/starktui/colors"
)

// update regenerates the shared goldens. The TS twin asserts against the SAME
// files (ts/src/help/help.test.ts), so the two implementations cannot drift
// without one of the two test suites going red.
var update = flag.Bool("update", false, "rewrite testdata/fixture*.ansi")

const (
	fixturePath = "testdata/fixture.txt"
	goldenPath  = "testdata/fixture.ansi"
	// The wrapped golden pins the reflow path too — the colorizer and the
	// wrapper are separate code on each side, and a colored wrap is exactly
	// where they drifted before (a span left open across a line break).
	wrappedGoldenPath = "testdata/fixture.w60.ansi"
	wrappedColumns    = 60
	// The tagged golden pins the OPT-IN path: the same fixture rendered with
	// MutedTags, so both "a count dims by default" and "a named tag dims too"
	// are asserted by both suites.
	taggedGoldenPath = "testdata/fixture.tags.ansi"
	// The L3 fixture opens with the usage line instead of a title — the shape
	// every frigg `<cmd> -h` page has, and the one that pins rule 2 winning at
	// index 0.
	l3FixturePath = "testdata/fixture_l3.txt"
	l3GoldenPath  = "testdata/fixture_l3.ansi"
)

func TestConformanceGolden(t *testing.T) {
	assertGolden(t, goldenPath, Options{Colors: colors.New(true), Binary: "frigg"})
}

func TestConformanceGoldenWrapped(t *testing.T) {
	assertGolden(t, wrappedGoldenPath, Options{Colors: colors.New(true), Columns: wrappedColumns, Binary: "frigg"})
}

func TestConformanceGoldenTagged(t *testing.T) {
	assertGolden(t, taggedGoldenPath, Options{
		Colors:    colors.New(true),
		Binary:    "frigg",
		MutedTags: []string{"TUI", "creds-free"},
	})
}

func TestConformanceGoldenL3(t *testing.T) {
	assertGoldenOf(t, l3FixturePath, l3GoldenPath, Options{Colors: colors.New(true), Binary: "frigg"})
}

func assertGolden(t *testing.T, golden string, opt Options) {
	t.Helper()
	assertGoldenOf(t, fixturePath, golden, opt)
}

func assertGoldenOf(t *testing.T, fixture, golden string, opt Options) {
	t.Helper()
	raw, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	got := Render(string(raw), opt)
	if *update {
		if err := os.WriteFile(golden, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("%s updated — re-run the TS suite to confirm the twin agrees", golden)
		return
	}
	want, err := os.ReadFile(golden)
	if err != nil {
		t.Fatal(err)
	}
	if got != string(want) {
		t.Fatalf("golden %s mismatch (run `go test ./help -update` after a deliberate change)\ngot:\n%q\nwant:\n%q", golden, got, string(want))
	}
}
