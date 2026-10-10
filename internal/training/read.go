package training

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/StarMadeGalaxy/JudeOS/internal/access"
)

type Service struct{ Access *access.Service }

func New(a *access.Service) *Service { return &Service{a} }
func admin(v access.Session, tenant string) bool {
	for _, m := range v.Memberships {
		if m.Tenant == tenant && access.Allows(m.Grants, "schedule", false) {
			return true
		}
	}
	return false
}
func (s *Service) within(ctx context.Context, token, csrf, tenant, request, action, target string, fn func(*sql.Tx, access.Session) error) error {
	var fault *Fault
	wrap := func(f func(*sql.Tx, access.Session) error) func(*sql.Tx, access.Session) error {
		return func(tx *sql.Tx, v access.Session) error {
			e := f(tx, v)
			if errors.As(e, &fault) {
				return access.ErrInvalid
			}
			return e
		}
	}
	var e error
	if action == "journal" || action == "add_guest" {
		// A list has no single object: ListSessions filters every row in SQL below.
		authorize := wrap(func(tx *sql.Tx, v access.Session) error {
			if target == "" {
				return nil
			}
			if _, e := session(ctx, tx, target); e != nil {
				return e
			}
			if admin(v, tenant) {
				return nil
			}
			var assigned bool
			e := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM core.training_session_coaches c
    JOIN core.memberships m ON (m.tenant_id,m.id)=(c.tenant_id,c.membership_id)
    JOIN core.role_grants g ON (g.tenant_id,g.membership_id)=(m.tenant_id,m.id)
    WHERE c.session_id=$1 AND c.valid_until IS NULL AND c.valid_from<=clock_timestamp()
     AND m.account_id=$2 AND m.active AND g.role='coach' AND g.scope='assigned_sessions')`, target, v.Account).Scan(&assigned)
			if e != nil {
				return e
			}
			if !assigned {
				return notFound()
			}
			return nil
		})
		e = s.Access.WithinObject(ctx, token, csrf, tenant, request, action, authorize, wrap(fn))
	} else {
		e = s.Access.Within(ctx, token, csrf, tenant, request, action, wrap(fn))
	}
	if fault != nil {
		return fault
	}
	return e
}

var catalogs = map[string]string{"venues": "core.training_venues", "disciplines": "core.training_disciplines", "groups": "core.training_groups"}

func catalog(ctx context.Context, tx *sql.Tx, kind, id string) (map[string]any, error) {
	table, ok := catalogs[kind]
	if !ok || kind == "groups" {
		return nil, access.ErrInvalid
	}
	var name string
	var archived bool
	var version int64
	e := tx.QueryRowContext(ctx, `SELECT name,archived,version FROM `+table+` WHERE id=$1`, id).Scan(&name, &archived, &version)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, notFound()
	}
	if e != nil {
		return nil, e
	}
	key := "venue_id"
	if kind == "disciplines" {
		key = "discipline_id"
	}
	return map[string]any{key: id, "name": name, "archived": archived, "version": version}, nil
}
func group(ctx context.Context, tx *sql.Tx, id string) (Group, error) {
	v := Group{Enrollments: []Interval{}, Coaches: []GroupCoach{}}
	e := tx.QueryRowContext(ctx, `SELECT id,name,venue_id,discipline_id,archived,version FROM core.training_groups WHERE id=$1`, id).Scan(&v.ID, &v.Name, &v.Venue, &v.Discipline, &v.Archived, &v.Version)
	if errors.Is(e, sql.ErrNoRows) {
		return v, notFound()
	}
	if e != nil {
		return v, e
	}
	rows, e := tx.QueryContext(ctx, `SELECT id,athlete_id,valid_from,valid_until FROM core.training_enrollments WHERE group_id=$1 ORDER BY valid_from,id`, id)
	if e != nil {
		return v, e
	}
	for rows.Next() {
		var x Interval
		if e = rows.Scan(&x.ID, &x.Athlete, &x.From, &x.Until); e != nil {
			rows.Close()
			return v, e
		}
		x.From = x.From.UTC()
		if x.Until != nil {
			u := x.Until.UTC()
			x.Until = &u
		}
		v.Enrollments = append(v.Enrollments, x)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return v, e
	}
	rows, e = tx.QueryContext(ctx, `SELECT id,membership_id,valid_from,valid_until FROM core.training_group_coaches WHERE group_id=$1 ORDER BY valid_from,id`, id)
	if e != nil {
		return v, e
	}
	defer rows.Close()
	for rows.Next() {
		var x GroupCoach
		if e = rows.Scan(&x.ID, &x.Membership, &x.From, &x.Until); e != nil {
			return v, e
		}
		x.From = x.From.UTC()
		if x.Until != nil {
			u := x.Until.UTC()
			x.Until = &u
		}
		v.Coaches = append(v.Coaches, x)
	}
	return v, rows.Err()
}
func session(ctx context.Context, tx *sql.Tx, id string) (Session, error) {
	var v Session
	e := tx.QueryRowContext(ctx, `SELECT id,tenant_id,group_id,group_name,venue_id,venue_name,starts_at,ends_at,state,version FROM core.training_sessions WHERE id=$1`, id).Scan(&v.ID, &v.Tenant, &v.Group.ID, &v.Group.Name, &v.Venue.ID, &v.Venue.Name, &v.Starts, &v.Ends, &v.State, &v.Version)
	v.Starts = v.Starts.UTC()
	v.Ends = v.Ends.UTC()
	if errors.Is(e, sql.ErrNoRows) {
		return v, notFound()
	}
	return v, e
}
func roster(ctx context.Context, tx *sql.Tx, id string) ([]Roster, error) {
	v := []Roster{}
	rows, e := tx.QueryContext(ctx, `SELECT r.athlete_id,p.id,p.display_name,r.participation,r.trial,r.excluded
  FROM core.training_roster r JOIN core.athletes a ON (a.tenant_id,a.id)=(r.tenant_id,r.athlete_id)
  JOIN core.people p ON (p.tenant_id,p.id)=(a.tenant_id,a.person_id) WHERE r.session_id=$1 ORDER BY r.athlete_id`, id)
	if e != nil {
		return v, e
	}
	defer rows.Close()
	for rows.Next() {
		var x Roster
		if e = rows.Scan(&x.Athlete, &x.Person, &x.Name, &x.Participation, &x.Trial, &x.Excluded); e != nil {
			return v, e
		}
		// #31 owns actual Attendance. This is the accepted unrecorded projection,
		// not a fabricated stored mark or an implicit absence.
		x.Attendance = map[string]any{"athlete_id": x.Athlete, "status": "unmarked", "version": 0, "recorded_at": nil, "recorded_by_account_id": nil}
		v = append(v, x)
	}
	return v, rows.Err()
}
func journal(ctx context.Context, tx *sql.Tx, id string) (Journal, error) {
	v := Journal{}
	var e error
	v.Session, e = session(ctx, tx, id)
	if e != nil {
		return v, e
	}
	v.Roster, e = roster(ctx, tx, id)
	return v, e
}
func coaches(ctx context.Context, tx *sql.Tx, id string) (Coaches, error) {
	v := Coaches{Session: id, Coaches: []SessionCoach{}}
	se, e := session(ctx, tx, id)
	if e != nil {
		return v, e
	}
	v.Version = se.Version
	rows, e := tx.QueryContext(ctx, `SELECT id,membership_id,valid_from,valid_until FROM core.training_session_coaches WHERE session_id=$1 ORDER BY valid_from,id`, id)
	if e != nil {
		return v, e
	}
	defer rows.Close()
	for rows.Next() {
		var x SessionCoach
		if e = rows.Scan(&x.ID, &x.Membership, &x.From, &x.Until); e != nil {
			return v, e
		}
		x.From = x.From.UTC()
		if x.Until != nil {
			u := x.Until.UTC()
			x.Until = &u
		}
		v.Coaches = append(v.Coaches, x)
	}
	return v, rows.Err()
}
func (s *Service) Get(ctx context.Context, token, tenant, request, kind, id string) (any, error) {
	if !uuidPattern.MatchString(id) {
		return nil, access.ErrInvalid
	}
	var v any
	action, target := "schedule", ""
	if kind == "sessions" {
		action, target = "journal", id
	}
	e := s.within(ctx, token, "", tenant, request, action, target, func(tx *sql.Tx, _ access.Session) error {
		var e error
		switch kind {
		case "groups":
			v, e = group(ctx, tx, id)
		case "sessions":
			v, e = journal(ctx, tx, id)
		case "coaches":
			v, e = coaches(ctx, tx, id)
		default:
			v, e = catalog(ctx, tx, kind, id)
		}
		return e
	})
	return v, e
}
func (s *Service) List(ctx context.Context, token, tenant, request, kind, q, state, after string, limit int) (Page, error) {
	v := Page{Items: []any{}}
	table, ok := catalogs[kind]
	if !ok || limit < 1 || limit > 100 || !utf8.ValidString(q) || utf8.RuneCountInString(q) > 200 || (state != "active" && state != "archived" && state != "all") || (after != "" && !uuidPattern.MatchString(after)) {
		return v, access.ErrInvalid
	}
	e := s.within(ctx, token, "", tenant, request, "schedule", "", func(tx *sql.Tx, _ access.Session) error {
		extra := "''::text,''::text"
		if kind == "groups" {
			extra = "venue_id::text,discipline_id::text"
		}
		rows, e := tx.QueryContext(ctx, `SELECT id,name,archived,version,`+extra+` FROM `+table+` WHERE ($1='' OR position(lower($1) in lower(name))>0) AND ($2='all' OR archived=($2='archived')) AND ($3='' OR id>NULLIF($3,'')::uuid) ORDER BY id LIMIT $4`, q, state, after, limit+1)
		if e != nil {
			return e
		}
		defer rows.Close()
		var last string
		for rows.Next() {
			var id, name, venue, discipline string
			var archived bool
			var version int64
			if e = rows.Scan(&id, &name, &archived, &version, &venue, &discipline); e != nil {
				return e
			}
			if len(v.Items) == limit {
				v.Next = &last
				break
			}
			last = id
			key := "group_id"
			if kind == "venues" {
				key = "venue_id"
			}
			if kind == "disciplines" {
				key = "discipline_id"
			}
			x := map[string]any{key: id, "name": name, "archived": archived, "version": version}
			if kind == "groups" {
				x["venue_id"] = venue
				x["discipline_id"] = discipline
			}
			v.Items = append(v.Items, x)
		}
		return rows.Err()
	})
	return v, e
}

// Cursor authentication uses the current bearer session as a key, never exposes
// it, and binds actor/tenant/date. A new login intentionally invalidates cursors.
type sessionCursor struct {
	Actor, Tenant, Date, ID string
	Starts                  time.Time
}

func encodeCursor(c sessionCursor, token string) string {
	b, _ := json.Marshal(c)
	m := hmac.New(sha256.New, []byte(token))
	m.Write(b)
	return base64.RawURLEncoding.EncodeToString(b) + "." + base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}
func decodeCursor(raw, token string) (sessionCursor, error) {
	var c sessionCursor
	p := strings.Split(raw, ".")
	if len(p) != 2 || len(raw) > 2048 {
		return c, access.ErrInvalid
	}
	b, e := base64.RawURLEncoding.DecodeString(p[0])
	if e != nil {
		return c, access.ErrInvalid
	}
	sig, e := base64.RawURLEncoding.DecodeString(p[1])
	if e != nil {
		return c, access.ErrInvalid
	}
	m := hmac.New(sha256.New, []byte(token))
	m.Write(b)
	if !hmac.Equal(m.Sum(nil), sig) || json.Unmarshal(b, &c) != nil || !uuidPattern.MatchString(c.ID) || c.Starts.IsZero() {
		return c, access.ErrInvalid
	}
	return c, nil
}
func (s *Service) ListSessions(ctx context.Context, token, tenant, request, date, cursor string, limit int) (Page, error) {
	v := Page{Items: []any{}}
	zone, e := time.LoadLocation("Europe/Minsk")
	if e != nil {
		return v, e
	}
	day, e := time.ParseInLocation("2006-01-02", date, zone)
	if e != nil || day.Format("2006-01-02") != date || limit < 1 || limit > 100 {
		return v, access.ErrInvalid
	}
	e = s.within(ctx, token, "", tenant, request, "journal", "", func(tx *sql.Tx, a access.Session) error {
		var last sessionCursor
		if cursor != "" {
			var e error
			last, e = decodeCursor(cursor, token)
			if e != nil || last.Actor != a.Account || last.Tenant != tenant || last.Date != date {
				return access.ErrInvalid
			}
		}
		rows, e := tx.QueryContext(ctx, `SELECT s.id,s.tenant_id,s.group_id,s.group_name,s.venue_id,s.venue_name,s.starts_at,s.ends_at,s.state,s.version
   FROM core.training_sessions s WHERE s.starts_at >= $1 AND s.starts_at < $2
   AND ($3 OR EXISTS(SELECT 1 FROM core.training_session_coaches c JOIN core.memberships m ON (m.tenant_id,m.id)=(c.tenant_id,c.membership_id)
    JOIN core.role_grants g ON (g.tenant_id,g.membership_id)=(m.tenant_id,m.id) WHERE c.session_id=s.id
    AND c.valid_until IS NULL AND c.valid_from<=clock_timestamp() AND m.active AND m.account_id=$4 AND g.role='coach' AND g.scope='assigned_sessions'))
   AND ($5='' OR (s.starts_at,s.id)>($6,NULLIF($5,'')::uuid)) ORDER BY s.starts_at,s.id LIMIT $7`, day, day.AddDate(0, 0, 1), admin(a, tenant), a.Account, last.ID, last.Starts, limit+1)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			var x Session
			if e = rows.Scan(&x.ID, &x.Tenant, &x.Group.ID, &x.Group.Name, &x.Venue.ID, &x.Venue.Name, &x.Starts, &x.Ends, &x.State, &x.Version); e != nil {
				return e
			}
			x.Starts = x.Starts.UTC()
			x.Ends = x.Ends.UTC()
			if len(v.Items) == limit {
				next := encodeCursor(last, token)
				v.Next = &next
				break
			}
			v.Items = append(v.Items, x)
			last = sessionCursor{Actor: a.Account, Tenant: tenant, Date: date, ID: x.ID, Starts: x.Starts}
		}
		return rows.Err()
	})
	return v, e
}
