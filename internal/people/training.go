package people

import (
	"context"
	"database/sql"
	"errors"
)

// TrainingAthlete is a minimal read inside an already authorized tenant tx.
// It has no contacts, GuardianLink, family or account requirement. Training
// owns enrollment/roster; it must not create or mutate people through this read.
type TrainingAthlete struct {
	ID, Person, Name, Participation string
	Archived                        bool
}

func AthleteForTraining(ctx context.Context, tx *sql.Tx, id string) (TrainingAthlete, bool, error) {
	var a TrainingAthlete
	e := tx.QueryRowContext(ctx, `SELECT a.id,p.id,p.display_name,a.participation,(a.archived OR p.archived)
		FROM core.athletes a JOIN core.people p ON (p.tenant_id,p.id)=(a.tenant_id,a.person_id) WHERE a.id=$1`, id).
		Scan(&a.ID, &a.Person, &a.Name, &a.Participation, &a.Archived)
	if errors.Is(e, sql.ErrNoRows) {
		return a, false, nil
	}
	return a, e == nil, e
}
