package httpapi_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"sync"
	"testing"

	"github.com/StarMadeGalaxy/JudeOS/db/migrations"
	"github.com/StarMadeGalaxy/JudeOS/internal/access"
	"github.com/StarMadeGalaxy/JudeOS/internal/people"
	"github.com/StarMadeGalaxy/JudeOS/internal/platform/database"
	"github.com/StarMadeGalaxy/JudeOS/internal/platform/httpapi"
)

func TestRegistryNetworkPostgresHTTP(t *testing.T) {
	if os.Getenv("JUDEOS_TEST_DATABASE_URL") == "" {
		t.Skip("disposable PostgreSQL required")
	}
	ctx := context.Background()
	open := func(key string) *sql.DB {
		db, e := database.Open(os.Getenv(key))
		if e != nil {
			t.Fatal("test configuration")
		}
		t.Cleanup(func() { db.Close() })
		return db
	}
	migrator, runtime, admin := open("JUDEOS_TEST_MIGRATION_URL"), open("JUDEOS_TEST_RUNTIME_URL"), open("JUDEOS_TEST_DATABASE_URL")
	if e := database.Migrate(ctx, migrator, migrations.Version); e != nil {
		t.Fatal(e)
	}
	if _, e := admin.ExecContext(ctx, `DELETE FROM access.rate_limits`); e != nil {
		t.Fatal("isolated test limiter", e)
	}
	clubA, clubB := people.UUID(), people.UUID()
	for _, id := range []string{clubA, clubB} {
		e := database.WithinTenant(ctx, migrator, database.TenantContext{TenantID: id, ActorID: "00000000-0000-4000-8000-000000000301", RequestID: "00000000000000000000000000000027"}, func(tx *sql.Tx) error {
			_, e := tx.ExecContext(ctx, `INSERT INTO core.clubs(tenant_id,name) VALUES($1,'Синтетический клуб')`, id)
			return e
		})
		if e != nil {
			t.Fatal("club setup", e)
		}
	}
	prefix := "synthetic." + people.UUID()
	password := "synthetic-network-password-27"
	linkA, e := access.BootstrapOwner(ctx, migrator, clubA, prefix+".owner")
	if e != nil {
		t.Fatal(e)
	}
	linkB, e := access.BootstrapOwner(ctx, migrator, clubB, prefix+".foreign")
	if e != nil {
		t.Fatal(e)
	}
	var logs bytes.Buffer
	opts := httpapi.Options{Access: access.New(runtime), Logger: slog.New(slog.NewTextHandler(&logs, nil)), Ready: func(context.Context) error { return nil }}
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { httpapi.New(opts).ServeHTTP(w, r) }))
	server.StartTLS()
	defer server.Close()
	opts.Origin = server.URL
	fresh := func() *browser {
		jar, _ := cookiejar.New(nil)
		client := *server.Client()
		client.Jar = jar
		return &browser{t: t, client: &client, origin: server.URL}
	}
	install := func(login string, link access.Link) *browser {
		b := fresh()
		b.bootstrap()
		b.call("POST", "/api/v1/access/redeem", map[string]any{"token": link.Token, "password": password}, 204)
		b.login(login, password)
		return b
	}
	owner, foreign := install(prefix+".owner", linkA), install(prefix+".foreign", linkB)
	path := func(club, resource string) string { return "/api/v1/tenants/" + club + "/" + resource }
	cmd := func(fields map[string]any) map[string]any { fields["operation_id"] = people.UUID(); return fields }
	create := func(b *browser, club, name string) map[string]any {
		return b.call("POST", path(club, "people"), cmd(map[string]any{"display_name": name, "phone": "+375000000027"}), 201)
	}
	child := create(owner, clubA, "Синтетический Иванов")
	sameName := create(owner, clubA, "Синтетический Иванов")
	if child["person_id"] == sameName["person_id"] {
		t.Fatal("automatic merge")
	}
	representative := create(owner, clubA, "Синтетический представитель")
	foreignPerson := create(foreign, clubB, "Чужой синтетический человек")
	owner.call("GET", path(clubB, "people"), nil, 403)
	owner.call("POST", path(clubA, "athletes"), cmd(map[string]any{"person_id": foreignPerson["person_id"], "participation": "regular"}), 404)
	athlete := owner.call("POST", path(clubA, "athletes"), cmd(map[string]any{"person_id": child["person_id"], "participation": "regular"}), 201)
	aid := athlete["athlete_id"].(string)
	if athlete["primary_contact"] != nil || athlete["admission"] != nil {
		t.Fatal("inferred contact/admission")
	}
	household := owner.call("POST", path(clubA, "households"), cmd(map[string]any{"name": "Синтетическая семья"}), 201)
	hid := household["household_id"].(string)
	member := owner.call("POST", path(clubA, "households/"+hid+"/members"), cmd(map[string]any{"base_version": 1, "person_id": representative["person_id"], "valid_from": "2020-01-01T00:00:00Z", "valid_until": nil}), 201)
	owner.call("GET", path(clubA, "athletes/"+aid), nil, 200)
	if member["version"] != float64(2) {
		t.Fatal("household version")
	}
	verify := cmd(map[string]any{"base_version": 1, "representative_person_id": representative["person_id"], "basis_kind": "synthetic_manual_check", "valid_from": "2020-01-01T00:00:00Z", "valid_until": nil})
	guardian := owner.call("POST", path(clubA, "athletes/"+aid+"/guardian-links"), verify, 201)
	replay := owner.call("POST", path(clubA, "athletes/"+aid+"/guardian-links"), verify, 201)
	if replay["guardian_link_id"] != guardian["guardian_link_id"] {
		t.Fatal("duplicate effect")
	}
	profile := owner.call("PUT", path(clubA, "athletes/"+aid+"/primary-contact"), cmd(map[string]any{"base_version": 2, "guardian_link_id": guardian["guardian_link_id"]}), 200)
	if profile["primary_contact"].(map[string]any)["display_name"] != representative["display_name"] {
		t.Fatal("contact projection")
	}
	owner.call("PUT", path(clubA, "athletes/"+aid+"/primary-contact"), cmd(map[string]any{"base_version": 1, "guardian_link_id": guardian["guardian_link_id"]}), 409)
	page := owner.call("GET", path(clubA, "people?q=Иванов&limit=1"), nil, 200)
	if len(page["items"].([]any)) != 1 || page["next_cursor"] == nil {
		t.Fatal("pagination")
	}
	page = owner.call("GET", path(clubA, "people?q=Иванов&limit=1&cursor="+page["next_cursor"].(string)), nil, 200)
	if len(page["items"].([]any)) != 1 || page["next_cursor"] != nil {
		t.Fatal("next page")
	}
	owner.call("POST", path(clubA, "people/"+representative["person_id"].(string)+"/archive"), cmd(map[string]any{"base_version": 1}), 200)
	profile = owner.call("GET", path(clubA, "athletes/"+aid), nil, 200)
	if profile["primary_contact"] != nil || profile["primary_guardian_link_id"] != nil || profile["guardian_links"].([]any)[0].(map[string]any)["status"] != "revoked" {
		t.Fatal("archive revocation")
	}
	owner.call("POST", path(clubA, "athletes/"+aid+"/guardian-links"), verify, 409)
	archived := owner.call("GET", path(clubA, "people/"+representative["person_id"].(string)), nil, 200)
	if archived["phone"] != nil {
		t.Fatal("archived contact")
	}
	// Two concurrent commands at one version: one commits, one conflicts.
	var wg sync.WaitGroup
	statuses := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			raw, _ := json.Marshal(cmd(map[string]any{"base_version": 1, "display_name": "Синтетическое обновление", "phone": nil}))
			req, _ := http.NewRequest("PUT", server.URL+path(clubA, "people/"+sameName["person_id"].(string)), bytes.NewReader(raw))
			req.Header.Set("Origin", server.URL)
			req.Header.Set("X-CSRF-Token", owner.csrf)
			req.Header.Set("Content-Type", "application/json")
			res, e := owner.client.Do(req)
			if e != nil {
				statuses <- 0
				return
			}
			io.Copy(io.Discard, res.Body)
			res.Body.Close()
			statuses <- res.StatusCode
		}()
	}
	wg.Wait()
	close(statuses)
	counts := map[int]int{}
	for n := range statuses {
		counts[n]++
	}
	if counts[200] != 1 || counts[409] != 1 {
		t.Fatal("concurrent version guard", counts)
	}
	// Database boundary rejects cross-club FK, deletion and audit tampering.
	for _, q := range []string{`DELETE FROM core.people`, `INSERT INTO core.audit_events DEFAULT VALUES`, `SELECT * FROM organization.platform_administrators`, `SELECT * FROM core.people`} {
		if _, e = runtime.ExecContext(ctx, q); e == nil {
			t.Fatal("runtime privilege/RLS", q)
		}
	}
	e = database.WithinTenant(ctx, runtime, database.TenantContext{TenantID: clubA, ActorID: owner.call("GET", "/api/v1/access/session", nil, 200)["account_id"].(string), RequestID: "00000000000000000000000000000027"}, func(tx *sql.Tx) error {
		_, e := tx.ExecContext(ctx, `INSERT INTO core.athletes(tenant_id,id,person_id,participation) VALUES($1,$2,$3,'regular')`, clubA, people.UUID(), foreignPerson["person_id"])
		return e
	})
	if e != database.ErrConflict {
		t.Fatal("composite FK", e)
	}
	var leak bool
	if e = admin.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM core.audit_events WHERE tenant_id=$1 AND row_to_json(audit_events)::text LIKE '%Синтетич%')`, clubA).Scan(&leak); e != nil || leak {
		t.Fatal("metadata audit")
	}
	beforeMembership := owner.call("GET", "/api/v1/access/session", nil, 200)["memberships"].([]any)[0].(map[string]any)["membership_id"]
	network := owner.call("POST", path(clubA, "network"), map[string]any{"name": "Синтетическая сеть"}, 201)
	nid := network["network_id"].(string)
	effective := owner.call("GET", "/api/v1/access/session", nil, 200)["memberships"].([]any)[0].(map[string]any)
	if effective["membership_id"] != beforeMembership || effective["authority_source"] != "network_owner" {
		t.Fatal("direct membership identity/source changed")
	}

	owner.call("GET", "/api/v1/networks/"+nid, nil, 200)
	foreign.call("GET", "/api/v1/networks/"+nid, nil, 403)
	newClub := owner.call("POST", "/api/v1/networks/"+nid+"/clubs", map[string]any{"name": "Синтетический второй клуб", "address": "Тестовая улица, 2"}, 201)
	clubC := newClub["tenant_id"].(string)
	owner.call("GET", path(clubC, "people"), nil, 200)
	owner.call("GET", path(clubB, "people"), nil, 403)
	owner.call("PUT", "/api/v1/networks/"+nid+"/clubs/"+clubC, map[string]any{"name": "Синтетический филиал", "address": "Тестовая улица, 3", "base_version": 1}, 200)
	owner.call("PUT", "/api/v1/networks/"+nid, map[string]any{"name": "Новое синтетическое название", "base_version": 1}, 200)
	// Existing ready account joins a club through its own session. Join links can
	// neither reset passwords nor be accepted by another signed-in account.
	invite := owner.call("POST", path(clubC, "staff/assignments"), map[string]any{"login": prefix + ".foreign", "grants": []access.Grant{{Role: "manager", Scope: "club"}}}, 201)
	rows := owner.call("GET", path(clubC, "staff"), nil, 200)["items"].([]any)
	pendingID := rows[0].(map[string]any)["membership_id"].(string)
	replaced := owner.call("POST", path(clubC, "staff/"+pendingID+"/reset"), nil, 201)
	if replaced["kind"] != "join" {
		t.Fatal("ready-account reissue became password reset")
	}
	foreign.call("POST", "/api/v1/access/accept-invitation", map[string]any{"token": invite["token"]}, 400)
	invite = replaced
	owner.call("POST", "/api/v1/access/accept-invitation", map[string]any{"token": invite["token"]}, 400)
	anon := fresh()
	anon.bootstrap()
	anon.call("POST", "/api/v1/access/redeem", map[string]any{"token": invite["token"], "password": password + "changed"}, 400)
	foreign.call("POST", "/api/v1/access/accept-invitation", map[string]any{"token": invite["token"]}, 204)
	foreign.call("POST", "/api/v1/access/accept-invitation", map[string]any{"token": invite["token"]}, 400)
	foreign.call("GET", path(clubC, "people"), nil, 200)
	foreign.call("GET", path(clubA, "people"), nil, 403)
	foreign.call("POST", path(clubC, "staff/assignments"), map[string]any{"login": prefix + ".escalate", "grants": []access.Grant{{Role: "manager", Scope: "club"}}}, 403)
	coachLink := foreign.call("POST", path(clubC, "staff/assignments"), map[string]any{"login": prefix + ".coach", "grants": []access.Grant{{Role: "coach", Scope: "assigned_sessions"}}}, 201)
	coach := install(prefix+".coach", access.Link{Token: coachLink["token"].(string)})
	coach.call("GET", path(clubC, "people"), nil, 403)
	coaches := foreign.call("GET", path(clubC, "coaches"), nil, 200)["items"].([]any)
	mid := coaches[0].(map[string]any)["membership_id"].(string)
	foreign.call("POST", path(clubC, "coaches/"+mid+"/revoke"), nil, 204)
	coach.call("GET", "/api/v1/access/session", nil, 401)
	// Platform bootstrapping is operator-only, with a distinct global grant.
	platformLink, e := access.BootstrapPlatform(ctx, migrator, prefix+".platform")
	if e != nil {
		t.Fatal("platform setup", e)
	}
	platform := install(prefix+".platform", platformLink)
	ps := platform.call("GET", "/api/v1/access/session", nil, 200)
	if ps["platform_administrator"] != true {
		t.Fatal("platform authority")
	}
	platform.call("GET", path(clubB, "people"), nil, 200)
	platform.call("GET", "/api/v1/networks/"+nid, nil, 200)
	owner.call("POST", "/api/v1/platform/networks", map[string]any{"name": "Недоступная сеть"}, 403)
	otherNetwork := platform.call("POST", "/api/v1/platform/networks", map[string]any{"name": "Другая синтетическая сеть"}, 201)
	owner.call("GET", "/api/v1/networks/"+otherNetwork["network_id"].(string), nil, 403)
	platform.call("PUT", "/api/v1/platform/administrators", map[string]any{"login": prefix + ".platform", "active": false}, 409)
	owner.call("PUT", "/api/v1/networks/"+nid+"/owners", map[string]any{"login": prefix + ".owner", "active": false}, 409)
	owner.call("PUT", "/api/v1/networks/"+nid+"/owners", map[string]any{"login": prefix + ".foreign", "active": true}, 204)
	foreign.call("GET", "/api/v1/access/session", nil, 401)
	foreign.login(prefix+".foreign", password)
	owner.call("PUT", "/api/v1/networks/"+nid+"/owners", map[string]any{"login": prefix + ".foreign", "active": false}, 204)
	foreign.call("GET", "/api/v1/access/session", nil, 401)
	foreign.login(prefix+".foreign", password)
	foreign.call("GET", path(clubA, "people"), nil, 403)
	if _, e = admin.ExecContext(ctx, `DELETE FROM access.rate_limits`); e != nil {
		t.Fatal(e)
	}
	platform.call("PUT", "/api/v1/platform/administrators", map[string]any{"login": prefix + ".foreign", "active": true}, 204)
	foreign.call("GET", "/api/v1/access/session", nil, 401)
	foreign.login(prefix+".foreign", password)
	foreign.call("GET", path(clubA, "people"), nil, 200)
	platform.call("PUT", "/api/v1/platform/administrators", map[string]any{"login": prefix + ".foreign", "active": false}, 204)
	foreign.call("GET", "/api/v1/access/session", nil, 401)
	foreign.login(prefix+".foreign", password)
	foreign.call("GET", path(clubA, "people"), nil, 403)
	if bytes.Contains(logs.Bytes(), []byte("Синтетический Иванов")) || bytes.Contains(logs.Bytes(), []byte(password)) {
		t.Fatal("sensitive logs")
	}
}
