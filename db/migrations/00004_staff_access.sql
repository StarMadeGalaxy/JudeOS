-- +goose Up
CREATE SCHEMA access;
REVOKE ALL ON SCHEMA access FROM PUBLIC;
-- Global authentication data never includes Person/Athlete or club profiles.
CREATE TABLE access.accounts (
 id uuid PRIMARY KEY,
 login text NOT NULL UNIQUE CHECK (login ~ '^[a-z0-9][a-z0-9._@+-]{0,253}$'),
 password_hash text,
 disabled boolean NOT NULL DEFAULT false
);
CREATE TABLE access.sessions (
 secret_hash text PRIMARY KEY CHECK(length(secret_hash)=64),
 account_id uuid NOT NULL REFERENCES access.accounts(id),
 expires_at timestamptz NOT NULL,
 revoked boolean NOT NULL DEFAULT false,
 csrf text NOT NULL CHECK(length(csrf)=64)
);
CREATE INDEX ON access.sessions(account_id);
CREATE TABLE access.preauth (
 secret_hash text PRIMARY KEY CHECK(length(secret_hash)=64),
 csrf text NOT NULL CHECK(length(csrf)=64), expires_at timestamptz NOT NULL
);
CREATE TABLE access.rate_limits (
 key_hash text PRIMARY KEY CHECK(length(key_hash)=64), count integer NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE core.memberships (
 tenant_id uuid NOT NULL REFERENCES core.clubs(tenant_id),
 id uuid NOT NULL, account_id uuid NOT NULL REFERENCES access.accounts(id),
 active boolean NOT NULL DEFAULT false,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,account_id)
);
CREATE TABLE core.role_grants (
 tenant_id uuid NOT NULL, membership_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('administrator','manager','coach')),
 scope text NOT NULL CHECK((role='coach' AND scope='assigned_sessions') OR (role IN ('administrator','manager') AND scope='club')),
 PRIMARY KEY(tenant_id,membership_id,role),
 FOREIGN KEY(tenant_id,membership_id) REFERENCES core.memberships(tenant_id,id)
);
CREATE TABLE core.access_tokens (
 tenant_id uuid NOT NULL, id uuid NOT NULL,
 membership_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('invite','reset')),
 secret_hash text NOT NULL UNIQUE CHECK(length(secret_hash)=64),
 expires_at timestamptz NOT NULL, used boolean NOT NULL DEFAULT false,
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,membership_id) REFERENCES core.memberships(tenant_id,id)
);
ALTER TABLE core.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON core.memberships USING(tenant_id=core.current_tenant()) WITH CHECK(tenant_id=core.current_tenant());
ALTER TABLE core.role_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.role_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON core.role_grants USING(tenant_id=core.current_tenant()) WITH CHECK(tenant_id=core.current_tenant());
ALTER TABLE core.access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.access_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON core.access_tokens USING(tenant_id=core.current_tenant()) WITH CHECK(tenant_id=core.current_tenant());
-- Narrow discovery capabilities bridge global authentication to tenant RLS.
-- Runtime cannot SELECT tenant tables without context. These policies apply
-- only to migrator-owned SECURITY DEFINER functions, never runtime directly.
CREATE POLICY discovery ON core.clubs FOR SELECT TO judeos_migrator USING(true);
CREATE POLICY discovery ON core.memberships FOR SELECT TO judeos_migrator USING(true);
CREATE POLICY discovery ON core.role_grants FOR SELECT TO judeos_migrator USING(true);
CREATE POLICY discovery ON core.access_tokens FOR SELECT TO judeos_migrator USING(true);
-- +goose StatementBegin
CREATE FUNCTION access.memberships(a uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('membership_id',m.id,'tenant_id',m.tenant_id,'club_name',c.name,'timezone',c.timezone,'grants',g.grants) ORDER BY m.tenant_id),'[]'::jsonb)
 FROM core.memberships m JOIN core.clubs c USING(tenant_id)
 JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('role',role,'scope',scope) ORDER BY role) grants FROM core.role_grants WHERE tenant_id=m.tenant_id AND membership_id=m.id) g ON g.grants IS NOT NULL
 WHERE m.account_id=a AND m.active
$$;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE FUNCTION access.token_target(h text) RETURNS TABLE(tenant_id uuid, membership_id uuid, account_id uuid, kind text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT t.tenant_id,t.membership_id,m.account_id,t.kind FROM core.access_tokens t JOIN core.memberships m ON (m.tenant_id,m.id)=(t.tenant_id,t.membership_id)
 WHERE t.secret_hash=h AND NOT t.used AND t.expires_at>clock_timestamp()
$$;
-- +goose StatementEnd
-- Security invariant at the database boundary, including direct/competing writes.
-- Club-wide advisory lock serializes role and membership changes before checking.
-- +goose StatementBegin
CREATE FUNCTION core.guard_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE t uuid; m uuid; losing boolean; owners integer;
BEGIN
 IF TG_OP='INSERT' THEN t:=NEW.tenant_id; ELSE t:=OLD.tenant_id; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(t::text,21));
 IF TG_TABLE_NAME='memberships' THEN
   m:=OLD.id; losing:=OLD.active AND (TG_OP='DELETE' OR NOT NEW.active);
 ELSE
   m:=OLD.membership_id; losing:=OLD.role='administrator' AND (TG_OP='DELETE' OR NEW.role<>'administrator' OR NEW.membership_id<>OLD.membership_id);
 END IF;
 IF TG_OP<>'INSERT' AND losing THEN
   SELECT count(*) INTO owners FROM core.memberships cm JOIN core.role_grants g ON (g.tenant_id,g.membership_id)=(cm.tenant_id,cm.id)
   JOIN access.accounts a ON a.id=cm.account_id
   WHERE cm.tenant_id=t AND cm.active AND NOT a.disabled AND g.role='administrator';
   IF owners<=1 AND EXISTS(SELECT 1 FROM core.role_grants g JOIN core.memberships cm ON (g.tenant_id,g.membership_id)=(cm.tenant_id,cm.id) WHERE cm.tenant_id=t AND cm.id=m AND cm.active AND g.role='administrator') THEN
     RAISE EXCEPTION 'last owner protected' USING ERRCODE='23514';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
-- +goose StatementEnd
CREATE TRIGGER guard_owner BEFORE UPDATE OR DELETE ON core.memberships FOR EACH ROW EXECUTE FUNCTION core.guard_owner();
CREATE TRIGGER guard_owner BEFORE INSERT OR UPDATE OR DELETE ON core.role_grants FOR EACH ROW EXECUTE FUNCTION core.guard_owner();
-- Metadata-only audit for membership/grant/token changes; no login/hash/token/body.
ALTER TABLE core.audit_events DROP CONSTRAINT audit_events_object_type_check;
ALTER TABLE core.audit_events ADD CHECK(object_type IN ('club','synthetic_object','membership','role_grant','access_token'));
-- +goose StatementBegin
CREATE FUNCTION core.record_access_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t uuid; i uuid; kind text; actor text:=nullif(current_setting('judeos.actor_id',true),''); request text:=nullif(current_setting('judeos.request_id',true),'');
BEGIN
 IF actor IS NULL OR request IS NULL THEN RAISE EXCEPTION 'audit context required' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN RETURN NEW; END IF;
 IF TG_OP='DELETE' THEN t:=OLD.tenant_id; ELSE t:=NEW.tenant_id; END IF;
 IF TG_TABLE_NAME='role_grants' THEN
   kind:='role_grant'; IF TG_OP='DELETE' THEN i:=OLD.membership_id; ELSE i:=NEW.membership_id; END IF;
 ELSE
   kind:=CASE TG_TABLE_NAME WHEN 'memberships' THEN 'membership' ELSE 'access_token' END;
   IF TG_OP='DELETE' THEN i:=OLD.id; ELSE i:=NEW.id; END IF;
 END IF;
 INSERT INTO core.audit_events(tenant_id,actor_id,request_id,action,object_type,object_id) VALUES(t,actor::uuid,request,TG_OP,kind,i);
 RETURN NULL;
END $$;
-- +goose StatementEnd
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON core.memberships FOR EACH ROW EXECUTE FUNCTION core.record_access_change();
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON core.role_grants FOR EACH ROW EXECUTE FUNCTION core.record_access_change();
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON core.access_tokens FOR EACH ROW EXECUTE FUNCTION core.record_access_change();
REVOKE ALL ON ALL TABLES IN SCHEMA access FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA access FROM PUBLIC;
REVOKE ALL ON FUNCTION core.guard_owner(),core.record_access_change() FROM PUBLIC;
GRANT USAGE ON SCHEMA access TO judeos_runtime;
GRANT SELECT,INSERT ON access.accounts TO judeos_runtime;
GRANT UPDATE(password_hash) ON access.accounts TO judeos_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON access.sessions,access.preauth,access.rate_limits TO judeos_runtime;
GRANT SELECT,INSERT ON core.memberships,core.access_tokens TO judeos_runtime;
GRANT UPDATE(active) ON core.memberships TO judeos_runtime;
GRANT UPDATE(used) ON core.access_tokens TO judeos_runtime;
GRANT SELECT,INSERT,DELETE ON core.role_grants TO judeos_runtime;
GRANT EXECUTE ON FUNCTION access.memberships(uuid),access.token_target(text) TO judeos_runtime;
-- +goose Down
DROP TABLE core.access_tokens;
DROP TABLE core.role_grants;
DROP TABLE core.memberships;
DROP FUNCTION core.guard_owner(),core.record_access_change();
DROP POLICY discovery ON core.clubs;
DROP SCHEMA access CASCADE;
-- Keep metadata-only access audit records and their accepted object_type values.
