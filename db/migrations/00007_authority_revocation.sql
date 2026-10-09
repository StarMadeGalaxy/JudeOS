-- +goose Up
-- Serialize direct organizational revocation with the same tenant operations
-- as the application. Platform changes take the global lock before club locks.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION organization.guard_authority() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n uuid; remaining integer; c uuid;
BEGIN
 IF TG_TABLE_NAME='owners' THEN
  n:=NEW.network_id;
  IF OLD.network_id IS DISTINCT FROM NEW.network_id OR OLD.account_id IS DISTINCT FROM NEW.account_id THEN RAISE EXCEPTION 'immutable authority key' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(n::text,27));
  FOR c IN SELECT tenant_id FROM core.clubs WHERE network_id=n ORDER BY tenant_id LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended(c::text,21));
  END LOOP;
  SELECT count(*) INTO remaining FROM organization.owners o JOIN access.accounts a ON a.id=o.account_id WHERE o.network_id=n AND o.active AND NOT a.disabled;
 ELSE
  IF OLD.account_id IS DISTINCT FROM NEW.account_id THEN RAISE EXCEPTION 'immutable authority key' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(27,1);
  FOR c IN SELECT tenant_id FROM core.clubs ORDER BY tenant_id LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended(c::text,21));
  END LOOP;
  SELECT count(*) INTO remaining FROM organization.platform_administrators p JOIN access.accounts a ON a.id=p.account_id WHERE p.active AND NOT a.disabled;
 END IF;
 IF OLD.active AND NOT NEW.active AND remaining<=1 THEN RAISE EXCEPTION 'last authority protected' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
-- +goose StatementEnd
-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'authority revocation invariant cannot be downgraded operationally'; END $$;
-- +goose StatementEnd
