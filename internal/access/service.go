// Package access owns authentication and current staff permissions. HTTP menus
// are consumers; authorization always runs again inside the mutation transaction.
package access

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/StarMadeGalaxy/JudeOS/internal/platform/database"
	"time"
	"unicode/utf8"
)

var (
	ErrLimited      = errors.New("password work limit")
	ErrUnauthorized = errors.New("authentication required")
	ErrForbidden    = errors.New("access denied")
	ErrConflict     = errors.New("access conflict")
	ErrToken        = errors.New("link invalid or expired")
)

const SessionTTL = 8 * time.Hour
const PreauthTTL = 10 * time.Minute
const InviteTTL = 24 * time.Hour
const ResetTTL = 30 * time.Minute

type Grant struct {
	Role  string `json:"role"`
	Scope string `json:"scope"`
}
type Membership struct {
	ID       string  `json:"membership_id"`
	Tenant   string  `json:"tenant_id"`
	Club     string  `json:"club_name"`
	Timezone string  `json:"timezone"`
	Grants   []Grant `json:"grants"`
}
type Session struct {
	Account     string       `json:"account_id"`
	Expires     time.Time    `json:"expires_at"`
	Memberships []Membership `json:"memberships"`
	CSRF        string       `json:"-"`
}
type Link struct {
	Token   string    `json:"token"`
	Expires time.Time `json:"expires_at"`
}
type Staff struct {
	ID      string  `json:"membership_id"`
	Account string  `json:"account_id"`
	Login   string  `json:"login"`
	Active  bool    `json:"active"`
	Grants  []Grant `json:"grants"`
}
type Service struct {
	DB    *sql.DB
	dummy string
	slots chan struct{}
}

func New(db *sql.DB) *Service {
	d, err := HashPassword("synthetic-dummy-password")
	if err != nil {
		panic("password initialization failed")
	}
	return &Service{DB: db, dummy: d, slots: make(chan struct{}, 2)}
}
func safe(err error) error {
	if err == nil {
		return nil
	}
	for _, e := range []error{ErrUnauthorized, ErrForbidden, ErrConflict, ErrToken, ErrInvalid, ErrLimited} {
		if errors.Is(err, e) {
			return e
		}
	}
	if errors.Is(err, database.ErrConflict) {
		return ErrConflict
	}
	return database.ErrDatabase
}
func memberships(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, account string) ([]Membership, error) {
	var raw []byte
	err := q.QueryRowContext(ctx, `SELECT access.memberships($1)`, account).Scan(&raw)
	if err != nil {
		return nil, err
	}
	var ms []Membership
	err = json.Unmarshal(raw, &ms)
	return ms, err
}
func session(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, token string) (Session, error) {
	var s Session
	if len(token) != 64 {
		return s, ErrUnauthorized
	}
	err := q.QueryRowContext(ctx, `SELECT a.id,s.expires_at,s.csrf FROM access.sessions s JOIN access.accounts a ON a.id=s.account_id WHERE s.secret_hash=$1 AND NOT s.revoked AND NOT a.disabled AND a.password_hash IS NOT NULL AND s.expires_at>clock_timestamp()`, digest(token)).Scan(&s.Account, &s.Expires, &s.CSRF)
	if errors.Is(err, sql.ErrNoRows) {
		return s, ErrUnauthorized
	}
	if err != nil {
		return s, err
	}
	s.Expires = s.Expires.UTC()
	s.Memberships, err = memberships(ctx, q, s.Account)
	if err == nil && len(s.Memberships) == 0 {
		return s, ErrUnauthorized
	}
	return s, err
}
func (s *Service) Session(ctx context.Context, token string) (Session, error) {
	v, e := session(ctx, s.DB, token)
	return v, safe(e)
}
func (s *Service) CSRF(ctx context.Context, token, preauth string) (csrf string, expiry time.Time, newCookie string, err error) {
	if token != "" {
		v, e := s.Session(ctx, token)
		if e == nil {
			return v.CSRF, v.Expires, "", nil
		}
		if !errors.Is(e, ErrUnauthorized) {
			return "", expiry, "", e
		}
	}
	if len(preauth) == 64 {
		e := s.DB.QueryRowContext(ctx, `SELECT csrf,expires_at FROM access.preauth WHERE secret_hash=$1 AND expires_at>clock_timestamp()`, digest(preauth)).Scan(&csrf, &expiry)
		if e == nil {
			return csrf, expiry.UTC(), "", nil
		}
		if !errors.Is(e, sql.ErrNoRows) {
			return "", expiry, "", safe(e)
		}
	}
	newCookie = secret()
	csrf = secret()
	expiry = time.Now().UTC().Add(PreauthTTL)
	_, err = s.DB.ExecContext(ctx, `INSERT INTO access.preauth VALUES($1,$2,$3)`, digest(newCookie), csrf, expiry)
	return csrf, expiry, newCookie, safe(err)
}
func (s *Service) Login(ctx context.Context, login, password, preauth, csrf, old string) (Session, string, error) {
	var empty Session
	normalized, e := NormalizeLogin(login)
	if e != nil {
		return empty, "", ErrInvalid
	}
	// Check before expensive password work; claim again under lock before issuing.
	var expected string
	e = s.DB.QueryRowContext(ctx, `SELECT csrf FROM access.preauth WHERE secret_hash=$1 AND expires_at>clock_timestamp()`, digest(preauth)).Scan(&expected)
	if errors.Is(e, sql.ErrNoRows) {
		return empty, "", ErrForbidden
	}
	if e != nil {
		return empty, "", safe(e)
	}
	if expected != csrf || csrf == "" {
		return empty, "", ErrForbidden
	}
	var account, hash string
	var disabled bool
	e = s.DB.QueryRowContext(ctx, `SELECT id,coalesce(password_hash,''),disabled FROM access.accounts WHERE login=$1`, normalized).Scan(&account, &hash, &disabled)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		return empty, "", safe(e)
	}
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	default:
		return empty, "", ErrLimited
	}
	actual := hash
	if actual == "" {
		actual = s.dummy
	}
	valid := VerifyPassword(actual, password)
	if !valid || hash == "" || disabled {
		return empty, "", ErrUnauthorized
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return empty, "", safe(e)
	}
	defer tx.Rollback()
	// Account lock serializes login with password reset/revocation.
	var current string
	e = tx.QueryRowContext(ctx, `SELECT coalesce(password_hash,'') FROM access.accounts WHERE id=$1 AND NOT disabled FOR UPDATE`, account).Scan(&current)
	if errors.Is(e, sql.ErrNoRows) || current != hash {
		return empty, "", ErrUnauthorized
	}
	if e != nil {
		return empty, "", safe(e)
	}
	e = tx.QueryRowContext(ctx, `DELETE FROM access.preauth WHERE secret_hash=$1 AND csrf=$2 AND expires_at>clock_timestamp() RETURNING csrf`, digest(preauth), csrf).Scan(&expected)
	if errors.Is(e, sql.ErrNoRows) {
		return empty, "", ErrForbidden
	}
	if e != nil {
		return empty, "", safe(e)
	}
	ms, e := memberships(ctx, tx, account)
	if e != nil {
		return empty, "", safe(e)
	}
	if len(ms) == 0 {
		return empty, "", ErrUnauthorized
	}
	token := secret()
	v := Session{account, time.Now().UTC().Add(SessionTTL), ms, secret()}
	if old != "" {
		if _, e = tx.ExecContext(ctx, `UPDATE access.sessions SET revoked=true WHERE secret_hash=$1`, digest(old)); e != nil {
			return empty, "", safe(e)
		}
	}
	_, e = tx.ExecContext(ctx, `INSERT INTO access.sessions VALUES($1,$2,$3,false,$4)`, digest(token), account, v.Expires, v.CSRF)
	if e != nil {
		return empty, "", safe(e)
	}
	if e = tx.Commit(); e != nil {
		return empty, "", safe(e)
	}
	return v, token, nil
}
func (s *Service) Logout(ctx context.Context, token, csrf string) error {
	v, e := s.Session(ctx, token)
	if e != nil {
		return e
	}
	if csrf != v.CSRF || csrf == "" {
		return ErrForbidden
	}
	r, e := s.DB.ExecContext(ctx, `UPDATE access.sessions SET revoked=true WHERE secret_hash=$1 AND NOT revoked AND expires_at>clock_timestamp()`, digest(token))
	if e != nil {
		return safe(e)
	}
	n, _ := r.RowsAffected()
	if n == 0 {
		return ErrUnauthorized
	}
	return nil
}
func ValidGrants(gs []Grant) bool {
	if len(gs) == 0 || len(gs) > 3 {
		return false
	}
	seen := map[string]bool{}
	for _, g := range gs {
		if seen[g.Role] {
			return false
		}
		seen[g.Role] = true
		if (g.Role == "coach" && g.Scope == "assigned_sessions") || ((g.Role == "administrator" || g.Role == "manager") && g.Scope == "club") {
			continue
		}
		return false
	}
	return true
}

// Allows expresses the accepted union of roles; coach object assignments must be
// resolved from the current server repository, never a request body/menu choice.
func Allows(gs []Grant, action string, assigned bool) bool {
	switch action {
	case "staff", "finance", "people", "schedule", "attendance", "journal", "add_guest":
	default:
		return false
	}
	for _, g := range gs {
		switch g.Role {
		case "administrator":
			if g.Scope == "club" {
				return true
			}
		case "manager":
			if g.Scope == "club" && action != "staff" {
				return true
			}
		case "coach":
			if g.Scope == "assigned_sessions" && assigned && (action == "attendance" || action == "journal" || action == "add_guest") {
				return true
			}
		}
	}
	return false
}
func (s *Service) within(ctx context.Context, token, csrf, tenant, request string, fn func(*sql.Tx, Session) error) error {
	if !uuidPattern.MatchString(tenant) {
		return ErrInvalid
	}
	v, e := s.Session(ctx, token)
	if e != nil {
		return e
	}
	if csrf != "" && csrf != v.CSRF {
		return ErrForbidden
	}
	found := false
	for _, m := range v.Memberships {
		if m.Tenant == tenant && Allows(m.Grants, "staff", false) {
			found = true
		}
	}
	if !found {
		return ErrForbidden
	}
	return safe(tenantTx(ctx, s.DB, database.TenantContext{TenantID: tenant, ActorID: v.Account, RequestID: request}, func(tx *sql.Tx) error {
		// Every staff mutation in one club serializes before authorization and the
		// last-owner check. A request authorized before a revocation cannot slip past it.
		if _, e := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,21))`, tenant); e != nil {
			return e
		}
		current, e := session(ctx, tx, token)
		if e != nil {
			return e
		}
		if csrf != "" && csrf != current.CSRF {
			return ErrForbidden
		}
		allowed := false
		for _, m := range current.Memberships {
			if m.Tenant == tenant && Allows(m.Grants, "staff", false) {
				allowed = true
			}
		}
		if !allowed {
			return ErrForbidden
		}
		return fn(tx, current)
	}))
}
func (s *Service) List(ctx context.Context, token, tenant, request string) ([]Staff, error) {
	items := []Staff{}
	e := s.within(ctx, token, "", tenant, request, func(tx *sql.Tx, _ Session) error {
		rows, e := tx.QueryContext(ctx, `SELECT m.id,m.account_id,a.login,m.active,coalesce((SELECT jsonb_agg(jsonb_build_object('role',role,'scope',scope) ORDER BY role) FROM core.role_grants g WHERE (g.tenant_id,g.membership_id)=(m.tenant_id,m.id)),'[]'::jsonb) FROM core.memberships m JOIN access.accounts a ON a.id=m.account_id ORDER BY m.id`)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			var v Staff
			var raw []byte
			if e = rows.Scan(&v.ID, &v.Account, &v.Login, &v.Active, &raw); e != nil {
				return e
			}
			if e = json.Unmarshal(raw, &v.Grants); e != nil {
				return e
			}
			items = append(items, v)
		}
		return rows.Err()
	})
	return items, e
}
func grants(ctx context.Context, tx *sql.Tx, tenant, id string, gs []Grant) error {
	// Retain existing administrator until replacement grants are ready. Never
	// delete/reinsert it on an unchanged role set (last-owner would rightly reject).
	for _, g := range gs {
		if _, e := tx.ExecContext(ctx, `INSERT INTO core.role_grants VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, tenant, id, g.Role, g.Scope); e != nil {
			return e
		}
	}
	roles := []string{}
	for _, g := range gs {
		roles = append(roles, g.Role)
	}
	_, e := tx.ExecContext(ctx, `DELETE FROM core.role_grants WHERE tenant_id=$1 AND membership_id=$2 AND NOT (role=ANY($3))`, tenant, id, roles)
	return e
}
func (s *Service) Invite(ctx context.Context, token, csrf, tenant, request, login string, gs []Grant) (Link, error) {
	var link Link
	if csrf == "" {
		return link, ErrForbidden
	}
	normalized, e := NormalizeLogin(login)
	if e != nil || !ValidGrants(gs) {
		return link, ErrInvalid
	}
	e = s.within(ctx, token, csrf, tenant, request, func(tx *sql.Tx, _ Session) error {
		a := uuid()
		if _, e := tx.ExecContext(ctx, `INSERT INTO access.accounts(id,login) VALUES($1,$2) ON CONFLICT(login) DO NOTHING`, a, normalized); e != nil {
			return e
		}
		var hash sql.NullString
		var disabled bool
		if e := tx.QueryRowContext(ctx, `SELECT id,password_hash,disabled FROM access.accounts WHERE login=$1 FOR UPDATE`, normalized).Scan(&a, &hash, &disabled); e != nil {
			return e
		}
		// Existing active global accounts are linked only by an authenticated future
		// flow, not by inviting a matching identifier and replacing their password.
		if hash.Valid || disabled {
			return ErrConflict
		}
		id := uuid()
		if _, e := tx.ExecContext(ctx, `INSERT INTO core.memberships VALUES($1,$2,$3,false)`, tenant, id, a); e != nil {
			return e
		}
		if e := grants(ctx, tx, tenant, id, gs); e != nil {
			return e
		}
		var e error
		link, e = issueToken(ctx, tx, tenant, id, "invite")
		return e
	})
	return link, e
}
func issueToken(ctx context.Context, tx *sql.Tx, tenant, id, kind string) (Link, error) {
	ttl := InviteTTL
	if kind == "reset" {
		ttl = ResetTTL
	}
	v := Link{secret(), time.Now().UTC().Add(ttl)}
	// Issuing a replacement invalidates all previous links for this membership.
	if _, e := tx.ExecContext(ctx, `UPDATE core.access_tokens SET used=true WHERE tenant_id=$1 AND membership_id=$2 AND NOT used`, tenant, id); e != nil {
		return Link{}, e
	}
	_, e := tx.ExecContext(ctx, `INSERT INTO core.access_tokens VALUES($1,$2,$3,$4,$5,$6,false)`, tenant, uuid(), id, kind, digest(v.Token), v.Expires)
	return v, e
}
func (s *Service) Reset(ctx context.Context, token, csrf, tenant, request, id string) (Link, error) {
	var v Link
	if csrf == "" {
		return v, ErrForbidden
	}
	if !uuidPattern.MatchString(id) {
		return v, ErrInvalid
	}
	e := s.within(ctx, token, csrf, tenant, request, func(tx *sql.Tx, _ Session) error {
		var active bool
		var hasPassword bool
		if e := tx.QueryRowContext(ctx, `SELECT m.active,a.password_hash IS NOT NULL FROM core.memberships m JOIN access.accounts a ON a.id=m.account_id WHERE m.id=$1`, id).Scan(&active, &hasPassword); errors.Is(e, sql.ErrNoRows) {
			return ErrToken
		} else if e != nil {
			return e
		}
		if !active && hasPassword {
			return ErrConflict
		}
		kind := "invite"
		if active {
			kind = "reset"
		}
		var e error
		v, e = issueToken(ctx, tx, tenant, id, kind)
		return e
	})
	return v, e
}
func (s *Service) Change(ctx context.Context, token, csrf, tenant, request, id string, active bool, gs []Grant) error {
	if csrf == "" {
		return ErrForbidden
	}
	if !ValidGrants(gs) || !uuidPattern.MatchString(id) {
		return ErrInvalid
	}
	return s.within(ctx, token, csrf, tenant, request, func(tx *sql.Tx, _ Session) error {
		var account string
		var current bool
		if e := tx.QueryRowContext(ctx, `SELECT account_id,active FROM core.memberships WHERE id=$1 FOR UPDATE`, id).Scan(&account, &current); errors.Is(e, sql.ErrNoRows) {
			return ErrToken
		} else if e != nil {
			return e
		}
		// Access revocation is permanent until a new invite flow. No silent reactivation.
		if active && !current {
			return ErrConflict
		}
		if e := grants(ctx, tx, tenant, id, gs); e != nil {
			return e
		}
		if _, e := tx.ExecContext(ctx, `UPDATE core.memberships SET active=$2 WHERE id=$1`, id, active); e != nil {
			return e
		}
		if _, e := tx.ExecContext(ctx, `SELECT id FROM access.accounts WHERE id=$1 FOR UPDATE`, account); e != nil {
			return e
		}
		if _, e := tx.ExecContext(ctx, `UPDATE access.sessions SET revoked=true WHERE account_id=$1`, account); e != nil {
			return e
		}
		_, e := tx.ExecContext(ctx, `UPDATE core.access_tokens SET used=true WHERE membership_id=$1 AND NOT used`, id)
		return e
	})
}
func (s *Service) Redeem(ctx context.Context, token, password, preauth, csrf, request string) error {
	if !utf8.ValidString(password) || utf8.RuneCountInString(password) < 12 || len(password) > 1024 {
		return ErrInvalid
	}
	var expected string
	e := s.DB.QueryRowContext(ctx, `SELECT csrf FROM access.preauth WHERE secret_hash=$1 AND csrf=$2 AND expires_at>clock_timestamp()`, digest(preauth), csrf).Scan(&expected)
	if errors.Is(e, sql.ErrNoRows) || csrf == "" {
		return ErrForbidden
	}
	if e != nil {
		return safe(e)
	}
	var tenant, id, account, kind string
	e = s.DB.QueryRowContext(ctx, `SELECT tenant_id,membership_id,account_id,kind FROM access.token_target($1)`, digest(token)).Scan(&tenant, &id, &account, &kind)
	if errors.Is(e, sql.ErrNoRows) {
		return ErrToken
	}
	if e != nil {
		return safe(e)
	}
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	default:
		return ErrLimited
	}
	hash, e := HashPassword(password)
	if e != nil {
		return ErrInvalid
	}
	return safe(tenantTx(ctx, s.DB, database.TenantContext{TenantID: tenant, ActorID: account, RequestID: request}, func(tx *sql.Tx) error {
		if _, e := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,21))`, tenant); e != nil {
			return e
		}
		var old sql.NullString
		if e := tx.QueryRowContext(ctx, `SELECT password_hash FROM access.accounts WHERE id=$1 AND NOT disabled FOR UPDATE`, account).Scan(&old); e != nil {
			return ErrToken
		}
		var expected string
		e := tx.QueryRowContext(ctx, `DELETE FROM access.preauth WHERE secret_hash=$1 AND csrf=$2 AND expires_at>clock_timestamp() RETURNING csrf`, digest(preauth), csrf).Scan(&expected)
		if errors.Is(e, sql.ErrNoRows) || csrf == "" {
			return ErrForbidden
		}
		if e != nil {
			return e
		}
		var active bool
		if e = tx.QueryRowContext(ctx, `SELECT active FROM core.memberships WHERE id=$1 FOR UPDATE`, id).Scan(&active); e != nil {
			return e
		}
		if (kind == "reset" && !active) || (kind == "invite" && (active || old.Valid)) {
			return ErrToken
		}
		r, e := tx.ExecContext(ctx, `UPDATE core.access_tokens SET used=true WHERE secret_hash=$1 AND NOT used AND expires_at>clock_timestamp()`, digest(token))
		if e != nil {
			return e
		}
		n, _ := r.RowsAffected()
		if n != 1 {
			return ErrToken
		}
		if _, e = tx.ExecContext(ctx, `UPDATE access.accounts SET password_hash=$2 WHERE id=$1`, account, hash); e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, `UPDATE core.memberships SET active=true WHERE id=$1`, id); e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, `UPDATE access.sessions SET revoked=true WHERE account_id=$1`, account); e != nil {
			return e
		}
		_, e = tx.ExecContext(ctx, `UPDATE core.access_tokens SET used=true WHERE membership_id=$1 AND NOT used`, id)
		return e
	}))
}

// Limit uses PostgreSQL atomic upsert, shared across processes and restarts.
// Only a SHA-256 bucket identifier is stored; never a login/IP in clear text.
func (s *Service) Limit(ctx context.Context, key string, max int, window time.Duration) (bool, error) {
	var count int
	e := s.DB.QueryRowContext(ctx, `INSERT INTO access.rate_limits VALUES($1,1,clock_timestamp()+$2 * interval '1 second') ON CONFLICT(key_hash) DO UPDATE SET count=CASE WHEN access.rate_limits.expires_at<=clock_timestamp() THEN 1 ELSE access.rate_limits.count+1 END, expires_at=CASE WHEN access.rate_limits.expires_at<=clock_timestamp() THEN EXCLUDED.expires_at ELSE access.rate_limits.expires_at END RETURNING count`, digest(key), int64(window.Seconds())).Scan(&count)
	return count <= max, safe(e)
}

// tenantTx keeps safe domain classifications across the platform transaction
// boundary, which intentionally strips arbitrary callback/driver error details.
func tenantTx(ctx context.Context, db *sql.DB, scope database.TenantContext, fn func(*sql.Tx) error) error {
	var domain error
	e := database.WithinTenant(ctx, db, scope, func(tx *sql.Tx) error {
		err := fn(tx)
		for _, known := range []error{ErrUnauthorized, ErrForbidden, ErrInvalid, ErrToken, ErrConflict, ErrLimited} {
			if errors.Is(err, known) {
				domain = known
				break
			}
		}
		return err
	})
	if domain != nil {
		return domain
	}
	return e
}

// CleanExpired removes only unusable global auth state; accounts, tenant links
// and metadata audit are retained. It does not define a real-data retention policy.
func (s *Service) CleanExpired(ctx context.Context) error {
	for _, statement := range []string{`DELETE FROM access.preauth WHERE expires_at<=clock_timestamp()`, `DELETE FROM access.rate_limits WHERE expires_at<=clock_timestamp()`, `DELETE FROM access.sessions WHERE expires_at<=clock_timestamp()`} {
		if _, e := s.DB.ExecContext(ctx, statement); e != nil {
			return safe(e)
		}
	}
	return nil
}
