-- +goose Up
CREATE TABLE core.people (
 tenant_id uuid NOT NULL REFERENCES core.clubs(tenant_id), id uuid NOT NULL,
 display_name text NOT NULL CHECK(char_length(display_name) BETWEEN 1 AND 200 AND display_name ~ '\S'),
 phone text CHECK(phone IS NULL OR (char_length(phone) BETWEEN 1 AND 50 AND phone ~ '\S')),
 archived boolean NOT NULL DEFAULT false, version bigint NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991),
 PRIMARY KEY(tenant_id,id)
);
CREATE TABLE core.athletes (
 tenant_id uuid NOT NULL, id uuid NOT NULL, person_id uuid NOT NULL,
 participation text NOT NULL CHECK(participation IN ('regular','guest')),
 archived boolean NOT NULL DEFAULT false, version bigint NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991),
 primary_guardian_link_id uuid,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,person_id),
 FOREIGN KEY(tenant_id,person_id) REFERENCES core.people(tenant_id,id)
);
CREATE TABLE core.guardian_links (
 tenant_id uuid NOT NULL, id uuid NOT NULL, athlete_id uuid NOT NULL, representative_person_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'verified' CHECK(status IN ('verified','revoked')),
 basis_kind text NOT NULL CHECK(char_length(basis_kind) BETWEEN 1 AND 80 AND basis_kind ~ '\S'),
 verified_by_account_id uuid NOT NULL REFERENCES access.accounts(id), valid_from timestamptz NOT NULL, valid_until timestamptz,
 version bigint NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991),
 CHECK(valid_until IS NULL OR valid_until>valid_from),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,athlete_id,id),
 FOREIGN KEY(tenant_id,athlete_id) REFERENCES core.athletes(tenant_id,id),
 FOREIGN KEY(tenant_id,representative_person_id) REFERENCES core.people(tenant_id,id)
);
ALTER TABLE core.athletes ADD FOREIGN KEY(tenant_id,id,primary_guardian_link_id) REFERENCES core.guardian_links(tenant_id,athlete_id,id);
CREATE TABLE core.households (
 tenant_id uuid NOT NULL REFERENCES core.clubs(tenant_id), id uuid NOT NULL,
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 200 AND name ~ '\S'),
 version bigint NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991),
 PRIMARY KEY(tenant_id,id)
);
CREATE TABLE core.household_members (
 tenant_id uuid NOT NULL, id uuid NOT NULL, household_id uuid NOT NULL, person_id uuid NOT NULL,
 valid_from timestamptz NOT NULL, valid_until timestamptz, CHECK(valid_until IS NULL OR valid_until>valid_from),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,household_id,person_id,valid_from),
 FOREIGN KEY(tenant_id,household_id) REFERENCES core.households(tenant_id,id),
 FOREIGN KEY(tenant_id,person_id) REFERENCES core.people(tenant_id,id)
);
-- Successful responses are private club data, not audit payload. Replays must
-- recheck current authorization and all referenced versions/periods before use.
CREATE TABLE core.registry_operations (
 tenant_id uuid NOT NULL REFERENCES core.clubs(tenant_id), actor_id uuid NOT NULL REFERENCES access.accounts(id),
 operation_id uuid NOT NULL, request_hash text NOT NULL CHECK(length(request_hash)=64),
 response jsonb NOT NULL, references_json jsonb NOT NULL,
 PRIMARY KEY(tenant_id,actor_id,operation_id)
);
CREATE INDEX ON core.people(tenant_id,id);
CREATE INDEX ON core.guardian_links(tenant_id,representative_person_id);
CREATE INDEX ON core.household_members(tenant_id,household_id,id);
ALTER TABLE core.audit_events DROP CONSTRAINT audit_events_object_type_check;
ALTER TABLE core.audit_events ADD CHECK(object_type IN ('club','synthetic_object','membership','role_grant','access_token','person','athlete','guardian_link','household','household_member'));
-- +goose StatementBegin
CREATE FUNCTION core.record_registry_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t uuid; i uuid; kind text; actor text:=nullif(current_setting('judeos.actor_id',true),''); request text:=nullif(current_setting('judeos.request_id',true),'');
BEGIN
 IF actor IS NULL OR request IS NULL THEN RAISE EXCEPTION 'audit context required' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN RETURN NEW; END IF;
 IF TG_OP='DELETE' THEN t:=OLD.tenant_id; i:=OLD.id; ELSE t:=NEW.tenant_id; i:=NEW.id; END IF;
 kind:=CASE TG_TABLE_NAME WHEN 'people' THEN 'person' WHEN 'athletes' THEN 'athlete' WHEN 'guardian_links' THEN 'guardian_link' WHEN 'households' THEN 'household' WHEN 'household_members' THEN 'household_member' ELSE NULL END;
 IF kind IS NULL THEN RAISE EXCEPTION 'unsupported audit target' USING ERRCODE='42501'; END IF;
 INSERT INTO core.audit_events(tenant_id,actor_id,request_id,action,object_type,object_id) VALUES(t,actor::uuid,request,TG_OP,kind,i);
 RETURN NULL;
END $$;
-- +goose StatementEnd
-- +goose StatementBegin
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['people','athletes','guardian_links','households','household_members','registry_operations'] LOOP
  EXECUTE format('ALTER TABLE core.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE core.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_boundary ON core.%I USING(tenant_id=core.current_tenant()) WITH CHECK(tenant_id=core.current_tenant())',t);
  EXECUTE format('REVOKE ALL ON core.%I FROM PUBLIC',t);
  EXECUTE format('GRANT SELECT ON core.%I TO judeos_runtime',t);
  IF t<>'registry_operations' THEN
   EXECUTE format('CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON core.%I FOR EACH ROW EXECUTE FUNCTION core.record_registry_change()',t);
  END IF;
 END LOOP;
END $$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION core.record_registry_change() FROM PUBLIC;
GRANT INSERT ON core.people,core.athletes,core.guardian_links,core.households,core.household_members,core.registry_operations TO judeos_runtime;
GRANT UPDATE(display_name,phone,archived,version) ON core.people TO judeos_runtime;
GRANT UPDATE(participation,archived,version,primary_guardian_link_id) ON core.athletes TO judeos_runtime;
GRANT UPDATE(status,version) ON core.guardian_links TO judeos_runtime;
GRANT UPDATE(name,version) ON core.households TO judeos_runtime;
GRANT UPDATE(valid_until) ON core.household_members TO judeos_runtime;
-- +goose Down
-- Destructive down is deliberately not an operational rollback of private history.
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'registry rollback requires an explicit recovery plan'; END $$;
-- +goose StatementEnd
