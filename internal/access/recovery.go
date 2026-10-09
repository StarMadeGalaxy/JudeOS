package access

import (
	"context"
	"database/sql"
	"regexp"
)

// Recovery is an explicit platform capability; login is an exact selector,
// never evidence of identity. The administrator verifies the recipient first.
func (s *Service) Recovery(ctx context.Context, token, csrf, request, login string, verified bool) (Link, error) {
	if !verified {
		return Link{}, ErrInvalid
	}
	login, e := NormalizeLogin(login)
	if e != nil || !networkRequestPattern.MatchString(request) {
		return Link{}, ErrInvalid
	}
	v, e := s.Session(ctx, token)
	if e != nil {
		return Link{}, e
	}
	if !v.Platform || csrf == "" || csrf != v.CSRF {
		return Link{}, ErrForbidden
	}
	link := Link{Kind: "recovery", Token: secret()}
	var expiry sql.NullTime
	e = s.DB.QueryRowContext(ctx, `SELECT access.issue_password_recovery($1,$2,$3,$4,$5)`, digest(token), csrf, login, digest(link.Token), request).Scan(&expiry)
	if e != nil {
		return Link{}, dbError(e)
	}
	if !expiry.Valid {
		return Link{}, ErrToken
	}
	link.Expires = expiry.Time.UTC()
	return link, nil
}

// OperatorRecovery is only for an already active platform administrator. It
// accepts a symbolic procedure reference, never personal verification details.
func OperatorRecovery(ctx context.Context, db *sql.DB, login, operatorRef string, verified bool) (Link, error) {
	if !verified || !regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$`).MatchString(operatorRef) {
		return Link{}, ErrInvalid
	}
	login, e := NormalizeLogin(login)
	if e != nil {
		return Link{}, ErrInvalid
	}
	var role string
	if e = db.QueryRowContext(ctx, `SELECT current_user`).Scan(&role); e != nil {
		return Link{}, safe(e)
	}
	if role != "judeos_migrator" {
		return Link{}, ErrForbidden
	}
	link := Link{Kind: "recovery", Token: secret()}
	var expiry sql.NullTime
	e = db.QueryRowContext(ctx, `SELECT access.operator_password_recovery($1,$2,$3,$4)`, login, operatorRef, digest(link.Token), secret()[:32]).Scan(&expiry)
	if e != nil {
		return Link{}, dbError(e)
	}
	if !expiry.Valid {
		return Link{}, ErrToken
	}
	link.Expires = expiry.Time.UTC()
	return link, nil
}

func (s *Service) redeemRecovery(ctx context.Context, token, password, preauth, csrf, request string) error {
	var target sql.NullString
	if e := s.DB.QueryRowContext(ctx, `SELECT access.password_recovery_target($1)`, digest(token)).Scan(&target); e != nil {
		return safe(e)
	}
	if !target.Valid {
		return s.redeemPlatform(ctx, token, password, preauth, csrf, request)
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
	var applied bool
	e = s.DB.QueryRowContext(ctx, `SELECT access.finish_password_recovery($1,$2,$3,$4,$5)`, digest(token), hash, digest(preauth), csrf, request).Scan(&applied)
	if e != nil {
		return dbError(e)
	}
	if !applied {
		return ErrToken
	}
	return nil
}
