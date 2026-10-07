package database

import (
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestDatabaseErrorsDoNotExposeDriverDetail(t *testing.T) {
	secret := "synthetic-contact-secret@example.invalid"
	for _, tc := range []struct {
		code string
		want error
	}{
		{"42501", ErrDenied}, {"23503", ErrConflict}, {"23505", ErrConflict}, {"23514", ErrConflict}, {"XX000", ErrDatabase},
	} {
		err := safeError(&pgconn.PgError{Code: tc.code, Message: secret, Detail: secret, ConstraintName: secret})
		if !errors.Is(err, tc.want) || strings.Contains(err.Error(), secret) {
			t.Fatal("driver detail exposed or classification lost")
		}
	}
}
