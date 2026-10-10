package httpapi_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/StarMadeGalaxy/JudeOS/db/migrations"
	"github.com/StarMadeGalaxy/JudeOS/internal/access"
	"github.com/StarMadeGalaxy/JudeOS/internal/people"
	"github.com/StarMadeGalaxy/JudeOS/internal/platform/database"
	"github.com/StarMadeGalaxy/JudeOS/internal/platform/httpapi"
)

func TestTrainingPostgresHTTP(t *testing.T) {
	if os.Getenv("JUDEOS_TEST_DATABASE_URL") == "" {
		t.Skip("disposable PostgreSQL required")
	}
	ctx := context.Background()
	open := func(key string) *sql.DB {
		db, e := database.Open(os.Getenv(key))
		if e != nil {
			t.Fatal("configuration")
		}
		t.Cleanup(func() { db.Close() })
		return db
	}
	migrator, runtime, admin := open("JUDEOS_TEST_MIGRATION_URL"), open("JUDEOS_TEST_RUNTIME_URL"), open("JUDEOS_TEST_DATABASE_URL")
	if e := database.Migrate(ctx, migrator, migrations.Version); e != nil {
		t.Fatal(e)
	}
	if _, e := admin.ExecContext(ctx, `DELETE FROM access.rate_limits`); e != nil {
		t.Fatal(e)
	}
	club, other := people.UUID(), people.UUID()
	scope := func(c string) database.TenantContext {
		return database.TenantContext{TenantID: c, ActorID: "00000000-0000-4000-8000-000000000301", RequestID: "00000000000000000000000000000029"}
	}
	for _, id := range []string{club, other} {
		if e := database.WithinTenant(ctx, migrator, scope(id), func(tx *sql.Tx) error {
			_, e := tx.ExecContext(ctx, `INSERT INTO core.clubs(tenant_id,name) VALUES($1,'Синтетический training клуб')`, id)
			return e
		}); e != nil {
			t.Fatal(e)
		}
	}
	// This fast suite crosses several accepted minute buckets. Reset only the
	// disposable limiter fixture between scenarios; production limits stay intact.
	resetLimiter := func() {
		t.Helper()
		if _, e := admin.ExecContext(ctx, `DELETE FROM access.rate_limits`); e != nil {
			t.Fatal(e)
		}
	}
	prefix := "training." + people.UUID()
	password := "synthetic-training-password-29"
	ownerLink, e := access.BootstrapOwner(ctx, migrator, club, prefix+".owner")
	if e != nil {
		t.Fatal(e)
	}
	foreignLink, e := access.BootstrapOwner(ctx, migrator, other, prefix+".foreign")
	if e != nil {
		t.Fatal(e)
	}
	var logs bytes.Buffer
	opts := httpapi.Options{Access: access.New(runtime), Logger: slog.New(slog.NewTextHandler(&logs, nil)), Ready: func(context.Context) error { return database.ReadyRuntime(ctx, runtime) }}
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
	install := func(login, token string) *browser {
		b := fresh()
		b.bootstrap()
		b.call("POST", "/api/v1/access/redeem", map[string]any{"token": token, "password": password}, 204)
		b.login(login, password)
		return b
	}
	owner, foreign := install(prefix+".owner", ownerLink.Token), install(prefix+".foreign", foreignLink.Token)
	path := func(c, r string) string { return "/api/v1/tenants/" + c + "/" + r }
	cp := func(r string) string { return path(club, r) }
	cmd := func(m map[string]any) map[string]any { m["operation_id"] = people.UUID(); return m }
	staff := func(suffix string, grants []access.Grant) (*browser, string) {
		login := prefix + suffix
		link := owner.call("POST", cp("staff/assignments"), map[string]any{"login": login, "grants": grants}, 201)
		b := install(login, link["token"].(string))
		mid := b.call("GET", "/api/v1/access/session", nil, 200)["memberships"].([]any)[0].(map[string]any)["membership_id"].(string)
		return b, mid
	}
	manager, _ := staff(".manager", []access.Grant{{Role: "manager", Scope: "club"}})
	coach1, mid1 := staff(".coach1", []access.Grant{{Role: "coach", Scope: "assigned_sessions"}})
	coach2, mid2 := staff(".coach2", []access.Grant{{Role: "coach", Scope: "assigned_sessions"}})
	groupOnly, mid3 := staff(".group-only", []access.Grant{{Role: "coach", Scope: "assigned_sessions"}})
	union, unionMID := staff(".union", []access.Grant{{Role: "coach", Scope: "assigned_sessions"}, {Role: "manager", Scope: "club"}})
	actor := manager.call("GET", "/api/v1/access/session", nil, 200)["account_id"].(string)
	foreignMID := foreign.call("GET", "/api/v1/access/session", nil, 200)["memberships"].([]any)[0].(map[string]any)["membership_id"].(string)
	makeAthlete := func(b *browser, c, name string) string {
		p := b.call("POST", path(c, "people"), cmd(map[string]any{"display_name": name}), 201)
		a := b.call("POST", path(c, "athletes"), cmd(map[string]any{"person_id": p["person_id"], "participation": "regular"}), 201)
		return a["athlete_id"].(string)
	}
	a1 := makeAthlete(manager, club, "Синтетический однофамилец")
	a2 := makeAthlete(manager, club, "Синтетический однофамилец")
	a3 := makeAthlete(manager, club, "Синтетический временный визит")
	a4 := makeAthlete(manager, club, "Синтетический участник гонки")
	otherAthlete := makeAthlete(foreign, other, "Синтетический другой клуб")
	venueCmd := cmd(map[string]any{"name": "Синтетический зал"})
	venue := manager.call("POST", cp("venues"), venueCmd, 201)
	vid := venue["venue_id"].(string)
	replay := manager.call("POST", cp("venues"), venueCmd, 201)
	if replay["venue_id"] != vid {
		t.Fatal("duplicate venue")
	}
	manager.call("GET", cp("venues/"+vid), nil, 200)
	manager.call("PUT", cp("venues/"+vid), cmd(map[string]any{"base_version": 1, "name": "Синтетический зал обновлён"}), 200)
	// Exact replay ignores its old version; another payload with this ID conflicts.
	if manager.call("POST", cp("venues"), venueCmd, 201)["venue_id"] != vid {
		t.Fatal("lost response replay")
	}
	changed := map[string]any{"operation_id": venueCmd["operation_id"], "name": "Иной синтетический зал"}
	manager.call("POST", cp("venues"), changed, 409)
	// Global logical operation namespace is shared with accepted people commands.
	manager.call("POST", cp("people"), map[string]any{"operation_id": venueCmd["operation_id"], "display_name": "Недопустимый второй эффект"}, 409)
	personCmd := cmd(map[string]any{"display_name": "Синтетический ключ people"})
	manager.call("POST", cp("people"), personCmd, 201)
	manager.call("POST", cp("venues"), map[string]any{"operation_id": personCmd["operation_id"], "name": "Недопустимый второй эффект"}, 409)
	discipline := manager.call("POST", cp("disciplines"), cmd(map[string]any{"name": "Синтетическое дзюдо"}), 201)
	did := discipline["discipline_id"].(string)
	manager.call("GET", cp("disciplines/"+did), nil, 200)
	manager.call("PUT", cp("disciplines/"+did), cmd(map[string]any{"base_version": 1, "name": "Синтетическое направление"}), 200)
	group := manager.call("POST", cp("groups"), cmd(map[string]any{"name": "Синтетическая группа А", "venue_id": vid, "discipline_id": did}), 201)
	gid := group["group_id"].(string)
	gpath := cp("groups/" + gid)
	group2 := manager.call("POST", cp("groups"), cmd(map[string]any{"name": "Синтетическая группа Б", "venue_id": vid, "discipline_id": did}), 201)
	gid2 := group2["group_id"].(string)
	gv := func() float64 { return manager.call("GET", gpath, nil, 200)["version"].(float64) }
	enroll := func(id, athlete string, base float64) map[string]any {
		return manager.call("POST", cp("groups/"+id+"/enrollments"), cmd(map[string]any{"base_version": base, "athlete_id": athlete, "valid_from": "2026-10-01T00:00:00Z", "valid_until": nil}), 201)
	}
	group = enroll(gid, a1, gv())
	eid := group["enrollments"].([]any)[0].(map[string]any)["enrollment_id"].(string)
	enroll(gid2, a1, 1) // Several groups do not imply an exclusive "main" group.
	group = enroll(gid, a2, gv())
	manager.call("POST", gpath+"/enrollments", cmd(map[string]any{"base_version": gv(), "athlete_id": a1, "valid_from": "2026-10-02T00:00:00Z", "valid_until": nil}), 409)
	manager.call("POST", gpath+"/enrollments", cmd(map[string]any{"base_version": 1, "athlete_id": otherAthlete, "valid_from": "2026-10-01T00:00:00Z", "valid_until": nil}), 404)
	for _, mid := range []string{mid1, mid2, mid3} {
		manager.call("POST", gpath+"/coaches", cmd(map[string]any{"base_version": gv(), "membership_id": mid, "valid_from": "2026-10-01T00:00:00Z", "valid_until": nil}), 201)
	}
	group = manager.call("GET", gpath, nil, 200)
	if len(group["enrollments"].([]any)) != 2 || len(group["coaches"].([]any)) != 3 {
		t.Fatal("multiple relationships")
	}
	groupCoachID := group["coaches"].([]any)[0].(map[string]any)["group_coach_id"].(string)
	manager.call("POST", gpath+"/coaches", cmd(map[string]any{"base_version": gv(), "membership_id": mid1, "valid_from": "2026-10-05T00:00:00Z", "valid_until": nil}), 409)
	manager.call("POST", gpath+"/coaches", cmd(map[string]any{"base_version": 1, "membership_id": foreignMID, "valid_from": "2026-10-01T00:00:00Z", "valid_until": nil}), 404)
	// A roster is an explicit selection, not all Enrollment or all GroupCoach.
	manual := func(starts, ends string, selection []any, coaches []string) map[string]any {
		return cmd(map[string]any{"group_id": gid, "group_base_version": gv(), "venue_id": vid, "starts_at": starts, "ends_at": ends, "roster": selection, "coach_membership_ids": coaches})
	}
	old := manager.call("POST", cp("sessions"), manual("2026-10-09T15:00:00Z", "2026-10-09T16:00:00Z", []any{map[string]any{"athlete_id": a1, "trial": false}}, []string{mid1, mid2}), 201)
	oldID := old["session"].(map[string]any)["session_id"].(string)
	create := manual("2026-10-10T15:00:00Z", "2026-10-10T16:00:00Z", []any{map[string]any{"athlete_id": a1, "trial": false}}, []string{mid1, mid2})
	current := manager.call("POST", cp("sessions"), create, 201)
	sid := current["session"].(map[string]any)["session_id"].(string)
	spath := cp("sessions/" + sid)
	if len(current["roster"].([]any)) != 1 || current["roster"].([]any)[0].(map[string]any)["participation"] != "regular" {
		t.Fatal("roster was inferred instead of selected")
	}
	if manager.call("POST", cp("sessions"), create, 201)["session"].(map[string]any)["session_id"] != sid {
		t.Fatal("duplicate manual session")
	}
	coach1.call("GET", spath, nil, 200)
	coach2.call("GET", spath, nil, 200)
	groupOnly.call("GET", spath, nil, 404)
	groupOnly.call("GET", cp("sessions?date=2026-10-10"), nil, 200)
	if len(groupOnly.call("GET", cp("sessions?date=2026-10-10"), nil, 200)["items"].([]any)) != 0 {
		t.Fatal("GroupCoach leaked session")
	}
	coach1.call("GET", gpath, nil, 403)
	coach1.call("GET", spath+"/coaches", nil, 403)
	coach1.call("POST", cp("sessions"), manual("2026-10-10T17:00:00Z", "2026-10-10T18:00:00Z", []any{}, []string{mid1}), 403)
	coach1.call("POST", gpath+"/enrollments", cmd(map[string]any{"base_version": gv(), "athlete_id": a3, "valid_from": "2026-10-10T00:00:00Z", "valid_until": nil}), 403)
	coach1.call("POST", spath+"/roster/"+a1+"/exclude", cmd(map[string]any{"base_version": 1}), 403)
	coach1.call("PUT", spath+"/coaches", cmd(map[string]any{"base_version": 1, "coach_membership_ids": []string{mid1}}), 403)
	coach1.call("POST", spath+"/roster", map[string]any{"operation_id": people.UUID(), "base_version": 1, "athlete_id": a3, "trial": false, "enroll_permanently": true}, 400)
	add := cmd(map[string]any{"base_version": 1, "athlete_id": a3, "trial": true})
	added := coach1.call("POST", spath+"/roster", add, 200)
	if added["entry"].(map[string]any)["participation"] != "visit" || added["entry"].(map[string]any)["trial"] != true {
		t.Fatal("known visit lost")
	}
	coach1.call("POST", spath+"/roster", add, 200)
	entry := added["entry"].(map[string]any)
	for _, key := range []string{"primary_contact", "admission", "household_id", "phone", "account_id"} {
		if _, ok := entry[key]; ok {
			t.Fatal("unimplemented/private field exposed", key)
		}
	}
	// Exclusion is an irreversible saved row. A new no-op exclusion does not bump.
	excluded := manager.call("POST", spath+"/roster/"+a3+"/exclude", cmd(map[string]any{"base_version": 2}), 200)
	if excluded["entry"].(map[string]any)["excluded"] != true {
		t.Fatal("physical deletion/exclusion missing")
	}
	if manager.call("POST", spath+"/roster/"+a3+"/exclude", cmd(map[string]any{"base_version": 3}), 200)["session"].(map[string]any)["version"] != float64(3) {
		t.Fatal("no-op version")
	}
	coach1.call("POST", spath+"/roster", cmd(map[string]any{"base_version": 3, "athlete_id": a3, "trial": false}), 409)
	coach1.call("POST", spath+"/roster", add, 409) // Replay cannot reveal an active excluded row.
	resetLimiter()
	// No implicit changes to Enrollment or other/future sessions.
	if len(manager.call("GET", gpath, nil, 200)["enrollments"].([]any)) != 2 {
		t.Fatal("coach created Enrollment")
	}
	// Introduce closed state only as a DB fixture: #31 is still not implemented.
	if e := database.WithinTenant(ctx, migrator, scope(club), func(tx *sql.Tx) error {
		_, e := tx.ExecContext(ctx, `UPDATE core.training_sessions SET state='closed',version=version+1 WHERE id=$1`, oldID)
		return e
	}); e != nil {
		t.Fatal(e)
	}
	oldBefore := manager.call("GET", cp("sessions/"+oldID), nil, 200)
	manager.call("POST", gpath+"/enrollments/"+eid+"/end", cmd(map[string]any{"base_version": gv(), "valid_until": "2026-10-10T00:00:00Z"}), 200)
	destination := manager.call("POST", cp("groups"), cmd(map[string]any{"name": "Синтетическая группа перевода", "venue_id": vid, "discipline_id": did}), 201)
	manager.call("POST", cp("groups/"+destination["group_id"].(string)+"/enrollments"), cmd(map[string]any{"base_version": 1, "athlete_id": a1, "valid_from": "2026-10-10T00:00:00Z", "valid_until": nil}), 201)
	manager.call("POST", gpath+"/coaches/"+groupCoachID+"/end", cmd(map[string]any{"base_version": gv(), "valid_until": "2026-10-10T00:00:00Z"}), 200)
	manager.call("PUT", gpath, cmd(map[string]any{"base_version": gv(), "name": "Синтетическая группа после перевода", "venue_id": vid, "discipline_id": did}), 200)
	oldAfter := manager.call("GET", cp("sessions/"+oldID), nil, 200)
	beforeJSON, _ := json.Marshal(oldBefore)
	afterJSON, _ := json.Marshal(oldAfter)
	if !bytes.Equal(beforeJSON, afterJSON) {
		t.Fatal("transfer renamed or changed historical session/roster")
	}
	// Even an already materialized future roster remains explicitly saved.
	now := manager.call("GET", spath, nil, 200)
	if len(now["roster"].([]any)) != 2 {
		t.Fatal("transfer recalculated roster")
	}
	for _, raw := range now["roster"].([]any) {
		row := raw.(map[string]any)
		if row["athlete_id"] == a1 && (row["participation"] != "regular" || row["excluded"] != false) {
			t.Fatal("saved regular row changed after transfer")
		}
	}
	coach1.call("GET", cp("sessions/"+oldID), nil, 200)
	manager.call("POST", cp("sessions/"+oldID+"/roster"), cmd(map[string]any{"base_version": 2, "athlete_id": a2, "trial": false}), 409)
	manager.call("POST", cp("sessions/"+oldID+"/roster/"+a1+"/exclude"), cmd(map[string]any{"base_version": 2}), 409)
	manager.call("PUT", cp("sessions/"+oldID+"/coaches"), cmd(map[string]any{"base_version": 2, "coach_membership_ids": []string{mid1, mid3}}), 409)
	manager.call("PUT", cp("sessions/"+oldID+"/coaches"), cmd(map[string]any{"base_version": 2, "coach_membership_ids": []string{mid2}}), 200)
	coach1.call("GET", cp("sessions/"+oldID), nil, 404)
	// Cancelled is also a migrator-only fixture. Cancellation commands belong to #30.
	if e := database.WithinTenant(ctx, migrator, scope(club), func(tx *sql.Tx) error {
		_, e := tx.ExecContext(ctx, `UPDATE core.training_sessions SET state='cancelled',version=version+1 WHERE id=$1`, oldID)
		return e
	}); e != nil {
		t.Fatal(e)
	}
	manager.call("POST", cp("sessions/"+oldID+"/roster"), cmd(map[string]any{"base_version": 4, "athlete_id": a2, "trial": false}), 409)
	manager.call("PUT", cp("sessions/"+oldID+"/coaches"), cmd(map[string]any{"base_version": 4, "coach_membership_ids": []string{mid2, mid3}}), 409)
	// Current SessionCoach changes version and retains the ended assignment.
	cs := manager.call("PUT", spath+"/coaches", cmd(map[string]any{"base_version": 3, "coach_membership_ids": []string{mid1}}), 200)
	if len(cs["coaches"].([]any)) != 2 || cs["version"] != float64(4) {
		t.Fatal("assignment history missing")
	}
	coach2.call("GET", spath, nil, 404)
	coach2.call("POST", spath+"/roster", cmd(map[string]any{"base_version": 4, "athlete_id": a2, "trial": false}), 404)
	union.call("GET", spath, nil, 200)
	union.call("POST", spath+"/roster/"+a1+"/exclude", cmd(map[string]any{"base_version": 4}), 200)
	// A dated list includes the early UTC start in the correct Minsk date.
	manager.call("POST", cp("sessions"), manual("2026-10-09T22:00:00Z", "2026-10-09T23:00:00Z", []any{}, []string{mid1}), 201)
	page := coach1.call("GET", cp("sessions?date=2026-10-10&limit=1"), nil, 200)
	if len(page["items"].([]any)) != 1 || page["next_cursor"] == nil {
		t.Fatal("Minsk pagination")
	}
	cursor := page["next_cursor"].(string)
	next := coach1.call("GET", cp("sessions?date=2026-10-10&limit=1&cursor="+cursor), nil, 200)
	if len(next["items"].([]any)) != 1 || next["next_cursor"] != nil {
		t.Fatal("cursor page")
	}
	coach1.call("GET", cp("sessions?date=2026-10-09&cursor="+cursor), nil, 400)
	coach2.call("GET", cp("sessions?date=2026-10-10&cursor="+cursor), nil, 400)
	coach1.call("GET", cp("sessions?date=2026-10-10&cursor="+cursor+"X"), nil, 400)
	coach1.call("GET", cp("sessions?date=2026-02-30"), nil, 400)
	owner.call("GET", path(other, "groups"), nil, 403)
	foreign.call("GET", cp("sessions?date=2026-10-10"), nil, 403)
	foreignVenue := foreign.call("POST", path(other, "venues"), cmd(map[string]any{"name": "Чужой синтетический зал"}), 201)["venue_id"].(string)
	manager.call("GET", cp("venues/"+foreignVenue), nil, 404)
	manager.call("POST", cp("groups"), cmd(map[string]any{"name": "Синтетическая недопустимая связь", "venue_id": foreignVenue, "discipline_id": did}), 404)
	foreign.call("GET", path(other, "sessions/"+sid), nil, 404)
	// Terminal version conflicts are saved; exact retry retains that outcome.
	stale := cmd(map[string]any{"base_version": 1, "coach_membership_ids": []string{mid1}})
	f := manager.call("PUT", spath+"/coaches", stale, 409)
	if f["code"] != "SESSION_VERSION_CONFLICT" {
		t.Fatal("version code")
	}
	manager.call("PUT", spath+"/coaches", stale, 409)
	resetLimiter()
	// Concurrent response collection uses real TLS requests. No body/header mocking.
	type outcome struct {
		status int
		body   map[string]any
	}
	send := func(b *browser, method, p string, payload any) outcome {
		raw, _ := json.Marshal(payload)
		req, _ := http.NewRequest(method, server.URL+p, bytes.NewReader(raw))
		req.Header.Set("Origin", server.URL)
		req.Header.Set("X-CSRF-Token", b.csrf)
		req.Header.Set("Content-Type", "application/json")
		res, e := b.client.Do(req)
		if e != nil {
			return outcome{}
		}
		defer res.Body.Close()
		var v map[string]any
		json.NewDecoder(res.Body).Decode(&v)
		return outcome{res.StatusCode, v}
	}
	race := func(a, b map[string]any, resource string, want map[int]int) {
		results := make(chan outcome, 2)
		var wg sync.WaitGroup
		for _, payload := range []map[string]any{a, b} {
			wg.Add(1)
			go func(payload map[string]any) { defer wg.Done(); results <- send(manager, "POST", resource, payload) }(payload)
		}
		wg.Wait()
		close(results)
		counts := map[int]int{}
		for r := range results {
			counts[r.status]++
		}
		for code, n := range want {
			if counts[code] != n {
				t.Fatalf("HTTP concurrency counts=%v want=%v", counts, want)
			}
		}
	}
	base := manager.call("GET", spath, nil, 200)["session"].(map[string]any)["version"].(float64)
	race(cmd(map[string]any{"base_version": base, "athlete_id": a2, "trial": false}), cmd(map[string]any{"base_version": base, "athlete_id": a4, "trial": false}), spath+"/roster", map[int]int{200: 1, 409: 1})
	// The same operation concurrently creates exactly one row/result/audit effect.
	retryAthlete := makeAthlete(manager, club, "Синтетический повтор гонки")
	base = manager.call("GET", spath, nil, 200)["session"].(map[string]any)["version"].(float64)
	duplicate := cmd(map[string]any{"base_version": base, "athlete_id": retryAthlete, "trial": false})
	race(duplicate, duplicate, spath+"/roster", map[int]int{200: 2})
	// Revoke assignment while a request waits behind the club lock. This explicitly
	// tests stale preauthorization, with real HTTP and a controlled DB interleaving.
	raceAthlete := makeAthlete(manager, club, "Синтетический после отзыва")
	base = manager.call("GET", spath, nil, 200)["session"].(map[string]any)["version"].(float64)
	var pending chan outcome
	e = database.WithinTenant(ctx, runtime, scope(club), func(tx *sql.Tx) error {
		if _, e := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,21))`, club); e != nil {
			return e
		}
		pending = make(chan outcome, 1)
		go func() {
			pending <- send(coach1, "POST", spath+"/roster", cmd(map[string]any{"base_version": base, "athlete_id": raceAthlete, "trial": false}))
		}()
		deadline := time.Now().Add(3 * time.Second)
		waiting := false
		for time.Now().Before(deadline) {
			var n int
			if e := admin.QueryRowContext(ctx, `SELECT count(*) FROM pg_stat_activity WHERE usename='judeos_runtime' AND wait_event='advisory'`).Scan(&n); e != nil {
				return e
			}
			if n > 0 {
				waiting = true
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
		if !waiting {
			return fmt.Errorf("HTTP writer did not wait for revocation lock")
		}
		if _, e := tx.ExecContext(ctx, `UPDATE core.training_session_coaches SET valid_until=clock_timestamp(),ended_by_account_id=$2 WHERE session_id=$1 AND membership_id=$3 AND valid_until IS NULL`, sid, actor, mid1); e != nil {
			return e
		}
		if _, e := tx.ExecContext(ctx, `UPDATE core.training_sessions SET version=version+1 WHERE id=$1`, sid); e != nil {
			return e
		}
		// Commit must precede receiving the blocked HTTP request.
		return nil
	})
	if e != nil {
		t.Fatal(e)
	}
	select {
	case blocked := <-pending:
		if blocked.status != 404 {
			t.Fatalf("stale authorized writer status=%d", blocked.status)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("blocked HTTP did not complete")
	}
	coach1.call("GET", spath, nil, 404)
	// Removal of SessionCoach cannot be undone by a later club role regrant.
	manager.call("POST", cp("coaches/"+mid1+"/revoke"), nil, 204)
	coach1.call("GET", cp("sessions?date=2026-10-10"), nil, 401)
	// Repeated role union still grants the manager path independently of coach.
	union.call("GET", spath, nil, 200)
	_ = unionMID
	resetLimiter()
	// Archive directories/groups preserve the historical sessions and relationships.
	archGroup := manager.call("POST", gpath+"/archive", cmd(map[string]any{"base_version": gv()}), 200)
	if len(archGroup["enrollments"].([]any)) != 2 {
		t.Fatal("archive deleted intervals")
	}
	manager.call("POST", gpath+"/archive", cmd(map[string]any{"base_version": archGroup["version"]}), 200)
	manager.call("POST", gpath+"/enrollments", cmd(map[string]any{"base_version": archGroup["version"], "athlete_id": a4, "valid_from": "2026-10-20T00:00:00Z", "valid_until": nil}), 409)
	manager.call("POST", cp("venues/"+vid+"/archive"), cmd(map[string]any{"base_version": 2}), 200)
	manager.call("POST", cp("disciplines/"+did+"/archive"), cmd(map[string]any{"base_version": 2}), 200)
	manager.call("POST", cp("venues/"+vid+"/archive"), cmd(map[string]any{"base_version": 3}), 200)
	manager.call("POST", cp("disciplines/"+did+"/archive"), cmd(map[string]any{"base_version": 3}), 200)
	manager.call("GET", cp("venues?state=archived"), nil, 200)
	manager.call("GET", cp("disciplines?state=all"), nil, 200)
	manager.call("GET", cp("groups?state=all&limit=1"), nil, 200)
	latest := manager.call("GET", cp("sessions/"+oldID), nil, 200)
	oldRoster, _ := json.Marshal(oldBefore["roster"])
	latestRoster, _ := json.Marshal(latest["roster"])
	if !bytes.Equal(oldRoster, latestRoster) || latest["session"].(map[string]any)["group"].(map[string]any)["name"] != "Синтетическая группа А" {
		t.Fatal("archive changed saved history")
	}

	// Database-level RLS/FK/privileges/history/audit evidence (not schema fixtures).
	var count int
	if e := database.WithinTenant(ctx, runtime, scope(club), func(tx *sql.Tx) error {
		if e := tx.QueryRowContext(ctx, `SELECT count(*) FROM core.training_operations WHERE actor_id=$1 AND operation_id=$2`, actor, duplicate["operation_id"]).Scan(&count); e != nil {
			return e
		}
		if count != 1 {
			return fmt.Errorf("duplicate operation ledger")
		}
		if e := tx.QueryRowContext(ctx, `SELECT count(*) FROM core.training_roster WHERE session_id=$1 AND athlete_id=$2`, sid, retryAthlete).Scan(&count); e != nil {
			return e
		}
		if count != 1 {
			return fmt.Errorf("duplicate roster effect")
		}
		if e := tx.QueryRowContext(ctx, `SELECT count(*) FROM core.training_roster WHERE session_id=$1 AND athlete_id=$2`, sid, raceAthlete).Scan(&count); e != nil {
			return e
		}
		if count != 0 {
			return fmt.Errorf("revoked writer committed")
		}
		return nil
	}); e != nil {
		t.Fatal(e)
	}
	for _, statement := range []string{`DELETE FROM core.training_roster`, `SELECT * FROM core.audit_events`, `UPDATE core.training_sessions SET state='closed'`, `UPDATE core.training_roster SET participation='regular'`} {
		if e := database.WithinTenant(ctx, runtime, scope(club), func(tx *sql.Tx) error { _, e := tx.ExecContext(ctx, statement); return e }); e == nil {
			t.Fatal("runtime authority leak")
		}
	}
	if e := database.WithinTenant(ctx, runtime, scope(club), func(tx *sql.Tx) error {
		_, e := tx.ExecContext(ctx, `INSERT INTO core.training_enrollments(tenant_id,id,group_id,athlete_id,valid_from) VALUES($1,$2,$3,$4,'2026-12-01')`, club, people.UUID(), gid2, otherAthlete)
		return e
	}); e == nil {
		t.Fatal("cross-club FK allowed")
	}
	for _, guard := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO core.training_enrollments(tenant_id,id,group_id,athlete_id,valid_from) VALUES($1,$2,$3,$4,'2026-10-02')`, []any{club, people.UUID(), gid2, a1}},
		{`UPDATE core.training_enrollments SET valid_until=NULL WHERE id=$1`, []any{eid}},
		{`UPDATE core.training_roster SET excluded=false,excluded_at=NULL,excluded_by_account_id=NULL WHERE session_id=$1 AND athlete_id=$2`, []any{sid, a1}},
		{`UPDATE core.training_roster SET excluded=true,excluded_at=clock_timestamp(),excluded_by_account_id=$3 WHERE session_id=$1 AND athlete_id=$2`, []any{oldID, a1, actor}},
		{`INSERT INTO core.training_roster(tenant_id,id,session_id,athlete_id,participation,trial,added_by_account_id) VALUES($1,$2,$3,$4,'visit',false,$5)`, []any{club, people.UUID(), oldID, a2, actor}},
		{`INSERT INTO core.training_session_coaches(tenant_id,id,session_id,membership_id,assigned_by_account_id) VALUES($1,$2,$3,$4,$5)`, []any{club, people.UUID(), oldID, mid3, actor}},
	} {
		if e := database.WithinTenant(ctx, runtime, scope(club), func(tx *sql.Tx) error { _, e := tx.ExecContext(ctx, guard.sql, guard.args...); return e }); e == nil {
			t.Fatal("SQL lifecycle/interval guard allowed invalid mutation")
		}
	}
	if _, e := runtime.ExecContext(ctx, `SELECT * FROM core.training_sessions`); e == nil {
		t.Fatal("missing tenant context allowed")
	}
	if e := database.WithinTenant(ctx, migrator, scope(club), func(tx *sql.Tx) error {
		var n int
		if e := tx.QueryRowContext(ctx, `SELECT count(*) FROM core.audit_events WHERE object_type='session_roster' AND action='INSERT' AND object_id IN(SELECT id FROM core.training_roster WHERE session_id=$1 AND athlete_id=$2)`, sid, retryAthlete).Scan(&n); e != nil {
			return e
		}
		if n != 1 {
			return fmt.Errorf("duplicate audit")
		}
		var safe bool
		if e := tx.QueryRowContext(ctx, `SELECT NOT EXISTS(SELECT 1 FROM core.audit_events WHERE row_to_json(audit_events)::text LIKE '%Синтетический%')`).Scan(&safe); e != nil {
			return e
		}
		if !safe {
			return fmt.Errorf("audit contained profile text")
		}
		return nil
	}); e != nil {
		t.Fatal(e)
	}
	if strings.Contains(logs.String(), "Синтетический") || strings.Contains(logs.String(), password) {
		t.Fatal("private data in request logs")
	}
	t.Log("Real TLS HTTP/PostgreSQL training: groups/periods/manual selection, saved history, two coaches, role/tenant gates, replay/version/races and RLS/FK/audit passed. close/attendance/guest/admission remain unimplemented.")
}
