package main

import (
	"bytes"
	"io"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/spf13/cobra"

	"github.com/21StarkCom/bifrost/engine/internal/starktui/colors"
	"github.com/21StarkCom/bifrost/engine/internal/starktui/help"
)

// pristine returns a second copy of the real command tree with cobra's OWN help
// and usage funcs restored: nil means "no func of my own", so Command.HelpFunc /
// UsageFunc fall through to cobra's defaults. It is the baseline every identity
// test below compares against, built from newRootCmd so it can never drift from
// the tree that ships.
func pristine(t *testing.T) *cobra.Command {
	t.Helper()
	root := newRootCmd()
	root.SetHelpFunc(nil)
	root.SetUsageFunc(nil)
	initGenerated(root)
	return root
}

// initGenerated attaches the `help` and `completion` subtrees cobra would
// otherwise only add part-way through Execute. Both trees under comparison need
// them: the shipped one so the walk covers the generated pages, the pristine one
// so Find can resolve them — and the root's own "Available Commands:" block lists
// them, so a tree missing them does not even render the same root page.
func initGenerated(c *cobra.Command) {
	c.InitDefaultHelpCmd()
	c.InitDefaultCompletionCmd()
}

// walk yields every command in the tree, including cobra's generated `help` and
// `completion` subtrees — they inherit the renderer too, so they are part of the
// contract. Cobra only attaches those two during Execute, so they are forced in
// first; without that the walk quietly covers 15 commands instead of 22 and the
// generated pages — the ones no constructor in this repo can be inspected for —
// go untested.
func walk(c *cobra.Command) []*cobra.Command {
	initGenerated(c)
	return descend(c)
}

func descend(c *cobra.Command) []*cobra.Command {
	out := []*cobra.Command{c}
	for _, sub := range c.Commands() {
		out = append(out, descend(sub)...)
	}
	return out
}

var reSGR = regexp.MustCompile("\x1b\\[[0-9;]*m")

// coloredTree is the real command tree with the real renderer installed, except
// that the palette is forced ON instead of sniffed from the stream.
//
// A unit test has no PTY, and off a terminal a rendered page is byte-identical to
// cobra's by design — so without this, "the renderer ran" and "the renderer is
// still installed" are both unfalsifiable. Only the color DECISION is stubbed: the
// options themselves come from the shipped helpOptions, so a page here is exactly
// what a terminal gets — including its column budget, which is why
// TestColorIsPurelyAdditive can police that budget at all. help, usage, plainHelp
// and plainUsage are the shipped code too.
// TestNoColorAndDumbTerminalStayPlain covers the decision itself.
func coloredTree(t *testing.T) *cobra.Command {
	t.Helper()
	root := newRootCmd()
	r := &helpRenderer{root: root, opts: func(io.Writer) help.Options {
		return helpOptions(true)
	}}
	root.SetHelpFunc(r.help)
	root.SetUsageFunc(r.usage)
	initGenerated(root)
	return root
}

// helpOf captures one command's help page by path, so the renderer-installed tree
// and the pristine tree are asked for the SAME page.
func helpOf(t *testing.T, root *cobra.Command, path []string) string {
	t.Helper()
	var buf bytes.Buffer
	root.SetOut(&buf)
	root.SetErr(&buf)
	root.SetArgs(append(append([]string{}, path...), "--help"))
	if err := root.Execute(); err != nil {
		t.Fatalf("%v --help: %v", path, err)
	}
	return buf.String()
}

// TestHelpIsByteIdenticalToCobraOffATerminal is the acceptance criterion that
// makes this change safe to ship: `stark <anything> --help` piped, redirected or
// captured emits exactly the bytes cobra emitted before the renderer existed.
//
// It is also the only thing pinning plainHelp's copy of cobra's unexported
// defaultHelpFunc. If a cobra upgrade reshapes that page — or someone edits the
// composition here — every command in the tree reddens at once, naming the drift.
//
// The comparison is per command, not one root page, because the two shapes
// differ: root has subcommands and no flags of its own, a leaf has flags and no
// subcommands, and `completion` has both.
func TestHelpIsByteIdenticalToCobraOffATerminal(t *testing.T) {
	t.Setenv("NO_COLOR", "")
	t.Setenv("COLUMNS", "")

	var paths [][]string
	for _, c := range walk(newRootCmd()) {
		// CommandPath is "stark build"; drop the binary to get the argv path.
		paths = append(paths, strings.Fields(c.CommandPath())[1:])
	}
	if len(paths) < 16 {
		t.Fatalf("walked %d commands — fewer than the 1 root + 14 subcommands stark ships plus cobra's generated ones, so this proved nothing", len(paths))
	}

	for _, path := range paths {
		name := "stark " + strings.Join(path, " ")
		t.Run(name, func(t *testing.T) {
			got := helpOf(t, newRootCmd(), path)
			want := helpOf(t, pristine(t), path)
			if got != want {
				t.Errorf("%s --help is not byte-identical off a terminal:\n got: %q\nwant: %q", name, got, want)
			}
			if got == "" {
				t.Errorf("%s --help emitted nothing", name)
			}
		})
	}
}

// TestUsageIsByteIdenticalToCobraOffATerminal is the same contract for the usage
// page. `stark help <unknown-topic>` reaches it through Root().Usage(), so it is
// a live surface and not only an internal of the help page.
//
// Restoration of the root's usage func is NOT what this test proves — off a
// terminal a restored renderer and cobra's bare default emit the same bytes, so
// the comparison cannot tell them apart. TestPlainUsageRestoresTheRootsUsageFunc
// does that, with the palette forced on.
func TestUsageIsByteIdenticalToCobraOffATerminal(t *testing.T) {
	root := newRootCmd()
	for _, c := range walk(root) {
		name := c.CommandPath()
		t.Run(name, func(t *testing.T) {
			var got bytes.Buffer
			c.SetOut(&got)
			if err := c.Usage(); err != nil {
				t.Fatalf("Usage(): %v", err)
			}
			// Same command on a pristine tree, found by path.
			p := pristine(t)
			target, _, err := p.Find(strings.Fields(name)[1:])
			if err != nil {
				t.Fatalf("find %q on the pristine tree: %v", name, err)
			}
			var want bytes.Buffer
			target.SetOut(&want)
			if err := target.Usage(); err != nil {
				t.Fatalf("pristine Usage(): %v", err)
			}
			if got.String() != want.String() {
				t.Errorf("%s: usage is not byte-identical off a terminal:\n got: %q\nwant: %q", name, got.String(), want.String())
			}
		})
	}
}

// TestPlainUsageRestoresTheRootsUsageFunc pins the `defer` in plainUsage.
//
// plainUsage clears the root's usage func to escape its own recursion, so if it
// failed to put it back, every page rendered after the first would silently fall
// through to cobra's bare default — the whole fleet look gone from the second
// page onward, in a process that still exits 0. Off a terminal that is invisible,
// which is why this runs with the palette forced on: render a page (which goes
// through plainUsage and therefore through the clear/restore), then render
// another and require it to still be colorized.
func TestPlainUsageRestoresTheRootsUsageFunc(t *testing.T) {
	root := coloredTree(t)

	// First page: goes through help -> plainHelp -> plainUsage's clear/restore.
	if first := helpOf(t, root, nil); !strings.Contains(first, "\x1b[") {
		t.Fatalf("the first page is not colorized — the fixture is wrong, not the restore: %q", first)
	}
	// Second page on the SAME tree: only reaches the renderer if the defer ran.
	var second bytes.Buffer
	root.SetOut(&second)
	if err := root.Usage(); err != nil {
		t.Fatalf("Usage(): %v", err)
	}
	if !strings.Contains(second.String(), "\x1b[") {
		t.Errorf("usage after a help render is plain — plainUsage cleared the root's usage func and never restored it:\n%q", second.String())
	}
}

// TestUnknownHelpTopicDoesNotRecurse pins the reason plainUsage clears the func
// on the ROOT rather than on the command being rendered. `stark help bogus` is
// the one path where cobra calls Usage() on its own; with the naive override it
// re-enters the renderer and never returns. A hang here IS the failure — the
// test binary's own timeout reports it.
func TestUnknownHelpTopicDoesNotRecurse(t *testing.T) {
	root := newRootCmd()
	var buf bytes.Buffer
	root.SetOut(&buf)
	root.SetErr(&buf)
	root.SetArgs([]string{"help", "no-such-topic"})
	if err := root.Execute(); err != nil {
		t.Fatalf("help no-such-topic: %v", err)
	}
	out := buf.String()
	if !strings.Contains(out, "Unknown help topic") {
		t.Errorf("expected the unknown-topic error, got %q", out)
	}
	if !strings.Contains(out, "Usage:") {
		t.Errorf("expected the root usage page after the error, got %q", out)
	}
}

// TestHelpRendersTheFleetLookOnATerminal is the other half of the acceptance
// criterion: off a terminal the bytes are cobra's, ON one they carry the fleet
// palette. It drives the real SetHelpFunc seam end to end through Execute, with
// only the color decision forced, so a seam that stopped calling the renderer
// fails here.
//
// The assertions are the roles the ticket names, checked as SGR sequences on the
// specific text they must land on — a bare "output contains an escape" would pass
// on any colorizer at all.
func TestHelpRendersTheFleetLookOnATerminal(t *testing.T) {
	got := helpOf(t, coloredTree(t), nil)

	for _, want := range []struct{ what, seq string }{
		// Rule 1: the title's binary name is bold cyan, its tagline plain.
		{"bold-cyan title", "\x1b[1m\x1b[36mstark\x1b[39m\x1b[22m — the Bifröst marketplace engine"},
		// Rule 2: the "Usage:" label is bold magenta.
		{"bold-magenta Usage: label", "\x1b[1m\x1b[35mUsage:\x1b[39m\x1b[22m"},
		// Rule 3: a section heading is bold magenta.
		{"bold-magenta section heading", "\x1b[1m\x1b[35mAvailable Commands:\x1b[39m\x1b[22m"},
		// Rule 5: a command name is cyan, a flag green.
		{"cyan command name", "\x1b[36mbuild\x1b[39m"},
		{"green flag", "\x1b[32m--help\x1b[39m"},
	} {
		if !strings.Contains(got, want.seq) {
			t.Errorf("%s missing from the rendered page: want %q in\n%q", want.what, want.seq, got)
		}
	}
}

// TestColorIsPurelyAdditive pins the invariant the whole design rests on: the
// renderer only ADDS escapes. Strip them back out and the page is the authored
// one, character for character — so no `stark --help` ever loses, reorders or
// RE-WRAPS a word, whatever the palette does.
//
// It walks the whole tree rather than a handful of paths because the shapes
// differ: only some commands have subcommands, only some have flags, and the
// generated `help`/`completion` pages are the ones no constructor here can be
// read for. The budget itself is policed by TestHelpIsNeverColumnFitted, not
// here — both sides of this comparison go through helpOptions, so a budget
// applied to both would cancel out.
func TestColorIsPurelyAdditive(t *testing.T) {
	for _, c := range walk(newRootCmd()) {
		path := strings.Fields(c.CommandPath())[1:]
		name := "stark " + strings.Join(path, " ")
		t.Run(name, func(t *testing.T) {
			page := helpOf(t, newRootCmd(), path)
			stripped := reSGR.ReplaceAllString(helpOf(t, coloredTree(t), path), "")
			if stripped != page {
				t.Errorf("%s: stripping SGR from the colored page does not return the plain one:\n got: %q\nwant: %q", name, stripped, page)
			}
		})
	}
}

// TestHelpIsNeverColumnFitted states the budget decision on its own, so a change
// to it fails with its reason attached instead of only as a pile of diffs in
// TestColorIsPurelyAdditive.
//
// Zero means "keep the authored layout verbatim". Cobra and pflag have already
// laid the page out and aligned its columns; a second pass can only disagree with
// them — see helpOptions and TestColumnFittingWouldGarbleCobrasFlagBlock.
func TestHelpIsNeverColumnFitted(t *testing.T) {
	for _, colorize := range []bool{false, true} {
		if got := helpOptions(colorize).Columns; got != 0 {
			t.Errorf("helpOptions(%v).Columns = %d, want 0 — cobra already laid this page out", colorize, got)
		}
	}
	if got := optionsFor(os.Stdout).Columns; got != 0 {
		t.Errorf("optionsFor(os.Stdout).Columns = %d, want 0", got)
	}
}

// TestColumnFittingWouldGarbleCobrasFlagBlock is the tripwire under helpOptions'
// zero budget: it pins the upstream behavior that forces the choice, so the day
// the snapshot is refreshed past a fix, this test — not a user — reports it.
//
// help.Render folds any 4+-space-indented line into the item row above it, which
// is correct for a hand-wrapped page. pflag prints a flag WITHOUT a shorthand at a
// 6-space indent and `-h, --help` at two, so every long-only flag after `--help`
// reads as a continuation of it. At 80 columns `stark install --help` lost eight
// rows into one.
func TestColumnFittingWouldGarbleCobrasFlagBlock(t *testing.T) {
	const row = "\n      --index string"
	page := helpOf(t, newRootCmd(), []string{"install"})
	if !strings.Contains(page, row) {
		t.Fatalf("fixture drifted — `stark install --help` no longer prints %q on its own line:\n%s", strings.TrimSpace(row), page)
	}
	fitted := help.Render(page, help.Options{Colors: colors.New(false), Columns: 80, Binary: binaryName})
	if strings.Contains(fitted, row) {
		t.Errorf("the snapshot now keeps pflag's 6-space flag rows on their own line under a column budget.\n" +
			"The upstream continuation rule was fixed: helpOptions can go back to help.For(f, binaryName), and this tripwire can be deleted.")
	}
}

// TestPlainHelpMirrorsCobraOnEmptyDescriptions covers the branch the shipped tree
// cannot reach: every stark command carries a real Short, so the byte-identity
// walk never asks what happens when a description is absent or only whitespace.
//
// That branch is exactly where cobra's own two definitions disagree —
// defaultHelpTemplate's `{{with (or .Long .Short)}}` tests the string BEFORE
// trimTrailingWhitespaces and emits a stray blank line, while defaultHelpFunc
// trims first and emits none. plainHelp has to copy the FUNC, because that is
// what runs: since v1.10 getHelpTemplateFunc returns defaultHelpFunc unless a
// command installs a template of its own. Comparing against the live HelpFunc()
// rather than against either source is what keeps that true across an upgrade.
func TestPlainHelpMirrorsCobraOnEmptyDescriptions(t *testing.T) {
	for _, tc := range []struct{ name, long, short string }{
		{"whitespace-only Long", "   \n\t ", ""},
		{"whitespace-only Short", "", "  "},
		{"no description at all", "", ""},
		{"trailing space on a real Long", "does a thing   ", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			mk := func() *cobra.Command {
				c := &cobra.Command{Use: "x", Long: tc.long, Short: tc.short, Run: func(*cobra.Command, []string) {}}
				c.InitDefaultHelpFlag()
				return c
			}
			c := mk()
			got := (&helpRenderer{root: c}).plainHelp(c)

			p := mk()
			var want bytes.Buffer
			p.SetOut(&want)
			p.SetErr(&want)
			p.HelpFunc()(p, nil)

			if got != want.String() {
				t.Errorf("plainHelp diverges from cobra's default help func:\n got: %q\nwant: %q", got, want.String())
			}
		})
	}
}

// TestBinaryNameMatchesTheRootCommand pins the one coupling optionsFor cannot see:
// help.Options.Binary is the token that marks an example line, and it is a const
// here while the command's name lives in newRootCmd. Rename one without the other
// and example lines silently stop being recognised — no page changes shape, so
// nothing else in this file would notice.
func TestBinaryNameMatchesTheRootCommand(t *testing.T) {
	if got := newRootCmd().Name(); got != binaryName {
		t.Errorf("root command name = %q, binaryName = %q — they must agree", got, binaryName)
	}
}

// TestNoColorAndDumbTerminalStayPlain pins the two explicit opt-outs on the real
// seam — optionsFor -> help.For -> ColorEnabled — rather than on the renderer in
// isolation, so a seam that forgot to consult the environment is caught here.
// os.Stdout stands in for a stream the detector could otherwise say yes to.
func TestNoColorAndDumbTerminalStayPlain(t *testing.T) {
	for _, tc := range []struct{ name, key, value string }{
		{"NO_COLOR", "NO_COLOR", "1"},
		{"TERM=dumb", "TERM", "dumb"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(tc.key, tc.value)
			if opt := optionsFor(os.Stdout); opt.Colors.Bold("x") != "x" {
				t.Errorf("%s must disable the palette, got %q", tc.name, opt.Colors.Bold("x"))
			}
		})
	}
}

// TestOptionsForANonFileWriterIsPlain pins the fallback that makes every test and
// every `| cat` in this repo deterministic: anything that is not an *os.File
// cannot be a terminal, so it gets the identity palette and no column budget.
func TestOptionsForANonFileWriterIsPlain(t *testing.T) {
	opt := optionsFor(&bytes.Buffer{})
	if opt.Colors.Bold("x") != "x" {
		t.Errorf("a non-file writer must get a disabled palette, got %q", opt.Colors.Bold("x"))
	}
	if opt.Columns != 0 {
		t.Errorf("a non-file writer must get no column budget, got %d", opt.Columns)
	}
	if opt.Binary != binaryName {
		t.Errorf("Binary = %q, want %q — example lines would stop being recognised", opt.Binary, binaryName)
	}
}
