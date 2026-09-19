package colors

import (
	"fmt"
	"os"
	"regexp"
	"runtime"
	"strconv"
	"strings"
)

// Styler wraps its input in an SGR open/close pair.
type Styler func(string) string

var reNewline = regexp.MustCompile(`\r?\n`)

// applyStyle wraps s in open/close, restoring the parent style where a nested
// child's close appears (nesting) and re-wrapping the style across each newline
// (multiline). A disabled palette returns s unchanged.
func applyStyle(enabled bool, open, close, reopen, s string) string {
	if !enabled {
		return s
	}
	if reopen != "" && strings.Contains(s, close) {
		s = strings.ReplaceAll(s, close, reopen)
	}
	if strings.IndexByte(s, '\n') >= 0 {
		s = reNewline.ReplaceAllString(s, close+"${0}"+open)
	}
	return open + s + close
}

var reHex = regexp.MustCompile(`(?i)[a-f0-9]{3,6}`)

// hexToRgb converts a 3- or 6-digit hex color (optional '#') to r, g, b.
// Ported from ansis; invalid lengths fall back to black.
func hexToRgb(value string) (uint8, uint8, uint8) {
	match := reHex.FindString(value)
	var hex string
	switch len(match) {
	case 6:
		hex = match
	case 3:
		hex = string([]byte{match[0], match[0], match[1], match[1], match[2], match[2]})
	default:
		hex = "000000"
	}
	n, _ := strconv.ParseInt(hex, 16, 32)
	return uint8(n >> 16), uint8(n >> 8), uint8(n)
}

// isTTY reports whether f is a character device (a real terminal). Stdlib-only:
// os.File.Stat + os.ModeCharDevice, no golang.org/x/term.
func isTTY(f *os.File) bool {
	fi, err := f.Stat()
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeCharDevice != 0
}

var (
	reColorOn  = regexp.MustCompile(`^--color(=(true|always))?$`)
	reColorOff = regexp.MustCompile(`^--(no-color|color=(false|never))$`)
)

// detect resolves color support to a single on/off bit via the ansis precedence
// ladder: FORCE_COLOR > CLI flags > NO_COLOR > auto-detect.
func detect() bool {
	auto := runtime.GOOS == "windows" ||
		(isTTY(os.Stdout) && os.Getenv("TERM") != "dumb")
	if _, ok := os.LookupEnv("CI"); ok {
		auto = true
	}

	// 1) FORCE_COLOR wins. false/0 disable; any other presence enables.
	if fc, ok := os.LookupEnv("FORCE_COLOR"); ok {
		return !(fc == "false" || fc == "0")
	}

	// 2) CLI flags override NO_COLOR (last flag wins).
	flag := -1
	for _, v := range os.Args {
		if reColorOn.MatchString(v) {
			flag = 1
		} else if reColorOff.MatchString(v) {
			flag = 0
		}
	}
	if flag == 1 {
		return true
	}
	if flag == 0 {
		return false
	}

	// 3) NO_COLOR disables when non-empty (empty string has no effect).
	if os.Getenv("NO_COLOR") != "" {
		return false
	}

	// 4) Auto-detected.
	return auto
}

// Colors is a palette of stylers. Build one with New; the package-level funcs
// are bound to New(detected).
type Colors struct {
	Enabled bool

	Reset, Bold, Dim, Italic, Underline, Inverse, Hidden, Strikethrough Styler

	Black, Red, Green, Yellow, Blue, Magenta, Cyan, White, Gray Styler

	BgBlack, BgRed, BgGreen, BgYellow, BgBlue, BgMagenta, BgCyan, BgWhite Styler

	BlackBright, RedBright, GreenBright, YellowBright,
	BlueBright, MagentaBright, CyanBright, WhiteBright Styler

	BgBlackBright, BgRedBright, BgGreenBright, BgYellowBright,
	BgBlueBright, BgMagentaBright, BgCyanBright, BgWhiteBright Styler

	// Hex/BgHex take a hex color; Rgb/BgRgb take components. Truecolor.
	Hex, BgHex func(hexColor, s string) string
	Rgb, BgRgb func(r, g, b uint8, s string) string
}

// New builds a palette. Pass an explicit enabled bit in tests so they never
// touch a real TTY.
func New(enabled bool) Colors {
	mk := func(open, close string) Styler {
		return func(s string) string { return applyStyle(enabled, open, close, open, s) }
	}
	// mk3 is for styles whose reopen differs from open (bold/dim share close 22m).
	mk3 := func(open, close, reopen string) Styler {
		return func(s string) string { return applyStyle(enabled, open, close, reopen, s) }
	}
	rgbFn := func(prefix string, close string) func(r, g, b uint8, s string) string {
		return func(r, g, b uint8, s string) string {
			open := fmt.Sprintf("\x1b[%s;2;%d;%d;%dm", prefix, r, g, b)
			return applyStyle(enabled, open, close, open, s)
		}
	}
	rgb := rgbFn("38", "\x1b[39m")
	bgRgb := rgbFn("48", "\x1b[49m")

	return Colors{
		Enabled: enabled,

		Reset:         mk("\x1b[0m", "\x1b[0m"),
		Bold:          mk3("\x1b[1m", "\x1b[22m", "\x1b[22m\x1b[1m"),
		Dim:           mk3("\x1b[2m", "\x1b[22m", "\x1b[22m\x1b[2m"),
		Italic:        mk("\x1b[3m", "\x1b[23m"),
		Underline:     mk("\x1b[4m", "\x1b[24m"),
		Inverse:       mk("\x1b[7m", "\x1b[27m"),
		Hidden:        mk("\x1b[8m", "\x1b[28m"),
		Strikethrough: mk("\x1b[9m", "\x1b[29m"),

		Black:   mk("\x1b[30m", "\x1b[39m"),
		Red:     mk("\x1b[31m", "\x1b[39m"),
		Green:   mk("\x1b[32m", "\x1b[39m"),
		Yellow:  mk("\x1b[33m", "\x1b[39m"),
		Blue:    mk("\x1b[34m", "\x1b[39m"),
		Magenta: mk("\x1b[35m", "\x1b[39m"),
		Cyan:    mk("\x1b[36m", "\x1b[39m"),
		White:   mk("\x1b[37m", "\x1b[39m"),
		Gray:    mk("\x1b[90m", "\x1b[39m"),

		BgBlack:   mk("\x1b[40m", "\x1b[49m"),
		BgRed:     mk("\x1b[41m", "\x1b[49m"),
		BgGreen:   mk("\x1b[42m", "\x1b[49m"),
		BgYellow:  mk("\x1b[43m", "\x1b[49m"),
		BgBlue:    mk("\x1b[44m", "\x1b[49m"),
		BgMagenta: mk("\x1b[45m", "\x1b[49m"),
		BgCyan:    mk("\x1b[46m", "\x1b[49m"),
		BgWhite:   mk("\x1b[47m", "\x1b[49m"),

		BlackBright:   mk("\x1b[90m", "\x1b[39m"),
		RedBright:     mk("\x1b[91m", "\x1b[39m"),
		GreenBright:   mk("\x1b[92m", "\x1b[39m"),
		YellowBright:  mk("\x1b[93m", "\x1b[39m"),
		BlueBright:    mk("\x1b[94m", "\x1b[39m"),
		MagentaBright: mk("\x1b[95m", "\x1b[39m"),
		CyanBright:    mk("\x1b[96m", "\x1b[39m"),
		WhiteBright:   mk("\x1b[97m", "\x1b[39m"),

		BgBlackBright:   mk("\x1b[100m", "\x1b[49m"),
		BgRedBright:     mk("\x1b[101m", "\x1b[49m"),
		BgGreenBright:   mk("\x1b[102m", "\x1b[49m"),
		BgYellowBright:  mk("\x1b[103m", "\x1b[49m"),
		BgBlueBright:    mk("\x1b[104m", "\x1b[49m"),
		BgMagentaBright: mk("\x1b[105m", "\x1b[49m"),
		BgCyanBright:    mk("\x1b[106m", "\x1b[49m"),
		BgWhiteBright:   mk("\x1b[107m", "\x1b[49m"),

		Hex:   func(hexColor, s string) string { r, g, b := hexToRgb(hexColor); return rgb(r, g, b, s) },
		BgHex: func(hexColor, s string) string { r, g, b := hexToRgb(hexColor); return bgRgb(r, g, b, s) },
		Rgb:   rgb,
		BgRgb: bgRgb,
	}
}

// std is the package-default palette, detected once at init.
var std = New(detect())

// IsColorSupported reports whether the package-default palette emits color.
func IsColorSupported() bool { return std.Enabled }

// Package-level stylers, bound to the detected palette (flat function-map API).
var (
	Reset         = std.Reset
	Bold          = std.Bold
	Dim           = std.Dim
	Italic        = std.Italic
	Underline     = std.Underline
	Inverse       = std.Inverse
	Hidden        = std.Hidden
	Strikethrough = std.Strikethrough

	Black   = std.Black
	Red     = std.Red
	Green   = std.Green
	Yellow  = std.Yellow
	Blue    = std.Blue
	Magenta = std.Magenta
	Cyan    = std.Cyan
	White   = std.White
	Gray    = std.Gray

	BgBlack   = std.BgBlack
	BgRed     = std.BgRed
	BgGreen   = std.BgGreen
	BgYellow  = std.BgYellow
	BgBlue    = std.BgBlue
	BgMagenta = std.BgMagenta
	BgCyan    = std.BgCyan
	BgWhite   = std.BgWhite

	BlackBright   = std.BlackBright
	RedBright     = std.RedBright
	GreenBright   = std.GreenBright
	YellowBright  = std.YellowBright
	BlueBright    = std.BlueBright
	MagentaBright = std.MagentaBright
	CyanBright    = std.CyanBright
	WhiteBright   = std.WhiteBright

	BgBlackBright   = std.BgBlackBright
	BgRedBright     = std.BgRedBright
	BgGreenBright   = std.BgGreenBright
	BgYellowBright  = std.BgYellowBright
	BgBlueBright    = std.BgBlueBright
	BgMagentaBright = std.BgMagentaBright
	BgCyanBright    = std.BgCyanBright
	BgWhiteBright   = std.BgWhiteBright

	Hex   = std.Hex
	BgHex = std.BgHex
	Rgb   = std.Rgb
	BgRgb = std.BgRgb
)
