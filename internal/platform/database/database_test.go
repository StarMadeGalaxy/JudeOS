package database

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"sync"
	"testing"

	"github.com/StarMadeGalaxy/JudeOS/db/migrations"
)

const (
	clubA   = "00000000-0000-4000-8000-000000000101"
	clubB   = "00000000-0000-4000-8000-000000000102"
	objectA = "00000000-0000-4000-8000-000000000201"
	objectB = "00000000-0000-4000-8000-000000000202"
	actor   = "00000000-0000-4000-8000-000000000301"
	request = "abcdefabcdefabcdefabcdefabcdefab"
)

func scope(tenant string) TenantContext { return TenantContext{tenant, actor, request} }

// Requires a disposable local database and separate actual LOGIN connections.
// Never uses DATABASE_URL or runs parallel migrations against a shared database.
func TestPostgresIsolationAndUpgrade(t *testing.T) {
	if os.Getenv("JUDEOS_TEST_DATABASE_URL") == "" {
		t.Skip("run make check-db for disposable PostgreSQL")
	}
	ctx := context.Background()
	open := func(key string) *sql.DB {
		t.Helper()
		db, err := Open(os.Getenv(key))
		if err != nil {
			t.Fatal("test connection configuration failed")
		}
		t.Cleanup(func() { db.Close() })
		return db
	}
	admin := open("JUDEOS_TEST_DATABASE_URL")
	if Ready(ctx, admin) == nil {
		t.Fatal("empty database must not be ready")
	}
	// Reproduce #19 exactly: old schema/table ownership belongs to local admin.
	if err := Migrate(ctx, admin, 1); err != nil {
		t.Fatal("legacy migration failed")
	}
	if _, err := admin.ExecContext(ctx, `INSERT INTO development.sample_clubs VALUES ('00000000-0000-4000-8000-000000000999','Синтетический клуб обновления')`); err != nil {
		t.Fatal("legacy fixture failed")
	}
	if err := Migrate(ctx, admin, 2); err != nil {
		t.Fatal("legacy upgrade failed")
	}
	if Ready(ctx, admin) == nil {
		t.Fatal("old database must not be ready")
	}
	if err := Bootstrap(ctx, admin, os.Getenv("JUDEOS_TEST_MIGRATION_PASSWORD"), os.Getenv("JUDEOS_TEST_RUNTIME_PASSWORD")); err != nil {
		t.Fatal("role bootstrap failed")
	}
	if err := Bootstrap(ctx, admin, os.Getenv("JUDEOS_TEST_MIGRATION_PASSWORD"), os.Getenv("JUDEOS_TEST_RUNTIME_PASSWORD")); err != nil {
		t.Fatal("repeat bootstrap failed")
	}
	migrator := open("JUDEOS_TEST_MIGRATION_URL")
	runtime := open("JUDEOS_TEST_RUNTIME_URL")
	// Bind audit_reader only inside this disposable test session using admin SET ROLE.
	// The NOLOGIN capability is deliberately not granted to any application login.
	auditor := open("JUDEOS_TEST_DATABASE_URL")
	auditor.SetMaxOpenConns(1)
	auditor.SetMaxIdleConns(1)
	if _, err := auditor.ExecContext(ctx, "SET ROLE judeos_audit_reader"); err != nil {
		t.Fatal("audit test role failed")
	}
	if err := Migrate(ctx, migrator, migrations.Version); err != nil {
		t.Fatal("tenant migration failed", err)
	}
	if err := Migrate(ctx, migrator, migrations.Version); err != nil {
		t.Fatal("repeat migration failed")
	}
	if err := Ready(ctx, migrator); err != nil {
		t.Fatal("schema not ready")
	}
	if ReadyRuntime(ctx, admin) == nil || ReadyRuntime(ctx, migrator) == nil {
		t.Fatal("privileged API configuration accepted")
	}
	if err := ReadyRuntime(ctx, runtime); err != nil {
		t.Fatal("runtime not ready")
	}
	for i := 0; i < 2; i++ {
		if err := Seed(ctx, migrator); err != nil {
			t.Fatal("seed failed")
		}
	}
	var count int
	if err := admin.QueryRowContext(ctx, "SELECT count(*) FROM core.clubs").Scan(&count); err != nil || count != 3 {
		t.Fatal("existing clubs lost/duplicated")
	}
	var zone string
	if err := admin.QueryRowContext(ctx, "SELECT timezone FROM core.clubs WHERE tenant_id='00000000-0000-4000-8000-000000000999'").Scan(&zone); err != nil || zone != "Europe/Minsk" {
		t.Fatal("existing row not migrated")
	}
	assertRoles(t, admin)
	// Reading seeded rows without tenant context must error, not expose all tenants.
	if err := runtime.QueryRowContext(ctx, "SELECT count(*) FROM core.clubs").Scan(&count); !errors.Is(safeError(err), ErrDenied) {
		t.Fatal("missing SQL context accepted")
	}
	called := false
	if err := WithinTenant(ctx, runtime, TenantContext{}, func(*sql.Tx) error { called = true; return nil }); !errors.Is(err, ErrContext) || called {
		t.Fatal("missing application context accepted")
	}
	if err := WithinTenant(ctx, runtime, TenantContext{clubA, actor, "secret\n"}, func(*sql.Tx) error { return nil }); !errors.Is(err, ErrContext) {
		t.Fatal("untrusted metadata accepted")
	}
	runtime.SetMaxOpenConns(1)
	runtime.SetMaxIdleConns(1)
	inspect := func(tenant string) error {
		return WithinTenant(ctx, runtime, scope(tenant), func(tx *sql.Tx) error {
			var got string
			if err := tx.QueryRowContext(ctx, "SELECT tenant_id::text FROM core.clubs").Scan(&got); err != nil {
				return err
			}
			if got != tenant {
				return errors.New("wrong tenant")
			}
			var n int
			if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM development.sample_objects WHERE tenant_id <> $1", tenant).Scan(&n); err != nil {
				return err
			}
			if n != 0 {
				return errors.New("cross tenant read")
			}
			return nil
		})
	}
	for _, tenant := range []string{clubA, clubB, clubA} {
		if err := inspect(tenant); err != nil {
			t.Fatal("tenant read failed")
		}
		assertNoContext(t, runtime)
	}
	deny := func(statement string, want error, args ...any) {
		t.Helper()
		err := WithinTenant(ctx, runtime, scope(clubA), func(tx *sql.Tx) error { _, err := tx.ExecContext(ctx, statement, args...); return err })
		if !errors.Is(err, want) {
			t.Fatalf("rejection mismatch: got %v, want %v", err, want)
		}
		assertNoContext(t, runtime)
	}
	deny(`INSERT INTO development.sample_objects(tenant_id,id,label) VALUES($1,$2,'x')`, ErrDenied, clubB, "00000000-0000-4000-8000-000000000401")
	deny(`UPDATE development.sample_objects SET tenant_id=$1 WHERE id=$2`, ErrDenied, clubB, objectA)
	deny(`INSERT INTO development.sample_objects(tenant_id,id,parent_id,label) VALUES($1,$2,$3,'x')`, ErrConflict, clubA, "00000000-0000-4000-8000-000000000401", objectB)
	deny(`INSERT INTO development.sample_objects(tenant_id,id,label) VALUES($1,$2,'x')`, ErrConflict, clubA, objectA)
	for _, statement := range []string{
		"SELECT * FROM core.audit_events", "INSERT INTO core.audit_events DEFAULT VALUES",
		"UPDATE core.audit_events SET action='DELETE'", "DELETE FROM core.audit_events",
		"TRUNCATE development.sample_objects", "ALTER TABLE core.clubs DISABLE ROW LEVEL SECURITY",
		"CREATE TABLE public.forbidden(id int)", "SELECT * FROM development.sample_clubs",
		"SET ROLE judeos_migrator", "SET ROLE judeos_audit_reader", "SELECT core.record_change()",
	} {
		deny(statement, ErrDenied)
	}
	if err := WithinTenant(ctx, runtime, scope(clubA), func(tx *sql.Tx) error {
		for _, verb := range []string{"UPDATE development.sample_objects SET label='x'", "DELETE FROM development.sample_objects"} {
			result, err := tx.ExecContext(ctx, verb+" WHERE tenant_id=$1", clubB)
			if err != nil {
				return err
			}
			n, err := result.RowsAffected()
			if err != nil {
				return err
			}
			if n != 0 {
				return errors.New("foreign row changed")
			}
		}
		return nil
	}); err != nil {
		t.Fatal("USING failed")
	}
	// Successful insert/update/delete append metadata atomically, never field values.
	newID := "00000000-0000-4000-8000-000000000401"
	secret := "synthetic-contact-secret@example.invalid"
	if err := WithinTenant(ctx, runtime, scope(clubA), func(tx *sql.Tx) error {
		for _, statement := range []string{
			`INSERT INTO development.sample_objects(tenant_id,id,parent_id,label) VALUES($1,$2,'00000000-0000-4000-8000-000000000201',$3)`,
			`UPDATE development.sample_objects SET label=$3||'-changed' WHERE tenant_id=$1 AND id=$2`,
			`UPDATE development.sample_objects SET label=label WHERE tenant_id=$1 AND id=$2 AND $3<>''`,
			`DELETE FROM development.sample_objects WHERE tenant_id=$1 AND id=$2 AND $3<>''`,
		} {
			if _, err := tx.ExecContext(ctx, statement, clubA, newID, secret); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal("own tenant CRUD failed", err)
	}
	if err := WithinTenant(ctx, auditor, scope(clubA), func(tx *sql.Tx) error {
		var n int
		err := tx.QueryRowContext(ctx, `SELECT count(*) FROM core.audit_events WHERE object_id=$1 AND actor_id=$2 AND request_id=$3`, newID, actor, request).Scan(&n)
		if err != nil {
			return err
		}
		if n != 3 {
			return errors.New("audit missing/no-op incorrectly audited")
		}
		var leaks int
		err = tx.QueryRowContext(ctx, `SELECT count(*) FROM core.audit_events e WHERE e.tenant_id<>$1 OR row_to_json(e)::text LIKE '%'||$2||'%'`, clubA, secret).Scan(&leaks)
		if err != nil {
			return err
		}
		if leaks != 0 {
			return errors.New("audit leaks fields/tenant")
		}
		return nil
	}); err != nil {
		t.Fatal("audit verification failed", err)
	}
	// SQL error rollback and panic rollback must remove both effect and audit.
	for _, panicCase := range []bool{false, true} {
		func() {
			defer func() {
				if panicCase && recover() == nil {
					t.Error("expected panic")
				}
			}()
			err := WithinTenant(ctx, runtime, scope(clubA), func(tx *sql.Tx) error {
				if _, err := tx.ExecContext(ctx, `INSERT INTO development.sample_objects(tenant_id,id,label) VALUES($1,$2,'rolled back')`, clubA, newID); err != nil {
					return err
				}
				if panicCase {
					panic(secret)
				}
				return errors.New(secret)
			})
			if !panicCase && !errors.Is(err, ErrDatabase) {
				t.Error("unsafe callback error")
			}
		}()
		assertNoContext(t, runtime)
	}
	if err := WithinTenant(ctx, auditor, scope(clubA), func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `SELECT count(*) FROM core.audit_events WHERE object_id=$1`, newID).Scan(&count)
	}); err != nil || count != 3 {
		t.Fatal("rolled-back audit survived")
	}
	cancelCtx, cancel := context.WithCancel(ctx)
	if err := WithinTenant(cancelCtx, runtime, scope(clubA), func(tx *sql.Tx) error { cancel(); return cancelCtx.Err() }); !errors.Is(err, context.Canceled) {
		t.Fatal("cancellation lost")
	}
	assertNoContext(t, runtime)
	// Contending callers on the same single-connection pool alternate tenants.
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		tenant := clubA
		if i%2 != 0 {
			tenant = clubB
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := inspect(tenant); err != nil {
				t.Error("pool tenant leaked")
			}
		}()
	}
	wg.Wait()
	assertNoContext(t, runtime)
	if _, err := admin.ExecContext(ctx, "INSERT INTO goose_db_version(version_id,is_applied) VALUES (5,true)"); err != nil {
		t.Fatal("new version fixture failed")
	}
	if Ready(ctx, runtime) == nil {
		t.Fatal("too new schema must not be ready")
	}
 if _,err:=admin.ExecContext(ctx,"DELETE FROM goose_db_version WHERE version_id=5");err!=nil{t.Fatal("new version fixture cleanup failed")}
}

func assertNoContext(t *testing.T, db *sql.DB) {
	t.Helper()
	var empty bool
	err := db.QueryRow(`SELECT coalesce(nullif(current_setting('judeos.tenant_id',true),''),'')='' AND coalesce(nullif(current_setting('judeos.actor_id',true),''),'')='' AND coalesce(nullif(current_setting('judeos.request_id',true),''),'')=''`).Scan(&empty)
	if err != nil || !empty {
		t.Fatal("transaction context remains in pool")
	}
}

func assertRoles(t *testing.T, admin *sql.DB) {
	t.Helper()
	var ok bool
	err := admin.QueryRow(`SELECT bool_and(r.rolname='judeos_migrator' AND c.relrowsecurity AND c.relforcerowsecurity)
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner
        WHERE (n.nspname='core' AND c.relname IN ('clubs','audit_events')) OR (n.nspname='development' AND c.relname='sample_objects')`).Scan(&ok)
	if err != nil || !ok {
		t.Fatal("ownership/RLS configuration failed")
	}
}
