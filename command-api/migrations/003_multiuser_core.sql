CREATE TABLE app_user (
  user_id uuid PRIMARY KEY,
  role text NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEACTIVATED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_identity (
  identity_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider = 'GOOGLE'),
  provider_subject text NOT NULL CHECK (btrim(provider_subject) <> ''),
  email text,
  email_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_subject),
  UNIQUE(user_id, provider)
);

CREATE TABLE profile (
  profile_id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES app_user(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_session (
  session_id_hash text PRIMARY KEY CHECK (length(session_id_hash) = 64),
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX user_session_user_idx ON user_session(user_id);
CREATE INDEX user_session_expires_idx ON user_session(expires_at);

CREATE TABLE profile_preferences (
  profile_id uuid PRIMARY KEY REFERENCES profile(profile_id) ON DELETE CASCADE,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE profile_job_state (
  profile_id uuid NOT NULL REFERENCES profile(profile_id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES canonical_jobs(job_id) ON DELETE CASCADE,
  seen_at timestamptz,
  archived_at timestamptz,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(profile_id, job_id)
);

CREATE TABLE profile_job_evaluation (
  profile_id uuid NOT NULL REFERENCES profile(profile_id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES canonical_jobs(job_id) ON DELETE CASCADE,
  eligible boolean NOT NULL,
  score integer CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  pros jsonb NOT NULL DEFAULT '[]'::jsonb,
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  exclusion_reason text,
  evaluation_version text NOT NULL,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(profile_id, job_id)
);

CREATE TABLE applications (
  application_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES profile(profile_id) ON DELETE CASCADE,
  job_id uuid REFERENCES canonical_jobs(job_id) ON DELETE SET NULL,
  company text NOT NULL CHECK (btrim(company) <> ''),
  title text NOT NULL CHECK (btrim(title) <> ''),
  location text,
  countries jsonb NOT NULL DEFAULT '[]'::jsonb,
  reference text,
  status text NOT NULL,
  applied_at date,
  next_status_check date,
  source_url text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX applications_profile_idx ON applications(profile_id, applied_at DESC);
CREATE INDEX applications_job_idx ON applications(job_id) WHERE job_id IS NOT NULL;

CREATE TABLE profile_notes (
  note_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES profile(profile_id) ON DELETE CASCADE,
  job_id uuid REFERENCES canonical_jobs(job_id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE profile_ui_preferences (
  profile_id uuid PRIMARY KEY REFERENCES profile(profile_id) ON DELETE CASCADE,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE collection_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE system_bootstrap (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  owner_bootstrapped_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO system_bootstrap(singleton)
VALUES (true)
ON CONFLICT(singleton) DO NOTHING;

CREATE TABLE account_capacity_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  admission_enabled boolean NOT NULL DEFAULT true,
  max_users integer CHECK (max_users IS NULL OR max_users > 0),
  warning_percent integer NOT NULL DEFAULT 70 CHECK (warning_percent BETWEEN 1 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO account_capacity_policy(singleton, admission_enabled, max_users, warning_percent)
VALUES (true, true, NULL, 70)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE account_deletion_audit (
  audit_id uuid PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type = 'ACCOUNT_DELETE'),
  actor_kind text NOT NULL CHECK (actor_kind IN ('SELF', 'ADMIN')),
  result text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days')
);

ALTER TABLE profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile FORCE ROW LEVEL SECURITY;
CREATE POLICY profile_owner_policy ON profile
  USING (user_id = NULLIF(current_setting('jscc.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('jscc.user_id', true), '')::uuid);

ALTER TABLE profile_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY profile_preferences_owner_policy ON profile_preferences
  USING (profile_id = NULLIF(current_setting('jscc.profile_id', true), '')::uuid)
  WITH CHECK (profile_id = NULLIF(current_setting('jscc.profile_id', true), '')::uuid);

ALTER TABLE profile_job_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_job_state FORCE ROW LEVEL SECURITY;
CREATE POLICY profile_job_state_owner_policy ON profile_job_state
  USING (profile_id = NULLIF(current_setting('jscc.profile_id', true), '')::uuid)
  WITH CHECK (profile_id = NULLIF(current_setting('jscc.profile_id', true), '')::uuid);

ALTER TABLE profile_job_evaluation ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_job_evaluation FORCE ROW LEVEL SECURITY;
CREATE POLICY profile_job_evaluation_owner_policy ON profile_job_evaluation
  USING (profile_id = NULLIF(current_setting('jscc.profile_id', true), '')::uuid)
  WITH CHECK (profile_id = NULLIF(current_setting('jscc.profile_id', true), '')::uuid);

ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications FORCE ROW LEVEL SECURITY;
CREATE POLICY applications_owner_policy ON applications
  USING (profile_id = NULLIF(current_setting('jscc.profile_id', true), '')::uuid)
  WITH CHECK (profile_id = NULLIF(current_setting('jscc.profile_id', true), '')::uuid);

ALTER TABLE profile_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY profile_notes_owner_policy ON profile_notes
  USING (profile_id = NULLIF(current_setting('jscc.profile_id', true), '')::uuid)
  WITH CHECK (profile_id = NULLIF(current_setting('jscc.profile_id', true), '')::uuid);

ALTER TABLE profile_ui_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_ui_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY profile_ui_preferences_owner_policy ON profile_ui_preferences
  USING (profile_id = NULLIF(current_setting('jscc.profile_id', true), '')::uuid)
  WITH CHECK (profile_id = NULLIF(current_setting('jscc.profile_id', true), '')::uuid);
