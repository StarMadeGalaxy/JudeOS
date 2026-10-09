package httpapi_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/StarMadeGalaxy/JudeOS/internal/access"
)

// Called from the real registry/network fixture after role/revocation tests.
func checkGlobalRecovery(t *testing.T, ctx context.Context, migrator, runtime, admin *sql.DB,
	owner, foreign, platform, coach *browser, fresh func() *browser, prefix, password, club string) {
	t.Helper()
	path := "/api/v1/platform/password-recovery"
	body := func(login string) map[string]any { return map[string]any{"login": login, "identity_verified": true} }
	clear := func() {
		if _, e := admin.ExecContext(ctx, `DELETE FROM access.rate_limits`); e != nil {
			t.Fatal(e)
		}
	}
	recipient := func() *browser { clear(); b := fresh(); b.bootstrap(); return b }
	issue := func(login string) map[string]any { return platform.call("POST", path, body(login), 201) }
	owner.call("POST", path, body(prefix+".foreign"), 403)
	foreign.call("POST", path, body(prefix+".owner"), 403)
	anonymous := recipient()
	anonymous.call("POST", path, body(prefix+".owner"), 401)
	platform.call("POST", path, map[string]any{"login": prefix + ".owner", "identity_verified": false}, 400)
	platform.call("POST", path, map[string]any{"login": prefix + ".owner"}, 400)
	platform.call("POST", path, body(prefix+".unknown"), 400)
	oldCSRF := platform.csrf
	platform.csrf = ""
	platform.call("POST", path, body(prefix+".owner"), 403)
	platform.csrf = oldCSRF
	// Global tables and operator capability remain unavailable to runtime.
	for _, q := range []string{`SELECT * FROM access.password_recoveries`, `SELECT * FROM access.recovery_audit`, `SELECT access.operator_password_recovery('synthetic','verified','` + string(bytes.Repeat([]byte("0"), 64)) + `','` + string(bytes.Repeat([]byte("0"), 32)) + `')`} {
		if _, e := runtime.ExecContext(ctx, q); e == nil {
			t.Fatal("runtime recovery capability leaked")
		}
	}
	var before, after string
	snapshot := `SELECT jsonb_build_object('memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.tenant_id,m.id) FROM core.memberships m),'grants',(SELECT jsonb_agg(to_jsonb(g) ORDER BY g.tenant_id,g.membership_id,g.role) FROM core.role_grants g),'owners',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.network_id,o.account_id) FROM organization.owners o),'platform',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.account_id) FROM organization.platform_administrators p))::text`
	if e := admin.QueryRowContext(ctx, snapshot).Scan(&before); e != nil {
		t.Fatal(e)
	}
	first, second := issue(prefix+".owner"), issue(prefix+".owner")
	if second["kind"] != "recovery" || first["token"] == second["token"] {
		t.Fatal("replacement link")
	}
	expiry, e := time.Parse(time.RFC3339Nano, second["expires_at"].(string))
	if e != nil || time.Until(expiry) < 29*time.Minute || time.Until(expiry) > 30*time.Minute {
		t.Fatal("recovery TTL")
	}
	b := recipient()
	b.call("POST", "/api/v1/access/redeem", map[string]any{"token": first["token"], "password": password + "-new"}, 400)
	b.call("POST", "/api/v1/access/redeem", map[string]any{"token": second["token"], "password": password + "-new"}, 204)
	owner.call("GET", "/api/v1/access/session", nil, 401)
	owner.bootstrap()
	owner.call("POST", "/api/v1/access/login", map[string]any{"login": prefix + ".owner", "password": password}, 401)
	owner.login(prefix+".owner", password+"-new")
	if e = admin.QueryRowContext(ctx, snapshot).Scan(&after); e != nil || before != after {
		t.Fatal("recovery altered authority")
	}
	b.bootstrap()
	b.call("POST", "/api/v1/access/redeem", map[string]any{"token": second["token"], "password": password + "-replay"}, 400)
	// Expiry and issuer revocation are checked at redemption, not just issuance.
	expired := issue(prefix + ".owner")
	if _, e = admin.ExecContext(ctx, `UPDATE access.password_recoveries SET expires_at=clock_timestamp()-interval '1 second' WHERE account_id=(SELECT id FROM access.accounts WHERE login=$1) AND NOT used`, prefix+".owner"); e != nil {
		t.Fatal(e)
	}
	b = recipient()
	b.call("POST", "/api/v1/access/redeem", map[string]any{"token": expired["token"], "password": password}, 400)
	platform.call("PUT", "/api/v1/platform/administrators", map[string]any{"login": prefix + ".foreign", "active": true}, 204)
	foreign.login(prefix+".foreign", password)
	revokedIssuer := foreign.call("POST", path, body(prefix+".owner"), 201)
	platform.call("PUT", "/api/v1/platform/administrators", map[string]any{"login": prefix + ".foreign", "active": false}, 204)
	b = recipient()
	b.call("POST", "/api/v1/access/redeem", map[string]any{"token": revokedIssuer["token"], "password": password}, 400)
	platform.call("PUT", "/api/v1/platform/administrators", map[string]any{"login": prefix + ".foreign", "active": true}, 204)
	b.call("POST", "/api/v1/access/redeem", map[string]any{"token": revokedIssuer["token"], "password": password}, 400)
	platform.call("PUT", "/api/v1/platform/administrators", map[string]any{"login": prefix + ".foreign", "active": false}, 204)
	// A normal retained club reset must consume a previously issued global
	// recovery. This is independent of global redeem and issuer role revocation.
	localLogin := prefix + ".local-recovery"
	localInvite := platform.call("POST", "/api/v1/tenants/"+club+"/staff/assignments", map[string]any{"login": localLogin, "grants": []access.Grant{{Role: "coach", Scope: "assigned_sessions"}}}, 201)
	b = recipient()
	b.call("POST", "/api/v1/access/redeem", map[string]any{"token": localInvite["token"], "password": password}, 204)
	globalOld := issue(localLogin)
	var localMID string
	if e = admin.QueryRowContext(ctx, `SELECT m.id FROM core.memberships m JOIN access.accounts a ON a.id=m.account_id WHERE a.login=$1 AND m.tenant_id=$2`, localLogin, club).Scan(&localMID); e != nil {
		t.Fatal(e)
	}
	localReset := platform.call("POST", "/api/v1/tenants/"+club+"/staff/"+localMID+"/reset", nil, 201)
	b = recipient()
	b.call("POST", "/api/v1/access/redeem", map[string]any{"token": localReset["token"], "password": password + "-local"}, 204)
	b.bootstrap()
	b.call("POST", "/api/v1/access/redeem", map[string]any{"token": globalOld["token"], "password": password + "-stale"}, 400)
	// Two recipients racing on one link cannot both change the password.
	concurrent := issue(prefix + ".owner")
	b1, b2 := recipient(), recipient()
	var wg sync.WaitGroup
	statuses := make(chan int, 2)
	for _, clientBrowser := range []*browser{b1, b2} {
		wg.Add(1)
		go func(b *browser) {
			defer wg.Done()
			raw, _ := json.Marshal(map[string]any{"token": concurrent["token"], "password": password + "-concurrent"})
			req, _ := http.NewRequest("POST", b.origin+"/api/v1/access/redeem", bytes.NewReader(raw))
			req.Header.Set("Origin", b.origin)
			req.Header.Set("X-CSRF-Token", b.csrf)
			req.Header.Set("Content-Type", "application/json")
			res, e := b.client.Do(req)
			if e != nil {
				statuses <- 0
				return
			}
			io.Copy(io.Discard, res.Body)
			res.Body.Close()
			statuses <- res.StatusCode
		}(clientBrowser)
	}
	wg.Wait()
	close(statuses)
	counts := map[int]int{}
	for status := range statuses {
		counts[status]++
	}
	if counts[204] != 1 || counts[400] != 1 {
		t.Fatal("recovery race", counts)
	}
	// Resetting a revoked ready account must not accept its pending join or
	// silently restore its membership. All outstanding access links are consumed.
	foreign.login(prefix+".foreign", password)
	join := foreign.call("POST", "/api/v1/tenants/"+club+"/staff/assignments", map[string]any{"login": prefix + ".coach", "grants": []access.Grant{{Role: "coach", Scope: "assigned_sessions"}}}, 201)
	noRights := issue(prefix + ".coach")
	b = recipient()
	b.call("POST", "/api/v1/access/redeem", map[string]any{"token": noRights["token"], "password": password + "-revoked"}, 204)
	coach.bootstrap()
	coach.call("POST", "/api/v1/access/login", map[string]any{"login": prefix + ".coach", "password": password + "-revoked"}, 401)
	var used bool
	if e = admin.QueryRowContext(ctx, `SELECT used FROM core.access_tokens WHERE membership_id=(SELECT m.id FROM core.memberships m JOIN access.accounts a ON a.id=m.account_id WHERE a.login=$1 AND m.tenant_id=$2) ORDER BY expires_at DESC LIMIT 1`, prefix+".coach", club).Scan(&used); e != nil || !used {
		t.Fatal("pending join survived password recovery", e, join["kind"])
	}
	// One identity with two physical club assignments, multiple sessions and a
	// pending third-club link keeps its active rights but loses every old session
	// and link, including the link outside the currently selected club.
	otherSession := fresh()
	otherSession.login(prefix+".foreign", password)
	multiBefore, _ := json.Marshal(foreign.call("GET", "/api/v1/access/session", nil, 200)["memberships"])
	newNetwork := platform.call("POST", "/api/v1/platform/networks", map[string]any{"name": "Синтетическая сеть восстановления"}, 201)
	newClub := platform.call("POST", "/api/v1/networks/"+newNetwork["network_id"].(string)+"/clubs", map[string]any{"name": "Синтетический клуб восстановления", "address": "Тестовая улица, 11"}, 201)
	pending := platform.call("POST", "/api/v1/tenants/"+newClub["tenant_id"].(string)+"/staff/assignments", map[string]any{"login": prefix + ".foreign", "grants": []access.Grant{{Role: "coach", Scope: "assigned_sessions"}}}, 201)
	multi := issue(prefix + ".foreign")
	b = recipient()
	b.call("POST", "/api/v1/access/redeem", map[string]any{"token": multi["token"], "password": password + "-multi"}, 204)
	foreign.call("GET", "/api/v1/access/session", nil, 401)
	otherSession.call("GET", "/api/v1/access/session", nil, 401)
	foreign.login(prefix+".foreign", password+"-multi")
	multiAfter, _ := json.Marshal(foreign.call("GET", "/api/v1/access/session", nil, 200)["memberships"])
	if !bytes.Equal(multiBefore, multiAfter) {
		t.Fatal("multi-club authority changed")
	}
	foreign.call("POST", "/api/v1/access/accept-invitation", map[string]any{"token": pending["token"]}, 400)
	var remaining int
	if e = admin.QueryRowContext(ctx, `SELECT count(*) FROM core.access_tokens x JOIN core.memberships m ON (m.tenant_id,m.id)=(x.tenant_id,x.membership_id) JOIN access.accounts a ON a.id=m.account_id WHERE a.login=$1 AND NOT x.used`, prefix+".foreign").Scan(&remaining); e != nil || remaining != 0 {
		t.Fatal("cross-club links survived", e)
	}
	// Operator recovery requires migration identity, manual verification and an
	// already active platform recipient. It cannot promote a network owner.
	if _, e = access.OperatorRecovery(ctx, runtime, prefix+".platform", "synthetic-procedure", true); !errors.Is(e, access.ErrForbidden) {
		t.Fatal("runtime operator", e)
	}
	if _, e = access.OperatorRecovery(ctx, migrator, prefix+".owner", "synthetic-procedure", true); !errors.Is(e, access.ErrToken) {
		t.Fatal("operator elevated owner", e)
	}
	if _, e = access.OperatorRecovery(ctx, migrator, prefix+".platform", "synthetic-procedure", false); !errors.Is(e, access.ErrInvalid) {
		t.Fatal("unverified operator", e)
	}
	emergency, e := access.OperatorRecovery(ctx, migrator, prefix+".platform", "synthetic-procedure", true)
	if e != nil {
		t.Fatal("operator recovery", e)
	}
	b = recipient()
	b.call("POST", "/api/v1/access/redeem", map[string]any{"token": emergency.Token, "password": password}, 204)
	platform.call("GET", "/api/v1/access/session", nil, 401)
	platform.login(prefix+".platform", password)
	if platform.call("GET", "/api/v1/access/session", nil, 200)["platform_administrator"] != true {
		t.Fatal("operator changed authority")
	}
	var audit, hashes string
	if e = admin.QueryRowContext(ctx, `SELECT string_agg(action,',') FROM access.recovery_audit`).Scan(&audit); e != nil || !bytes.Contains([]byte(audit), []byte("ISSUE_OPERATOR")) || !bytes.Contains([]byte(audit), []byte("REDEEM")) {
		t.Fatal("recovery audit", e)
	}
	if e = admin.QueryRowContext(ctx, `SELECT coalesce(string_agg(secret_hash,','),'') FROM access.password_recoveries`).Scan(&hashes); e != nil || bytes.Contains([]byte(hashes), []byte(emergency.Token)) {
		t.Fatal("raw recovery secret stored")
	}
}
