CREATE TABLE search_runs (
  run_id text PRIMARY KEY,
  status text NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  records_inspected integer NOT NULL DEFAULT 0,
  jobs_published integer NOT NULL DEFAULT 0,
  excluded integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE source_run_results (
  source_execution_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES search_runs(run_id) ON DELETE CASCADE,
  source_id text,
  source text,
  connector text,
  collection_method text,
  outcome text,
  records integer NOT NULL DEFAULT 0,
  error_code text,
  failure_stage text,
  http_status integer,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX source_run_results_run_idx ON source_run_results(run_id);

CREATE TABLE scheduler_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  schedule_expression text,
  timezone text NOT NULL DEFAULT 'Europe/Bucharest',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE scheduler_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_triggered_at timestamptz,
  last_run_id text REFERENCES search_runs(run_id) ON DELETE SET NULL,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO scheduler_config(singleton, enabled)
VALUES (true, false)
ON CONFLICT(singleton) DO NOTHING;

INSERT INTO scheduler_state(singleton)
VALUES (true)
ON CONFLICT(singleton) DO NOTHING;
