-- #489 / ATC-489-01: Search Profile / Candidate Profile persistence foundation.
-- These are tenant-aware personal tables. Existing tenant/workspace identifiers remain unchanged.
-- candidate_profile_id is intentionally a logical tenant-local reference. A physical FK
-- between tenant-aware tables prevents Nile tenant hard-delete partition teardown.

CREATE TABLE candidate_profile (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_profile_id uuid NOT NULL,
  candidate_version integer NOT NULL DEFAULT 1 CHECK (candidate_version > 0),
  structured_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, candidate_profile_id)
);

CREATE TABLE search_profile (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  search_profile_id uuid NOT NULL,
  candidate_profile_id uuid NOT NULL,
  name text NOT NULL DEFAULT 'Default',
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  profile_version integer NOT NULL DEFAULT 1 CHECK (profile_version > 0),
  onboarding_state text NOT NULL DEFAULT 'NOT_CONFIGURED'
    CHECK (onboarding_state IN ('NOT_CONFIGURED', 'CONFIGURED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, search_profile_id)
);

CREATE INDEX search_profile_tenant_status_idx
  ON search_profile(tenant_id, status, created_at, search_profile_id);
