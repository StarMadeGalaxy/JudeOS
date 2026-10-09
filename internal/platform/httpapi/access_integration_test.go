package httpapi_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/StarMadeGalaxy/JudeOS/db/migrations"
	"github.com/StarMadeGalaxy/JudeOS/internal/access"
	"github.com/StarMadeGalaxy/JudeOS/internal/platform/database"
	"github.com/StarMadeGalaxy/JudeOS/internal/platform/httpapi"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

const tenantA = "00000000-0000-4000-8000-000000000101"
const tenantB = "00000000-0000-4000-8000-000000000102"

type browser struct {
	t      *testing.T
	client *http.Client
	origin string
	csrf   string
}

func (b *browser) call(method, path string, value any, status int) map[string]any {
	b.t.Helper()
	var data io.Reader
	if value != nil {
		raw, _ := json.Marshal(value)
		data = bytes.NewReader(raw)
	}
	req, _ := http.NewRequest(method, b.origin+path, data)
	if method != "GET" {
		req.Header.Set("Origin", b.origin)
		req.Header.Set("X-CSRF-Token", b.csrf)
	}
	if value != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, e := b.client.Do(req)
	if e != nil {
		b.t.Fatal(e)
	}
	defer res.Body.Close()
	var v map[string]any
	json.NewDecoder(res.Body).Decode(&v)
	if res.StatusCode != status {
		b.t.Fatalf("%s %s: status %d want %d code=%v", method, path, res.StatusCode, status, v["code"])
	}
	if res.Header.Get("Cache-Control") != "no-store" {
		b.t.Fatal("cache")
	}
	for _, c := range res.Cookies() {
		if !c.Secure || !c.HttpOnly || c.Path != "/" || c.Domain != "" || c.SameSite != http.SameSiteLaxMode {
			b.t.Fatal("unsafe cookie")
		}
	}
	return v
}
func (b *browser) bootstrap() {
	v := b.call("GET", "/api/v1/access/csrf", nil, 200)
	b.csrf = v["csrf_token"].(string)
}
func (b *browser) login(login, password string) {
	b.bootstrap()
	b.call("POST", "/api/v1/access/login", map[string]any{"login": login, "password": password}, 200)
	b.bootstrap()
}
func TestStaffAccessPostgresHTTP(t *testing.T) {
	if os.Getenv("JUDEOS_TEST_DATABASE_URL") == "" {
		t.Skip("make check-db uses disposable PostgreSQL")
	}
	ctx := context.Background()
	open := func(key string) *sql.DB {
		db, e := database.Open(os.Getenv(key))
		if e != nil {
			t.Fatal(e)
		}
		t.Cleanup(func() { db.Close() })
		return db
	}
	migrator := open("JUDEOS_TEST_MIGRATION_URL")
	runtime := open("JUDEOS_TEST_RUNTIME_URL")
	admin := open("JUDEOS_TEST_DATABASE_URL")
	if e := database.Migrate(ctx, migrator, migrations.Version); e != nil {
		t.Fatal(e)
	}
	if e := database.Seed(ctx, migrator); e != nil {
		t.Fatal(e)
	}
	owner, e := access.BootstrapOwner(ctx, migrator, tenantA, "synthetic.owner")
	if e != nil {
		t.Fatal("bootstrap", e)
	}
	ownerB, e := access.BootstrapOwner(ctx, migrator, tenantB, "synthetic.owner.b")
	if e != nil {
		t.Fatal("bootstrap B", e)
	}
	if _, e = access.BootstrapOwner(ctx, migrator, tenantA, "synthetic.other"); e == nil {
		t.Fatal("duplicate bootstrap")
	}
	var logs bytes.Buffer
	opts := httpapi.Options{Access: access.New(runtime), Logger: slog.New(slog.NewTextHandler(&logs, nil)), Ready: func(context.Context) error { return nil }}
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { httpapi.New(opts).ServeHTTP(w, r) }))
	server.StartTLS()
	defer server.Close()
	opts.Origin = server.URL
	fresh := func() *browser {
		jar, _ := cookiejar.New(nil)
		baseClient := *server.Client()
		c := &baseClient
		c.Jar = jar
		return &browser{t: t, client: c, origin: server.URL}
	}
	a, b := fresh(), fresh()
	password := "synthetic-password-1234"
	a.bootstrap()
	a.call("POST", "/api/v1/access/redeem", map[string]any{"token": owner.Token, "password": password}, 204)
	a.bootstrap()
	a.call("POST", "/api/v1/access/redeem", map[string]any{"token": owner.Token, "password": password}, 400)
	a.login(" SYNTHETIC.OWNER ", password)
	b.bootstrap()
	b.call("POST", "/api/v1/access/redeem", map[string]any{"token": ownerB.Token, "password": password}, 204)
	b.login("synthetic.owner.b", password)
	session := a.call("GET", "/api/v1/access/session", nil, 200)
	account := session["account_id"].(string)
	members := session["memberships"].([]any)
	ownerID := members[0].(map[string]any)["membership_id"].(string)
	staffPath := "/api/v1/tenants/" + tenantA + "/staff"
	a.call("GET", "/api/v1/tenants/"+tenantB+"/staff", nil, 403)
	b.call("GET", staffPath, nil, 403)
	adminGrant := []map[string]string{{"role": "administrator", "scope": "club"}}
	a.call("PUT", staffPath+"/"+ownerID, map[string]any{"active": false, "grants": adminGrant}, 409)
	a.call("PUT", staffPath+"/"+ownerID, map[string]any{"active": true, "grants": []map[string]string{{"role": "coach", "scope": "assigned_sessions"}}}, 409)
	// RLS remains closed even if runtime directly tries to read the staff tables.
	if _, e = runtime.ExecContext(ctx, `SELECT * FROM core.memberships`); e == nil {
		t.Fatal("missing tenant RLS")
	}
	gs := []map[string]string{{"role": "coach", "scope": "assigned_sessions"}, {"role": "manager", "scope": "club"}}
	assertStaffState := func(want string) {
		t.Helper()
		page := a.call("GET", staffPath, nil, 200)
		for _, item := range page["items"].([]any) {
			member := item.(map[string]any)
			if member["login"] == "synthetic.coach" {
				if member["state"] != want {
					t.Fatalf("staff state: got %v, want %s", member["state"], want)
				}
				return
			}
		}
		t.Fatal("synthetic coach missing")
	}
	invitation := a.call("POST", staffPath+"/invitations", map[string]any{"login": "synthetic.coach", "grants": gs}, 201)
	assertStaffState("pending")
	token := invitation["token"].(string)
	coach := fresh()
	coach.bootstrap()
	coach.call("POST", "/api/v1/access/redeem", map[string]any{"token": token, "password": "short"}, 400)
	coach.call("POST", "/api/v1/access/redeem", map[string]any{"token": token, "password": password}, 204)
	assertStaffState("active")
	coach.login("synthetic.coach", password)
	cs := coach.call("GET", "/api/v1/access/session", nil, 200)
	if len(cs["memberships"].([]any)[0].(map[string]any)["grants"].([]any)) != 2 {
		t.Fatal("union roles")
	}
	coach.call("GET", staffPath, nil, 403)
	coachID := cs["memberships"].([]any)[0].(map[string]any)["membership_id"].(string)
	// Malicious Origin, absent Origin/CSRF, cross-site Fetch Metadata fail closed.
	for _, tc := range []struct{ method, path, origin, csrf, site string }{{"GET", "/api/v1/access/csrf", "https://foreign.invalid", "", ""}, {"POST", "/api/v1/access/logout", "", a.csrf, ""}, {"POST", "/api/v1/access/logout", server.URL, "", ""}, {"GET", "/api/v1/access/session", "", "", "cross-site"}} {
		req, _ := http.NewRequest(tc.method, server.URL+tc.path, nil)
		req.Header.Set("Origin", tc.origin)
		req.Header.Set("X-CSRF-Token", tc.csrf)
		req.Header.Set("Sec-Fetch-Site", tc.site)
		res, e := a.client.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		res.Body.Close()
		if res.StatusCode != 403 {
			t.Fatal("CSRF/origin", res.StatusCode)
		}
	}
	// Parent/athlete and invalid role scope never activate in MVP.
	for _, role := range []string{"parent", "athlete"} {
		a.call("POST", staffPath+"/invitations", map[string]any{"login": "synthetic.forbidden", "grants": []map[string]string{{"role": role, "scope": "club"}}}, 400)
	}
	a.call("POST", staffPath+"/invitations", map[string]any{"login": "synthetic.forbidden", "grants": []map[string]string{{"role": "coach", "scope": "club"}}}, 400)
	expiredInvite := a.call("POST", staffPath+"/invitations", map[string]any{"login": "synthetic.expired", "grants": gs}, 201)["token"].(string)
	inviteHash := sha256.Sum256([]byte(expiredInvite))
	if e = database.WithinTenant(ctx, admin, database.TenantContext{TenantID: tenantA, ActorID: account, RequestID: "00000000000000000000000000000021"}, func(tx *sql.Tx) error {
		_, e := tx.ExecContext(ctx, `UPDATE core.access_tokens SET expires_at=clock_timestamp()-interval '1 second' WHERE secret_hash=$1`, hex.EncodeToString(inviteHash[:]))
		return e
	}); e != nil {
		t.Fatal("expire invite")
	}
	expiredBrowser := fresh()
	expiredBrowser.bootstrap()
	expiredBrowser.call("POST", "/api/v1/access/redeem", map[string]any{"token": expiredInvite, "password": password}, 400)
	// Strict bounded JSON and invalid path values remain client errors.
	for _, tc := range []struct {
		raw, kind string
		want      int
	}{{`{"login":"synthetic.owner","password":"x","extra":true}`, "application/json", 400}, {`{"login":null,"password":"x"}`, "application/json", 400}, {`{} {}`, "application/json", 400}, {`{"login":"` + strings.Repeat("a", 17000) + `","password":"x"}`, "application/json", 413}, {`{}`, "text/plain", 415}} {
		req, _ := http.NewRequest("POST", server.URL+"/api/v1/access/login", strings.NewReader(tc.raw))
		req.Header.Set("Content-Type", tc.kind)
		req.Header.Set("Origin", server.URL)
		req.Header.Set("X-CSRF-Token", a.csrf)
		res, e := a.client.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		res.Body.Close()
		if res.StatusCode != tc.want {
			t.Fatal("bounded JSON", res.StatusCode, tc.want)
		}
	}
	a.call("GET", "/api/v1/tenants/invalid/staff", nil, 400)
	if _, e = admin.ExecContext(ctx, `DELETE FROM access.rate_limits`); e != nil {
		t.Fatal(e)
	}
	// Replacement reset invalidates the previous link, expires and replays reject.
	reset1 := a.call("POST", staffPath+"/"+coachID+"/reset", nil, 201)["token"].(string)
	reset2 := a.call("POST", staffPath+"/"+coachID+"/reset", nil, 201)["token"].(string)
	resetter := fresh()
	resetter.bootstrap()
	resetter.call("POST", "/api/v1/access/redeem", map[string]any{"token": reset1, "password": password}, 400)
	h := sha256.Sum256([]byte(reset2))
	if e = database.WithinTenant(ctx, admin, database.TenantContext{TenantID: tenantA, ActorID: account, RequestID: "00000000000000000000000000000021"}, func(tx *sql.Tx) error {
		_, e := tx.ExecContext(ctx, `UPDATE core.access_tokens SET expires_at=clock_timestamp()-interval '1 second' WHERE secret_hash=$1`, hex.EncodeToString(h[:]))
		return e
	}); e != nil {
		t.Fatal(e)
	}
	resetter.call("POST", "/api/v1/access/redeem", map[string]any{"token": reset2, "password": password}, 400)
	reset3 := a.call("POST", staffPath+"/"+coachID+"/reset", nil, 201)["token"].(string)
	resetter.call("POST", "/api/v1/access/redeem", map[string]any{"token": reset3, "password": "synthetic-new-password-5678"}, 204)
	coach.call("GET", "/api/v1/access/session", nil, 401)
	resetter.bootstrap()
	resetter.call("POST", "/api/v1/access/redeem", map[string]any{"token": reset3, "password": password}, 400)
	coach.login("synthetic.coach", "synthetic-new-password-5678")
	a.call("PUT", staffPath+"/"+coachID, map[string]any{"active": false, "grants": gs}, 204)
	assertStaffState("revoked")
	coach.call("GET", "/api/v1/access/session", nil, 401)
	// Last-owner protection also holds under two competing admin removals.
	secondToken := a.call("POST", staffPath+"/invitations", map[string]any{"login": "synthetic.owner.second", "grants": adminGrant}, 201)["token"].(string)
	second := fresh()
	second.bootstrap()
	second.call("POST", "/api/v1/access/redeem", map[string]any{"token": secondToken, "password": password}, 204)
	second.login("synthetic.owner.second", password)
	secondID := second.call("GET", "/api/v1/access/session", nil, 200)["memberships"].([]any)[0].(map[string]any)["membership_id"].(string)
	getToken := func(browser *browser) string {
		req, _ := http.NewRequest("GET", server.URL, nil)
		for _, c := range browser.client.Jar.Cookies(req.URL) {
			if c.Name == "__Host-judeos-session" {
				return c.Value
			}
		}
		return ""
	}
	aToken, sToken := getToken(a), getToken(second)
	svc := opts.Access
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	for _, v := range []struct{ token, csrf, id string }{{aToken, a.csrf, ownerID}, {sToken, second.csrf, secondID}} {
		wg.Add(1)
		go func(v struct{ token, csrf, id string }) {
			defer wg.Done()
			errs <- svc.Change(ctx, v.token, v.csrf, tenantA, "00000000000000000000000000000021", v.id, false, []access.Grant{{Role: "administrator", Scope: "club"}})
		}(v)
	}
	wg.Wait()
	close(errs)
	success := 0
	for e := range errs {
		if e == nil {
			success++
		}
	}
	if success != 1 {
		t.Fatal("concurrent last owner", success)
	}
	var n int
	if e = admin.QueryRowContext(ctx, `SELECT count(*) FROM core.memberships m JOIN core.role_grants g ON (g.tenant_id,g.membership_id)=(m.tenant_id,m.id) WHERE m.tenant_id=$1 AND m.active AND g.role='administrator'`, tenantA).Scan(&n); e != nil || n != 1 {
		t.Fatal("last owner count")
	}
	// Expiry rejects old cookie without extending TTL through reads.
	if _, e = admin.ExecContext(ctx, `UPDATE access.sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1`, account); e != nil {
		t.Fatal(e)
	}
	a.call("GET", "/api/v1/access/session", nil, 401)
	b.call("POST", "/api/v1/access/logout", nil, 204)
	b.call("GET", "/api/v1/access/session", nil, 401)
	b.call("POST", "/api/v1/access/logout", nil, 401)
	if _, e = admin.ExecContext(ctx, `DELETE FROM access.rate_limits`); e != nil {
		t.Fatal(e)
	}
	unknown := fresh()
	unknown.bootstrap()
	for i := 0; i < 10; i++ {
		unknown.call("POST", "/api/v1/access/login", map[string]any{"login": "unknown.synthetic", "password": password}, 401)
	}
	unknown.call("POST", "/api/v1/access/login", map[string]any{"login": "unknown.synthetic", "password": password}, 429)
	// Hash-only secrets; metadata audit and structured logs contain no credentials.
	var leaks int
	e = admin.QueryRowContext(ctx, `SELECT count(*) FROM core.audit_events ae WHERE row_to_json(ae)::text LIKE '%synthetic-password%'`).Scan(&leaks)
	if e != nil || leaks != 0 {
		t.Fatal("audit leak")
	}
	for _, secret := range []string{owner.Token, token, password, "unknown.synthetic", "synthetic.coach"} {
		if strings.Contains(logs.String(), secret) {
			t.Fatal("log secret")
		}
	}
	t.Log(fmt.Sprintf("HTTP + PostgreSQL access flow passed; %d remaining owner", n))
	_ = time.Second
}
