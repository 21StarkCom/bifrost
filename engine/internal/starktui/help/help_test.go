package help

import (
	"os"
	"strings"
	"testing"

	"github.com/21StarkCom/bifrost/engine/internal/starktui/colors"
)

// on is the enabled palette every color assertion renders through.
func on() Options { return Options{Colors: colors.New(true)} }

// onTags is on() plus the opt-in muted-tag list — the shape a consumer uses to
// name the tags it considers metadata.
func onTags(tags ...string) Options {
	opt := on()
	opt.MutedTags = tags
	return opt
}

const fixture = `frigg — 21Stark IT-ops headless CLI

Usage: frigg <command> [args]

Commands:
  ga4       read-only Google Analytics 4
  gitlab    GitLab reads and gated writes

Options:
  --json    emit the typed projection
  -o FILE   write the raw result to FILE (0600)

Notes:
  • Write posture: every write is dry-run by default; pass --confirm.
  ! Secrets never reach stdout.

Examples:
  frigg ga4 list-accounts --json
  frigg invoke notion.get_page --arg page_id="abc" -o out.json
`

// A disabled palette with no column budget must be the identity transform —
// this is the pin that guarantees rendering never mutates help text.
func TestRenderDisabledIsIdentity(t *testing.T) {
	if got := Render(fixture, Options{Colors: colors.New(false)}); got != fixture {
		t.Fatalf("disabled render mutated the text:\n%q", got)
	}
	// The zero Options value must behave the same (no accidental ANSI).
	if got := Render(fixture, Options{}); got != fixture {
		t.Fatalf("zero-value render mutated the text:\n%q", got)
	}
}

// Stripping the ANSI back out of a colored render must return the original text:
// color adds bytes, never changes them.
func TestRenderColorIsPurelyAdditive(t *testing.T) {
	got := reANSI.ReplaceAllString(Render(fixture, on()), "")
	if got != fixture {
		t.Fatalf("color changed the text:\ngot  %q\nwant %q", got, fixture)
	}
}

func TestTitleSplitsNameFromTagline(t *testing.T) {
	line := first(Render(fixture, on()))
	want := "\x1b[1m\x1b[36mfrigg\x1b[39m\x1b[22m — 21Stark IT-ops headless CLI"
	if line != want {
		t.Fatalf("title\ngot  %q\nwant %q", line, want)
	}
}

func TestTitleWithoutTaglineIsBold(t *testing.T) {
	got := first(Render("frigg cockpit\n", on()))
	if want := "\x1b[1mfrigg cockpit\x1b[22m"; got != want {
		t.Fatalf("title\ngot  %q\nwant %q", got, want)
	}
}

func TestUsageLabelOnlyIsPainted(t *testing.T) {
	got := line(Render(fixture, on()), 2)
	want := "\x1b[1m\x1b[35mUsage:\x1b[39m\x1b[22m frigg <command> [args]"
	if got != want {
		t.Fatalf("usage\ngot  %q\nwant %q", got, want)
	}
}

// frigg authors its usage label lowercase; idun authors it capitalized. Both are
// the same rule.
func TestUsageLabelIsCaseInsensitive(t *testing.T) {
	got := line(Render("t\nusage: frigg ga4 <verb>\n", on()), 1)
	if !strings.HasPrefix(got, "\x1b[1m\x1b[35musage:\x1b[39m\x1b[22m frigg") {
		t.Fatalf("lowercase usage not painted: %q", got)
	}
}

func TestSectionHeadingIsBoldMagenta(t *testing.T) {
	got := line(Render(fixture, on()), 4)
	if want := "\x1b[1m\x1b[35mCommands:\x1b[39m\x1b[22m"; got != want {
		t.Fatalf("heading\ngot  %q\nwant %q", got, want)
	}
}

func TestItemRowNameIsCyanAndDescriptionKeepsContrast(t *testing.T) {
	got := line(Render(fixture, on()), 5)
	want := "  \x1b[36mga4\x1b[39m       read-only Google Analytics 4"
	if got != want {
		t.Fatalf("item row\ngot  %q\nwant %q", got, want)
	}
}

func TestItemRowFlagNameIsGreenAndPlaceholderYellow(t *testing.T) {
	got := line(Render(fixture, on()), 9)
	want := "  \x1b[32m--json\x1b[39m    emit the typed projection"
	if got != want {
		t.Fatalf("flag row\ngot  %q\nwant %q", got, want)
	}
	got = line(Render(fixture, on()), 10)
	if !strings.HasPrefix(got, "  \x1b[32m-o\x1b[39m\x1b[36m \x1b[39m\x1b[33mFILE\x1b[39m") {
		t.Fatalf("placeholder row not styled: %q", got)
	}
}

func TestInlineFlagInProseIsGreen(t *testing.T) {
	got := Render("t\n\nPass --confirm to execute.\n", on())
	if !strings.Contains(got, "Pass \x1b[32m--confirm\x1b[39m to execute.") {
		t.Fatalf("inline flag not painted: %q", got)
	}
}

// A flag-looking token glued to a word (a--b) is not a flag.
func TestInlineFlagNeedsASeparator(t *testing.T) {
	got := Render("t\n\nfoo--bar stays plain.\n", on())
	if strings.Contains(got, "\x1b[32m") {
		t.Fatalf("glued token was painted: %q", got)
	}
}

func TestBulletAndLabelArePainted(t *testing.T) {
	got := line(Render(fixture, on()), 13)
	if !strings.HasPrefix(got, "  \x1b[94m•\x1b[39m \x1b[1m\x1b[94mWrite posture:\x1b[39m\x1b[22m") {
		t.Fatalf("bullet\ngot %q", got)
	}
	if !strings.Contains(got, "\x1b[32m--confirm\x1b[39m") {
		t.Fatalf("bullet body flag not painted: %q", got)
	}
}

func TestWarningBulletIsYellow(t *testing.T) {
	got := line(Render(fixture, on()), 14)
	if !strings.HasPrefix(got, "  \x1b[33m!\x1b[39m ") {
		t.Fatalf("! bullet\ngot %q", got)
	}
}

func TestExampleLineUsesSyntaxColors(t *testing.T) {
	got := line(Render(fixture, on()), 17)
	// A hyphenated verb splits: the flag token has no word-boundary guard, so
	// "list-accounts" reads as "list" + a "-accounts" flag. Quirk of the
	// original TS rules, kept deliberately — the twins must agree.
	want := "  \x1b[36mfrigg ga4 list\x1b[39m\x1b[32m-accounts\x1b[39m\x1b[36m \x1b[39m\x1b[32m--json\x1b[39m"
	if got != want {
		t.Fatalf("example\ngot  %q\nwant %q", got, want)
	}
}

func TestExampleQuotedValueIsBlueBright(t *testing.T) {
	got := line(Render(fixture, on()), 18)
	if !strings.Contains(got, "\x1b[94m\"abc\"\x1b[39m") {
		t.Fatalf("quoted value not painted: %q", got)
	}
}

// Outside an examples section the same line is prose, not syntax.
func TestExampleColoringIsScopedToExamplesSections(t *testing.T) {
	got := Render("t\n\nNotes:\n  frigg ga4 list-accounts\n", on())
	if strings.Contains(got, "\x1b[36mfrigg ga4") {
		t.Fatalf("prose line was syntax-colored: %q", got)
	}
}

func TestBinaryIsInferredFromTitle(t *testing.T) {
	if got := inferBinary(strings.Split(fixture, "\n")); got != "frigg" {
		t.Fatalf("binary = %q, want frigg", got)
	}
	if got := inferBinary([]string{"usage: idun red-team <engine>"}); got != "idun" {
		t.Fatalf("binary = %q, want idun", got)
	}
}

func TestBareConstantNeedsWordBoundaries(t *testing.T) {
	// FILE is a placeholder; FILEs / xFILE are ordinary words.
	p := NewPalette(colors.New(true))
	if got := syntax("cmd FILE", p); !strings.Contains(got, "\x1b[33mFILE\x1b[39m") {
		t.Fatalf("bare constant not painted: %q", got)
	}
	if got := syntax("cmd FILEs", p); strings.Contains(got, "\x1b[33m") {
		t.Fatalf("FILEs must not be a placeholder: %q", got)
	}
	if got := syntax("cmd xFILE", p); strings.Contains(got, "\x1b[33m") {
		t.Fatalf("xFILE must not be a placeholder: %q", got)
	}
}

func TestWrappingHangsTheIndentOnItemRows(t *testing.T) {
	raw := "t\n\nCommands:\n  ga4  " + strings.Repeat("word ", 12) + "end\n"
	got := Render(raw, Options{Columns: 40})
	rows := strings.Split(got, "\n")[3:]
	if len(rows) < 2 {
		t.Fatalf("expected the row to wrap, got %q", got)
	}
	for i, r := range rows {
		if r == "" {
			continue
		}
		if w := visibleWidth(r); w > 40 {
			t.Fatalf("row %d is %d wide: %q", i, w, r)
		}
		if i > 0 && !strings.HasPrefix(r, strings.Repeat(" ", len("  ga4  "))) {
			t.Fatalf("continuation %d is not hanging-indented: %q", i, r)
		}
	}
}

// A narrow terminal stacks the name above its description instead of squeezing
// the description into a sliver of a column.
func TestNarrowTerminalStacksItemRows(t *testing.T) {
	raw := "t\n\nCommands:\n  a-very-long-command-name  does a thing worth describing\n"
	got := Render(raw, Options{Columns: 32})
	if !strings.Contains(got, "  a-very-long-command-name\n    does a thing") {
		t.Fatalf("row not stacked:\n%s", got)
	}
}

// A continuation line folds into the row above before the text is re-fitted, so
// hand-wrapped help reflows cleanly instead of keeping the authored breaks.
func TestContinuationLinesFoldIntoTheirRow(t *testing.T) {
	raw := "t\n\nCommands:\n  ga4  read-only\n       Google Analytics 4\n"
	got := Render(raw, Options{Columns: 100})
	if !strings.Contains(got, "  ga4  read-only Google Analytics 4") {
		t.Fatalf("continuation not folded:\n%s", got)
	}
}

// With no column budget the authored breaks survive untouched.
func TestZeroColumnsKeepsAuthoredLayout(t *testing.T) {
	raw := "t\n\nCommands:\n  ga4  read-only\n       Google Analytics 4\n"
	if got := Render(raw, Options{}); got != raw {
		t.Fatalf("authored layout changed:\n%q", got)
	}
}

func TestBlankLinesSurvive(t *testing.T) {
	if got := Render("t\n\n\nx\n", on()); strings.Count(got, "\n") != 4 {
		t.Fatalf("line count changed: %q", got)
	}
}

// Reflow re-fits a line; it must not rewrite the text inside one. A run of
// spaces is authored alignment, so only the run a break lands on is consumed.
func TestReflowKeepsInteriorSpaceRuns(t *testing.T) {
	raw := "t\n\nSome prose with     wide   gaps that is definitely longer than the budget here.\n"
	got := Render(raw, Options{Columns: 40})
	if !strings.Contains(got, "with     wide   gaps") {
		t.Fatalf("space runs collapsed:\n%q", got)
	}
}

// A line that already fits is emitted verbatim — trailing spaces and a tab
// indent are authored bytes, not something the wrapper may normalize away.
func TestFittingLineIsNeverRewritten(t *testing.T) {
	for _, raw := range []string{"t\n\nshort line with trailing   \n", "t\n\n\tTabbed line\n"} {
		if got := Render(raw, Options{Columns: 40}); got != raw {
			t.Fatalf("fitting line rewritten:\ngot  %q\nwant %q", got, raw)
		}
	}
}

// A colored span must not stay open across a wrap: the close lands at the break
// and the style reopens after the hanging indent, so the indent is never painted.
func TestWrappedSpansCloseAtTheBreak(t *testing.T) {
	raw := "t\n\nCommands:\n  ga4  " + strings.Repeat("word ", 10) + "end\n"
	got := Render(raw, Options{Colors: colors.New(true), Columns: 40})
	for i, ln := range strings.Split(got, "\n") {
		if open := sgrOpen(ln); len(open) != 0 {
			t.Fatalf("line %d leaves %v open: %q", i, open, ln)
		}
	}
}

// A hard-split of a styled token closes and reopens the style too.
func TestHardSplitStyledTokenReopens(t *testing.T) {
	raw := "t\n\nOptions:\n  --averyveryverylongflagname-indeed  does a thing\n"
	want := "  \x1b[32m--averyveryverylongflagn\x1b[39m\n  \x1b[32mame-indeed\x1b[39m"
	if got := Render(raw, Options{Colors: colors.New(true), Columns: 26}); !strings.Contains(got, want) {
		t.Fatalf("hard split did not reopen the style:\n%q", got)
	}
}

// The examples-heading test must use JS \b semantics (word = [0-9A-Za-z_]) or
// the twins disagree on what opens an examples section.
func TestExamplesHeadingUsesWordBoundaries(t *testing.T) {
	for _, s := range []string{"Examples:", "examples:", "More examples:", "Example usage:"} {
		if !examplesHeading.MatchString(s) {
			t.Errorf("%q should open an examples section", s)
		}
	}
	for _, s := range []string{"3examples:", "_examples:", "examples2:", "exampleish:"} {
		if examplesHeading.MatchString(s) {
			t.Errorf("%q must not open an examples section", s)
		}
	}
}

// JS backtracks a BARE_CONSTANT whose trailing \b fails by dropping "/SEGMENT"
// groups; "A/Bs" therefore paints "A". The Go scan must land in the same place.
func TestBareConstantBacktracksOverSlashSegments(t *testing.T) {
	p := NewPalette(colors.New(true))
	if got, want := syntax("cmd A/Bs", p), "\x1b[36mcmd \x1b[39m\x1b[33mA\x1b[39m\x1b[36m/Bs\x1b[39m"; got != want {
		t.Fatalf("A/Bs\ngot  %q\nwant %q", got, want)
	}
	if got, want := syntax("cmd A/B", p), "\x1b[36mcmd \x1b[39m\x1b[33mA/B\x1b[39m"; got != want {
		t.Fatalf("A/B\ngot  %q\nwant %q", got, want)
	}
}

// An empty Binary means "infer", matching the TS twin's `binary || inferBinary`.
func TestEmptyBinaryStillInfers(t *testing.T) {
	got := Render("frigg — x\n\nExamples:\n  frigg ga4 list\n", Options{Colors: colors.New(true), Binary: ""})
	if !strings.Contains(got, "\x1b[36mfrigg ga4 list\x1b[39m") {
		t.Fatalf("empty binary did not infer: %q", got)
	}
}

// Off a terminal there is no column budget, COLUMNS or not: piped help is a
// byte contract, so it must never be reflowed (the TS twin's rule too).
func TestWidthIsZeroOffATerminal(t *testing.T) {
	t.Setenv("COLUMNS", "70")
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	defer w.Close()
	if got := Width(w); got != 0 {
		t.Fatalf("Width(pipe) = %d, want 0", got)
	}
	if ColorEnabled(w) {
		t.Error("ColorEnabled(pipe) = true, want false")
	}
	if got := Width(nil); got != 0 {
		t.Fatalf("Width(nil) = %d, want 0", got)
	}
}

func line(s string, n int) string { return strings.Split(s, "\n")[n] }
func first(s string) string       { return line(s, 0) }

// A page whose FIRST line is the usage line (every frigg `<cmd> -h`) must render
// as a usage line, not as a title: the label is painted, the invocation is not.
func TestUsageLineAtIndexZeroBeatsTheTitleRule(t *testing.T) {
	got := first(Render("usage: frigg ga4 <verb> [flags]\n", on()))
	want := "\x1b[1m\x1b[35musage:\x1b[39m\x1b[22m frigg ga4 <verb> [flags]"
	if got != want {
		t.Fatalf("line-0 usage\ngot  %q\nwant %q", got, want)
	}
}

// A real title at index 0 is unaffected.
func TestTitleAtIndexZeroStillWinsWhenItIsNotUsage(t *testing.T) {
	got := first(Render("frigg — IT-ops CLI\n", on()))
	if want := "\x1b[1m\x1b[36mfrigg\x1b[39m\x1b[22m — IT-ops CLI"; got != want {
		t.Fatalf("title\ngot  %q\nwant %q", got, want)
	}
}

// inferBinary honors the same precedence as colorizeLine: a line-0 usage line is
// a usage line, so the binary comes from AFTER the label even when the
// invocation carries an em dash. Reading it as a title would yield "usage:" and
// leave every example line unpainted.
func TestInferBinarySkipsTheTitleRuleForALine0UsageLine(t *testing.T) {
	lines := []string{"usage: frigg ga4 <verb> — read-only GA4 reads"}
	if got := inferBinary(lines); got != "frigg" {
		t.Fatalf("inferBinary = %q, want %q", got, "frigg")
	}
	// End to end: the example line must be syntax-colored, not left plain.
	raw := "usage: frigg ga4 <verb> — read-only GA4 reads\n\nExamples:\n  frigg ga4 list-accounts\n"
	if got := line(Render(raw, on()), 3); !strings.Contains(got, "\x1b[") {
		t.Fatalf("example line went unpainted (binary mis-inferred): %q", got)
	}
}

// A trailing count / tag is METADATA and renders dim, so it stops competing
// with the description it follows.
func TestTrailingCountIsDimmedByDefault(t *testing.T) {
	for _, row := range []struct{ line, want string }{
		{"  ga4     read-only Google Analytics 4  (45)", "\x1b[90m(45)\x1b[39m"},
		{"  gitlab  reads and gated writes  (1)", "\x1b[90m(1)\x1b[39m"},
	} {
		got := line(Render("t\n\nCommands:\n"+row.line+"\n", on()), 3)
		if !strings.Contains(got, row.want) {
			t.Fatalf("%q\ngot  %q\nwant it to contain %q", row.line, got, row.want)
		}
	}
}

// A WORD tag is not dimmed unless the consumer names it. This is the whole
// point of the opt-in: "(TUI)" and "(DELETE)" are indistinguishable by shape,
// and dimming the second would make a destructive verb the faintest row on the
// page.
func TestAWordTagNeedsOptingIn(t *testing.T) {
	const page = "t\n\nCommands:\n  cockpit  launch the TUI  (TUI)\n  group delete  Dissolve a group AND DELETE its items  (DELETE)\n"

	plain := Render(page, on())
	if strings.Contains(plain, "\x1b[90m") {
		t.Fatalf("a word tag dimmed with no MutedTags:\n%s", plain)
	}

	opted := Render(page, onTags("TUI"))
	if !strings.Contains(line(opted, 3), "\x1b[90m(TUI)\x1b[39m") {
		t.Fatalf("the opted-in tag did not dim:\n%s", opted)
	}
	if strings.Contains(line(opted, 4), "\x1b[90m") {
		t.Fatalf("(DELETE) dimmed though it was never named:\n%s", opted)
	}
}

// The tags a consumer did NOT name stay bright even when they sit beside one it
// did — the match is exact, not fuzzy.
func TestMutedTagsMatchExactly(t *testing.T) {
	page := "t\n\nCommands:\n  a  x  (creds-free)\n  b  y  (creds)\n  c  z  (creds-free-ish)\n"
	got := Render(page, onTags("creds-free"))
	if !strings.Contains(line(got, 3), "\x1b[90m(creds-free)\x1b[39m") {
		t.Fatalf("exact tag did not dim:\n%s", got)
	}
	for _, i := range []int{4, 5} {
		if strings.Contains(line(got, i), "\x1b[90m") {
			t.Fatalf("row %d dimmed on a partial match:\n%s", i, got)
		}
	}
}

// A trailing parenthetical that is a USAGE HINT keeps its own colors: dimming
// it would grey out a flag the operator needs to see. Each row below is
// rejected by a DIFFERENT clause, so no single guard masks another.
func TestTrailingHintIsNotDimmed(t *testing.T) {
	for _, row := range []string{
		"  get-account  Get one GA4 account by id (--account accounts/<id>)",
		"  run-report   run a report (the request carries the property itself)", // too long
		"  arg-only     pass exactly one (<id>)",                                // <> only — short, no flag
		"  nested       a note (a (b))",                                         // nested parens only
		"  flag-space   run it (see --json)",                                    // flag after a space
		"  flag-quote   run it ('--json' only)",                                 // flag after a quote
		"  flag-comma   run it (a,--json)",                                      // flag after a comma
		"  flag-brack   run it (see [--json])",                                  // flag after a bracket
		"  unbalanced   a description ending in a stray group)",                 // no opening paren at all
		"  no-suffix    a description ending in (an unopened group",             // does not end in ')'
	} {
		got := line(Render("t\n\nCommands:\n"+row+"\n", on()), 3)
		if strings.Contains(got, "\x1b[90m") {
			t.Fatalf("hint was dimmed: %q\n%q", row, got)
		}
	}
	// The flag inside the hint still paints green — including one introduced by
	// a separator a word-prefix scan would miss.
	for _, row := range []string{
		"  get-account  Get one by id (--account X)",
		"  quoted       run it ('--account' only)",
	} {
		got := line(Render("t\n\nCommands:\n"+row+"\n", on()), 3)
		if !strings.Contains(got, "\x1b[32m--account\x1b[39m") {
			t.Fatalf("flag inside a trailing hint lost its color: %q\n%q", row, got)
		}
	}
}

// The structural guards outrank the consumer's own opt-in: naming a group in
// MutedTags does NOT make it a marker when it carries a flag, a <placeholder>,
// a {placeholder}, a nested paren, or more runes than the cap. Without a NAMED
// row per guard these clauses are dead weight — the terminal isCount/muted test
// alone rejects every row in TestTrailingHintIsNotDimmed, so deleting the
// guards would leave the whole suite green.
func TestStructuralGuardsOutrankAnOptedInTag(t *testing.T) {
	for _, inner := range []string{
		"",                      // "()" — empty, and the one isCount must not accept
		" ",                     // whitespace-only
		"<id>",                  // a <placeholder>
		"{n}",                   // a {placeholder} — the braces spelling
		"a (b)",                 // nested parens
		"see --json",            // a flag after a space
		"'--json' only",         // a flag after a quote
		"a,--json",              // a flag after a comma
		"see [--json]",          // a flag after a bracket
		strings.Repeat("x", 19), // 21 runes with the parens — one over the cap
	} {
		page := "t\n\nCommands:\n  verb  desc  (" + inner + ")\n"
		got := line(Render(page, onTags(inner)), 3)
		if strings.Contains(got, "\x1b[90m") {
			t.Fatalf("named tag %q dimmed past a structural guard:\n%q", inner, got)
		}
	}
}

// The length cap is a RUNE count, not a display width — the one measure the TS
// twin can compute identically without Go growing an East-Asian width table.
func TestMarkerLengthCapCountsRunes(t *testing.T) {
	// Counts, so the cap is what decides — a word tag would need opting in and
	// would confound the boundary this pins.
	for _, row := range []struct {
		desc string
		dim  bool
	}{
		{"(" + strings.Repeat("7", 18) + ")", true},  // 20 runes — the boundary
		{"(" + strings.Repeat("7", 19) + ")", false}, // 21 runes — one over
	} {
		got := line(Render("t\n\nCommands:\n  ga4  desc  "+row.desc+"\n", on()), 3)
		if dimmed := strings.Contains(got, "\x1b[90m"); dimmed != row.dim {
			t.Fatalf("%q: dimmed=%v want %v\n%q", row.desc, dimmed, row.dim, got)
		}
	}
	// A NAMED tag of wide characters: 12 runes (under the cap) but 22 display
	// columns. It dims because the cap counts runes — the TS twin pins the same
	// row, and without it Go could switch to a byte or column measure with both
	// suites still green.
	const wide = "日本語テキストですよ"
	got := line(Render("t\n\nCommands:\n  ga4  desc  ("+wide+")\n", onTags(wide)), 3)
	if !strings.Contains(got, "\x1b[90m") {
		t.Fatalf("a 12-rune wide tag was rejected — the cap is counting columns/bytes, not runes: %q", got)
	}
}

// Only a TRAILING group is a marker; a parenthetical mid-sentence is content,
// and a group glued to a word is part of that word.
func TestOnlyATrailingMarkerIsDimmed(t *testing.T) {
	got := line(Render("t\n\nCommands:\n  ga4  reads (all of them) plus writes\n", on()), 3)
	if strings.Contains(got, "\x1b[90m") {
		t.Fatalf("mid-sentence parenthetical was dimmed: %q", got)
	}
	got = line(Render("t\n\nCommands:\n  ga4  see docs(1)\n", on()), 3)
	if strings.Contains(got, "\x1b[90m") {
		t.Fatalf("glued group was dimmed: %q", got)
	}
}

// The marker keeps its dim across a wrap: reflow must not drop the styling when
// the tag lands on a continuation line.
func TestTrailingMarkerSurvivesAWrap(t *testing.T) {
	raw := "t\n\nCommands:\n  ga4  " + strings.Repeat("word ", 10) + "end  (45)\n"
	got := Render(raw, Options{Colors: colors.New(true), Columns: 40})
	if !strings.Contains(got, "\x1b[90m(45)\x1b[39m") {
		t.Fatalf("marker lost its dim when wrapped:\n%s", got)
	}
}

// A MULTI-WORD named tag ("(may return PII)") is the shape a consumer's own
// metadata usually takes, and the only one a wrap can SPLIT. The dim must close
// at the break and reopen after the hanging indent — a span left open would
// paint the indent and bleed into the next row.
func TestAMultiWordMutedTagSurvivesAWrap(t *testing.T) {
	const tag = "may return PII"
	raw := "t\n\nCommands:\n  sql  " + strings.Repeat("word ", 6) + "end  (" + tag + ")\n"
	got := Render(raw, Options{Colors: colors.New(true), Columns: 24, MutedTags: []string{tag}})
	if n := strings.Count(got, "\x1b[90m"); n < 2 {
		t.Fatalf("the tag never split across a break (%d dim opens), so this pins nothing:\n%s", n, got)
	}
	for i, l := range strings.Split(got, "\n") {
		if open := sgrOpen(l); len(open) != 0 {
			t.Fatalf("line %d leaves %v open across the break: %q", i, open, l)
		}
	}
	plain := reANSI.ReplaceAllString(got, "")
	if !strings.Contains(plain, "(may") || !strings.Contains(plain, "return PII)") {
		t.Fatalf("the tag text did not survive the reflow:\n%s", plain)
	}
}

// A file MODE is not a count. frigg writes `-o FILE (0600)` to promise that
// secret-bearing output lands in a 0600 file rather than on stdout — dimming
// that is the emphasis inversion the muted-tag narrowing exists to prevent.
func TestALeadingZeroIsNotACount(t *testing.T) {
	for _, row := range []struct {
		group string
		dim   bool
	}{
		{"(0600)", false}, // a file mode
		{"(0755)", false},
		{"(007)", false},
		{"(0)", true}, // zero itself is a count
		{"(45)", true},
		{"(10)", true},
	} {
		got := line(Render("t\n\nCommands:\n  verb  desc  "+row.group+"\n", on()), 3)
		if dimmed := strings.Contains(got, "\x1b[90m"); dimmed != row.dim {
			t.Fatalf("%s: dimmed=%v want %v\n%q", row.group, dimmed, row.dim, got)
		}
	}
}
