package main

import (
	"bytes"
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

// renderForTest renders page through the same Render call the seam makes, with
// the palette forced on. A unit test has no PTY, and whether the stream is one is
// the single thing optionsFor asks the terminal — so forcing it here tests the
// rules, and TestNoColorAndDumbTerminalStayPlain tests the asking.
func renderForTest(t *testing.T, page string) string {
	t.Helper()
	return help.Render(page, help.Options{Colors: colors.New(true), Binary: binaryName})
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
// It also proves plainUsage's root-clearing window actually restores: a second
// call has to render the same page as the first, and cobra's own tree has to
// still agree with it.
func TestUsageIsByteIdenticalToCobraOffATerminal(t *testing.T) {
	root := newRootCmd()
	for _, c := range walk(root) {
		name := c.CommandPath()
		t.Run(name, func(t *testing.T) {
			var got, again bytes.Buffer
			c.SetOut(&got)
			if err := c.Usage(); err != nil {
				t.Fatalf("Usage(): %v", err)
			}
			c.SetOut(&again)
			if err := c.Usage(); err != nil {
				t.Fatalf("second Usage(): %v", err)
			}
			if got.String() != again.String() {
				t.Errorf("%s: usage differs between calls — plainUsage did not restore the root's usage func", name)
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
// palette. A real PTY is not available here, so the render is driven through the
// same help.Render call the seam makes, with the palette forced on.
//
// The assertions are the roles the ticket names, checked as SGR sequences on the
// specific text they must land on — a bare "output contains an escape" would pass
// on any colorizer at all.
func TestHelpRendersTheFleetLookOnATerminal(t *testing.T) {
	page := helpOf(t, newRootCmd(), nil)
	got := renderForTest(t, page)

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
// one, character for character — so no `stark --help` ever loses or reorders a
// word, whatever the palette does.
func TestColorIsPurelyAdditive(t *testing.T) {
	for _, path := range [][]string{nil, {"build"}, {"install"}, {"sync"}, {"completion"}} {
		name := "stark " + strings.Join(path, " ")
		t.Run(name, func(t *testing.T) {
			page := helpOf(t, newRootCmd(), path)
			stripped := reSGR.ReplaceAllString(renderForTest(t, page), "")
			if stripped != page {
				t.Errorf("%s: stripping SGR from the colored page does not return the plain one:\n got: %q\nwant: %q", name, stripped, page)
			}
		})
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
