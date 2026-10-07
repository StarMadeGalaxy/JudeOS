package database

import (
	"context"
	"os"
	"testing"
)

// Requires a separate disposable database; never runs against DATABASE_URL.
func TestMigrationUpgradeAndSeed(t *testing.T) {
	url := os.Getenv("JUDEOS_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set JUDEOS_TEST_DATABASE_URL to a fresh disposable database")
	}
	db, err := Open(url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	if Ready(ctx, db) == nil {
		t.Fatal("empty database must not be ready")
	}
	if err := Migrate(ctx, db, 1); err != nil {
		t.Fatal("first migration failed")
	}
	if Ready(ctx, db) == nil {
		t.Fatal("older schema must not be ready")
	}
	// Exercise an actual upgrade with existing rows, rather than just an empty DB.
	if _, err := db.ExecContext(ctx, `INSERT INTO development.sample_clubs VALUES ('00000000-0000-4000-8000-000000000999','Синтетический клуб обновления')`); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(ctx, db, 2); err != nil {
		t.Fatal("upgrade failed")
	}
	if err := Migrate(ctx, db, 2); err != nil {
		t.Fatal("repeat migration failed")
	}
	if err := Ready(ctx, db); err != nil {
		t.Fatal("schema not ready")
	}
	if err := Seed(ctx, db); err != nil {
		t.Fatal("seed failed")
	}
	if err := Seed(ctx, db); err != nil {
		t.Fatal("repeat seed failed")
	}
	var count int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM development.sample_clubs").Scan(&count); err != nil || count != 3 {
		t.Fatal("upgrade or seed lost/duplicated rows")
	}
	var zone string
	if err := db.QueryRowContext(ctx, "SELECT timezone FROM development.sample_clubs WHERE id='00000000-0000-4000-8000-000000000999'").Scan(&zone); err != nil || zone != "Europe/Minsk" {
		t.Fatal("existing row was not migrated")
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO goose_db_version(version_id,is_applied) VALUES (3,true)"); err != nil {
		t.Fatal(err)
	}
	if Ready(ctx, db) == nil {
		t.Fatal("newer schema must not be ready")
	}
}
