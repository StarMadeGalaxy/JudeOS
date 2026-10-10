// Package training owns groups, dated relationships and saved manual sessions.
package training

import (
	"encoding/json"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/StarMadeGalaxy/JudeOS/internal/access"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

const maxVersion int64 = 9007199254740991

type Fault struct {
	Status    int    `json:"-"`
	Code      string `json:"code"`
	Operation string `json:"operation_id"`
	Version   *int64 `json:"current_version"`
}

func (f *Fault) Error() string { return f.Code }
func notFound() *Fault         { return &Fault{Status: 404, Code: "NOT_FOUND"} }
func conflict(code, op string, v *int64) *Fault {
	return &Fault{Status: 409, Code: code, Operation: op, Version: v}
}

type Interval struct {
	ID      string     `json:"enrollment_id"`
	Athlete string     `json:"athlete_id"`
	From    time.Time  `json:"valid_from"`
	Until   *time.Time `json:"valid_until"`
}
type GroupCoach struct {
	ID         string     `json:"group_coach_id"`
	Membership string     `json:"membership_id"`
	From       time.Time  `json:"valid_from"`
	Until      *time.Time `json:"valid_until"`
}
type Group struct {
	ID          string       `json:"group_id"`
	Name        string       `json:"name"`
	Venue       string       `json:"venue_id"`
	Discipline  string       `json:"discipline_id"`
	Archived    bool         `json:"archived"`
	Version     int64        `json:"version"`
	Enrollments []Interval   `json:"enrollments"`
	Coaches     []GroupCoach `json:"coaches"`
}
type Named struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type Session struct {
	ID      string    `json:"session_id"`
	Tenant  string    `json:"tenant_id"`
	Group   Named     `json:"group"`
	Venue   Named     `json:"venue"`
	Starts  time.Time `json:"starts_at"`
	Ends    time.Time `json:"ends_at"`
	State   string    `json:"state"`
	Version int64     `json:"version"`
}
type Roster struct {
	Athlete       string `json:"athlete_id"`
	Person        string `json:"person_id"`
	Name          string `json:"display_name"`
	Participation string `json:"participation"`
	Trial         bool   `json:"trial"`
	Excluded      bool   `json:"excluded"`
	Attendance    any    `json:"attendance"`
}
type Journal struct {
	Session Session  `json:"session"`
	Roster  []Roster `json:"roster"`
}
type SessionCoach struct {
	ID         string     `json:"session_coach_id"`
	Membership string     `json:"membership_id"`
	From       time.Time  `json:"valid_from"`
	Until      *time.Time `json:"valid_until"`
}
type Coaches struct {
	Session string         `json:"session_id"`
	Version int64          `json:"version"`
	Coaches []SessionCoach `json:"coaches"`
}
type Page struct {
	Items []any   `json:"items"`
	Next  *string `json:"next_cursor"`
}
type Selection struct {
	Athlete string `json:"athlete_id"`
	Trial   bool   `json:"trial"`
}
type Command struct {
	Operation  string      `json:"operation_id"`
	Base       int64       `json:"base_version"`
	Name       string      `json:"name"`
	Venue      string      `json:"venue_id"`
	Discipline string      `json:"discipline_id"`
	Athlete    string      `json:"athlete_id"`
	Membership string      `json:"membership_id"`
	From       time.Time   `json:"valid_from"`
	Until      *time.Time  `json:"valid_until"`
	Group      string      `json:"group_id"`
	GroupBase  int64       `json:"group_base_version"`
	Starts     time.Time   `json:"starts_at"`
	Ends       time.Time   `json:"ends_at"`
	Roster     []Selection `json:"roster"`
	Coaches    []string    `json:"coach_membership_ids"`
	Trial      bool        `json:"trial"`
}

var fields = map[string]string{
	"createVenue": "operation_id name", "updateVenue": "operation_id base_version name", "archiveVenue": "operation_id base_version",
	"createDiscipline": "operation_id name", "updateDiscipline": "operation_id base_version name", "archiveDiscipline": "operation_id base_version",
	"createGroup": "operation_id name venue_id discipline_id", "updateGroup": "operation_id base_version name venue_id discipline_id", "archiveGroup": "operation_id base_version",
	"createEnrollment": "operation_id base_version athlete_id valid_from valid_until", "endEnrollment": "operation_id base_version valid_until",
	"createGroupCoach": "operation_id base_version membership_id valid_from valid_until", "endGroupCoach": "operation_id base_version valid_until",
	"createManualSession": "operation_id group_id group_base_version venue_id starts_at ends_at roster coach_membership_ids",
	"setSessionCoaches":   "operation_id base_version coach_membership_ids", "addKnownRosterAthlete": "operation_id base_version athlete_id trial", "excludeRosterAthlete": "operation_id base_version",
}

func validText(v string) bool {
	return utf8.ValidString(v) && utf8.RuneCountInString(v) <= 200 && strings.TrimSpace(v) != "" && !strings.ContainsFunc(v, unicode.IsControl)
}
func Decode(kind string, raw []byte) (Command, error) {
	var c Command
	var data map[string]json.RawMessage
	allowed, ok := fields[kind]
	if !ok || !utf8.Valid(raw) || json.Unmarshal(raw, &data) != nil || data == nil {
		return c, access.ErrInvalid
	}
	for k := range data {
		if !strings.Contains(" "+allowed+" ", " "+k+" ") {
			return c, access.ErrInvalid
		}
	}
	for _, k := range strings.Fields(allowed) {
		v, ok := data[k]
		if !ok || (string(v) == "null" && k != "valid_until") {
			return c, access.ErrInvalid
		}
	}
	if json.Unmarshal(raw, &c) != nil || !uuidPattern.MatchString(c.Operation) {
		return c, access.ErrInvalid
	}
	for _, k := range []string{"venue_id", "discipline_id", "athlete_id", "membership_id", "group_id"} {
		if v, ok := data[k]; ok {
			var id string
			_ = json.Unmarshal(v, &id)
			if !uuidPattern.MatchString(id) {
				return c, access.ErrInvalid
			}
		}
	}
	if _, ok := data["base_version"]; ok && (c.Base < 1 || c.Base >= maxVersion) {
		return c, access.ErrInvalid
	}
	if _, ok := data["group_base_version"]; ok && (c.GroupBase < 1 || c.GroupBase >= maxVersion) {
		return c, access.ErrInvalid
	}
	if _, ok := data["name"]; ok && !validText(c.Name) {
		return c, access.ErrInvalid
	}
	for _, k := range []string{"valid_from", "valid_until", "starts_at", "ends_at"} {
		if v, ok := data[k]; ok && string(v) != "null" {
			var t time.Time
			if json.Unmarshal(v, &t) != nil || t.IsZero() || t.Year() < 1 || t.Year() > 9999 || !strings.HasSuffix(strings.Trim(string(v), "\""), "Z") {
				return c, access.ErrInvalid
			}
		}
	}
	if c.Until != nil && !c.From.IsZero() && !c.Until.After(c.From) {
		return c, access.ErrInvalid
	}
	if strings.HasPrefix(kind, "end") && c.Until == nil {
		return c, access.ErrInvalid
	}
	if kind == "createManualSession" && !c.Ends.After(c.Starts) {
		return c, access.ErrInvalid
	}
	if len(c.Roster) > 100 || len(c.Coaches) > 20 {
		return c, access.ErrInvalid
	}
	seen := map[string]bool{}
	for _, id := range c.Coaches {
		if !uuidPattern.MatchString(id) || seen[id] {
			return c, access.ErrInvalid
		}
		seen[id] = true
	}
	seen = map[string]bool{}
	if v, ok := data["roster"]; ok {
		var entries []map[string]json.RawMessage
		if json.Unmarshal(v, &entries) != nil {
			return c, access.ErrInvalid
		}
		for i, x := range entries {
			if len(x) != 2 || x["athlete_id"] == nil || x["trial"] == nil || string(x["trial"]) == "null" || !uuidPattern.MatchString(c.Roster[i].Athlete) || seen[c.Roster[i].Athlete] {
				return c, access.ErrInvalid
			}
			seen[c.Roster[i].Athlete] = true
		}
	}
	// Selections and assignment sets have no ordering semantics. A permuted retry
	// is the same intention, while changes to trial/base_version remain different.
	sort.Strings(c.Coaches)
	sort.Slice(c.Roster, func(i, j int) bool { return c.Roster[i].Athlete < c.Roster[j].Athlete })
	return c, nil
}
