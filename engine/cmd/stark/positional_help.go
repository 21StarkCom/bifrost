package main

import (
	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// Run after pflag parses (and rejects malformed flags), before argument
// validation or any command hook. Flag values are already removed; -- marks
// literal data. Search owns a free-text query, so its positional help is data.
//
// Wrapping Command.Args is the seam because cobra calls ValidateArgs after
// ParseFlags and before PersistentPreRun/PreRun/Run, and returning pflag.ErrHelp
// from there is what cobra itself returns for --help: ExecuteC prints the route's
// help page and exits 0 without touching a handler.
//
// CALL ORDER MATTERS: this only guards commands that already exist on the tree.
// newRootCmd forces InitDefaultCompletionCmd first so the generated
// `completion <shell>` leaves are covered; cobra's `help` command and the hidden
// __complete protocol command are attached later by ExecuteC and stay unguarded
// on purpose — both take a positional that is a topic/argv, not a help request.
//
// Only runnable commands are wrapped. That is not just an optimisation: cobra's
// Find falls back to legacyArgs when Args is nil, which is what turns
// `stark bogus` into "unknown command" on the non-runnable root. Wrapping the
// root would replace that with arbitrary-args acceptance.
func installPositionalHelp(c *cobra.Command) {
	if c.Runnable() && c.Name() != "search" {
		validate := c.Args
		c.Args = func(cmd *cobra.Command, args []string) error {
			end := cmd.ArgsLenAtDash()
			if end < 0 {
				end = len(args)
			}
			for _, arg := range args[:end] {
				if arg == "help" {
					return pflag.ErrHelp
				}
			}
			if validate != nil {
				return validate(cmd, args)
			}
			return nil
		}
	}
	for _, child := range c.Commands() {
		installPositionalHelp(child)
	}
}
