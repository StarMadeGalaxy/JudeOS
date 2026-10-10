package training

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"

	"github.com/StarMadeGalaxy/JudeOS/internal/access"
	"github.com/StarMadeGalaxy/JudeOS/internal/people"
)

func athleteRef(ctx context.Context, tx *sql.Tx, id, op string, active bool) (people.TrainingAthlete, error) {
	a, found, e := people.AthleteForTraining(ctx, tx, id)
	if e != nil {
		return a, e
	}
	if !found {
		return a, notFound()
	}
	if active && a.Archived {
		return a, conflict("ATHLETE_ARCHIVED", op, nil)
	}
	return a, nil
}
func coachRef(ctx context.Context, tx *sql.Tx, id, op string) error {
	var active bool
	e := tx.QueryRowContext(ctx, `SELECT m.active AND EXISTS(SELECT 1 FROM core.role_grants g WHERE (g.tenant_id,g.membership_id)=(m.tenant_id,m.id) AND g.role='coach' AND g.scope='assigned_sessions') FROM core.memberships m WHERE m.id=$1`, id).Scan(&active)
	if errors.Is(e, sql.ErrNoRows) {
		return notFound()
	}
	if e != nil {
		return e
	}
	if !active {
		return conflict("COACH_INACTIVE", op, nil)
	}
	return nil
}
func catalogRef(ctx context.Context, tx *sql.Tx, kind, id, op string) (map[string]any, error) {
	v, e := catalog(ctx, tx, kind, id)
	if e != nil {
		return v, e
	}
	if v["archived"].(bool) {
		return v, conflict("ENTITY_ARCHIVED", op, nil)
	}
	return v, nil
}
func editable(se Session, kind, op string) error {
	if se.State == "planned" || se.State == "in_progress" {
		return nil
	}
	if kind == "addKnownRosterAthlete" || kind == "excludeRosterAthlete" {
		if se.State == "closed" {
			return conflict("SESSION_CLOSED", op, nil)
		}
		return conflict("SESSION_CANCELLED", op, nil)
	}
	return conflict("SESSION_ROSTER_LOCKED", op, nil)
}
func rosterResult(ctx context.Context, tx *sql.Tx, id, athlete, op string) (any, error) {
	j, e := journal(ctx, tx, id)
	if e != nil {
		return nil, e
	}
	for _, r := range j.Roster {
		if r.Athlete == athlete {
			return map[string]any{"operation_id": op, "session": j.Session, "entry": r}, nil
		}
	}
	return nil, notFound()
}
func bumpSession(ctx context.Context, tx *sql.Tx, id string) error {
	_, e := tx.ExecContext(ctx, `UPDATE core.training_sessions SET version=version+1 WHERE id=$1`, id)
	return e
}
func insertRoster(ctx context.Context, tx *sql.Tx, tenant, session, athlete, participation, actor string, trial bool) error {
	_, e := tx.ExecContext(ctx, `INSERT INTO core.training_roster(tenant_id,id,session_id,athlete_id,participation,trial,added_by_account_id) VALUES($1,$2,$3,$4,$5,$6,$7)`, tenant, people.UUID(), session, athlete, participation, trial, actor)
	return e
}
func setCoaches(ctx context.Context, tx *sql.Tx, tenant, id, actor string, want []string) (bool, error) {
	rows, e := tx.QueryContext(ctx, `SELECT membership_id FROM core.training_session_coaches WHERE session_id=$1 AND valid_until IS NULL ORDER BY membership_id`, id)
	if e != nil {
		return false, e
	}
	have := map[string]bool{}
	for rows.Next() {
		var x string
		if e = rows.Scan(&x); e != nil {
			rows.Close()
			return false, e
		}
		have[x] = true
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return false, e
	}
	selected := map[string]bool{}
	for _, x := range want {
		selected[x] = true
	}
	changed := false
	for x := range have {
		if !selected[x] {
			_, e = tx.ExecContext(ctx, `UPDATE core.training_session_coaches SET valid_until=clock_timestamp(),ended_by_account_id=$3 WHERE session_id=$1 AND membership_id=$2 AND valid_until IS NULL`, id, x, actor)
			if e != nil {
				return false, e
			}
			changed = true
		}
	}
	for _, x := range want {
		if !have[x] {
			_, e = tx.ExecContext(ctx, `INSERT INTO core.training_session_coaches(tenant_id,id,session_id,membership_id,assigned_by_account_id) VALUES($1,$2,$3,$4,$5)`, tenant, people.UUID(), id, x, actor)
			if e != nil {
				return false, e
			}
			changed = true
		}
	}
	return changed, nil
}

func (s *Service) Command(ctx context.Context, token, csrf, tenant, request, kind, target, sub string, c Command) (json.RawMessage, bool, error) {
	if csrf == "" {
		return nil, false, access.ErrForbidden
	}
	if _, ok := fields[kind]; !ok || (target != "" && !uuidPattern.MatchString(target)) || (sub != "" && !uuidPattern.MatchString(sub)) {
		return nil, false, access.ErrInvalid
	}
	raw, _ := json.Marshal(struct {
		API, Kind, Target, Sub string
		Payload                Command
	}{"v1", kind, target, sub, c})
	hash := sha256.Sum256(raw)
	digest := hex.EncodeToString(hash[:])
	var result json.RawMessage
	replayed := false
	var terminal *Fault
	action, object := "schedule", ""
	if kind == "addKnownRosterAthlete" {
		action, object = "add_guest", target
	}
	e := s.within(ctx, token, csrf, tenant, request, action, object, func(tx *sql.Tx, actor access.Session) error {
		var version int64
		var archived bool
		var se Session
		var g Group
		var e error
		sessionCommand := kind == "setSessionCoaches" || kind == "addKnownRosterAthlete" || kind == "excludeRosterAthlete"
		targetKind := "groups"
		if strings.Contains(kind, "Venue") {
			targetKind = "venues"
		}
		if strings.Contains(kind, "Discipline") {
			targetKind = "disciplines"
		}
		if target != "" {
			if sessionCommand {
				se, e = session(ctx, tx, target)
				version = se.Version
			} else if targetKind == "groups" {
				g, e = group(ctx, tx, target)
				version = g.Version
				archived = g.Archived
			} else {
				var x map[string]any
				x, e = catalog(ctx, tx, targetKind, target)
				if e == nil {
					version = x["version"].(int64)
					archived = x["archived"].(bool)
				}
			}
			if e != nil {
				return e
			}
		}
		// Resolve ALL external references in the authorized tenant before exposing a
		// version or operation key. Current assignment/state gates precede replay.
		if c.Venue != "" {
			if _, e = catalogRef(ctx, tx, "venues", c.Venue, c.Operation); e != nil {
				return e
			}
		}
		if c.Discipline != "" {
			if _, e = catalogRef(ctx, tx, "disciplines", c.Discipline, c.Operation); e != nil {
				return e
			}
		}
		if c.Athlete != "" {
			if _, e = athleteRef(ctx, tx, c.Athlete, c.Operation, true); e != nil {
				return e
			}
		}
		if c.Membership != "" {
			if e = coachRef(ctx, tx, c.Membership, c.Operation); e != nil {
				return e
			}
		}
		for _, id := range c.Coaches {
			if e = coachRef(ctx, tx, id, c.Operation); e != nil {
				return e
			}
		}
		for _, r := range c.Roster {
			if _, e = athleteRef(ctx, tx, r.Athlete, c.Operation, true); e != nil {
				return e
			}
		}
		if c.Group != "" {
			g, e = group(ctx, tx, c.Group)
			if e != nil {
				return e
			}
			if g.Archived {
				return conflict("ENTITY_ARCHIVED", c.Operation, nil)
			}
		}
		if sub != "" {
			var exists bool
			switch kind {
			case "excludeRosterAthlete":
				e = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM core.training_roster WHERE session_id=$1 AND athlete_id=$2)`, target, sub).Scan(&exists)
			case "endEnrollment":
				e = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM core.training_enrollments WHERE group_id=$1 AND id=$2)`, target, sub).Scan(&exists)
			case "endGroupCoach":
				e = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM core.training_group_coaches WHERE group_id=$1 AND id=$2)`, target, sub).Scan(&exists)
			default:
				return access.ErrInvalid
			}
			if e != nil {
				return e
			}
			if !exists {
				return notFound()
			}
		}
		if archived && !strings.HasPrefix(kind, "archive") && !strings.HasPrefix(kind, "end") {
			return conflict("ENTITY_ARCHIVED", c.Operation, nil)
		}
		if sessionCommand && kind != "setSessionCoaches" {
			if e = editable(se, kind, c.Operation); e != nil {
				return e
			}
		}
		if kind == "setSessionCoaches" {
			// Closed/cancelled permit revocation, never a new historical access grant.
			existing, e := coaches(ctx, tx, target)
			if e != nil {
				return e
			}
			have := map[string]bool{}
			for _, x := range existing.Coaches {
				if x.Until == nil {
					have[x.Membership] = true
				}
			}
			additions := false
			for _, id := range c.Coaches {
				if !have[id] {
					additions = true
				}
			}
			if additions {
				if e = editable(se, kind, c.Operation); e != nil {
					return e
				}
				gr, e := group(ctx, tx, se.Group.ID)
				if e != nil {
					return e
				}
				if gr.Archived {
					return conflict("ENTITY_ARCHIVED", c.Operation, nil)
				}
			}
		}
		if kind == "addKnownRosterAthlete" {
			var excluded bool
			if e = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM core.training_roster WHERE session_id=$1 AND athlete_id=$2 AND excluded)`, target, c.Athlete).Scan(&excluded); e != nil {
				return e
			}
			if excluded {
				return conflict("ROSTER_EXCLUDED", c.Operation, nil)
			}
		}
		var registryKey bool
		if e = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM core.registry_operations WHERE actor_id=$1 AND operation_id=$2)`, actor.Account, c.Operation).Scan(&registryKey); e != nil {
			return e
		}
		if registryKey {
			return conflict("OPERATION_ID_REUSED", c.Operation, nil)
		}
		var oldhash string
		e = tx.QueryRowContext(ctx, `SELECT request_hash,response FROM core.training_operations WHERE actor_id=$1 AND operation_id=$2`, actor.Account, c.Operation).Scan(&oldhash, &result)
		if e == nil {
			if oldhash != digest {
				return conflict("OPERATION_ID_REUSED", c.Operation, nil)
			}
			// A replay never reapplies effects or compares the old base_version. A
			// stored create still checks the current lifecycle before returning it.
			if kind == "createManualSession" {
				var saved Journal
				if json.Unmarshal(result, &saved) == nil && saved.Session.ID != "" {
					now, e := session(ctx, tx, saved.Session.ID)
					if e != nil {
						return e
					}
					if e = editable(now, kind, c.Operation); e != nil {
						return e
					}
				}
			}
			var stored struct {
				Conflict *Fault `json:"training_conflict"`
			}
			if json.Unmarshal(result, &stored) == nil && stored.Conflict != nil {
				terminal = stored.Conflict
				terminal.Status = 409
			}
			replayed = true
			return nil
		}
		if !errors.Is(e, sql.ErrNoRows) {
			return e
		}
		// A missing ledger row is expected for a new command, including no-op
		// archive/assignment commands. It must not escape as a service failure.
		e = nil
		expected := c.Base
		if kind == "createManualSession" {
			version, expected = g.Version, c.GroupBase
		}
		if version > 0 && version != expected {
			code := "ENTITY_VERSION_CONFLICT"
			if sessionCommand {
				code = "SESSION_VERSION_CONFLICT"
			}
			terminal = conflict(code, c.Operation, &version)
			result, _ = json.Marshal(map[string]any{"training_conflict": terminal})
			_, e = tx.ExecContext(ctx, `INSERT INTO core.training_operations VALUES($1,$2,$3,$4,$5)`, tenant, actor.Account, c.Operation, digest, string(result))
			return e
		}
		var output any
		id := people.UUID()
		switch kind {
		case "createVenue", "createDiscipline":
			_, e = tx.ExecContext(ctx, `INSERT INTO `+catalogs[targetKind]+`(tenant_id,id,name) VALUES($1,$2,$3)`, tenant, id, c.Name)
			if e == nil {
				output, e = catalog(ctx, tx, targetKind, id)
			}
		case "updateVenue", "updateDiscipline":
			_, e = tx.ExecContext(ctx, `UPDATE `+catalogs[targetKind]+` SET name=$2,version=version+1 WHERE id=$1`, target, c.Name)
			if e == nil {
				output, e = catalog(ctx, tx, targetKind, target)
			}
		case "archiveVenue", "archiveDiscipline":
			if !archived {
				_, e = tx.ExecContext(ctx, `UPDATE `+catalogs[targetKind]+` SET archived=true,version=version+1 WHERE id=$1`, target)
			}
			if e == nil {
				output, e = catalog(ctx, tx, targetKind, target)
			}
		case "createGroup":
			_, e = tx.ExecContext(ctx, `INSERT INTO core.training_groups(tenant_id,id,name,venue_id,discipline_id) VALUES($1,$2,$3,$4,$5)`, tenant, id, c.Name, c.Venue, c.Discipline)
			if e == nil {
				output, e = group(ctx, tx, id)
			}
		case "updateGroup":
			_, e = tx.ExecContext(ctx, `UPDATE core.training_groups SET name=$2,venue_id=$3,discipline_id=$4,version=version+1 WHERE id=$1`, target, c.Name, c.Venue, c.Discipline)
			if e == nil {
				output, e = group(ctx, tx, target)
			}
		case "archiveGroup":
			if !archived {
				_, e = tx.ExecContext(ctx, `UPDATE core.training_groups SET archived=true,version=version+1 WHERE id=$1`, target)
			}
			if e == nil {
				output, e = group(ctx, tx, target)
			}
		case "createEnrollment", "createGroupCoach":
			table, col, related := "core.training_enrollments", "athlete_id", c.Athlete
			if kind == "createGroupCoach" {
				table, col, related = "core.training_group_coaches", "membership_id", c.Membership
			}
			var overlap bool
			e = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM `+table+` WHERE group_id=$1 AND `+col+`=$2 AND tstzrange(valid_from,valid_until,'[)') && tstzrange($3::timestamptz,$4::timestamptz,'[)'))`, target, related, c.From, c.Until).Scan(&overlap)
			if e != nil {
				return e
			}
			if overlap {
				return conflict("INTERVAL_OVERLAP", c.Operation, nil)
			}
			_, e = tx.ExecContext(ctx, `INSERT INTO `+table+`(tenant_id,id,group_id,`+col+`,valid_from,valid_until) VALUES($1,$2,$3,$4,$5,$6)`, tenant, id, target, related, c.From, c.Until)
			if e == nil {
				_, e = tx.ExecContext(ctx, `UPDATE core.training_groups SET version=version+1 WHERE id=$1`, target)
			}
			if e == nil {
				output, e = group(ctx, tx, target)
			}
		case "endEnrollment", "endGroupCoach":
			table := "core.training_enrollments"
			if kind == "endGroupCoach" {
				table = "core.training_group_coaches"
			}
			var from sql.NullTime
			var until sql.NullTime
			e = tx.QueryRowContext(ctx, `SELECT valid_from,valid_until FROM `+table+` WHERE id=$1`, sub).Scan(&from, &until)
			if e != nil {
				return e
			}
			if until.Valid {
				return conflict("INTERVAL_ENDED", c.Operation, nil)
			}
			if !c.Until.After(from.Time) {
				return access.ErrInvalid
			}
			_, e = tx.ExecContext(ctx, `UPDATE `+table+` SET valid_until=$2 WHERE id=$1`, sub, c.Until)
			if e == nil {
				_, e = tx.ExecContext(ctx, `UPDATE core.training_groups SET version=version+1 WHERE id=$1`, target)
			}
			if e == nil {
				output, e = group(ctx, tx, target)
			}
		case "createManualSession":
			var venue map[string]any
			venue, e = catalog(ctx, tx, "venues", c.Venue)
			if e != nil {
				return e
			}
			_, e = tx.ExecContext(ctx, `INSERT INTO core.training_sessions(tenant_id,id,group_id,venue_id,group_name,venue_name,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, tenant, id, c.Group, c.Venue, g.Name, venue["name"], c.Starts, c.Ends)
			if e != nil {
				return e
			}
			for _, r := range c.Roster {
				a, e := athleteRef(ctx, tx, r.Athlete, c.Operation, true)
				if e != nil {
					return e
				}
				participation := "visit"
				if a.Participation == "guest" {
					participation = "guest"
				}
				var enrolled bool
				e = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM core.training_enrollments WHERE group_id=$1 AND athlete_id=$2 AND valid_from<=$3 AND (valid_until IS NULL OR valid_until>$3))`, c.Group, r.Athlete, c.Starts).Scan(&enrolled)
				if e != nil {
					return e
				}
				if enrolled {
					participation = "regular"
				}
				if e = insertRoster(ctx, tx, tenant, id, r.Athlete, participation, actor.Account, r.Trial); e != nil {
					return e
				}
			}
			if _, e = setCoaches(ctx, tx, tenant, id, actor.Account, c.Coaches); e != nil {
				return e
			}
			output, e = journal(ctx, tx, id)
		case "setSessionCoaches":
			var changed bool
			changed, e = setCoaches(ctx, tx, tenant, target, actor.Account, c.Coaches)
			if e == nil && changed {
				e = bumpSession(ctx, tx, target)
			}
			if e == nil {
				output, e = coaches(ctx, tx, target)
			}
		case "addKnownRosterAthlete":
			var excluded bool
			e = tx.QueryRowContext(ctx, `SELECT excluded FROM core.training_roster WHERE session_id=$1 AND athlete_id=$2`, target, c.Athlete).Scan(&excluded)
			if e == nil {
				if excluded {
					return conflict("ROSTER_EXCLUDED", c.Operation, nil)
				}
			} else if errors.Is(e, sql.ErrNoRows) {
				// Temporary add is ALWAYS visit: it does not imply Enrollment, group
				// membership, future participation, guest creation or a stored mark.
				if e = insertRoster(ctx, tx, tenant, target, c.Athlete, "visit", actor.Account, c.Trial); e == nil {
					e = bumpSession(ctx, tx, target)
				}
			}
			if e == nil {
				output, e = rosterResult(ctx, tx, target, c.Athlete, c.Operation)
			}
		case "excludeRosterAthlete":
			var excluded bool
			e = tx.QueryRowContext(ctx, `SELECT excluded FROM core.training_roster WHERE session_id=$1 AND athlete_id=$2`, target, sub).Scan(&excluded)
			if e == nil && !excluded {
				_, e = tx.ExecContext(ctx, `UPDATE core.training_roster SET excluded=true,excluded_at=clock_timestamp(),excluded_by_account_id=$3 WHERE session_id=$1 AND athlete_id=$2`, target, sub, actor.Account)
				if e == nil {
					e = bumpSession(ctx, tx, target)
				}
			}
			if e == nil {
				output, e = rosterResult(ctx, tx, target, sub, c.Operation)
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
		_, e = tx.ExecContext(ctx, `INSERT INTO core.training_operations VALUES($1,$2,$3,$4,$5)`, tenant, actor.Account, c.Operation, digest, string(result))
		return e
	})
	if e == nil && terminal != nil {
		return nil, replayed, terminal
	}
	return result, replayed, e
}
