-- ADR-008 provider amendment: Nile does not support CREATE FUNCTION.
-- Cross-profile nomenclature reference checks are enforced by the application-level
-- aggregate-only Cross-Tenant Reference Guard. This migration intentionally creates
-- no database routine; the statement below is a stable migration marker.
SELECT 1 AS jscc_nomenclature_reference_guard_application_managed;
