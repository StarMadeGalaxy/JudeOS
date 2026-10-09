-- +goose Up
-- Global recovery is a platform capability, never a derived club permission.
CREATE TABLE access.password_recoveries (
 id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES access.accounts(id),
 issuer_id uuid REFERENCES access.accounts(id), operator_ref text,
 secret_hash text NOT NULL UNIQUE CHECK(secret_hash ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz NOT NULL, used boolean NOT NULL DEFAULT false,
 CHECK ((issuer_id IS NOT NULL AND operator_ref IS NULL) OR
        (issuer_id IS NULL AND operator_ref IS NOT NULL AND operator_ref ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$'))
);
CREATE INDEX ON access.password_recoveries(account_id);
CREATE TABLE access.recovery_audit (
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 recovery_id uuid NOT NULL REFERENCES access.password_recoveries(id),
 account_id uuid NOT NULL REFERENCES access.accounts(id), actor_id uuid REFERENCES access.accounts(id),
 operator_ref text, request_id text NOT NULL CHECK(request_id ~ '^[0-9a-f]{32}$'),
 action text NOT NULL CHECK(action IN ('ISSUE_PLATFORM','ISSUE_OPERATOR','REDEEM','REVOKE')),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK ((action='ISSUE_OPERATOR' AND actor_id IS NULL AND operator_ref IS NOT NULL) OR
        (action<>'ISSUE_OPERATOR' AND actor_id IS NOT NULL AND operator_ref IS NULL))
);
ALTER TABLE access.password_recoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE access.password_recoveries FORCE ROW LEVEL SECURITY;
CREATE POLICY operator ON access.password_recoveries TO judeos_migrator USING(true) WITH CHECK(true);
ALTER TABLE access.recovery_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE access.recovery_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY append_only ON access.recovery_audit FOR INSERT TO judeos_migrator WITH CHECK(true);
CREATE POLICY audit_read ON access.recovery_audit FOR SELECT TO judeos_audit_reader USING(true);
-- Role revocation permanently consumes issued/operator links, so a later
-- re-grant cannot revive them. Existing organization audit supplies context.
-- +goose StatementBegin
CREATE FUNCTION access.revoke_password_recoveries() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r access.password_recoveries%ROWTYPE;
BEGIN
 FOR r IN UPDATE access.password_recoveries SET used=true WHERE NOT used
  AND (issuer_id=OLD.account_id OR (issuer_id IS NULL AND account_id=OLD.account_id)) RETURNING * LOOP
  INSERT INTO access.recovery_audit(recovery_id,account_id,actor_id,request_id,action)
  VALUES(r.id,r.account_id,nullif(current_setting('judeos.actor_id',true),'')::uuid,
   nullif(current_setting('judeos.request_id',true),''),'REVOKE');
 END LOOP;
 RETURN NULL;
END $$;
-- +goose StatementEnd
CREATE TRIGGER revoke_recovery AFTER UPDATE OF active ON organization.platform_administrators
 FOR EACH ROW WHEN (OLD.active AND NOT NEW.active) EXECUTE FUNCTION access.revoke_password_recoveries();
-- Internal helper has no runtime grant. All callers hold the platform lock.
-- +goose StatementBegin
CREATE FUNCTION access._issue_password_recovery(target uuid,issuer uuid,op text,h text,request text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i uuid:=gen_random_uuid(); expiry timestamptz:=clock_timestamp()+interval '30 minutes';
BEGIN
 IF h IS NULL OR h !~ '^[0-9a-f]{64}$' OR request IS NULL OR request !~ '^[0-9a-f]{32}$' THEN
  RAISE EXCEPTION 'invalid recovery context' USING ERRCODE='42501';
 END IF;
 PERFORM id FROM access.accounts WHERE id=target AND NOT disabled AND password_hash IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE access.password_recoveries SET used=true WHERE account_id=target AND NOT used;
 INSERT INTO access.password_recoveries VALUES(i,target,issuer,op,h,expiry,false);
 INSERT INTO access.recovery_audit(recovery_id,account_id,actor_id,operator_ref,request_id,action)
 VALUES(i,target,issuer,op,request,CASE WHEN issuer IS NULL THEN 'ISSUE_OPERATOR' ELSE 'ISSUE_PLATFORM' END);
 RETURN expiry;
END $$;
-- +goose StatementEnd
-- Bind the platform capability to a current session and its CSRF proof.
-- +goose StatementBegin
CREATE FUNCTION access.issue_password_recovery(sh text,c text,target_login text,h text,request text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; target uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(27,1);
 SELECT s.account_id INTO actor FROM access.sessions s JOIN access.accounts a ON a.id=s.account_id
 WHERE s.secret_hash=sh AND s.csrf=c AND NOT s.revoked AND s.expires_at>clock_timestamp()
 AND NOT a.disabled AND a.password_hash IS NOT NULL AND access.is_platform_administrator(a.id);
 IF actor IS NULL THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 SELECT a.id INTO target FROM access.accounts a WHERE a.login=target_login;
 RETURN access._issue_password_recovery(target,actor,NULL,h,request);
END $$;
-- +goose StatementEnd
-- Operator recovery cannot provision, elevate or re-enable an account.
-- +goose StatementBegin
CREATE FUNCTION access.operator_password_recovery(target_login text,op text,h text,request text)
RETURNS timestamptz LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE target uuid;
BEGIN
 IF current_user<>'judeos_migrator' OR op IS NULL OR op !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$' THEN
  RAISE EXCEPTION 'denied' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(27,1);
 SELECT a.id INTO target FROM access.accounts a WHERE a.login=target_login AND access.is_platform_administrator(a.id);
 RETURN access._issue_password_recovery(target,NULL,op,h,request);
END $$;
-- +goose StatementEnd
-- Knowledge of the random secret is required even for target discovery.
-- +goose StatementBegin
CREATE FUNCTION access.password_recovery_target(h text) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT r.account_id FROM access.password_recoveries r JOIN access.accounts a ON a.id=r.account_id
 WHERE r.secret_hash=h AND NOT r.used AND r.expires_at>clock_timestamp()
 AND NOT a.disabled AND a.password_hash IS NOT NULL
 AND ((r.issuer_id IS NOT NULL AND access.is_platform_administrator(r.issuer_id)) OR
      (r.issuer_id IS NULL AND access.is_platform_administrator(r.account_id)))
$$;
-- +goose StatementEnd
-- Rare global recovery serializes organization/club commands before account
-- locking. Password hashing happens outside this transaction in the service.
-- +goose StatementBegin
CREATE FUNCTION access.finish_password_recovery(h text,nh text,ph text,c text,request text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target uuid; r access.password_recoveries%ROWTYPE; n uuid; t uuid;
BEGIN
 IF request IS NULL OR request !~ '^[0-9a-f]{32}$' OR nh IS NULL THEN
  RAISE EXCEPTION 'invalid recovery context' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(27,1);
 FOR n IN SELECT id FROM organization.networks ORDER BY id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(n::text,27));
 END LOOP;
 FOR t IN SELECT tenant_id FROM core.clubs ORDER BY tenant_id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(t::text,21));
 END LOOP;
 SELECT account_id INTO target FROM access.password_recoveries WHERE secret_hash=h;
 PERFORM id FROM access.accounts WHERE id=target AND NOT disabled AND password_hash IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO r FROM access.password_recoveries WHERE secret_hash=h FOR UPDATE;
 IF NOT FOUND OR r.used OR r.expires_at<=clock_timestamp() OR
    (r.issuer_id IS NOT NULL AND NOT access.is_platform_administrator(r.issuer_id)) OR
    (r.issuer_id IS NULL AND NOT access.is_platform_administrator(target)) THEN RETURN false; END IF;
 DELETE FROM access.preauth WHERE secret_hash=ph AND csrf=c AND expires_at>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 UPDATE access.accounts SET password_hash=nh WHERE id=target;
 UPDATE access.sessions SET revoked=true WHERE account_id=target;
 UPDATE access.password_recoveries SET used=true WHERE account_id=target AND NOT used;
 UPDATE access.platform_tokens SET used=true WHERE account_id=target AND NOT used;
 -- Keep RLS/audit context for each club; no broad runtime UPDATE policy.
 PERFORM set_config('judeos.actor_id',target::text,true),set_config('judeos.request_id',request,true);
 FOR t IN SELECT DISTINCT m.tenant_id FROM core.memberships m WHERE m.account_id=target ORDER BY m.tenant_id LOOP
  PERFORM set_config('judeos.tenant_id',t::text,true);
  UPDATE core.access_tokens x SET used=true WHERE x.tenant_id=t AND NOT x.used
   AND EXISTS(SELECT 1 FROM core.memberships m WHERE (m.tenant_id,m.id)=(x.tenant_id,x.membership_id) AND m.account_id=target);
 END LOOP;
 INSERT INTO access.recovery_audit(recovery_id,account_id,actor_id,request_id,action)
 VALUES(r.id,target,target,request,'REDEEM');
 RETURN true;
END $$;
-- +goose StatementEnd
REVOKE ALL ON access.password_recoveries,access.recovery_audit FROM PUBLIC,judeos_runtime;
REVOKE ALL ON FUNCTION access._issue_password_recovery(uuid,uuid,text,text,text),
 access.revoke_password_recoveries(),
 access.issue_password_recovery(text,text,text,text,text),access.operator_password_recovery(text,text,text,text),
 access.password_recovery_target(text),access.finish_password_recovery(text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION access.issue_password_recovery(text,text,text,text,text),
 access.password_recovery_target(text),access.finish_password_recovery(text,text,text,text,text) TO judeos_runtime;
GRANT USAGE ON SCHEMA access TO judeos_audit_reader;
GRANT SELECT ON access.recovery_audit TO judeos_audit_reader;
-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'global recovery history requires separately reviewed rollback'; END $$;
-- +goose StatementEnd
