-- #521 / R2: global bounded Coverage observations.
-- Current Coverage state is derived at read time from these observations + collection_policy,
-- so time/policy changes can make a scope STALE without requiring a write.

CREATE TABLE coverage_scope_state (
  scope_key text PRIMARY KEY CHECK (scope_key ~ '^[0-9a-f]{64}$'),
  role_family text NOT NULL CHECK (
    role_family IN (
      'PROJECT_MANAGEMENT',
      'DELIVERY',
      'SERVICE_MANAGEMENT',
      'SCRUM_AGILE',
      'PROGRAM_PMO'
    )
  ),
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_usable_run_id text REFERENCES search_runs(run_id) ON DELETE SET NULL,
  last_usable_at timestamptz,
  corpus_volume integer NOT NULL DEFAULT 0 CHECK (corpus_volume >= 0),
  source_diversity integer NOT NULL DEFAULT 0 CHECK (source_diversity >= 0),
  source_ids text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX coverage_scope_family_freshness_idx
  ON coverage_scope_state(role_family, last_usable_at DESC);
