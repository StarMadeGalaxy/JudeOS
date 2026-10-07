package database

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

// Bootstrap is explicit local provisioning, never called by API/migrations.
// Use the local administrator only here. Existing passwords are preserved.
// Roles are cluster-wide; use dedicated synthetic clusters, not shared production.
func Bootstrap(ctx context.Context, db *sql.DB, migrationPassword, runtimePassword string) error {
	if len(migrationPassword) < 24 || len(runtimePassword) < 24 || strings.ContainsRune(migrationPassword+runtimePassword, 0) {
		return errors.New("local role passwords must have at least 24 characters")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return ErrDatabase
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `SET LOCAL standard_conforming_strings = on`); err != nil {
		return ErrDatabase
	}
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(200020)`); err != nil {
		return ErrDatabase
	}
	for _, role := range []struct{ name, password string }{
		{"judeos_migrator", migrationPassword}, {"judeos_runtime", runtimePassword}, {"judeos_audit_reader", ""},
	} {
		var exists bool
		if err = tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=$1)", role.name).Scan(&exists); err != nil {
			return ErrDatabase
		}
		if !exists {
			statement := "CREATE ROLE " + role.name + " NOLOGIN"
			if role.password != "" {
				statement = "CREATE ROLE " + role.name + " LOGIN PASSWORD '" + strings.ReplaceAll(role.password, "'", "''") + "'"
			}
			if _, err = tx.ExecContext(ctx, statement+" NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS"); err != nil {
				return ErrDatabase
			}
		}
	}
	// Fail rather than silently repurpose privileged or externally linked roles.
	var safe bool
	err = tx.QueryRowContext(ctx, `SELECT count(*) = 3 AND bool_and(NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolinherit
		AND rolcanlogin = (rolname <> 'judeos_audit_reader'))
		AND NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
			WHERE r.rolname IN ('judeos_migrator','judeos_runtime','judeos_audit_reader'))
		FROM pg_roles WHERE rolname IN ('judeos_migrator','judeos_runtime','judeos_audit_reader')`).Scan(&safe)
	if err != nil || !safe {
		return ErrDenied
	}
	var databaseName string
	if err = tx.QueryRowContext(ctx, "SELECT current_database()").Scan(&databaseName); err != nil {
		return ErrDatabase
	}
	identifier := `"` + strings.ReplaceAll(databaseName, `"`, `""`) + `"`
	for _, statement := range []string{
		"REVOKE CREATE ON DATABASE " + identifier + " FROM PUBLIC",
		"REVOKE CREATE ON SCHEMA public FROM PUBLIC",
		"GRANT CONNECT ON DATABASE " + identifier + " TO judeos_migrator, judeos_runtime, judeos_audit_reader",
		"GRANT CREATE ON DATABASE " + identifier + " TO judeos_migrator",
		"GRANT USAGE, CREATE ON SCHEMA public TO judeos_migrator",
		"GRANT USAGE ON SCHEMA public TO judeos_runtime",
	} {
		if _, err = tx.ExecContext(ctx, statement); err != nil {
			return ErrDatabase
		}
	}
	// Upgrade the two known #19 relations from the former local admin owner.
	// Do not transfer arbitrary objects or touch future module schemas.
	var legacy bool
	if err = tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='development')").Scan(&legacy); err != nil {
		return ErrDatabase
	}
	if legacy {
		if _, err = tx.ExecContext(ctx, "ALTER SCHEMA development OWNER TO judeos_migrator"); err != nil {
			return ErrDatabase
		}
	}
	for _, relation := range []string{"development.sample_clubs", "public.goose_db_version"} {
		if err = tx.QueryRowContext(ctx, "SELECT to_regclass($1) IS NOT NULL", relation).Scan(&legacy); err != nil {
			return ErrDatabase
		}
		if legacy {
			if _, err = tx.ExecContext(ctx, "ALTER TABLE "+relation+" OWNER TO judeos_migrator"); err != nil {
				return ErrDatabase
			}
		}
	}
	return safeError(tx.Commit())
}
