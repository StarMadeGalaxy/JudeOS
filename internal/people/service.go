package people

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/StarMadeGalaxy/JudeOS/internal/access"
)

type Service struct{ Access *access.Service }

func New(a *access.Service) *Service { return &Service{a} }
func (s *Service) within(ctx context.Context, token, csrf, tenant, request string, fn func(*sql.Tx, access.Session) error) error {
	var fault *Fault
	e := s.Access.Within(ctx, token, csrf, tenant, request, "people", func(tx *sql.Tx, v access.Session) error {
		e := fn(tx, v)
		if errors.As(e, &fault) {
			return access.ErrInvalid
		}
		return e
	})
	if fault != nil {
		return fault
	}
	return e
}
func textOK(v string, max int) bool {
	return utf8.ValidString(v) && utf8.RuneCountInString(v) <= max && strings.TrimSpace(v) != "" && !strings.ContainsFunc(v, unicode.IsControl)
}
func person(ctx context.Context, tx *sql.Tx, id string) (Person, error) {
	var v Person
	e := tx.QueryRowContext(ctx, `SELECT id,tenant_id,display_name,CASE WHEN archived THEN NULL ELSE phone END,archived,version FROM core.people WHERE id=$1`, id).Scan(&v.ID, &v.Tenant, &v.Name, &v.Phone, &v.Archived, &v.Version)
	if errors.Is(e, sql.ErrNoRows) {
		return v, notFound()
	}
	return v, e
}
func guardian(ctx context.Context, tx *sql.Tx, id string) (Guardian, error) {
	var v Guardian
	e := tx.QueryRowContext(ctx, `SELECT id,athlete_id,representative_person_id,status,basis_kind,verified_by_account_id,valid_from,valid_until,version FROM core.guardian_links WHERE id=$1`, id).Scan(&v.ID, &v.Athlete, &v.Representative, &v.Status, &v.Basis, &v.Actor, &v.From, &v.Until, &v.Version)
	if errors.Is(e, sql.ErrNoRows) {
		return v, notFound()
	}
	if e == nil {
		p, err := person(ctx, tx, v.Representative)
		if err != nil {
			return v, err
		}
		v.Name = p.Name
	}
	return v, e
}
func athlete(ctx context.Context, tx *sql.Tx, id string) (Athlete, error) {
	v := Athlete{Links: []Guardian{}}
	var pid string
	e := tx.QueryRowContext(ctx, `SELECT id,person_id,participation,archived,version,primary_guardian_link_id FROM core.athletes WHERE id=$1`, id).Scan(&v.ID, &pid, &v.Participation, &v.Archived, &v.Version, &v.Primary)
	if errors.Is(e, sql.ErrNoRows) {
		return v, notFound()
	}
	if e != nil {
		return v, e
	}
	v.Person, e = person(ctx, tx, pid)
	if e != nil {
		return v, e
	}
	rows, e := tx.QueryContext(ctx, `SELECT g.id,g.athlete_id,g.representative_person_id,g.status,g.basis_kind,g.verified_by_account_id,g.valid_from,g.valid_until,g.version,p.display_name FROM core.guardian_links g JOIN core.people p ON (p.tenant_id,p.id)=(g.tenant_id,g.representative_person_id) WHERE g.athlete_id=$1 ORDER BY g.id`, id)
	if e != nil {
		return v, e
	}
	for rows.Next() {
		var g Guardian
		if e = rows.Scan(&g.ID, &g.Athlete, &g.Representative, &g.Status, &g.Basis, &g.Actor, &g.From, &g.Until, &g.Version, &g.Name); e != nil {
			rows.Close()
			return v, e
		}
		v.Links = append(v.Links, g)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return v, e
	}
	if !v.Archived && !v.Person.Archived && v.Primary != nil {
		var c Contact
		e = tx.QueryRowContext(ctx, `SELECT p.display_name,p.phone FROM core.guardian_links g JOIN core.people p ON (p.tenant_id,p.id)=(g.tenant_id,g.representative_person_id) WHERE g.id=$1 AND g.status='verified' AND g.valid_from<=clock_timestamp() AND (g.valid_until IS NULL OR g.valid_until>clock_timestamp()) AND NOT p.archived`, *v.Primary).Scan(&c.Name, &c.Phone)
		if e == nil {
			v.Contact = &c
		} else if !errors.Is(e, sql.ErrNoRows) {
			return v, e
		}
	}
	return v, nil
}
func household(ctx context.Context, tx *sql.Tx, id string) (Household, error) {
	v := Household{Members: []Member{}}
	e := tx.QueryRowContext(ctx, `SELECT id,name,version FROM core.households WHERE id=$1`, id).Scan(&v.ID, &v.Name, &v.Version)
	if errors.Is(e, sql.ErrNoRows) {
		return v, notFound()
	}
	if e != nil {
		return v, e
	}
	rows, e := tx.QueryContext(ctx, `SELECT m.id,m.person_id,m.valid_from,m.valid_until,p.display_name FROM core.household_members m JOIN core.people p ON (p.tenant_id,p.id)=(m.tenant_id,m.person_id) WHERE m.household_id=$1 ORDER BY m.id`, id)
	if e != nil {
		return v, e
	}
	defer rows.Close()
	for rows.Next() {
		var m Member
		if e = rows.Scan(&m.ID, &m.Person, &m.From, &m.Until, &m.Name); e != nil {
			return v, e
		}
		v.Members = append(v.Members, m)
	}
	return v, rows.Err()
}
func get(ctx context.Context, tx *sql.Tx, kind, id string) (any, error) {
	switch kind {
	case "people":
		return person(ctx, tx, id)
	case "athletes":
		return athlete(ctx, tx, id)
	case "households":
		return household(ctx, tx, id)
	}
	return nil, access.ErrInvalid
}
func (s *Service) Get(ctx context.Context, token, tenant, request, kind, id string) (any, error) {
	var v any
	if !uuidPattern.MatchString(id) {
		return nil, access.ErrInvalid
	}
	e := s.within(ctx, token, "", tenant, request, func(tx *sql.Tx, _ access.Session) error { var e error; v, e = get(ctx, tx, kind, id); return e })
	return v, e
}
func (s *Service) List(ctx context.Context, token, tenant, request, kind, q, state, after string, limit int) (Page, error) {
	v := Page{Items: []any{}}
	if kind == "households" && state == "archived" {
		return v, access.ErrInvalid
	}
	if limit < 1 || limit > 100 || utf8.RuneCountInString(q) > 200 || !utf8.ValidString(q) || (after != "" && !uuidPattern.MatchString(after)) || (state != "active" && state != "archived" && state != "all") {
		return v, access.ErrInvalid
	}
	e := s.within(ctx, token, "", tenant, request, func(tx *sql.Tx, _ access.Session) error {
		var query string
		switch kind {
		case "people":
			query = `SELECT id,display_name,archived,version,tenant_id::text,'' FROM core.people WHERE ($1='' OR position(lower($1) in lower(display_name))>0) AND ($2='all' OR archived=($2='archived')) AND ($3='' OR id>NULLIF($3,'')::uuid) ORDER BY id LIMIT $4`
		case "athletes":
			query = `SELECT a.id,p.display_name,(a.archived OR p.archived),a.version,p.id::text,a.participation FROM core.athletes a JOIN core.people p ON (p.tenant_id,p.id)=(a.tenant_id,a.person_id) WHERE ($1='' OR position(lower($1) in lower(p.display_name))>0) AND ($2='all' OR (a.archived OR p.archived)=($2='archived')) AND ($3='' OR a.id>NULLIF($3,'')::uuid) ORDER BY a.id LIMIT $4`
		case "households":
			query = `SELECT id,name,false,version,'','' FROM core.households WHERE ($1='' OR position(lower($1) in lower(name))>0) AND $2 IN ('active','all') AND ($3='' OR id>NULLIF($3,'')::uuid) ORDER BY id LIMIT $4`
		default:
			return access.ErrInvalid
		}
		rows, e := tx.QueryContext(ctx, query, q, state, after, limit+1)
		if e != nil {
			return e
		}
		defer rows.Close()
		var last string
		for rows.Next() {
			var id, name, related, participation string
			var archived bool
			var version int64
			if e = rows.Scan(&id, &name, &archived, &version, &related, &participation); e != nil {
				return e
			}
			if len(v.Items) == limit {
				v.Next = &last
				break
			}
			last = id
			switch kind {
			case "people":
				v.Items = append(v.Items, map[string]any{"person_id": id, "tenant_id": related, "display_name": name, "archived": archived, "version": version})
			case "athletes":
				v.Items = append(v.Items, map[string]any{"athlete_id": id, "person_id": related, "display_name": name, "participation": participation, "archived": archived, "version": version})
			case "households":
				v.Items = append(v.Items, map[string]any{"household_id": id, "name": name, "version": version})
			}
		}
		return rows.Err()
	})
	return v, e
}

var commandFields = map[string]string{
	"createPerson": "operation_id display_name phone", "updatePerson": "operation_id base_version display_name phone", "archivePerson": "operation_id base_version",
	"createAthlete": "operation_id person_id participation", "updateAthlete": "operation_id base_version participation", "archiveAthlete": "operation_id base_version",
	"verifyGuardianLink": "operation_id base_version representative_person_id basis_kind valid_from valid_until", "revokeGuardianLink": "operation_id base_version",
	"setPrimaryContact": "operation_id base_version guardian_link_id", "createHousehold": "operation_id name", "updateHousehold": "operation_id base_version name",
	"addHouseholdMember": "operation_id base_version person_id valid_from valid_until", "endHouseholdMember": "operation_id base_version valid_until",
}

func Decode(kind string, raw []byte) (Command, error) {
	var c Command
	if !utf8.Valid(raw) {
		return c, access.ErrInvalid
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || fields == nil {
		return c, access.ErrInvalid
	}
	allowed, ok := commandFields[kind]
	if !ok {
		return c, access.ErrInvalid
	}
	for k := range fields {
		if !strings.Contains(" "+allowed+" ", " "+k+" ") {
			return c, access.ErrInvalid
		}
	}
	for _, k := range strings.Fields(allowed) {
		if k == "phone" {
			continue
		}
		if _, ok := fields[k]; !ok {
			return c, access.ErrInvalid
		}
		if string(fields[k]) == "null" && k != "valid_until" && k != "guardian_link_id" {
			return c, access.ErrInvalid
		}
	}
	if json.Unmarshal(raw, &c) != nil || !uuidPattern.MatchString(c.Operation) {
		return c, access.ErrInvalid
	}
	if strings.Contains(allowed, "base_version") && (c.Base < 1 || c.Base >= 9007199254740991) {
		return c, access.ErrInvalid
	}
	if strings.Contains(allowed, "display_name") && !textOK(c.Name, 200) {
		return c, access.ErrInvalid
	}
	if strings.Contains(allowed, " name") && !textOK(c.HouseholdName, 200) {
		return c, access.ErrInvalid
	}
	if c.Phone != nil && !textOK(*c.Phone, 50) {
		return c, access.ErrInvalid
	}
	if strings.Contains(allowed, "person_id") && !uuidPattern.MatchString(c.Person) && !uuidPattern.MatchString(c.Representative) {
		return c, access.ErrInvalid
	}
	if strings.Contains(allowed, "participation") && c.Participation != "regular" && c.Participation != "guest" {
		return c, access.ErrInvalid
	}
	if strings.Contains(allowed, "basis_kind") && !textOK(c.Basis, 80) {
		return c, access.ErrInvalid
	}
	if c.Guardian != nil && !uuidPattern.MatchString(*c.Guardian) {
		return c, access.ErrInvalid
	}
	if strings.Contains(allowed, "valid_from") && (c.From.IsZero() || !strings.HasSuffix(strings.Trim(string(fields["valid_from"]), "\""), "Z")) {
		return c, access.ErrInvalid
	}
	if c.Until != nil && (!strings.HasSuffix(strings.Trim(string(fields["valid_until"]), "\""), "Z") || (!c.From.IsZero() && !c.Until.After(c.From))) {
		return c, access.ErrInvalid
	}
	if kind == "endHouseholdMember" && c.Until == nil {
		return c, access.ErrInvalid
	}
	return c, nil
}
func refs(ctx context.Context, tx *sql.Tx, v any) ([]Ref, error) {
	var r []Ref
	switch x := v.(type) {
	case Person:
		r = append(r, Ref{"person", x.ID, x.Version, !x.Archived})
	case Guardian:
		r = append(r, Ref{"guardian", x.ID, x.Version, false})
		p, e := person(ctx, tx, x.Representative)
		if e != nil {
			return nil, e
		}
		r = append(r, Ref{"person", p.ID, p.Version, !p.Archived})
	case Athlete:
		r = append(r, Ref{"athlete", x.ID, x.Version, !x.Archived}, Ref{"person", x.Person.ID, x.Person.Version, !x.Person.Archived})
		for _, g := range x.Links {
			r = append(r, Ref{"guardian", g.ID, g.Version, false})
			p, e := person(ctx, tx, g.Representative)
			if e != nil {
				return nil, e
			}
			r = append(r, Ref{"person", p.ID, p.Version, false})
		}
		if x.Contact != nil && x.Primary != nil {
			g, e := guardian(ctx, tx, *x.Primary)
			if e != nil {
				return nil, e
			}
			p, e := person(ctx, tx, g.Representative)
			if e != nil {
				return nil, e
			}
			r = append(r, Ref{"guardian", g.ID, g.Version, true}, Ref{"person", p.ID, p.Version, true})
		}
	case Household:
		r = append(r, Ref{"household", x.ID, x.Version, false})
		for _, m := range x.Members {
			p, e := person(ctx, tx, m.Person)
			if e != nil {
				return nil, e
			}
			r = append(r, Ref{"person", p.ID, p.Version, false})
		}
	}
	return r, nil
}
func checkRefs(ctx context.Context, tx *sql.Tx, rs []Ref, op string) error {
	for _, r := range rs {
		var v int64
		var active bool
		var e error
		switch r.Kind {
		case "person":
			e = tx.QueryRowContext(ctx, `SELECT version,NOT archived FROM core.people WHERE id=$1`, r.ID).Scan(&v, &active)
		case "athlete":
			e = tx.QueryRowContext(ctx, `SELECT version,NOT archived FROM core.athletes WHERE id=$1`, r.ID).Scan(&v, &active)
		case "guardian":
			e = tx.QueryRowContext(ctx, `SELECT version,status='verified' AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp()) FROM core.guardian_links WHERE id=$1`, r.ID).Scan(&v, &active)
		case "household":
			e = tx.QueryRowContext(ctx, `SELECT version,true FROM core.households WHERE id=$1`, r.ID).Scan(&v, &active)
		default:
			return access.ErrInvalid
		}
		if errors.Is(e, sql.ErrNoRows) {
			return notFound()
		}
		if e != nil {
			return e
		}
		if v != r.Version || (r.Active && !active) {
			return conflict("RESULT_NOT_CURRENT", op, nil)
		}
	}
	return nil
}

// Command uses a normalized typed payload for the hash; omitted/null phone is identical.
func (s *Service) Command(ctx context.Context, token, csrf, tenant, request, kind, target, sub string, c Command) (json.RawMessage, bool, error) {
	if csrf == "" {
		return nil, false, access.ErrForbidden
	}
	if (target != "" && !uuidPattern.MatchString(target)) || (sub != "" && !uuidPattern.MatchString(sub)) {
		return nil, false, access.ErrInvalid
	}
	canonical, _ := json.Marshal(struct {
		API, Kind, Target, Sub string
		Payload                Command
	}{"v1", kind, target, sub, c})
	h := sha256.Sum256(canonical)
	hash := hex.EncodeToString(h[:])
	var result json.RawMessage
	replayed := false
	var terminal *Fault
	e := s.within(ctx, token, csrf, tenant, request, func(tx *sql.Tx, session access.Session) error {
		// Resolve every client reference in this club before version/idempotency checks.
		var current any
		var e error
		if target != "" {
			k := "people"
			if strings.Contains(kind, "Athlete") || strings.Contains(kind, "Guardian") || kind == "setPrimaryContact" {
				k = "athletes"
			}
			if strings.Contains(kind, "Household") {
				k = "households"
			}
			current, e = get(ctx, tx, k, target)
			if e != nil {
				return e
			}
		}
		if c.Person != "" {
			p, e := person(ctx, tx, c.Person)
			if e != nil {
				return e
			}
			if p.Archived {
				return conflict("PERSON_ARCHIVED", c.Operation, nil)
			}
		}
		if c.Representative != "" {
			p, e := person(ctx, tx, c.Representative)
			if e != nil {
				return e
			}
			if p.Archived {
				return conflict("PERSON_ARCHIVED", c.Operation, nil)
			}
		}
		if c.Guardian != nil {
			g, e := guardian(ctx, tx, *c.Guardian)
			if e != nil {
				return e
			}
			if g.Athlete != target {
				return notFound()
			}
		}
		if sub != "" {
			var belongs bool
			if kind == "revokeGuardianLink" {
				e = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM core.guardian_links WHERE id=$1 AND athlete_id=$2)`, sub, target).Scan(&belongs)
			} else {
				e = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM core.household_members WHERE id=$1 AND household_id=$2)`, sub, target).Scan(&belongs)
			}
			if e != nil {
				return e
			}
			if !belongs {
				return notFound()
			}
		}
		var oldhash string
		var rawrefs []byte
		e = tx.QueryRowContext(ctx, `SELECT request_hash,response,references_json FROM core.registry_operations WHERE actor_id=$1 AND operation_id=$2`, session.Account, c.Operation).Scan(&oldhash, &result, &rawrefs)
		if e == nil {
			var r []Ref
			if json.Unmarshal(rawrefs, &r) != nil {
				return access.ErrInvalid
			}
			if e = checkRefs(ctx, tx, r, c.Operation); e != nil {
				return e
			}
			if hash != oldhash {
				return conflict("OPERATION_ID_REUSED", c.Operation, nil)
			}
			var stored struct {
				Conflict *Fault `json:"registry_conflict"`
			}
			if json.Unmarshal(result, &stored) == nil && stored.Conflict != nil {
				terminal = stored.Conflict
			}
			replayed = true
			return nil
		}
		if !errors.Is(e, sql.ErrNoRows) {
			return e
		}
		var version int64
		var archived bool
		switch v := current.(type) {
		case Person:
			version = v.Version
			archived = v.Archived
		case Athlete:
			version = v.Version
			archived = v.Archived || v.Person.Archived
		case Household:
			version = v.Version
		}
		if version > 0 && c.Base != version {
			terminal = conflict("ENTITY_VERSION_CONFLICT", c.Operation, &version)
			stored, _ := json.Marshal(map[string]any{"registry_conflict": terminal})
			_, e := tx.ExecContext(ctx, `INSERT INTO core.registry_operations VALUES($1,$2,$3,$4,$5,'[]'::jsonb)`, tenant, session.Account, c.Operation, hash, string(stored))
			return e
		}
		if archived && !strings.HasPrefix(kind, "archive") {
			return conflict("PERSON_ARCHIVED", c.Operation, nil)
		}
		id := UUID()
		var output any
		switch kind {
		case "createPerson":
			_, e = tx.ExecContext(ctx, `INSERT INTO core.people(tenant_id,id,display_name,phone) VALUES($1,$2,$3,$4)`, tenant, id, c.Name, c.Phone)
			if e == nil {
				output, e = person(ctx, tx, id)
			}
		case "updatePerson":
			_, e = tx.ExecContext(ctx, `UPDATE core.people SET display_name=$2,phone=$3,version=version+1 WHERE id=$1`, target, c.Name, c.Phone)
			if e == nil {
				output, e = person(ctx, tx, target)
			}
		case "createAthlete":
			var exists bool
			e = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM core.athletes WHERE person_id=$1)`, c.Person).Scan(&exists)
			if e != nil {
				return e
			}
			if exists {
				return conflict("ATHLETE_ALREADY_EXISTS", c.Operation, nil)
			}
			_, e = tx.ExecContext(ctx, `INSERT INTO core.athletes(tenant_id,id,person_id,participation) VALUES($1,$2,$3,$4)`, tenant, id, c.Person, c.Participation)
			if e == nil {
				output, e = athlete(ctx, tx, id)
			}
		case "updateAthlete":
			_, e = tx.ExecContext(ctx, `UPDATE core.athletes SET participation=$2,version=version+1 WHERE id=$1`, target, c.Participation)
			if e == nil {
				output, e = athlete(ctx, tx, target)
			}
		case "archivePerson", "archiveAthlete":
			condition := `athlete_id=$1`
			if kind == "archivePerson" {
				condition = `representative_person_id=$1 OR athlete_id IN (SELECT id FROM core.athletes WHERE person_id=$1)`
			}
			_, e = tx.ExecContext(ctx, `UPDATE core.guardian_links SET status='revoked',version=version+1 WHERE status<>'revoked' AND (`+condition+`)`, target)
			if e != nil {
				return e
			}
			if kind == "archivePerson" {
				_, e = tx.ExecContext(ctx, `UPDATE core.athletes SET archived=true,primary_guardian_link_id=NULL,version=version+1 WHERE person_id=$1 AND NOT archived`, target)
				if e != nil {
					return e
				}
				_, e = tx.ExecContext(ctx, `UPDATE core.athletes SET primary_guardian_link_id=NULL,version=version+1 WHERE primary_guardian_link_id IN (SELECT id FROM core.guardian_links WHERE representative_person_id=$1)`, target)
				if e != nil {
					return e
				}
				_, e = tx.ExecContext(ctx, `UPDATE core.people SET archived=true,phone=NULL,version=version+1 WHERE id=$1 AND NOT archived`, target)
				if e == nil {
					output, e = person(ctx, tx, target)
				}
			} else {
				_, e = tx.ExecContext(ctx, `UPDATE core.athletes SET archived=true,primary_guardian_link_id=NULL,version=version+1 WHERE id=$1 AND NOT archived`, target)
				if e == nil {
					output, e = athlete(ctx, tx, target)
				}
			}
		case "verifyGuardianLink":
			_, e = tx.ExecContext(ctx, `INSERT INTO core.guardian_links(tenant_id,id,athlete_id,representative_person_id,basis_kind,verified_by_account_id,valid_from,valid_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, tenant, id, target, c.Representative, c.Basis, session.Account, c.From, c.Until)
			if e != nil {
				return e
			}
			_, e = tx.ExecContext(ctx, `UPDATE core.athletes SET version=version+1 WHERE id=$1`, target)
			if e == nil {
				output, e = guardian(ctx, tx, id)
			}
		case "revokeGuardianLink":
			_, e = tx.ExecContext(ctx, `UPDATE core.guardian_links SET status='revoked',version=version+1 WHERE id=$1 AND status<>'revoked'`, sub)
			if e != nil {
				return e
			}
			_, e = tx.ExecContext(ctx, `UPDATE core.athletes SET primary_guardian_link_id=CASE WHEN primary_guardian_link_id=$2 THEN NULL ELSE primary_guardian_link_id END,version=version+1 WHERE id=$1`, target, sub)
			if e == nil {
				output, e = athlete(ctx, tx, target)
			}
		case "setPrimaryContact":
			if c.Guardian != nil {
				var active bool
				e = tx.QueryRowContext(ctx, `SELECT g.status='verified' AND g.valid_from<=clock_timestamp() AND (g.valid_until IS NULL OR g.valid_until>clock_timestamp()) AND NOT p.archived FROM core.guardian_links g JOIN core.people p ON (p.tenant_id,p.id)=(g.tenant_id,g.representative_person_id) WHERE g.id=$1`, *c.Guardian).Scan(&active)
				if e != nil {
					return e
				}
				if !active {
					return conflict("GUARDIAN_LINK_INACTIVE", c.Operation, nil)
				}
			}
			_, e = tx.ExecContext(ctx, `UPDATE core.athletes SET primary_guardian_link_id=$2,version=version+1 WHERE id=$1`, target, c.Guardian)
			if e == nil {
				output, e = athlete(ctx, tx, target)
			}
		case "createHousehold":
			_, e = tx.ExecContext(ctx, `INSERT INTO core.households(tenant_id,id,name) VALUES($1,$2,$3)`, tenant, id, c.HouseholdName)
			if e == nil {
				output, e = household(ctx, tx, id)
			}
		case "updateHousehold":
			_, e = tx.ExecContext(ctx, `UPDATE core.households SET name=$2,version=version+1 WHERE id=$1`, target, c.HouseholdName)
			if e == nil {
				output, e = household(ctx, tx, target)
			}
		case "addHouseholdMember":
			_, e = tx.ExecContext(ctx, `INSERT INTO core.household_members(tenant_id,id,household_id,person_id,valid_from,valid_until) VALUES($1,$2,$3,$4,$5,$6)`, tenant, id, target, c.Person, c.From, c.Until)
			if e != nil {
				return e
			}
			_, e = tx.ExecContext(ctx, `UPDATE core.households SET version=version+1 WHERE id=$1`, target)
			if e == nil {
				output, e = household(ctx, tx, target)
			}
		case "endHouseholdMember":
			var from time.Time
			var until *time.Time
			e = tx.QueryRowContext(ctx, `SELECT valid_from,valid_until FROM core.household_members WHERE id=$1`, sub).Scan(&from, &until)
			if e != nil {
				return e
			}
			if !c.Until.After(from) {
				return access.ErrInvalid
			}
			if until != nil {
				return conflict("MEMBERSHIP_ENDED", c.Operation, nil)
			}
			_, e = tx.ExecContext(ctx, `UPDATE core.household_members SET valid_until=$2 WHERE id=$1`, sub, c.Until)
			if e != nil {
				return e
			}
			_, e = tx.ExecContext(ctx, `UPDATE core.households SET version=version+1 WHERE id=$1`, target)
			if e == nil {
				output, e = household(ctx, tx, target)
			}
		default:
			return access.ErrInvalid
		}
		if e != nil {
			return e
		}
		result, e = json.Marshal(output)
		if e != nil {
			return e
		}
		r, e := refs(ctx, tx, output)
		if e != nil {
			return e
		}
		rr, e := json.Marshal(r)
		if e != nil {
			return e
		}
		_, e = tx.ExecContext(ctx, `INSERT INTO core.registry_operations VALUES($1,$2,$3,$4,$5,$6)`, tenant, session.Account, c.Operation, hash, string(result), string(rr))
		return e
	})
	if e == nil && terminal != nil {
		return nil, replayed, terminal
	}
	return result, replayed, e
}
