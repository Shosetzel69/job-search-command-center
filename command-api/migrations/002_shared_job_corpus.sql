CREATE TABLE canonical_jobs (
  job_id uuid PRIMARY KEY,
  title text NOT NULL CHECK (btrim(title) <> ''),
  company text NOT NULL CHECK (btrim(company) <> ''),
  location text,
  country_codes text[] NOT NULL DEFAULT '{}',
  work_mode text NOT NULL CHECK (work_mode IN ('remote', 'hybrid', 'onsite', 'unknown')),
  role_family text NOT NULL CHECK (
    role_family IN (
      'PROJECT_MANAGEMENT',
      'DELIVERY',
      'SERVICE_MANAGEMENT',
      'SCRUM_AGILE',
      'PROGRAM_PMO',
      'UNKNOWN'
    )
  ),
  lifecycle_status text NOT NULL DEFAULT 'ACTIVE' CHECK (
    lifecycle_status IN ('ACTIVE', 'UNCONFIRMED', 'INACTIVE')
  ),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  inactive_at timestamptz,
  retention_until timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX canonical_jobs_lifecycle_idx
  ON canonical_jobs(lifecycle_status, retention_until);

CREATE TABLE source_postings (
  posting_id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES canonical_jobs(job_id) ON DELETE RESTRICT,
  source_id text NOT NULL CHECK (btrim(source_id) <> ''),
  source_name text NOT NULL CHECK (btrim(source_name) <> ''),
  external_job_id text,
  canonical_url text,
  identity_kind text NOT NULL CHECK (identity_kind IN ('EXTERNAL_ID', 'CANONICAL_URL')),
  identity_value text NOT NULL CHECK (btrim(identity_value) <> ''),
  lifecycle_status text NOT NULL DEFAULT 'ACTIVE' CHECK (
    lifecycle_status IN ('ACTIVE', 'UNCONFIRMED', 'INACTIVE')
  ),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  inactive_at timestamptz,
  seen_run_id text NOT NULL,
  repost_of_posting_id uuid REFERENCES source_postings(posting_id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(source_id, identity_kind, identity_value),
  CHECK (
    (identity_kind = 'EXTERNAL_ID' AND external_job_id IS NOT NULL)
    OR
    (identity_kind = 'CANONICAL_URL' AND canonical_url IS NOT NULL)
  )
);

CREATE INDEX source_postings_job_idx ON source_postings(job_id);
CREATE INDEX source_postings_url_idx ON source_postings(canonical_url) WHERE canonical_url IS NOT NULL;
CREATE INDEX source_postings_lifecycle_idx ON source_postings(source_id, lifecycle_status);
