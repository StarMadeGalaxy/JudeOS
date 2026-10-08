package database

import (
	"context"
	"database/sql"
	"errors"
	"regexp"

	"github.com/jackc/pgx/v5/pgconn"
)

var (
	ErrContext     = errors.New("tenant context is required")
	ErrDenied      = errors.New("data access denied")
	ErrConflict    = errors.New("data constraint rejected")
	ErrDatabase    = errors.New("database operation failed")
	uuidPattern    = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	requestPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)
)

// TenantContext is supplied by a trusted application service after authorization.
// It is not an authentication mechanism and must never come directly from headers/body.
// ActorID represents a server-resolved actor; synthetic tooling uses a synthetic UUID.
type TenantContext struct {
	TenantID, ActorID, RequestID string
}

// WithinTenant pins one connection until commit/rollback. All repository calls in
// fn must use this tx, not the pool. SET LOCAL also disappears after cancellation
// or panic (the deferred rollback returns the connection only after cleanup).
func WithinTenant(ctx context.Context, db *sql.DB, scope TenantContext, fn func(*sql.Tx) error) error {
	if !uuidPattern.MatchString(scope.TenantID) || scope.TenantID == "00000000-0000-0000-0000-000000000000" ||
		!uuidPattern.MatchString(scope.ActorID) || scope.ActorID == "00000000-0000-0000-0000-000000000000" || !requestPattern.MatchString(scope.RequestID) {
		return ErrContext
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return safeError(err)
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `SELECT set_config('judeos.tenant_id', $1, true),
		set_config('judeos.actor_id', $2, true), set_config('judeos.request_id', $3, true)`,
		scope.TenantID, scope.ActorID, scope.RequestID)
	if err != nil {
		return safeError(err)
	}
	if err = fn(tx); err != nil {
		return safeError(err)
	}
	return safeError(tx.Commit())
}

// Preserve only classifications. PostgreSQL detail/message/constraint/SQL can
// contain contacts, values or credentials and must not cross the service boundary.
func safeError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	if errors.Is(err, ErrContext) {
		return ErrContext
	}
	for _, known := range []error{ErrDenied, ErrConflict, ErrDatabase} {
		if errors.Is(err, known) {
			return known
		}
	}
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		switch pg.Code {
		case "42501":
			return ErrDenied
		case "23503", "23505", "23514":
			return ErrConflict
		}
	}
	return ErrDatabase
}

// ReadyRuntime fails closed for a privileged/misconfigured API connection.
func ReadyRuntime(ctx context.Context, db *sql.DB) error {
	if err := Ready(ctx, db); err != nil {
		return ErrDatabase
	}
	var allowed bool
	err := db.QueryRowContext(ctx, `SELECT current_user = 'judeos_runtime'
		AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole
		AND NOT pg_has_role(current_user, 'judeos_migrator', 'MEMBER')
		AND NOT pg_has_role(current_user, 'judeos_audit_reader', 'MEMBER')
		AND NOT has_schema_privilege(current_user, 'public', 'CREATE')
		AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
			WHERE n.nspname IN ('core','development','public') AND c.relowner = r.oid)
		FROM pg_roles r WHERE rolname = current_user`).Scan(&allowed)
	if err != nil || !allowed {
		return ErrDenied
	}
	return nil
}
