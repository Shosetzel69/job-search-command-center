-- ATC-489-03: Search-Profile-scoped, versioned lazy FIT cache.
-- profile_job_evaluation is derived/cache data. Rebuild it rather than carrying
-- forward legacy rows that lack Search Profile and version identity.

DROP TABLE profile_job_evaluation;

CREATE TABLE profile_job_evaluation (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  search_profile_id uuid NOT NULL,
  job_id uuid NOT NULL,
  eligibility_state text NOT NULL
    CHECK (eligibility_state IN ('ELIGIBLE','INELIGIBLE','UNKNOWN')),
  eligibility_reason_code text NOT NULL,
  eligible boolean NOT NULL,
  score integer CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  pros jsonb NOT NULL DEFAULT '[]'::jsonb,
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  exclusion_reason text,
  profile_version integer NOT NULL CHECK (profile_version > 0),
  job_version integer NOT NULL CHECK (job_version > 0),
  fit_algorithm_version text NOT NULL CHECK (btrim(fit_algorithm_version) <> ''),
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id, search_profile_id, job_id)
);

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
