-- #531 / ATC-531-01: Role Family v1 full cutover.
-- Additive migration only. Existing migrations 001-009 remain immutable.

-- Old Coverage observations were keyed with legacy family semantics. They cannot
-- be relabelled safely into the new family+subfamily scope, so reset operational
-- observations and let #521 repopulate them from usable bounded runs.
DELETE FROM coverage_scope_state;

ALTER TABLE canonical_jobs
  DROP CONSTRAINT IF EXISTS canonical_jobs_role_family_check;

-- Make existing rows admissible under the new major-family constraint before
-- the canonical JS classifier runs its exact idempotent backfill after migrations.
-- Subfamily/classification fields are intentionally left to that classifier.
UPDATE canonical_jobs
SET role_family = CASE role_family
  WHEN 'PROJECT_MANAGEMENT' THEN 'PROJECT_DELIVERY_MANAGEMENT'
  WHEN 'DELIVERY' THEN 'PROJECT_DELIVERY_MANAGEMENT'
  WHEN 'PROGRAM_PMO' THEN 'PROJECT_DELIVERY_MANAGEMENT'
  WHEN 'SERVICE_MANAGEMENT' THEN 'SERVICE_OPERATIONS_MANAGEMENT'
  WHEN 'SCRUM_AGILE' THEN 'PRODUCT_AGILE'
  ELSE role_family
END
WHERE role_family IN (
  'PROJECT_MANAGEMENT','DELIVERY','PROGRAM_PMO','SERVICE_MANAGEMENT','SCRUM_AGILE'
);

ALTER TABLE canonical_jobs
  ADD CONSTRAINT canonical_jobs_role_family_v1_check CHECK (
    role_family IN (
      'PROJECT_DELIVERY_MANAGEMENT',
      'SERVICE_OPERATIONS_MANAGEMENT',
      'PRODUCT_AGILE',
      'BUSINESS_ANALYSIS_TRANSFORMATION',
      'CUSTOMER_PROFESSIONAL_SERVICES',
      'TECHNICAL_LEADERSHIP_ARCHITECTURE',
      'UNKNOWN'
    )
  );

ALTER TABLE coverage_scope_state
  DROP CONSTRAINT IF EXISTS coverage_scope_state_role_family_check;

ALTER TABLE coverage_scope_state
  ADD COLUMN role_subfamilies text[] NOT NULL DEFAULT '{}';

ALTER TABLE coverage_scope_state
  ADD CONSTRAINT coverage_scope_state_role_family_v1_check CHECK (
    role_family IN (
      'PROJECT_DELIVERY_MANAGEMENT',
      'SERVICE_OPERATIONS_MANAGEMENT',
      'PRODUCT_AGILE',
      'BUSINESS_ANALYSIS_TRANSFORMATION',
      'CUSTOMER_PROFESSIONAL_SERVICES',
      'TECHNICAL_LEADERSHIP_ARCHITECTURE'
    )
  );

-- Search Profile preference values are tenant-aware Nile data. Their legacy
-- role criteria are migrated after schema migration by the canonical
-- tenant-qualified backfill (backfillSearchProfilePreferences); no cross-tenant
-- DML is permitted here.
