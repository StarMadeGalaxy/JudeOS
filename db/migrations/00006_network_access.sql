-- +goose Up
-- Network/platform authority is explicit and independent of a club role.
CREATE SCHEMA organization;
REVOKE ALL ON SCHEMA organization FROM PUBLIC;
CREATE TABLE organization.networks (
 id uuid PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120 AND name ~ '[^[:space:]]'),
 version bigint NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991)
);
CREATE TABLE organization.owners (
 network_id uuid NOT NULL REFERENCES organization.networks(id), account_id uuid NOT NULL REFERENCES access.accounts(id),
 active boolean NOT NULL DEFAULT true, PRIMARY KEY(network_id,account_id)
);
CREATE TABLE organization.platform_administrators (
 account_id uuid PRIMARY KEY REFERENCES access.accounts(id), active boolean NOT NULL DEFAULT true
);
CREATE TABLE access.platform_tokens (
 secret_hash text PRIMARY KEY CHECK(length(secret_hash)=64), account_id uuid NOT NULL REFERENCES access.accounts(id),
 expires_at timestamptz NOT NULL, used boolean NOT NULL DEFAULT false
);
CREATE TABLE organization.audit_events (
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, network_id uuid REFERENCES organization.networks(id),
 actor_id uuid NOT NULL, request_id text NOT NULL CHECK(request_id ~ '^[0-9a-f]{32}$'),
 action text NOT NULL CHECK(action IN ('INSERT','UPDATE')), object_type text NOT NULL CHECK(object_type IN ('network','network_owner','platform_administrator')),
 object_id uuid NOT NULL, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE core.clubs ADD COLUMN network_id uuid REFERENCES organization.networks(id);
ALTER TABLE core.clubs ADD COLUMN address text NOT NULL DEFAULT '' CHECK(length(address)<=300);
ALTER TABLE core.clubs ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991);
ALTER TABLE core.access_tokens DROP CONSTRAINT access_tokens_kind_check;
ALTER TABLE core.access_tokens ADD CHECK(kind IN ('invite','reset','join'));
-- +goose StatementBegin
CREATE FUNCTION organization.current_network() RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT nullif(current_setting('judeos.network_id',true),'')::uuid
$$;
-- +goose StatementEnd
ALTER TABLE organization.networks ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization.networks FORCE ROW LEVEL SECURITY;
CREATE POLICY network_boundary ON organization.networks USING(id=organization.current_network()) WITH CHECK(id=organization.current_network());
CREATE POLICY discovery ON organization.networks FOR SELECT TO judeos_migrator USING(true);
ALTER TABLE organization.owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization.owners FORCE ROW LEVEL SECURITY;
CREATE POLICY network_boundary ON organization.owners USING(network_id=organization.current_network()) WITH CHECK(network_id=organization.current_network());
CREATE POLICY discovery ON organization.owners FOR SELECT TO judeos_migrator USING(true);
ALTER TABLE organization.platform_administrators ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization.platform_administrators FORCE ROW LEVEL SECURITY;
CREATE POLICY operator ON organization.platform_administrators TO judeos_migrator USING(true) WITH CHECK(true);
ALTER TABLE organization.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY append_only ON organization.audit_events FOR INSERT TO judeos_migrator WITH CHECK(true);
CREATE POLICY audit_read ON organization.audit_events FOR SELECT TO judeos_audit_reader USING(true);
-- These fixed-search-path discovery functions return authority/organization
-- metadata only. Registry tables retain their existing per-tenant RLS.
-- +goose StatementBegin
CREATE FUNCTION access.is_platform_administrator(a uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM organization.platform_administrators p JOIN access.accounts x ON x.id=p.account_id WHERE p.account_id=a AND p.active AND NOT x.disabled)
$$;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE FUNCTION access.networks(a uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('network_id',n.id,'name',n.name,'version',n.version) ORDER BY n.id),'[]'::jsonb)
 FROM organization.networks n WHERE access.is_platform_administrator(a) OR EXISTS(SELECT 1 FROM organization.owners o JOIN access.accounts x ON x.id=o.account_id WHERE o.network_id=n.id AND o.account_id=a AND o.active AND NOT x.disabled)
$$;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE FUNCTION access.network_clubs(a uuid,n uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('tenant_id',c.tenant_id,'network_id',c.network_id,'name',c.name,'address',c.address,'timezone',c.timezone,'version',c.version) ORDER BY c.tenant_id),'[]'::jsonb)
 FROM core.clubs c WHERE c.network_id=n AND (access.is_platform_administrator(a) OR EXISTS(SELECT 1 FROM organization.owners o WHERE o.network_id=n AND o.account_id=a AND o.active))
$$;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION access.memberships(a uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH rights AS (
  SELECT m.tenant_id,m.id, g.role,g.scope FROM core.memberships m JOIN core.role_grants g ON (g.tenant_id,g.membership_id)=(m.tenant_id,m.id) WHERE m.account_id=a AND m.active
  UNION ALL
  SELECT c.tenant_id,c.tenant_id,'administrator','club' FROM core.clubs c WHERE access.is_platform_administrator(a) OR EXISTS(SELECT 1 FROM organization.owners o WHERE o.network_id=c.network_id AND o.account_id=a AND o.active)
 ), grouped AS (
  SELECT tenant_id,min(id::text)::uuid id,jsonb_agg(DISTINCT jsonb_build_object('role',role,'scope',scope)) grants FROM rights GROUP BY tenant_id
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('membership_id',g.id,'tenant_id',g.tenant_id,'club_name',c.name,'timezone',c.timezone,'grants',g.grants) ORDER BY g.tenant_id),'[]'::jsonb)
 FROM grouped g JOIN core.clubs c USING(tenant_id)
$$;
-- +goose StatementEnd
-- Reject silent movement of an existing club between networks.
-- +goose StatementBegin
CREATE FUNCTION organization.guard_club_network() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.network_id IS NOT NULL AND OLD.network_id IS DISTINCT FROM NEW.network_id THEN RAISE EXCEPTION 'network transfer unsupported' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
-- +goose StatementEnd
CREATE TRIGGER network_immutable BEFORE UPDATE OF network_id ON core.clubs FOR EACH ROW EXECUTE FUNCTION organization.guard_club_network();
-- Last owner and last platform administrator remain protected even for direct
-- competing writes. Revocation never deletes identity/history.
-- +goose StatementBegin
CREATE FUNCTION organization.guard_authority() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n uuid; remaining integer;
BEGIN
 IF TG_TABLE_NAME='owners' THEN
  n:=NEW.network_id;
  IF OLD.network_id IS DISTINCT FROM NEW.network_id OR OLD.account_id IS DISTINCT FROM NEW.account_id THEN RAISE EXCEPTION 'immutable authority key' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(n::text,27));
  SELECT count(*) INTO remaining FROM organization.owners o JOIN access.accounts a ON a.id=o.account_id WHERE o.network_id=n AND o.active AND NOT a.disabled;
 ELSE
  IF OLD.account_id IS DISTINCT FROM NEW.account_id THEN RAISE EXCEPTION 'immutable authority key' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(27,1);
  SELECT count(*) INTO remaining FROM organization.platform_administrators p JOIN access.accounts a ON a.id=p.account_id WHERE p.active AND NOT a.disabled;
 END IF;
 IF OLD.active AND NOT NEW.active AND remaining<=1 THEN RAISE EXCEPTION 'last authority protected' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
-- +goose StatementEnd
CREATE TRIGGER guard_authority BEFORE UPDATE ON organization.owners FOR EACH ROW EXECUTE FUNCTION organization.guard_authority();
CREATE TRIGGER guard_authority BEFORE UPDATE ON organization.platform_administrators FOR EACH ROW EXECUTE FUNCTION organization.guard_authority();
-- +goose StatementBegin
CREATE FUNCTION organization.record_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n uuid; i uuid; kind text; actor text:=nullif(current_setting('judeos.actor_id',true),''); request text:=nullif(current_setting('judeos.request_id',true),'');
BEGIN
 IF actor IS NULL OR request IS NULL THEN RAISE EXCEPTION 'audit context required' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='networks' THEN n:=NEW.id; i:=NEW.id; kind:='network';
 ELSIF TG_TABLE_NAME='owners' THEN n:=NEW.network_id; i:=NEW.account_id; kind:='network_owner';
 ELSE n:=NULL; i:=NEW.account_id; kind:='platform_administrator'; END IF;
 INSERT INTO organization.audit_events(network_id,actor_id,request_id,action,object_type,object_id) VALUES(n,actor::uuid,request,TG_OP,kind,i);
 RETURN NULL;
END $$;
-- +goose StatementEnd
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE ON organization.networks FOR EACH ROW EXECUTE FUNCTION organization.record_change();
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE ON organization.owners FOR EACH ROW EXECUTE FUNCTION organization.record_change();
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE ON organization.platform_administrators FOR EACH ROW EXECUTE FUNCTION organization.record_change();
REVOKE ALL ON ALL TABLES IN SCHEMA organization FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA organization FROM PUBLIC;
REVOKE ALL ON FUNCTION access.is_platform_administrator(uuid),access.networks(uuid),access.network_clubs(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON access.platform_tokens FROM PUBLIC;
GRANT USAGE ON SCHEMA organization TO judeos_runtime,judeos_audit_reader;
GRANT EXECUTE ON FUNCTION organization.current_network() TO judeos_runtime;
GRANT SELECT,INSERT ON organization.networks,organization.owners TO judeos_runtime;
GRANT UPDATE(name,version) ON organization.networks TO judeos_runtime;
GRANT UPDATE(active) ON organization.owners TO judeos_runtime;
GRANT SELECT ON organization.audit_events TO judeos_audit_reader;
GRANT SELECT ON access.platform_tokens TO judeos_runtime;
GRANT UPDATE(used) ON access.platform_tokens TO judeos_runtime;
GRANT EXECUTE ON FUNCTION access.is_platform_administrator(uuid),access.networks(uuid),access.network_clubs(uuid,uuid) TO judeos_runtime;
GRANT INSERT ON core.clubs TO judeos_runtime;
GRANT UPDATE(name,address,version,network_id) ON core.clubs TO judeos_runtime;
-- Platform authority changes are a narrow checked capability, not direct table
-- privileges; only an explicitly authorized platform account can use it.
-- +goose StatementBegin
CREATE FUNCTION access.change_platform_administrator(actor uuid,target uuid,enabled boolean,request text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(27,1);
 IF NOT access.is_platform_administrator(actor) OR NOT EXISTS(SELECT 1 FROM access.accounts WHERE id=target AND NOT disabled AND password_hash IS NOT NULL) THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF;
 PERFORM set_config('judeos.actor_id',actor::text,true),set_config('judeos.request_id',request,true);
 INSERT INTO organization.platform_administrators VALUES(target,enabled) ON CONFLICT(account_id) DO UPDATE SET active=EXCLUDED.active;
 UPDATE access.sessions SET revoked=true WHERE account_id=target;
END $$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION access.change_platform_administrator(uuid,uuid,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION access.change_platform_administrator(uuid,uuid,boolean,text) TO judeos_runtime;
-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'network authority/history requires a separately reviewed rollback'; END $$;
-- +goose StatementEnd
