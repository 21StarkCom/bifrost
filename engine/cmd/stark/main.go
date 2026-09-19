package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

func main() {
	if err := newRootCmd().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		if ec, ok := err.(interface{ ExitCode() int }); ok {
			os.Exit(ec.ExitCode())
		}
		os.Exit(1)
	}
}

// newRootCmd builds the whole command tree, help rendering included, so there is
// exactly one way to get a wired `stark` and no entry point can forget the look.
//
// A test that wants cobra's OWN default page back calls SetHelpFunc(nil) +
// SetUsageFunc(nil) on the returned root — cobra falls back to its defaults when
// the field is nil, which is how help_test.go gets a pristine baseline to compare
// against without a second constructor drifting from this one.
func newRootCmd() *cobra.Command {
	root := &cobra.Command{
		Use: "stark",
		// The title line of every `stark --help`. The " — " is what rule 1 of the
		// fleet help look splits on to paint the binary name bold cyan, so the
		// separator is load-bearing, not typography: an ASCII hyphen renders the
		// whole line as an untitled bold string (see installHelpRendering).
		Long:          "stark — the Bifröst marketplace engine",
		Short:         "stark-marketplace CLI",
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	root.AddCommand(newValidateCmd())
	root.AddCommand(newLintCmd())
	root.AddCommand(newAllowlistCmd())
	root.AddCommand(newVerifyManifestCmd())
	root.AddCommand(newImportCmd())
	root.AddCommand(newSyncCmd())
	root.AddCommand(newBuildCmd())
	root.AddCommand(newCheckBumpsCmd())
	root.AddCommand(newSearchCmd())
	root.AddCommand(newInfoCmd())
	root.AddCommand(newInstallCmd(realAdapter))
	root.AddCommand(newDoctorCmd())
	root.AddCommand(newVersionCmd())
	root.AddCommand(newSelfUpdateCmd())
	installHelpRendering(root)
	return root
}
