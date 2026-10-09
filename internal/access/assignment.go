package access

import (
	"context"
	"database/sql"
	"errors"
	"github.com/StarMadeGalaxy/JudeOS/internal/platform/database"
)

type AssignmentLink struct {
	Link
}

// AssignStaff supports one identity across clubs. Managers may assign only the
// coach role, and may never edit a membership carrying wider privileges.
func (s *Service) AssignStaff(ctx context.Context, token, csrf, tenant, request, login string, gs []Grant) (AssignmentLink, error) {
	var link AssignmentLink
	if csrf == "" {
		return link, ErrForbidden
	}
	login, e := NormalizeLogin(login)
	if e != nil || !ValidGrants(gs) {
		return link, ErrInvalid
	}
	e = s.Within(ctx, token, csrf, tenant, request, "assign_coach", func(tx *sql.Tx, current Session) error {
		admin := false
		for _, m := range current.Memberships {
			if m.Tenant == tenant && Allows(m.Grants, "staff", false) {
				admin = true
			}
		}
		if !admin && (len(gs) != 1 || gs[0].Role != "coach") {
			return ErrForbidden
		}
		a := uuid()
		if _, e := tx.ExecContext(ctx, `INSERT INTO access.accounts(id,login) VALUES($1,$2) ON CONFLICT(login) DO NOTHING`, a, login); e != nil {
			return e
		}
		var hasPassword, disabled bool
		if e := tx.QueryRowContext(ctx, `SELECT id,password_hash IS NOT NULL,disabled FROM access.accounts WHERE login=$1 FOR UPDATE`, login).Scan(&a, &hasPassword, &disabled); e != nil {
			return e
		}
		if disabled {
			return ErrConflict
		}
		var id string
		var active bool
		e := tx.QueryRowContext(ctx, `SELECT id,active FROM core.memberships WHERE account_id=$1 FOR UPDATE`, a).Scan(&id, &active)
		if errors.Is(e, sql.ErrNoRows) {
			id = uuid()
			if _, e = tx.ExecContext(ctx, `INSERT INTO core.memberships VALUES($1,$2,$3,false)`, tenant, id, a); e != nil {
				return e
			}
		} else if e != nil {
			return e
		} else {
			if active {
				return ErrConflict
			}
			if !admin {
				var wider bool
				if e = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM core.role_grants WHERE membership_id=$1 AND role<>'coach')`, id).Scan(&wider); e != nil {
					return e
				}
				if wider {
					return ErrForbidden
				}
			}
		}
		if e = grants(ctx, tx, tenant, id, gs); e != nil {
			return e
		}
		kind := "invite"
		if hasPassword {
			kind = "join"
		}
		link.Kind = kind
		link.Link, e = issueToken(ctx, tx, tenant, id, kind)
		return e
	})
	return link, e
}
func (s *Service) AcceptInvitation(ctx context.Context, token, csrf, invitation, request string) error {
	if csrf == "" || len(invitation) != 64 {
		return ErrForbidden
	}
	v, e := s.Session(ctx, token)
	if e != nil {
		return e
	}
	if csrf != v.CSRF {
		return ErrForbidden
	}
	var tenant, id, account, kind string
	e = s.DB.QueryRowContext(ctx, `SELECT tenant_id,membership_id,account_id,kind FROM access.token_target($1)`, digest(invitation)).Scan(&tenant, &id, &account, &kind)
	if errors.Is(e, sql.ErrNoRows) {
		return ErrToken
	}
	if e != nil {
		return safe(e)
	}
	if account != v.Account || kind != "join" {
		return ErrToken
	}
	return dbError(tenantTx(ctx, s.DB, database.TenantContext{TenantID: tenant, ActorID: account, RequestID: request}, func(tx *sql.Tx) error {
		if _, e := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,21))`, tenant); e != nil {
			return e
		}
		current, e := session(ctx, tx, token)
		if e != nil {
			return e
		}
		if current.Account != account || current.CSRF != csrf {
			return ErrForbidden
		}
		if _, e = tx.ExecContext(ctx, `SELECT id FROM access.accounts WHERE id=$1 AND NOT disabled FOR UPDATE`, account); e != nil {
			return e
		}
		r, e := tx.ExecContext(ctx, `UPDATE core.access_tokens SET used=true WHERE secret_hash=$1 AND kind='join' AND NOT used AND expires_at>clock_timestamp()`, digest(invitation))
		if e != nil {
			return e
		}
		n, _ := r.RowsAffected()
		if n != 1 {
			return ErrToken
		}
		r, e = tx.ExecContext(ctx, `UPDATE core.memberships SET active=true WHERE id=$1 AND NOT active`, id)
		if e != nil {
			return e
		}
		n, _ = r.RowsAffected()
		if n != 1 {
			return ErrToken
		}
		return nil
	}))
}
func (s *Service) Coaches(ctx context.Context, token, tenant, request string) ([]Staff, error) {
	v := []Staff{}
	e := s.Within(ctx, token, "", tenant, request, "assign_coach", func(tx *sql.Tx, _ Session) error {
		rows, e := tx.QueryContext(ctx, `SELECT m.id,m.account_id,a.login,m.active,CASE WHEN m.active THEN 'active' WHEN EXISTS(SELECT 1 FROM core.access_tokens t WHERE t.membership_id=m.id AND NOT t.used AND t.expires_at>clock_timestamp()) THEN 'pending' ELSE 'revoked' END FROM core.memberships m JOIN access.accounts a ON a.id=m.account_id WHERE EXISTS(SELECT 1 FROM core.role_grants g WHERE g.membership_id=m.id AND g.role='coach') AND NOT EXISTS(SELECT 1 FROM core.role_grants g WHERE g.membership_id=m.id AND g.role<>'coach') ORDER BY m.id`)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			var item Staff
			if e = rows.Scan(&item.ID, &item.Account, &item.Login, &item.Active, &item.State); e != nil {
				return e
			}
			item.Grants = []Grant{{"coach", "assigned_sessions"}}
			v = append(v, item)
		}
		return rows.Err()
	})
	return v, e
}
func (s *Service) RevokeCoach(ctx context.Context, token, csrf, tenant, id, request string) error {
	if csrf == "" {
		return ErrForbidden
	}
	if !uuidPattern.MatchString(id) {
		return ErrInvalid
	}
	return s.Within(ctx, token, csrf, tenant, request, "assign_coach", func(tx *sql.Tx, _ Session) error {
		var account string
		e := tx.QueryRowContext(ctx, `SELECT account_id FROM core.memberships m WHERE id=$1 AND EXISTS(SELECT 1 FROM core.role_grants g WHERE g.membership_id=m.id AND g.role='coach') AND NOT EXISTS(SELECT 1 FROM core.role_grants g WHERE g.membership_id=m.id AND g.role<>'coach') FOR UPDATE`, id).Scan(&account)
		if errors.Is(e, sql.ErrNoRows) {
			return ErrForbidden
		}
		if e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, `UPDATE core.memberships SET active=false WHERE id=$1`, id); e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, `UPDATE core.access_tokens SET used=true WHERE membership_id=$1 AND NOT used`, id); e != nil {
			return e
		}
		_, e = tx.ExecContext(ctx, `UPDATE access.sessions SET revoked=true WHERE account_id=$1`, account)
		return e
	})
}
