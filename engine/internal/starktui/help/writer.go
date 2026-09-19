package help

import (
	"bytes"
	"io"
)

// Writer returns an io.WriteCloser that buffers everything written to it and,
// on Close, renders it through Render into w. It is the drop-in seam for a CLI
// whose help is printed line by line (fmt.Fprintln(w, …)): wrap the writer once
// at the top of the usage function and the authored text stays plain in source.
//
// Buffering until Close is deliberate — rule 1 (the title) and the
// examples-section state are properties of the whole page, not of one line.
func Writer(w io.Writer, opt Options) io.WriteCloser {
	return &helpWriter{w: w, opt: opt}
}

type helpWriter struct {
	w   io.Writer
	opt Options
	buf bytes.Buffer
}

func (h *helpWriter) Write(p []byte) (int, error) { return h.buf.Write(p) }

// Close renders the buffered page. It is safe to call twice: the second call
// writes nothing.
func (h *helpWriter) Close() error {
	if h.buf.Len() == 0 {
		return nil
	}
	if _, err := io.WriteString(h.w, Render(h.buf.String(), h.opt)); err != nil {
		return err // keep the page buffered so a retry can still emit it
	}
	h.buf.Reset()
	return nil
}
