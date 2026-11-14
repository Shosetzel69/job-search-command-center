-- Additive request-to-run mapping. The heavy Run remains global in search_runs.
-- No cross-tenant FK: retain Nile native tenant deletion semantics.
CREATE TABLE refresh_requests (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  search_profile_id uuid,
  actor_role text NOT NULL CHECK (actor_role IN ('USER','ADMIN')),
  intent text NOT NULL CHECK (intent IN ('manual','coverage')),
  outcome text NOT NULL CHECK (outcome IN ('PENDING','STARTED_RUN','JOINED_EXISTING_RUN','REUSED_CORPUS','BLOCKED_BY_POLICY','DISPATCH_UNKNOWN')),
  run_id text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, request_id),
  CHECK (actor_role <> 'USER' OR search_profile_id IS NOT NULL)
);
CREATE INDEX refresh_requests_profile_idx
  ON refresh_requests(tenant_id, search_profile_id, created_at DESC);
