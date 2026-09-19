package main

import (
	"io"
	"os"
	"strings"
	"unicode"

	"github.com/spf13/cobra"

	"github.com/21StarkCom/bifrost/engine/internal/starktui/help"
)

// binaryName marks an example line inside an "Examples:" section. Nothing else
// keys off it.
const binaryName = "stark"

// installHelpRendering makes every help and usage page in the tree render in the
// shared 21Stark fleet look (STARK-6770, epic STARK-7636): bold-cyan title, bold-
// magenta "Usage:" and section headings, cyan command names, green --flags,
// yellow <args>. The rules live in internal/starktui/help, a snapshot of the
// fleet's shared renderer — see that package's README for why bifrost carries a
// copy instead of importing the module.
//
// Why a func and not a template: cobra OWNS its help and usage templates, and a
// template can only interleave text, never look at a rendered line and decide
// what it is. The colorizer is line-based and needs the FINISHED page, so the
// seam has to be SetHelpFunc/SetUsageFunc — render last, over cobra's own bytes.
//
// The help TEXT is untouched: every Short, Long and flag usage in this repo stays
// a plain authored string, and off a terminal the page comes back byte for byte
// as cobra wrote it (help.Render with a disabled palette and no column budget is
// an exact identity transform). That equivalence is pinned command-by-command
// against a pristine cobra tree in help_test.go.
//
// Set on the ROOT only: Command.HelpFunc and Command.UsageFunc walk up to the
// parent when a command owns none, so all 14 subcommands, `stark help <cmd>` and
// cobra's generated `completion` tree inherit this without touching their
// constructors.
func installHelpRendering(root *cobra.Command) {
	r := &helpRenderer{root: root, opts: optionsFor}
	root.SetHelpFunc(r.help)
	root.SetUsageFunc(r.usage)
}

type helpRenderer struct {
	root *cobra.Command
	// opts picks the palette and column budget for the stream a page is going
	// to. A field rather than a direct optionsFor call so a test can force the
	// palette ON: off a terminal a rendered page and cobra's own are identical
	// by design, which makes every "did the renderer actually run, and is it
	// still installed?" assertion vacuous unless the colors can be seen.
	opts func(io.Writer) help.Options
}

// help renders a full help page: `stark --help`, `stark <cmd> -h`,
// `stark help <cmd>`, and a bare `stark` (cobra routes a non-runnable command to
// HelpFunc). Cobra sends help to stdout.
func (r *helpRenderer) help(c *cobra.Command, _ []string) {
	w := c.OutOrStdout()
	if _, err := io.WriteString(w, help.Render(r.plainHelp(c), r.opts(w))); err != nil {
		c.PrintErrln(err)
	}
}

// usage renders a standalone usage page. The live surface is
// `stark help <unknown-topic>`, where cobra prints the topic error and then calls
// Root().Usage() directly.
//
// The writer is OutOrStderr, matching cobra's own usage func exactly. Despite the
// name that is the OUT chain with os.Stderr merely as its fallback, so a caller
// who redirected only stdout still sees usage land there — swapping in
// ErrOrStderr would silently move the page to a different stream.
func (r *helpRenderer) usage(c *cobra.Command) error {
	w := c.OutOrStderr()
	_, err := io.WriteString(w, help.Render(r.plainUsage(c), r.opts(w)))
	return err
}

// plainHelp composes cobra's own help page, unrendered.
//
// It mirrors cobra's unexported defaultHelpFunc (command.go), which cobra
// documents as the exact equivalent of its default help template: the long
// description (falling back to the short one) with trailing space trimmed, a
// blank line, then the usage page. Reimplementing those few lines is what lets
// the colorizer see one finished page — capturing cobra's own output instead
// would mean pointing the command's writers at a buffer, and SetOut/SetErr
// cannot restore the previous value (the fields are unexported, and the
// "previous value" is usually inheritance from the parent, not a writer).
//
// The copy cannot drift silently: help_test.go renders every command in the tree
// with color off and asserts the bytes equal a pristine cobra tree's page.
func (r *helpRenderer) plainHelp(c *cobra.Command) string {
	var b strings.Builder
	long := c.Long
	if long == "" {
		long = c.Short
	}
	if long = strings.TrimRightFunc(long, unicode.IsSpace); long != "" {
		b.WriteString(long)
		b.WriteString("\n\n")
	}
	if c.Runnable() || c.HasSubCommands() {
		b.WriteString(r.plainUsage(c))
	}
	return b.String()
}

// plainUsage returns cobra's own usage page for c, UNRENDERED.
//
// c.UsageString() is the only public API that captures that page without
// mutating the command's writers — it saves and restores the unexported fields
// directly, which SetOut/SetErr cannot. But it gets there via c.Usage(), which
// would re-enter the func installed above: unbounded recursion out of usage(),
// and a page painted twice out of help(). Clearing the func for the duration
// makes UsageFunc()'s parent walk land on cobra's default instead.
//
// On the ROOT, not on c: that walk only stops at a command owning a func, and
// installHelpRendering sets one on the root alone — clearing c would still find
// the root's on the way up. Help runs on one goroutine, before any command body,
// so the window is never shared.
func (r *helpRenderer) plainUsage(c *cobra.Command) string {
	r.root.SetUsageFunc(nil)
	defer r.root.SetUsageFunc(r.usage)
	return c.UsageString()
}

// optionsFor picks the palette and column budget for the stream the page is
// going to, per call — a redirected stream is then seen correctly.
//
// A writer that is not an *os.File (a test buffer, or cobra's own UsageString
// buffer) yields a nil file, which help.For reads as "not a terminal": no color,
// no reflow, identity. That is the same answer a pipe gets, so `stark --help |
// cat`, `NO_COLOR=1 stark --help` and a test all see the authored bytes.
func optionsFor(w io.Writer) help.Options {
	f, _ := w.(*os.File)
	return help.For(f, binaryName)
}
