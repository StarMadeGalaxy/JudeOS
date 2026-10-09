// Package people owns the club registry; family/contact data never grants login rights.
package people

import (
	"crypto/rand"
	"encoding/hex"
	"regexp"
	"time"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func UUID() string {
	var b [16]byte
	if _, e := rand.Read(b[:]); e != nil {
		panic("random source unavailable")
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	v := hex.EncodeToString(b[:])
	return v[:8] + "-" + v[8:12] + "-" + v[12:16] + "-" + v[16:20] + "-" + v[20:]
}

type Person struct {
	ID       string  `json:"person_id"`
	Tenant   string  `json:"tenant_id"`
	Name     string  `json:"display_name"`
	Phone    *string `json:"phone"`
	Archived bool    `json:"archived"`
	Version  int64   `json:"version"`
}
type Guardian struct {
	Name           string     `json:"representative_display_name"`
	ID             string     `json:"guardian_link_id"`
	Athlete        string     `json:"athlete_id"`
	Representative string     `json:"representative_person_id"`
	Status         string     `json:"status"`
	Basis          string     `json:"basis_kind"`
	Actor          string     `json:"verified_by_account_id"`
	From           time.Time  `json:"valid_from"`
	Until          *time.Time `json:"valid_until"`
	Version        int64      `json:"version"`
}
type Contact struct {
	Name  string  `json:"display_name"`
	Phone *string `json:"phone"`
}
type Athlete struct {
	ID            string     `json:"athlete_id"`
	Person        Person     `json:"person"`
	Participation string     `json:"participation"`
	Archived      bool       `json:"archived"`
	Version       int64      `json:"version"`
	Links         []Guardian `json:"guardian_links"`
	Primary       *string    `json:"primary_guardian_link_id"`
	Contact       *Contact   `json:"primary_contact"`
	Admission     any        `json:"admission"`
}
type Member struct {
	ID     string     `json:"household_member_id"`
	Person string     `json:"person_id"`
	Name   string     `json:"display_name"`
	From   time.Time  `json:"valid_from"`
	Until  *time.Time `json:"valid_until"`
}
type Household struct {
	ID      string   `json:"household_id"`
	Name    string   `json:"name"`
	Version int64    `json:"version"`
	Members []Member `json:"members"`
}
type Page struct {
	Items []any   `json:"items"`
	Next  *string `json:"next_cursor"`
}
type Fault struct {
	Status    int
	Code      string
	Operation string
	Version   *int64
}

func (f *Fault) Error() string                  { return f.Code }
func notFound() *Fault                          { return &Fault{Status: 404, Code: "NOT_FOUND"} }
func conflict(code, op string, v *int64) *Fault { return &Fault{409, code, op, v} }

type Ref struct {
	Kind    string `json:"kind"`
	ID      string `json:"id"`
	Version int64  `json:"version"`
	Active  bool   `json:"active"`
}
type Command struct {
	Operation      string     `json:"operation_id"`
	Base           int64      `json:"base_version"`
	Name           string     `json:"display_name"`
	HouseholdName  string     `json:"name"`
	Phone          *string    `json:"phone"`
	Person         string     `json:"person_id"`
	Participation  string     `json:"participation"`
	Representative string     `json:"representative_person_id"`
	Basis          string     `json:"basis_kind"`
	From           time.Time  `json:"valid_from"`
	Until          *time.Time `json:"valid_until"`
	Guardian       *string    `json:"guardian_link_id"`
}
