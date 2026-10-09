package access

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgconn"
)

var networkRequestPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)

type Network struct {
	ID      string `json:"network_id"`
	Name    string `json:"name"`
	Version int64  `json:"version"`
}
type Club struct {
	ID       string `json:"tenant_id"`
	Network  string `json:"network_id"`
	Name     string `json:"name"`
	Address  string `json:"address"`
	Timezone string `json:"timezone"`
	Version  int64  `json:"version"`
}
type NetworkProfile struct {
	Network
	Clubs  []Club  `json:"clubs"`
	Owners []Owner `json:"owners"`
}
type Owner struct {
	Account string `json:"account_id"`
	Login   string `json:"login"`
	Active  bool   `json:"active"`
}

func authority(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, v *Session) error {
	var raw []byte
	if e := q.QueryRowContext(ctx, `SELECT access.networks($1),access.is_platform_administrator($1)`, v.Account).Scan(&raw, &v.Platform); e != nil {
		return e
	}
	return json.Unmarshal(raw, &v.Networks)
}
func validText(v string, min, max int) bool {
	if !utf8.ValidString(v) || utf8.RuneCountInString(v) < min || utf8.RuneCountInString(v) > max {
		return false
	}
	nonspace := min == 0
	for _, r := range v {
		if unicode.IsControl(r) {
			return false
		}
		if !unicode.IsSpace(r) {
			nonspace = true
		}
	}
	return nonspace
}
func networkRight(v Session, id string) bool {
	for _, n := range v.Networks {
		if n.ID == id {
			return true
		}
	}
	return false
}
func dbError(e error) error {
	var p *pgconn.PgError
	if errors.As(e, &p) {
		switch p.Code {
		case "23503", "23505", "23514":
			return ErrConflict
		case "42501":
			return ErrForbidden
		}
	}
	return safe(e)
}

// Organization operations lock the network, then its clubs in stable order.
// Registry/staff requests re-read current authority under the same club lock.
func (s *Service) networkTx(ctx context.Context, token, csrf, id, request string, create bool, fn func(*sql.Tx, Session) error) error {
	if !uuidPattern.MatchString(id) || !networkRequestPattern.MatchString(request) {
		return ErrInvalid
	}
	v, e := s.Session(ctx, token)
	if e != nil {
		return e
	}
	if csrf != "" && csrf != v.CSRF {
		return ErrForbidden
	}
	if !create && !networkRight(v, id) {
		return ErrForbidden
	}
	if create && !v.Platform {
		return ErrForbidden
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return safe(e)
	}
	defer tx.Rollback()
	if v.Platform {
		if _, e = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(27,1)`); e != nil {
			return dbError(e)
		}
	}
	if _, e = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,27)),set_config('judeos.network_id',$1,true),set_config('judeos.actor_id',$2,true),set_config('judeos.request_id',$3,true)`, id, v.Account, request); e != nil {
		return dbError(e)
	}
	current, e := session(ctx, tx, token)
	if e != nil {
		return safe(e)
	}
	if (csrf != "" && csrf != current.CSRF) || (!create && !networkRight(current, id)) || (create && !current.Platform) {
		return ErrForbidden
	}
	var raw []byte
	if e = tx.QueryRowContext(ctx, `SELECT access.network_clubs($1,$2)`, current.Account, id).Scan(&raw); e != nil {
		return dbError(e)
	}
	var clubs []Club
	if e = json.Unmarshal(raw, &clubs); e != nil {
		return safe(e)
	}
	for _, c := range clubs {
		if _, e = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,21))`, c.ID); e != nil {
			return dbError(e)
		}
	}
	current, e = session(ctx, tx, token)
	if e != nil {
		return safe(e)
	}
	if (csrf != "" && csrf != current.CSRF) || (!create && !networkRight(current, id)) || (create && !current.Platform) {
		return ErrForbidden
	}
	if e = fn(tx, current); e != nil {
		return dbError(e)
	}
	return dbError(tx.Commit())
}
func profile(ctx context.Context, tx *sql.Tx, id, actor string) (NetworkProfile, error) {
	v := NetworkProfile{Clubs: []Club{}, Owners: []Owner{}}
	e := tx.QueryRowContext(ctx, `SELECT id,name,version FROM organization.networks WHERE id=$1`, id).Scan(&v.ID, &v.Name, &v.Version)
	if errors.Is(e, sql.ErrNoRows) {
		return v, ErrToken
	}
	if e != nil {
		return v, e
	}
	var raw []byte
	if e = tx.QueryRowContext(ctx, `SELECT access.network_clubs($1,$2)`, actor, id).Scan(&raw); e != nil {
		return v, e
	}
	if e = json.Unmarshal(raw, &v.Clubs); e != nil {
		return v, e
	}
	rows, e := tx.QueryContext(ctx, `SELECT o.account_id,a.login,o.active FROM organization.owners o JOIN access.accounts a ON a.id=o.account_id ORDER BY o.account_id`)
	if e != nil {
		return v, e
	}
	defer rows.Close()
	for rows.Next() {
		var o Owner
		if e = rows.Scan(&o.Account, &o.Login, &o.Active); e != nil {
			return v, e
		}
		v.Owners = append(v.Owners, o)
	}
	return v, rows.Err()
}
func (s *Service) Network(ctx context.Context, token, id, request string) (NetworkProfile, error) {
	var v NetworkProfile
	e := s.networkTx(ctx, token, "", id, request, false, func(tx *sql.Tx, current Session) error {
		var e error
		v, e = profile(ctx, tx, id, current.Account)
		return e
	})
	return v, e
}

func (s *Service) CreateNetwork(ctx context.Context, token, csrf, tenant, request, name string) (NetworkProfile, error) {
	var v NetworkProfile
	if csrf == "" {
		return v, ErrForbidden
	}
	if !validText(name, 1, 120) {
		return v, ErrInvalid
	}
	id := uuid()
	// Existing club administrators may explicitly create a network from that one
	// unlinked club. No other club is inferred from a shared login or name.
	e := s.Within(ctx, token, csrf, tenant, request, "staff", func(tx *sql.Tx, current Session) error {
		var linked sql.NullString
		if e := tx.QueryRowContext(ctx, `SELECT network_id FROM core.clubs WHERE tenant_id=$1 FOR UPDATE`, tenant).Scan(&linked); e != nil {
			return e
		}
		if linked.Valid {
			return ErrConflict
		}
		if _, e := tx.ExecContext(ctx, `SELECT set_config('judeos.network_id',$1,true)`, id); e != nil {
			return e
		}
		if _, e := tx.ExecContext(ctx, `INSERT INTO organization.networks(id,name) VALUES($1,$2)`, id, name); e != nil {
			return e
		}
		if _, e := tx.ExecContext(ctx, `INSERT INTO organization.owners VALUES($1,$2,true)`, id, current.Account); e != nil {
			return e
		}
		if _, e := tx.ExecContext(ctx, `UPDATE core.clubs SET network_id=$1,version=version+1 WHERE tenant_id=$2`, id, tenant); e != nil {
			return e
		}
		var e error
		v, e = profile(ctx, tx, id, current.Account)
		return e
	})
	return v, e
}
func (s *Service) PlatformNetwork(ctx context.Context, token, csrf, request, name string) (NetworkProfile, error) {
	var v NetworkProfile
	if csrf == "" {
		return v, ErrForbidden
	}
	if !validText(name, 1, 120) {
		return v, ErrInvalid
	}
	id := uuid()
	e := s.networkTx(ctx, token, csrf, id, request, true, func(tx *sql.Tx, current Session) error {
		if _, e := tx.ExecContext(ctx, `INSERT INTO organization.networks(id,name) VALUES($1,$2)`, id, name); e != nil {
			return e
		}
		var e error
		v, e = profile(ctx, tx, id, current.Account)
		return e
	})
	return v, e
}
func (s *Service) RenameNetwork(ctx context.Context, token, csrf, id, request, name string, base int64) (NetworkProfile, error) {
	var v NetworkProfile
	if csrf == "" {
		return v, ErrForbidden
	}
	if !validText(name, 1, 120) || base < 1 {
		return v, ErrInvalid
	}
	e := s.networkTx(ctx, token, csrf, id, request, false, func(tx *sql.Tx, current Session) error {
		r, e := tx.ExecContext(ctx, `UPDATE organization.networks SET name=$2,version=version+1 WHERE id=$1 AND version=$3`, id, name, base)
		if e != nil {
			return e
		}
		n, _ := r.RowsAffected()
		if n != 1 {
			return ErrConflict
		}
		v, e = profile(ctx, tx, id, current.Account)
		return e
	})
	return v, e
}
func (s *Service) SaveClub(ctx context.Context, token, csrf, network, id, request, name, address string, base int64) (Club, error) {
	var c Club
	if csrf == "" {
		return c, ErrForbidden
	}
	if !validText(name, 1, 120) || !validText(address, 0, 300) || base < 0 || (id != "" && !uuidPattern.MatchString(id)) {
		return c, ErrInvalid
	}
	creating := id == ""
	if creating {
		id = uuid()
		if base != 0 {
			return c, ErrInvalid
		}
	} else if base == 0 {
		return c, ErrInvalid
	}
	e := s.networkTx(ctx, token, csrf, network, request, false, func(tx *sql.Tx, _ Session) error {
		if _, e := tx.ExecContext(ctx, `SELECT set_config('judeos.tenant_id',$1,true),pg_advisory_xact_lock(hashtextextended($1,21))`, id); e != nil {
			return e
		}
		query := `UPDATE core.clubs SET name=$2,address=$3,version=version+1 WHERE tenant_id=$1 AND network_id=$4 AND version=$5 RETURNING tenant_id,network_id,name,address,timezone,version`
		args := []any{id, name, address, network, base}
		if creating {
			query = `INSERT INTO core.clubs(tenant_id,name,address,network_id) VALUES($1,$2,$3,$4) RETURNING tenant_id,network_id,name,address,timezone,version`
			args = args[:4]
		}
		e := tx.QueryRowContext(ctx, query, args...).Scan(&c.ID, &c.Network, &c.Name, &c.Address, &c.Timezone, &c.Version)
		if errors.Is(e, sql.ErrNoRows) {
			return ErrConflict
		}
		return e
	})
	return c, e
}
func (s *Service) NetworkOwner(ctx context.Context, token, csrf, id, request, login string, active bool) error {
	if csrf == "" {
		return ErrForbidden
	}
	login, e := NormalizeLogin(login)
	if e != nil {
		return ErrInvalid
	}
	return s.networkTx(ctx, token, csrf, id, request, false, func(tx *sql.Tx, _ Session) error {
		var account string
		e := tx.QueryRowContext(ctx, `SELECT id FROM access.accounts WHERE login=$1 AND password_hash IS NOT NULL AND NOT disabled FOR UPDATE`, login).Scan(&account)
		if errors.Is(e, sql.ErrNoRows) {
			return ErrToken
		}
		if e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, `INSERT INTO organization.owners VALUES($1,$2,$3) ON CONFLICT(network_id,account_id) DO UPDATE SET active=EXCLUDED.active`, id, account, active); e != nil {
			return e
		}
		_, e = tx.ExecContext(ctx, `UPDATE access.sessions SET revoked=true WHERE account_id=$1`, account)
		return e
	})
}
func (s *Service) PlatformAdministrator(ctx context.Context, token, csrf, request, login string, active bool) error {
	if csrf == "" {
		return ErrForbidden
	}
	login, e := NormalizeLogin(login)
	if e != nil {
		return ErrInvalid
	}
	v, e := s.Session(ctx, token)
	if e != nil {
		return e
	}
	if !v.Platform || csrf != v.CSRF {
		return ErrForbidden
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return safe(e)
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(27,1)`); e != nil {
		return dbError(e)
	}
	// Take the same club locks as scoped requests before revoking global authority.
	for _, m := range v.Memberships {
		if _, e = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,21))`, m.Tenant); e != nil {
			return dbError(e)
		}
	}
	current, e := session(ctx, tx, token)
	if e != nil {
		return safe(e)
	}
	if !current.Platform || csrf != current.CSRF {
		return ErrForbidden
	}
	var target string
	if e = tx.QueryRowContext(ctx, `SELECT id FROM access.accounts WHERE login=$1 AND NOT disabled AND password_hash IS NOT NULL FOR UPDATE`, login).Scan(&target); errors.Is(e, sql.ErrNoRows) {
		return ErrToken
	} else if e != nil {
		return safe(e)
	}
	if _, e = tx.ExecContext(ctx, `SELECT access.change_platform_administrator($1,$2,$3,$4)`, current.Account, target, active, request); e != nil {
		return dbError(e)
	}
	return dbError(tx.Commit())
}

// BootstrapPlatform is deliberately operator-only. It cannot promote a club
// administrator through an HTTP invitation or an ordinary club API.
func BootstrapPlatform(ctx context.Context, db *sql.DB, login string) (Link, error) {
	var link Link
	login, e := NormalizeLogin(login)
	if e != nil {
		return link, ErrInvalid
	}
	tx, e := db.BeginTx(ctx, nil)
	if e != nil {
		return link, safe(e)
	}
	defer tx.Rollback()
	var role string
	if e = tx.QueryRowContext(ctx, `SELECT current_user`).Scan(&role); e != nil || role != "judeos_migrator" {
		return link, ErrForbidden
	}
	if _, e = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(27,1),set_config('judeos.actor_id','00000000-0000-4000-8000-000000000301',true),set_config('judeos.request_id','00000000000000000000000000000027',true)`); e != nil {
		return link, safe(e)
	}
	var account string
	var exists bool
	if e = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM organization.platform_administrators WHERE active)`).Scan(&exists); e != nil {
		return link, safe(e)
	}
	if exists {
		e = tx.QueryRowContext(ctx, `SELECT a.id FROM access.accounts a JOIN organization.platform_administrators p ON p.account_id=a.id WHERE a.login=$1 AND a.password_hash IS NULL AND NOT a.disabled AND p.active`, login).Scan(&account)
		if e != nil {
			return link, ErrConflict
		}
	} else {
		account = uuid()
		if _, e = tx.ExecContext(ctx, `INSERT INTO access.accounts(id,login) VALUES($1,$2)`, account, login); e != nil {
			return link, dbError(e)
		}
		if _, e = tx.ExecContext(ctx, `INSERT INTO organization.platform_administrators VALUES($1,true)`, account); e != nil {
			return link, dbError(e)
		}
	}
	link = Link{Token: secret(), Expires: time.Now().UTC().Add(InviteTTL)}
	if _, e = tx.ExecContext(ctx, `UPDATE access.platform_tokens SET used=true WHERE account_id=$1 AND NOT used`, account); e != nil {
		return Link{}, safe(e)
	}
	if _, e = tx.ExecContext(ctx, `INSERT INTO access.platform_tokens VALUES($1,$2,$3,false)`, digest(link.Token), account, link.Expires); e != nil {
		return Link{}, safe(e)
	}
	return link, dbError(tx.Commit())
}
func (s *Service) redeemPlatform(ctx context.Context, token, password, preauth, csrf, request string) error {
	var account string
	e := s.DB.QueryRowContext(ctx, `SELECT account_id FROM access.platform_tokens WHERE secret_hash=$1 AND NOT used AND expires_at>clock_timestamp()`, digest(token)).Scan(&account)
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
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return safe(e)
	}
	defer tx.Rollback()
	var pending bool
	if e = tx.QueryRowContext(ctx, `SELECT password_hash IS NULL FROM access.accounts WHERE id=$1 AND NOT disabled FOR UPDATE`, account).Scan(&pending); e != nil || !pending {
		return ErrToken
	}
	var expected string
	if e = tx.QueryRowContext(ctx, `DELETE FROM access.preauth WHERE secret_hash=$1 AND csrf=$2 AND expires_at>clock_timestamp() RETURNING csrf`, digest(preauth), csrf).Scan(&expected); errors.Is(e, sql.ErrNoRows) {
		return ErrForbidden
	} else if e != nil {
		return safe(e)
	}
	r, e := tx.ExecContext(ctx, `UPDATE access.platform_tokens SET used=true WHERE secret_hash=$1 AND NOT used AND expires_at>clock_timestamp()`, digest(token))
	if e != nil {
		return safe(e)
	}
	n, _ := r.RowsAffected()
	if n != 1 {
		return ErrToken
	}
	var platform bool
	if e = tx.QueryRowContext(ctx, `SELECT access.is_platform_administrator($1)`, account).Scan(&platform); e != nil || !platform {
		return ErrToken
	}
	if _, e = tx.ExecContext(ctx, `UPDATE access.accounts SET password_hash=$2 WHERE id=$1`, account, hash); e != nil {
		return safe(e)
	}
	return dbError(tx.Commit())
}
