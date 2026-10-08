package access

import (
	"strings"
	"testing"
)

func TestPasswordsAndRoles(t *testing.T) {
	h, e := HashPassword("synthetic-passphrase-123")
	if e != nil || !VerifyPassword(h, "synthetic-passphrase-123") || VerifyPassword(h, "wrong") {
		t.Fatal("password verification")
	}
	h2, _ := HashPassword("synthetic-passphrase-123")
	if h == h2 || strings.Contains(h, "synthetic") {
		t.Fatal("salt/hash")
	}
	for _, bad := range []string{"short", strings.Repeat("a", 1025)} {
		if _, e = HashPassword(bad); e == nil {
			t.Fatal("password bounds")
		}
	}
	if VerifyPassword("$argon2id$v=19$m=999999999,t=2,p=1$aaaa$bbbb", "password") {
		t.Fatal("unbounded hash")
	}
	gs := []Grant{{"coach", "assigned_sessions"}, {"manager", "club"}}
	if !ValidGrants(gs) || !Allows(gs, "finance", false) || Allows(gs, "staff", true) {
		t.Fatal("role union")
	}
	coach := gs[:1]
	if Allows(coach, "journal", false) || !Allows(coach, "journal", true) || Allows(coach, "finance", true) || Allows(coach, "staff", true) {
		t.Fatal("object scope")
	}
	for _, bad := range [][]Grant{{{"parent", "club"}}, {{"athlete", "club"}}, {{"coach", "club"}}, {{"administrator", "assigned_sessions"}}, {{"coach", "assigned_sessions"}, {"coach", "assigned_sessions"}}} {
		if ValidGrants(bad) {
			t.Fatal("invalid grant")
		}
	}
	if v, e := NormalizeLogin(" Synthetic.Coach "); e != nil || v != "synthetic.coach" {
		t.Fatal("normalize")
	}
}
