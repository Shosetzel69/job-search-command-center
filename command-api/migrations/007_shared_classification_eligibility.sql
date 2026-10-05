-- #489 / ATC-489-02: Search Profile Selection Criteria authority + shared classification/versioning.

CREATE TABLE search_profile_preferences (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  search_profile_id uuid NOT NULL,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, search_profile_id)
);

ALTER TABLE canonical_jobs
  ADD COLUMN job_version integer NOT NULL DEFAULT 1 CHECK (job_version > 0),
  ADD COLUMN role_subfamily text[] NOT NULL DEFAULT '{}',
  ADD COLUMN seniority text NOT NULL DEFAULT 'unknown',
  ADD COLUMN contract_type text NOT NULL DEFAULT 'unknown'
    CHECK (contract_type IN ('permanent', 'temporary', 'contract', 'freelance', 'unknown')),
  ADD COLUMN remote_scope text NOT NULL DEFAULT 'unknown',
  ADD COLUMN classification_status text NOT NULL DEFAULT 'unknown'
    CHECK (classification_status IN ('matched', 'unknown', 'conflict')),
  ADD COLUMN classification_confidence numeric(5,4) NOT NULL DEFAULT 0
    CHECK (classification_confidence >= 0 AND classification_confidence <= 1),
  ADD COLUMN classification_version text NOT NULL DEFAULT 'legacy',
  ADD COLUMN evaluation_basis_hash text NOT NULL DEFAULT '';

CREATE INDEX canonical_jobs_classification_idx
  ON canonical_jobs(role_family, work_mode, contract_type, lifecycle_status);

CREATE INDEX canonical_jobs_job_version_idx
  ON canonical_jobs(job_version);
