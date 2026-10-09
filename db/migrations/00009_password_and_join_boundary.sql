-- +goose Up
-- A club password reset must not take over an identity with authority elsewhere.
-- Narrow discovery is checked again while holding the account row at redemption.
-- +goose StatementBegin
CREATE FUNCTION access.local_password_reset_allowed(a uuid,t uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT NOT access.is_platform_administrator(a)
 AND NOT EXISTS(SELECT 1 FROM organization.owners o WHERE o.account_id=a AND o.active)
 AND NOT EXISTS(
  SELECT 1 FROM core.memberships m WHERE m.account_id=a AND m.tenant_id<>t
  AND (m.active OR EXISTS(SELECT 1 FROM core.access_tokens x
   WHERE (x.tenant_id,x.membership_id)=(m.tenant_id,m.id)
   AND x.kind IN ('invite','join') AND NOT x.used AND x.expires_at>clock_timestamp()))
 )
$$;
-- +goose StatementEnd
-- Password authentication may yield a session with no club rights solely to
-- accept a currently valid invitation. Expired/revoked links confer no access.
-- +goose StatementBegin
CREATE FUNCTION access.has_pending_join(a uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM core.memberships m JOIN core.access_tokens x
  ON (x.tenant_id,x.membership_id)=(m.tenant_id,m.id)
  WHERE m.account_id=a AND NOT m.active AND x.kind='join'
  AND NOT x.used AND x.expires_at>clock_timestamp())
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION access.local_password_reset_allowed(uuid,uuid),access.has_pending_join(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION access.local_password_reset_allowed(uuid,uuid),access.has_pending_join(uuid) TO judeos_runtime;
-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'password identity boundary cannot be downgraded operationally'; END $$;
-- +goose StatementEnd
