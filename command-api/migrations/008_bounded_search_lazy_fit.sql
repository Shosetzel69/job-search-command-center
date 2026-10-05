-- ATC-489-03: Search-Profile-scoped, versioned lazy FIT cache.
-- profile_job_evaluation is derived/cache data. Clear legacy rows, then evolve
-- the existing relation in place so ownership and grants are preserved.

TRUNCATE TABLE profile_job_evaluation;

ALTER TABLE profile_job_evaluation
  ADD COLUMN search_profile_id uuid NOT NULL,
  ADD COLUMN eligibility_state text NOT NULL
    CHECK (eligibility_state IN ('ELIGIBLE','INELIGIBLE','UNKNOWN')),
  ADD COLUMN eligibility_reason_code text,
  ADD COLUMN profile_version integer NOT NULL CHECK (profile_version > 0),
  ADD COLUMN job_version integer NOT NULL CHECK (job_version > 0),
  ADD COLUMN fit_algorithm_version text NOT NULL CHECK (btrim(fit_algorithm_version) <> '');

ALTER TABLE profile_job_evaluation
  DROP CONSTRAINT profile_job_evaluation_pkey;

ALTER TABLE profile_job_evaluation
  ADD PRIMARY KEY(tenant_id, search_profile_id, job_id);

CREATE INDEX profile_job_evaluation_validity_idx
  ON profile_job_evaluation(
    tenant_id,
    search_profile_id,
    profile_version,
    fit_algorithm_version,
    job_id
  );

CREATE INDEX profile_job_evaluation_job_version_idx
  ON profile_job_evaluation(tenant_id, search_profile_id, job_id, job_version);
