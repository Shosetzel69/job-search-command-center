-- ATC-535-FP02-R6: nullable additive tenant-evaluation projection.
-- Existing records have NULL input_digest and must be evaluated lazily via advance.
-- No historical rewrite, shared DDL, or activation of migration 011.
ALTER TABLE profile_job_evaluation
  ADD COLUMN input_digest text,
  ADD COLUMN fit_matrix jsonb,
  ADD COLUMN sort_title text,
  ADD COLUMN display_country text,
  ADD COLUMN display_work_mode text,
  ADD COLUMN display_contract_type text,
  ADD COLUMN b2b boolean,
  ADD COLUMN publication_at timestamptz,
  ADD COLUMN publication_precision text,
  ADD COLUMN retrieve_at timestamptz,
  ADD COLUMN is_repost boolean,
  ADD COLUMN is_remote boolean;

-- Age/new24h are evaluated at the fixed listing anchor, never persisted.
