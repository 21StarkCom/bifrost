package help

import (
	"os"
	"testing"

	"github.com/21StarkCom/bifrost/engine/internal/starktui/colors"
)

// TestEyeball prints the fixture as a terminal would see it. It asserts nothing;
// run it with -v when changing a rule to look at the result:
//
//	go test ./help -run Eyeball -v
func TestEyeball(t *testing.T) {
	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Log("\n" + Render(string(raw), Options{Colors: colors.New(true), Columns: 100, Binary: "frigg"}))
}
