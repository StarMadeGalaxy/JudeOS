package access

import (
	"context"
	"database/sql"
	"errors"
	"github.com/StarMadeGalaxy/JudeOS/internal/platform/database"
)

// BootstrapOwner is an operator-only, migrator-credential command. It never
// runs at HTTP startup and refuses a club with an active/pending administrator.
func BootstrapOwner(ctx context.Context, db *sql.DB, tenant, login string) (Link, error) {
	normalized, e := NormalizeLogin(login)
	if e != nil {
		return Link{}, e
	}
	var link Link
	e = tenantTx(ctx, db, database.TenantContext{TenantID: tenant, ActorID: "00000000-0000-4000-8000-000000000301", RequestID: "00000000000000000000000000000021"}, func(tx *sql.Tx) error {
		var role string
		if e := tx.QueryRowContext(ctx, `SELECT current_user`).Scan(&role); e != nil || role != "judeos_migrator" {
			return ErrForbidden
		}
		if _, e := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,21))`, tenant); e != nil {
			return e
		}
		var exists bool
		if e := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM core.role_grants WHERE tenant_id=$1 AND role='administrator')`, tenant).Scan(&exists); e != nil {
			return e
		}
		if exists {
			var pending string
			e := tx.QueryRowContext(ctx, `SELECT m.id FROM core.memberships m JOIN access.accounts a ON a.id=m.account_id JOIN core.role_grants g ON (g.tenant_id,g.membership_id)=(m.tenant_id,m.id) WHERE m.tenant_id=$1 AND a.login=$2 AND a.password_hash IS NULL AND NOT m.active AND g.role='administrator' AND NOT EXISTS(SELECT 1 FROM core.memberships x JOIN core.role_grants y ON (y.tenant_id,y.membership_id)=(x.tenant_id,x.id) WHERE x.tenant_id=$1 AND x.active AND y.role='administrator')`, tenant, normalized).Scan(&pending)
			if e != nil {
				return ErrConflict
			}
			link, e = issueToken(ctx, tx, tenant, pending, "invite")
			return e
		}
		a, id := uuid(), uuid()
		if _, e := tx.ExecContext(ctx, `INSERT INTO access.accounts(id,login) VALUES($1,$2)`, a, normalized); e != nil {
			return e
		}
		if _, e := tx.ExecContext(ctx, `INSERT INTO core.memberships VALUES($1,$2,$3,false)`, tenant, id, a); e != nil {
			return e
		}
		if e := grants(ctx, tx, tenant, id, []Grant{{"administrator", "club"}}); e != nil {
			return e
		}
		var e error
		link, e = issueToken(ctx, tx, tenant, id, "invite")
		return e
	})
	if e != nil {
		return Link{}, errors.New("owner bootstrap rejected")
	}
	return link, nil
}
