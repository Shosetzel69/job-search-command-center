-- ADR-008 Multiuser core.
-- Nile provides a built-in tenants table. The IF NOT EXISTS definition is a
-- compatibility stand-in for local PostgreSQL CI and is a no-op on Nile.
CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE app_user (
  user_id uuid PRIMARY KEY,
  role text NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEACTIVATED')),
  deletion_started_at timestamptz,
  deletion_initiated_by text CHECK (deletion_initiated_by IS NULL OR deletion_initiated_by IN ('SELF', 'ADMIN')),
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

-- Global account/tenant metadata only. Personal workspace payload never lives here.
CREATE TABLE profile (
  profile_id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES app_user(user_id) ON DELETE CASCADE,
  provisioned_at timestamptz,
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

-- Every personal-content table is tenant-aware. Logical profile_id maps to
-- physical tenant_id at the repository/gateway boundary.
CREATE TABLE profile_preferences (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE profile_job_state (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  seen_at timestamptz,
  archived_at timestamptz,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id, job_id)
);

CREATE TABLE profile_job_evaluation (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  eligible boolean NOT NULL,
  score integer CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  pros jsonb NOT NULL DEFAULT '[]'::jsonb,
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  exclusion_reason text,
  evaluation_version text NOT NULL,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id, job_id)
);

CREATE TABLE applications (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  job_id uuid,
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
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id, application_id)
);

CREATE INDEX applications_tenant_applied_idx ON applications(tenant_id, applied_at DESC);
CREATE INDEX applications_job_idx ON applications(job_id) WHERE job_id IS NOT NULL;

CREATE TABLE profile_notes (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  note_id uuid NOT NULL,
  job_id uuid,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id, note_id)
);

CREATE TABLE profile_ui_preferences (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE collection_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO collection_policy(singleton, policy)
VALUES (true, '{}'::jsonb)
ON CONFLICT(singleton) DO NOTHING;

CREATE TABLE system_bootstrap (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  owner_preferences_imported_at timestamptz,
  owner_applications_imported_at timestamptz,
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
