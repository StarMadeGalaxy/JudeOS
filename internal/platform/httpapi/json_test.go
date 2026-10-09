package httpapi

import "testing"

func TestJSONParserRejectsAmbiguity(t *testing.T) {
	for _, tc := range []struct {
		raw   string
		valid bool
	}{
		{`{"active":true}`, true}, {`{"active":true,"active":false}`, false}, {`{"grants":[{"role":"coach","role":"administrator"}]}`, false}, {`{"a":1} {"a":2}`, false}, {`{"a":{"b":1},"c":{"b":2}}`, true},
	} {
		if uniqueJSON([]byte(tc.raw)) != tc.valid {
			t.Error("JSON ambiguity")
		}
	}
}
