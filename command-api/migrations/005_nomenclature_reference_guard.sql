CREATE OR REPLACE FUNCTION public.jscc_nomenclature_reference_count(
  p_domain text,
  p_code text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  account_row record;
  target_profile uuid;
  prefs jsonb;
  matched integer;
  total integer := 0;
  previous_user text := current_setting('jscc.user_id', true);
  previous_profile text := current_setting('jscc.profile_id', true);
BEGIN
  FOR account_row IN SELECT user_id FROM public.app_user LOOP
    PERFORM set_config('jscc.user_id', account_row.user_id::text, true);
    SELECT profile_id
      INTO target_profile
      FROM public.profile
     WHERE user_id = account_row.user_id;

    IF target_profile IS NULL THEN
      CONTINUE;
    END IF;

    PERFORM set_config('jscc.profile_id', target_profile::text, true);

    IF lower(p_domain) = 'application_statuses' THEN
      SELECT count(*)::integer
        INTO matched
        FROM public.applications
       WHERE profile_id = target_profile
         AND lower(status) = lower(p_code);
      total := total + COALESCE(matched, 0);
      CONTINUE;
    END IF;

    SELECT preferences
      INTO prefs
      FROM public.profile_preferences
     WHERE profile_id = target_profile;

    prefs := COALESCE(prefs, '{}'::jsonb);

    IF lower(p_domain) = 'regions' THEN
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(prefs->'target_regions', '[]'::jsonb)) AS item(value)
        WHERE lower(item.value) = lower(p_code)
      ) OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(prefs->'excluded_regions', '[]'::jsonb)) AS item(value)
        WHERE lower(item.value) = lower(p_code)
      ) THEN
        total := total + 1;
      END IF;
    ELSIF lower(p_domain) = 'countries' THEN
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(prefs->'target_country_codes', '[]'::jsonb)) AS item(value)
        WHERE lower(item.value) = lower(p_code)
      ) OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(prefs->'excluded_country_codes', '[]'::jsonb)) AS item(value)
        WHERE lower(item.value) = lower(p_code)
      ) OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(prefs->'remote_eligible_country_codes', '[]'::jsonb)) AS item(value)
        WHERE lower(item.value) = lower(p_code)
      ) THEN
        total := total + 1;
      END IF;
    ELSIF lower(p_domain) = 'work_modes' THEN
      IF lower(COALESCE(prefs->'work_modes'->>lower(p_code), 'false')) = 'true' THEN
        total := total + 1;
      END IF;
    ELSIF lower(p_domain) = 'contract_types' THEN
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(prefs->'contract_types', '[]'::jsonb)) AS item(value)
        WHERE lower(item.value) = lower(p_code)
      ) THEN
        total := total + 1;
      END IF;
    END IF;
  END LOOP;

  PERFORM set_config('jscc.user_id', COALESCE(previous_user, ''), true);
  PERFORM set_config('jscc.profile_id', COALESCE(previous_profile, ''), true);
  RETURN total;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('jscc.user_id', COALESCE(previous_user, ''), true);
    PERFORM set_config('jscc.profile_id', COALESCE(previous_profile, ''), true);
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.jscc_nomenclature_reference_count(text, text) FROM PUBLIC;
