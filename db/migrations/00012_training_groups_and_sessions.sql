-- +goose Up
-- Training owns this slice. Existing migrations and people/access data are unchanged.
CREATE TABLE core.training_venues (
 tenant_id uuid NOT NULL REFERENCES core.clubs(tenant_id), id uuid NOT NULL,
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 200 AND name ~ '\S'),
 archived boolean NOT NULL DEFAULT false, version bigint NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991),
 PRIMARY KEY(tenant_id,id)
);
CREATE TABLE core.training_disciplines (LIKE core.training_venues INCLUDING ALL);
ALTER TABLE core.training_disciplines ADD FOREIGN KEY(tenant_id) REFERENCES core.clubs(tenant_id);
CREATE TABLE core.training_groups (
 tenant_id uuid NOT NULL, id uuid NOT NULL, name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 200 AND name ~ '\S'),
 venue_id uuid NOT NULL, discipline_id uuid NOT NULL, archived boolean NOT NULL DEFAULT false,
 version bigint NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991),
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,venue_id) REFERENCES core.training_venues(tenant_id,id),
 FOREIGN KEY(tenant_id,discipline_id) REFERENCES core.training_disciplines(tenant_id,id)
);
CREATE TABLE core.training_enrollments (
 tenant_id uuid NOT NULL, id uuid NOT NULL, group_id uuid NOT NULL, athlete_id uuid NOT NULL,
 valid_from timestamptz NOT NULL, valid_until timestamptz, CHECK(valid_until IS NULL OR valid_until>valid_from),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,group_id,athlete_id,valid_from),
 FOREIGN KEY(tenant_id,group_id) REFERENCES core.training_groups(tenant_id,id),
 FOREIGN KEY(tenant_id,athlete_id) REFERENCES core.athletes(tenant_id,id)
);
CREATE TABLE core.training_group_coaches (
 tenant_id uuid NOT NULL, id uuid NOT NULL, group_id uuid NOT NULL, membership_id uuid NOT NULL,
 valid_from timestamptz NOT NULL, valid_until timestamptz, CHECK(valid_until IS NULL OR valid_until>valid_from),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,group_id,membership_id,valid_from),
 FOREIGN KEY(tenant_id,group_id) REFERENCES core.training_groups(tenant_id,id),
 FOREIGN KEY(tenant_id,membership_id) REFERENCES core.memberships(tenant_id,id)
);
CREATE TABLE core.training_sessions (
 tenant_id uuid NOT NULL, id uuid NOT NULL, group_id uuid NOT NULL, venue_id uuid NOT NULL,
 group_name text NOT NULL, venue_name text NOT NULL,
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),
 state text NOT NULL DEFAULT 'planned' CHECK(state IN ('planned','in_progress','closed','cancelled')),
 version bigint NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991),
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,group_id) REFERENCES core.training_groups(tenant_id,id),
 FOREIGN KEY(tenant_id,venue_id) REFERENCES core.training_venues(tenant_id,id)
);
CREATE TABLE core.training_roster (
 tenant_id uuid NOT NULL, id uuid NOT NULL, session_id uuid NOT NULL, athlete_id uuid NOT NULL,
 participation text NOT NULL CHECK(participation IN ('regular','guest','visit')), trial boolean NOT NULL,
 added_at timestamptz NOT NULL DEFAULT clock_timestamp(), added_by_account_id uuid NOT NULL REFERENCES access.accounts(id),
 excluded boolean NOT NULL DEFAULT false, excluded_at timestamptz, excluded_by_account_id uuid REFERENCES access.accounts(id),
 CHECK((excluded AND excluded_at IS NOT NULL AND excluded_by_account_id IS NOT NULL) OR
       (NOT excluded AND excluded_at IS NULL AND excluded_by_account_id IS NULL)),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,session_id,athlete_id),
 FOREIGN KEY(tenant_id,session_id) REFERENCES core.training_sessions(tenant_id,id),
 FOREIGN KEY(tenant_id,athlete_id) REFERENCES core.athletes(tenant_id,id)
);
CREATE TABLE core.training_session_coaches (
 tenant_id uuid NOT NULL, id uuid NOT NULL, session_id uuid NOT NULL, membership_id uuid NOT NULL,
 valid_from timestamptz NOT NULL DEFAULT clock_timestamp(), valid_until timestamptz,
 assigned_by_account_id uuid NOT NULL REFERENCES access.accounts(id), ended_by_account_id uuid REFERENCES access.accounts(id),
 CHECK(valid_until IS NULL OR valid_until>valid_from),
 CHECK((valid_until IS NULL)=(ended_by_account_id IS NULL)),
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,session_id) REFERENCES core.training_sessions(tenant_id,id),
 FOREIGN KEY(tenant_id,membership_id) REFERENCES core.memberships(tenant_id,id)
);
CREATE UNIQUE INDEX training_current_session_coach ON core.training_session_coaches(tenant_id,session_id,membership_id) WHERE valid_until IS NULL;
CREATE TABLE core.training_operations (
 tenant_id uuid NOT NULL REFERENCES core.clubs(tenant_id), actor_id uuid NOT NULL REFERENCES access.accounts(id),
 operation_id uuid NOT NULL, request_hash text NOT NULL CHECK(length(request_hash)=64), response jsonb NOT NULL,
 PRIMARY KEY(tenant_id,actor_id,operation_id)
);
CREATE INDEX ON core.training_enrollments(tenant_id,group_id,athlete_id);
CREATE INDEX ON core.training_group_coaches(tenant_id,group_id,membership_id);
CREATE INDEX ON core.training_sessions(tenant_id,starts_at,id);
CREATE INDEX ON core.training_session_coaches(tenant_id,membership_id,session_id) WHERE valid_until IS NULL;

ALTER TABLE core.audit_events DROP CONSTRAINT audit_events_object_type_check;
ALTER TABLE core.audit_events ADD CHECK(object_type IN ('club','synthetic_object','membership','role_grant','access_token','person','athlete','guardian_link','household','household_member','venue','discipline','training_group','enrollment','group_coach','training_session','session_roster','session_coach'));
-- +goose StatementBegin
CREATE FUNCTION core.record_training_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE kind text; actor text:=nullif(current_setting('judeos.actor_id',true),''); request text:=nullif(current_setting('judeos.request_id',true),'');
BEGIN
 IF actor IS NULL OR request IS NULL THEN RAISE EXCEPTION 'audit context required' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN RETURN NULL; END IF;
 kind:=CASE TG_TABLE_NAME WHEN 'training_venues' THEN 'venue' WHEN 'training_disciplines' THEN 'discipline'
  WHEN 'training_groups' THEN 'training_group' WHEN 'training_enrollments' THEN 'enrollment'
  WHEN 'training_group_coaches' THEN 'group_coach' WHEN 'training_sessions' THEN 'training_session'
  WHEN 'training_roster' THEN 'session_roster' WHEN 'training_session_coaches' THEN 'session_coach' END;
 IF kind IS NULL THEN RAISE EXCEPTION 'unsupported audit target' USING ERRCODE='42501'; END IF;
 INSERT INTO core.audit_events(tenant_id,actor_id,request_id,action,object_type,object_id)
 VALUES(NEW.tenant_id,actor::uuid,request,TG_OP,kind,NEW.id);
 RETURN NULL;
END $$;
-- +goose StatementEnd
-- Even a SQL caller cannot reopen an interval or mutate the roster of a completed session.
-- Interval writers lock the parent first, so overlap checks also serialize at the DB boundary.
-- +goose StatementBegin
CREATE FUNCTION core.guard_training_interval() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE is_archived boolean; has_overlap boolean;
BEGIN
 SELECT archived INTO is_archived FROM core.training_groups WHERE (tenant_id,id)=(NEW.tenant_id,NEW.group_id) FOR UPDATE;
 IF TG_OP='INSERT' AND is_archived THEN RAISE EXCEPTION 'group archived' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (OLD.valid_until IS NOT NULL OR NEW.valid_until IS NULL) THEN
  RAISE EXCEPTION 'interval is immutable after end' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='training_enrollments' THEN
  SELECT EXISTS(SELECT 1 FROM core.training_enrollments e WHERE e.tenant_id=NEW.tenant_id AND e.group_id=NEW.group_id AND e.athlete_id=NEW.athlete_id AND e.id<>NEW.id
   AND tstzrange(e.valid_from,e.valid_until,'[)') && tstzrange(NEW.valid_from,NEW.valid_until,'[)')) INTO has_overlap;
 ELSE
  SELECT EXISTS(SELECT 1 FROM core.training_group_coaches e WHERE e.tenant_id=NEW.tenant_id AND e.group_id=NEW.group_id AND e.membership_id=NEW.membership_id AND e.id<>NEW.id
   AND tstzrange(e.valid_from,e.valid_until,'[)') && tstzrange(NEW.valid_from,NEW.valid_until,'[)')) INTO has_overlap;
 END IF;
 IF has_overlap THEN RAISE EXCEPTION 'interval overlap' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
-- +goose StatementEnd
CREATE TRIGGER interval_guard BEFORE INSERT OR UPDATE ON core.training_enrollments FOR EACH ROW EXECUTE FUNCTION core.guard_training_interval();
CREATE TRIGGER interval_guard BEFORE INSERT OR UPDATE ON core.training_group_coaches FOR EACH ROW EXECUTE FUNCTION core.guard_training_interval();
-- +goose StatementBegin
CREATE FUNCTION core.guard_training_roster() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE st text;
BEGIN
 SELECT state INTO st FROM core.training_sessions WHERE (tenant_id,id)=(NEW.tenant_id,NEW.session_id) FOR UPDATE;
 IF st NOT IN ('planned','in_progress') THEN RAISE EXCEPTION 'roster locked' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (OLD.excluded OR NOT NEW.excluded) THEN RAISE EXCEPTION 'roster exclusion is irreversible' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
-- +goose StatementEnd
CREATE TRIGGER roster_guard BEFORE INSERT OR UPDATE ON core.training_roster FOR EACH ROW EXECUTE FUNCTION core.guard_training_roster();
-- +goose StatementBegin
CREATE FUNCTION core.guard_session_coach() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE st text;
BEGIN
 SELECT state INTO st FROM core.training_sessions WHERE (tenant_id,id)=(NEW.tenant_id,NEW.session_id) FOR UPDATE;
 IF TG_OP='INSERT' AND st NOT IN ('planned','in_progress') THEN RAISE EXCEPTION 'assignment locked' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (OLD.valid_until IS NOT NULL OR NEW.valid_until IS NULL) THEN RAISE EXCEPTION 'assignment ended' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
-- +goose StatementEnd
CREATE TRIGGER assignment_guard BEFORE INSERT OR UPDATE ON core.training_session_coaches FOR EACH ROW EXECUTE FUNCTION core.guard_session_coach();
-- +goose StatementBegin
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['training_venues','training_disciplines','training_groups','training_enrollments','training_group_coaches','training_sessions','training_roster','training_session_coaches','training_operations'] LOOP
  EXECUTE format('ALTER TABLE core.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE core.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_boundary ON core.%I USING(tenant_id=core.current_tenant()) WITH CHECK(tenant_id=core.current_tenant())',t);
  EXECUTE format('REVOKE ALL ON core.%I FROM PUBLIC',t);
  EXECUTE format('GRANT SELECT,INSERT ON core.%I TO judeos_runtime',t);
  IF t<>'training_operations' THEN
   EXECUTE format('CREATE TRIGGER audit_change AFTER INSERT OR UPDATE ON core.%I FOR EACH ROW EXECUTE FUNCTION core.record_training_change()',t);
  END IF;
 END LOOP;
END $$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION core.record_training_change(),core.guard_training_interval(),core.guard_training_roster(),core.guard_session_coach() FROM PUBLIC;
-- Invoker trigger functions are attached by the migrator, not callable by the product.
GRANT UPDATE(name,archived,version) ON core.training_venues,core.training_disciplines TO judeos_runtime;
GRANT UPDATE(name,venue_id,discipline_id,archived,version) ON core.training_groups TO judeos_runtime;
GRANT UPDATE(valid_until) ON core.training_enrollments,core.training_group_coaches TO judeos_runtime;
GRANT UPDATE(version) ON core.training_sessions TO judeos_runtime;
GRANT UPDATE(excluded,excluded_at,excluded_by_account_id) ON core.training_roster TO judeos_runtime;
GRANT UPDATE(valid_until,ended_by_account_id) ON core.training_session_coaches TO judeos_runtime;
-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'training rollback requires an explicit recovery plan'; END $$;
-- +goose StatementEnd
