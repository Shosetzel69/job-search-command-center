-- #535: complete profile/filter count snapshots, derived from versioned FIT cache.
-- Only COMPLETE snapshots are persisted. Listing recomputes completeness before reuse.
CREATE TABLE IF NOT EXISTS profile_job_count_snapshots (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  search_profile_id uuid NOT NULL,
  scope_key text NOT NULL,
  profile_version integer NOT NULL,
  fit_algorithm_version text NOT NULL,
  totals jsonb NOT NULL,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, search_profile_id, scope_key)
);
CREATE INDEX IF NOT EXISTS profile_job_count_snapshots_version_idx
  ON profile_job_count_snapshots (tenant_id, search_profile_id, profile_version);
