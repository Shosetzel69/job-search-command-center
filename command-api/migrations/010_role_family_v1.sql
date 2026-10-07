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

-- Preserve current user intent while removing the runtime dependency on the
-- legacy role_groups family model. Old selections become explicit major-family
-- + subfamily selections.
WITH migrated AS (
  SELECT
    tenant_id,
    search_profile_id,
    preferences,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN
        COALESCE(preferences->'target_role_families', '[]'::jsonb) ?| ARRAY['PROJECT_MANAGEMENT','DELIVERY','PROGRAM_PMO']
        OR COALESCE((preferences #>> '{role_groups,pm,enabled}')::boolean, false)
        OR COALESCE((preferences #>> '{role_groups,delivery,enabled}')::boolean, false)
        OR COALESCE((preferences #>> '{role_groups,program,enabled}')::boolean, false)
      THEN 'PROJECT_DELIVERY_MANAGEMENT' END,
      CASE WHEN
        COALESCE(preferences->'target_role_families', '[]'::jsonb) ? 'SERVICE_MANAGEMENT'
        OR COALESCE((preferences #>> '{role_groups,service,enabled}')::boolean, false)
      THEN 'SERVICE_OPERATIONS_MANAGEMENT' END,
      CASE WHEN
        COALESCE(preferences->'target_role_families', '[]'::jsonb) ? 'SCRUM_AGILE'
        OR COALESCE((preferences #>> '{role_groups,scrum,enabled}')::boolean, false)
      THEN 'PRODUCT_AGILE' END
    ], NULL)::text[] AS families,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN
        COALESCE(preferences->'target_role_families', '[]'::jsonb) ? 'PROJECT_MANAGEMENT'
        OR COALESCE((preferences #>> '{role_groups,pm,enabled}')::boolean, false)
        OR COALESCE(preferences->'target_role_subfamilies', '[]'::jsonb) ?| ARRAY['project_manager','it_project_manager','technical_project_manager','agile_project_manager']
      THEN 'project_management' END,
      CASE WHEN
        COALESCE(preferences->'target_role_families', '[]'::jsonb) ? 'DELIVERY'
        OR COALESCE((preferences #>> '{role_groups,delivery,enabled}')::boolean, false)
        OR COALESCE(preferences->'target_role_subfamilies', '[]'::jsonb) ?| ARRAY['delivery_manager','technical_delivery_manager']
      THEN 'delivery_management' END,
      CASE WHEN
        COALESCE(preferences->'target_role_families', '[]'::jsonb) ? 'PROGRAM_PMO'
        OR COALESCE((preferences #>> '{role_groups,program,enabled}')::boolean, false)
        OR COALESCE(preferences->'target_role_subfamilies', '[]'::jsonb) ?| ARRAY['program_manager','technical_program_manager']
      THEN 'program_management' END,
      CASE WHEN
        COALESCE(preferences->'target_role_families', '[]'::jsonb) ? 'PROGRAM_PMO'
        OR COALESCE((preferences #>> '{role_groups,program,enabled}')::boolean, false)
        OR COALESCE(preferences->'target_role_subfamilies', '[]'::jsonb) ? 'pmo_manager'
      THEN 'pmo' END,
      CASE WHEN
        COALESCE(preferences->'target_role_families', '[]'::jsonb) ? 'SERVICE_MANAGEMENT'
        OR COALESCE((preferences #>> '{role_groups,service,enabled}')::boolean, false)
        OR COALESCE(preferences->'target_role_subfamilies', '[]'::jsonb) ?| ARRAY['service_manager','service_delivery_manager']
      THEN 'service_management' END,
      CASE WHEN
        COALESCE(preferences->'target_role_families', '[]'::jsonb) ? 'SCRUM_AGILE'
        OR COALESCE((preferences #>> '{role_groups,scrum,enabled}')::boolean, false)
        OR COALESCE(preferences->'target_role_subfamilies', '[]'::jsonb) ? 'scrum_master'
      THEN 'agile_scrum' END
    ], NULL)::text[] AS subfamilies
  FROM search_profile_preferences
)
UPDATE search_profile_preferences pref
SET preferences =
      (pref.preferences - 'role_groups' - 'target_role_families' - 'target_role_subfamilies')
      || jsonb_build_object(
           'target_role_families', to_jsonb(migrated.families),
           'target_role_subfamilies', to_jsonb(migrated.subfamilies)
         ),
    updated_at = now()
FROM migrated
WHERE pref.tenant_id = migrated.tenant_id
  AND pref.search_profile_id = migrated.search_profile_id;