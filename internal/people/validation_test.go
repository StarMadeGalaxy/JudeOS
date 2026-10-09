package people

import "testing"

func TestCommandValidationBoundaries(t *testing.T) {
	op := `"operation_id":"00000000-0000-4000-8000-000000000901"`
	for _, tc := range []struct {
		kind, body string
		valid      bool
	}{
		{"createPerson", `{` + op + `,"display_name":"Синтетический участник"}`, true},
		{"createPerson", `{` + op + `,"display_name":"   "}`, false},
		{"createPerson", `{` + op + `,"display_name":"Синтетический участник","phone":null}`, true},
		{"createPerson", `{` + op + `,"display_name":"Синтетический участник","account_id":"x"}`, false},
		{"createAthlete", `{` + op + `,"person_id":"00000000-0000-4000-8000-000000000301","participation":"regular"}`, true},
		{"createAthlete", `{` + op + `,"person_id":"00000000-0000-4000-8000-000000000301","participation":"paid"}`, false},
		{"setPrimaryContact", `{` + op + `,"base_version":1,"guardian_link_id":null}`, true},
		{"setPrimaryContact", `{` + op + `,"base_version":1}`, false},
		{"setPrimaryContact", `{` + op + `,"base_version":1.5,"guardian_link_id":null}`, false},
		{"verifyGuardianLink", `{` + op + `,"base_version":1,"representative_person_id":"00000000-0000-4000-8000-000000000301","basis_kind":"synthetic_manual_check","valid_from":"2026-10-09T00:00:00Z","valid_until":"2026-10-08T00:00:00Z"}`, false},
		{"verifyGuardianLink", `{` + op + `,"base_version":1,"representative_person_id":"00000000-0000-4000-8000-000000000301","basis_kind":"synthetic_manual_check","valid_from":"2026-10-09T00:00:00+03:00","valid_until":null}`, false},
	} {
		_, e := Decode(tc.kind, []byte(tc.body))
		if (e == nil) != tc.valid {
			t.Errorf("%s valid=%v: %v", tc.kind, tc.valid, e)
		}
	}
}
