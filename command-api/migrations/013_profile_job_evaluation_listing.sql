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

-- Tenant-local global listing orderings (R6 section 3.3).
CREATE INDEX pje_listing_score_idx ON profile_job_evaluation (tenant_id, search_profile_id, score, job_id);
CREATE INDEX pje_listing_publication_idx ON profile_job_evaluation (tenant_id, search_profile_id, publication_at, job_id);
CREATE INDEX pje_listing_retrieve_idx ON profile_job_evaluation (tenant_id, search_profile_id, retrieve_at, job_id);
CREATE INDEX pje_listing_title_idx ON profile_job_evaluation (tenant_id, search_profile_id, sort_title, job_id);
CREATE INDEX pje_listing_country_idx ON profile_job_evaluation (tenant_id, search_profile_id, display_country, job_id);
CREATE INDEX pje_listing_mode_idx ON profile_job_evaluation (tenant_id, search_profile_id, display_work_mode, job_id);
