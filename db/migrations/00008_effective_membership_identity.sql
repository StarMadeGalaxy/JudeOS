-- +goose Up
-- Preserve a direct membership's stable ID when network/platform authority is
-- also present. A derived-only scope uses the club ID as a read-only scope ID;
-- it is explicitly marked and never becomes a staff-mutation target.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION access.memberships(a uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH rights AS (
  SELECT m.tenant_id,g.role,g.scope FROM core.memberships m JOIN core.role_grants g ON (g.tenant_id,g.membership_id)=(m.tenant_id,m.id) WHERE m.account_id=a AND m.active
  UNION ALL
  SELECT c.tenant_id,'administrator','club' FROM core.clubs c WHERE access.is_platform_administrator(a) OR EXISTS(SELECT 1 FROM organization.owners o WHERE o.network_id=c.network_id AND o.account_id=a AND o.active)
 ), grouped AS (
  SELECT tenant_id,jsonb_agg(DISTINCT jsonb_build_object('role',role,'scope',scope)) grants FROM rights GROUP BY tenant_id
 ) SELECT coalesce(jsonb_agg(jsonb_build_object(
  'membership_id',coalesce(m.id,c.tenant_id),'tenant_id',g.tenant_id,'club_name',c.name,'timezone',c.timezone,'grants',g.grants,
  'authority_source',CASE WHEN access.is_platform_administrator(a) THEN 'platform' WHEN EXISTS(SELECT 1 FROM organization.owners o WHERE o.network_id=c.network_id AND o.account_id=a AND o.active) THEN 'network_owner' ELSE 'club' END
 ) ORDER BY g.tenant_id),'[]'::jsonb)
 FROM grouped g JOIN core.clubs c USING(tenant_id)
 LEFT JOIN core.memberships m ON m.tenant_id=c.tenant_id AND m.account_id=a AND m.active
$$;
-- +goose StatementEnd
-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'effective membership identity requires a reviewed downgrade'; END $$;
-- +goose StatementEnd
