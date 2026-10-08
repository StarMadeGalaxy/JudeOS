-- +goose Up
-- This migration must run as judeos_migrator, never as the runtime/admin.
-- +goose StatementBegin
DO $$
BEGIN
    IF current_user <> 'judeos_migrator' THEN
        RAISE EXCEPTION 'migration role required' USING ERRCODE = '42501';
    END IF;
END $$;
-- +goose StatementEnd

CREATE SCHEMA core;
REVOKE ALL ON SCHEMA core, development FROM PUBLIC;

-- +goose StatementBegin
CREATE FUNCTION core.current_tenant() RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE tenant text := nullif(current_setting('judeos.tenant_id', true), '');
BEGIN
    IF tenant IS NULL THEN
        RAISE EXCEPTION 'tenant context required' USING ERRCODE = '42501';
    END IF;
    RETURN tenant::uuid;
END $$;
-- +goose StatementEnd

CREATE TABLE core.clubs (
    tenant_id uuid PRIMARY KEY,
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    timezone text NOT NULL DEFAULT 'Europe/Minsk' CHECK (timezone = 'Europe/Minsk')
);
-- Preserve all existing scaffold fixtures, including non-seed rows, before RLS.
INSERT INTO core.clubs SELECT id, name, timezone FROM development.sample_clubs;

-- A synthetic hierarchy exercises the same composite FK pattern future modules use.
-- It is not Person/Account or a premature journal/business schema.
CREATE TABLE development.sample_objects (
    tenant_id uuid NOT NULL REFERENCES core.clubs(tenant_id),
    id uuid NOT NULL,
    parent_id uuid,
    label text NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, parent_id) REFERENCES development.sample_objects(tenant_id, id)
);

CREATE TABLE core.audit_events (
    tenant_id uuid NOT NULL REFERENCES core.clubs(tenant_id),
    event_id bigint GENERATED ALWAYS AS IDENTITY,
    actor_id uuid NOT NULL,
    request_id text NOT NULL CHECK (request_id ~ '^[0-9a-f]{32}$'),
    action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    object_type text NOT NULL CHECK (object_type IN ('club', 'synthetic_object')),
    object_id uuid NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, event_id)
);

ALTER TABLE core.clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.clubs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON core.clubs
    USING (tenant_id = core.current_tenant()) WITH CHECK (tenant_id = core.current_tenant());
ALTER TABLE development.sample_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE development.sample_objects FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON development.sample_objects
    USING (tenant_id = core.current_tenant()) WITH CHECK (tenant_id = core.current_tenant());
ALTER TABLE core.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON core.audit_events
    USING (tenant_id = core.current_tenant()) WITH CHECK (tenant_id = core.current_tenant());

-- Only an attached trigger can append audit; runtime cannot call/insert/alter it.
-- No names, labels, contacts, payload, SQL, passwords or before/after snapshots.
-- +goose StatementBegin
CREATE FUNCTION core.record_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    row_tenant uuid;
    row_id uuid;
    kind text;
    actor text := nullif(current_setting('judeos.actor_id', true), '');
    request text := nullif(current_setting('judeos.request_id', true), '');
BEGIN
    IF actor IS NULL OR request IS NULL THEN
        RAISE EXCEPTION 'audit context required' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN
        RETURN NEW;
    END IF;
    IF TG_TABLE_SCHEMA = 'core' AND TG_TABLE_NAME = 'clubs' THEN
        kind := 'club';
        IF TG_OP = 'DELETE' THEN row_tenant := OLD.tenant_id; ELSE row_tenant := NEW.tenant_id; END IF;
        row_id := row_tenant;
    ELSIF TG_TABLE_SCHEMA = 'development' AND TG_TABLE_NAME = 'sample_objects' THEN
        kind := 'synthetic_object';
        IF TG_OP = 'DELETE' THEN row_tenant := OLD.tenant_id; row_id := OLD.id;
        ELSE row_tenant := NEW.tenant_id; row_id := NEW.id; END IF;
    ELSE
        RAISE EXCEPTION 'unsupported audit target' USING ERRCODE = '42501';
    END IF;
    INSERT INTO core.audit_events(tenant_id, actor_id, request_id, action, object_type, object_id)
        VALUES (row_tenant, actor::uuid, request, TG_OP, kind, row_id);
    RETURN NULL;
END $$;
-- +goose StatementEnd
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON core.clubs
    FOR EACH ROW EXECUTE FUNCTION core.record_change();
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON development.sample_objects
    FOR EACH ROW EXECUTE FUNCTION core.record_change();

REVOKE ALL ON ALL TABLES IN SCHEMA core, development FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA core FROM PUBLIC;
GRANT USAGE ON SCHEMA core, development TO judeos_runtime;
GRANT EXECUTE ON FUNCTION core.current_tenant() TO judeos_runtime, judeos_audit_reader;
GRANT SELECT ON core.clubs TO judeos_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON development.sample_objects TO judeos_runtime;
GRANT SELECT ON public.goose_db_version TO judeos_runtime;
GRANT USAGE ON SCHEMA core TO judeos_audit_reader;
GRANT SELECT ON core.audit_events TO judeos_audit_reader;
-- No runtime membership in either migrator or audit_reader; no default grants
-- on future tables. Every new module must explicitly add RLS, FK, grants, audit.

-- +goose Down
DROP TABLE development.sample_objects;
DROP TABLE core.audit_events;
DROP TABLE core.clubs;
DROP FUNCTION core.record_change();
DROP FUNCTION core.current_tenant();
DROP SCHEMA core;
