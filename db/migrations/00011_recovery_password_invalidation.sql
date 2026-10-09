-- +goose Up
-- Any password change, including the retained club reset, consumes older global
-- recovery links. The account row is already locked; acquire no advisory locks
-- here because club reset takes club -> account whereas recovery starts global.
-- The enclosing reset/redeem keeps its existing atomic metadata audit.
-- +goose StatementBegin
CREATE FUNCTION access.invalidate_password_recoveries() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE access.password_recoveries SET used=true WHERE account_id=NEW.id AND NOT used;
 RETURN NULL;
END $$;
-- +goose StatementEnd
CREATE TRIGGER password_recovery_boundary AFTER UPDATE OF password_hash ON access.accounts
 FOR EACH ROW WHEN (OLD.password_hash IS DISTINCT FROM NEW.password_hash)
 EXECUTE FUNCTION access.invalidate_password_recoveries();
REVOKE ALL ON FUNCTION access.invalidate_password_recoveries() FROM PUBLIC;
-- Issuance rechecks the session after waiting for the recipient account lock.
-- A concurrent logout/session revoke cannot slip through that wait.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION access.issue_password_recovery(sh text,c text,target_login text,h text,request text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; target uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(27,1);
 SELECT s.account_id INTO actor FROM access.sessions s JOIN access.accounts a ON a.id=s.account_id
 WHERE s.secret_hash=sh AND s.csrf=c AND NOT s.revoked AND s.expires_at>clock_timestamp()
 AND NOT a.disabled AND a.password_hash IS NOT NULL AND access.is_platform_administrator(a.id);
 IF actor IS NULL THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT a.id INTO target FROM access.accounts a WHERE a.login=target_login FOR UPDATE;
 SELECT s.account_id INTO actor FROM access.sessions s JOIN access.accounts a ON a.id=s.account_id
 WHERE s.secret_hash=sh AND s.csrf=c AND NOT s.revoked AND s.expires_at>clock_timestamp()
 AND NOT a.disabled AND a.password_hash IS NOT NULL AND access.is_platform_administrator(a.id);
 IF actor IS NULL THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 RETURN access._issue_password_recovery(target,actor,NULL,h,request);
END $$;
-- +goose StatementEnd
-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'password recovery boundary cannot be downgraded'; END $$;
-- +goose StatementEnd
