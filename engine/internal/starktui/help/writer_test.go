package help

import (
	"bytes"
	"fmt"
	"testing"

	"github.com/21StarkCom/bifrost/engine/internal/starktui/colors"
)

func TestWriterRendersTheWholePageOnClose(t *testing.T) {
	var buf bytes.Buffer
	w := Writer(&buf, Options{Colors: colors.New(true), Binary: "frigg"})
	fmt.Fprintln(w, "frigg — IT-ops CLI")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Commands:")
	fmt.Fprintln(w, "  ga4   read-only GA4")
	if buf.Len() != 0 {
		t.Fatalf("writer leaked bytes before Close: %q", buf.String())
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	got := buf.String()
	want := Render("frigg — IT-ops CLI\n\nCommands:\n  ga4   read-only GA4\n", Options{Colors: colors.New(true), Binary: "frigg"})
	if got != want {
		t.Fatalf("writer output\ngot  %q\nwant %q", got, want)
	}
	// A second Close is a no-op, not a double write.
	if err := w.Close(); err != nil || buf.String() != got {
		t.Fatalf("second Close changed the output: %v %q", err, buf.String())
	}
}

func TestWriterWithADisabledPaletteIsPassThrough(t *testing.T) {
	var buf bytes.Buffer
	w := Writer(&buf, Options{})
	raw := "usage: frigg ga4 <verb>\n\nCommands:\n  list  list them\n"
	fmt.Fprint(w, raw)
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if buf.String() != raw {
		t.Fatalf("pass-through changed the text:\n%q", buf.String())
	}
}
