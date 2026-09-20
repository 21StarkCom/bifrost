package main

import (
	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// Run after pflag parses (and rejects malformed flags), before argument
// validation or any command hook. Flag values are already removed; -- marks
// literal data. Search owns a free-text query, so its positional help is data.
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
