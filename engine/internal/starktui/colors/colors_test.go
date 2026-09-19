package colors

import "testing"

func TestStyledCodes(t *testing.T) {
	c := New(true)
	cases := []struct {
		name string
		got  string
		want string
	}{
		{"red", c.Red("x"), "\x1b[31mx\x1b[39m"},
		{"bold", c.Bold("x"), "\x1b[1mx\x1b[22m"},
		{"bgBlue", c.BgBlue("x"), "\x1b[44mx\x1b[49m"},
		{"gray", c.Gray("x"), "\x1b[90mx\x1b[39m"},
		{"redBright", c.RedBright("x"), "\x1b[91mx\x1b[39m"},
	}
	for _, tc := range cases {
		if tc.got != tc.want {
			t.Errorf("%s = %q, want %q", tc.name, tc.got, tc.want)
		}
	}
}

func TestDisabledIsPlain(t *testing.T) {
	c := New(false)
	if got := c.Red("x"); got != "x" {
		t.Errorf("disabled Red = %q, want %q", got, "x")
	}
	if got := c.Bold("x"); got != "x" {
		t.Errorf("disabled Bold = %q, want %q", got, "x")
	}
	if got := c.Hex("#ff8800", "x"); got != "x" {
		t.Errorf("disabled Hex = %q, want %q", got, "x")
	}
	if got := c.Rgb(255, 136, 0, "x"); got != "x" {
		t.Errorf("disabled Rgb = %q, want %q", got, "x")
	}
	if c.Enabled {
		t.Error("New(false).Enabled = true, want false")
	}
}

func TestNestedRestore(t *testing.T) {
	c := New(true)
	// green's close (39m) is replaced with red's reopen so "c" stays red.
	got := c.Red("a" + c.Green("b") + "c")
	want := "\x1b[31ma\x1b[32mb\x1b[31mc\x1b[39m"
	if got != want {
		t.Errorf("nested = %q, want %q", got, want)
	}
}

func TestBoldDimSharedClose(t *testing.T) {
	c := New(true)
	// dim's close (22m) also closes bold; the reopen re-arms bold.
	got := c.Bold("a" + c.Dim("b") + "c")
	want := "\x1b[1ma\x1b[2mb\x1b[22m\x1b[1mc\x1b[22m"
	if got != want {
		t.Errorf("bold/dim = %q, want %q", got, want)
	}
}

func TestMultiline(t *testing.T) {
	c := New(true)
	if got, want := c.Red("a\nb"), "\x1b[31ma\x1b[39m\n\x1b[31mb\x1b[39m"; got != want {
		t.Errorf("LF = %q, want %q", got, want)
	}
	if got, want := c.Red("a\r\nb"), "\x1b[31ma\x1b[39m\r\n\x1b[31mb\x1b[39m"; got != want {
		t.Errorf("CRLF = %q, want %q", got, want)
	}
}

func TestTruecolor(t *testing.T) {
	c := New(true)
	if got, want := c.Hex("#ff8800", "x"), "\x1b[38;2;255;136;0mx\x1b[39m"; got != want {
		t.Errorf("Hex = %q, want %q", got, want)
	}
	if got, want := c.Hex("#f80", "x"), "\x1b[38;2;255;136;0mx\x1b[39m"; got != want {
		t.Errorf("Hex 3-digit = %q, want %q", got, want)
	}
	if got, want := c.Rgb(255, 136, 0, "x"), "\x1b[38;2;255;136;0mx\x1b[39m"; got != want {
		t.Errorf("Rgb = %q, want %q", got, want)
	}
	if got, want := c.BgHex("#ff8800", "x"), "\x1b[48;2;255;136;0mx\x1b[49m"; got != want {
		t.Errorf("BgHex = %q, want %q", got, want)
	}
}

func TestHexToRgb(t *testing.T) {
	cases := []struct {
		in      string
		r, g, b uint8
	}{
		{"#ff8800", 255, 136, 0},
		{"ff8800", 255, 136, 0},
		{"#f80", 255, 136, 0},
		{"#000000", 0, 0, 0},
		{"#ffffff", 255, 255, 255},
	}
	for _, tc := range cases {
		r, g, b := hexToRgb(tc.in)
		if r != tc.r || g != tc.g || b != tc.b {
			t.Errorf("hexToRgb(%q) = %d,%d,%d, want %d,%d,%d", tc.in, r, g, b, tc.r, tc.g, tc.b)
		}
	}
}

func TestDetectDoesNotPanic(t *testing.T) {
	_ = detect() // exercised for the -race build; value depends on env.
}
