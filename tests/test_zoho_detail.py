import unittest
from zoho_detail import extract_detail
class DetailTests(unittest.TestCase):
    def test_osf(self):
        text='<h1>Engineer</h1><p>Full time | OSF Digital | India</p><h3>Posted On 14.10.2026</h3><h3>Job Information</h3><p>City</p><p>Hyderabad</p><p>State/Province</p><p>Telangana</p><h3>Job Description</h3><div>Build scalable systems.</div><h3>Requirements</h3><p>Python</p>'
        d=extract_detail(text)
        self.assertIn('Build scalable systems',d["description"])
        self.assertEqual(d["date_posted"],"2026-10-14")
        self.assertEqual(d["location"],"Hyderabad, Telangana")
        self.assertEqual(d["employment_type"],"Full time")
    def test_hr_plus(self):
        text='<h1>Operations Officer</h1><p>Full time | HR Plus Consultancy | Kuwait</p><p>Posted On 19/10/2026</p><h2>Job Description</h2><p>Admin role</p>'
        d=extract_detail(text)
        self.assertEqual(d["date_posted"],"2026-10-19")
        self.assertIn("Admin role",d["description"])
    def test_missing_description(self):
        with self.assertRaises(ValueError): extract_detail("<h1>Job</h1>")
    def test_oversized(self):
        with self.assertRaises(ValueError): extract_detail("x"*3_145_729)
    def test_no_script_leak(self):
        d=extract_detail('<script>secretTOKEN</script><h1>J</h1><h2>Job Description</h2><p>Public text</p>')
        self.assertNotIn("secretTOKEN",str(d))

class FunctionalCompletenessTests(unittest.TestCase):
    def test_requirements_must_be_included_in_full_description(self):
        html='<h1>Engineer</h1><h2>Job Description</h2><p>Build software.</p><h2>Requirements</h2><p>Python and SQL are mandatory.</p><h2>Apply Now</h2>'
        data=extract_detail(html)
        self.assertIn("Build software.",data["description"])
        self.assertIn("Python and SQL are mandatory.",data["description"])

class ModernFieldsTests(unittest.TestCase):
    def test_modern_explicit_fields(self):
        html = '<h1>Consultant</h1><p>Country</p><p>Romania</p><p>Job Type</p><p>Full Time</p><p>Date Opened</p><p>10/21/2026</p><h2>Job Description</h2><p>Deliver projects.</p><h2>Requirements</h2><p>PM skills.</p><h2>Apply Now</h2>'
        d=extract_detail(html)
        self.assertEqual(d["country"], "Romania")
        self.assertEqual(d["employment_type"], "Full Time")
        self.assertEqual(d["date_posted"], "2026-10-21")
        self.assertIn("PM skills.", d["description"])


class EmbeddedPublicDetailTests(unittest.TestCase):
    def test_full_richtext_and_date(self):
        import json
        payload = {"jobTitle":"Data Engineer", "postedOn":"14.10.2026",
                   "country":"India", "jobType":"Full time",
                   "jobDescriptionDetails":[{"richText":{"fieldLabel":"Job Description",
                   "value":"<p>Responsible for migrations.</p><p>Validate reconciliations.</p>"}}]}
        html = "<script>data=" + json.dumps(payload) + ";</script>"
        result = extract_detail(html)
        self.assertEqual(result["description_completeness"], "full")
        self.assertEqual(result["date_posted"], "2026-10-14")
        self.assertIn("Validate reconciliations.", result["description"])

    def test_meta_summary_not_full(self):
        html = '<meta name="description" content="' + ('Public short preview ' * 8) + '"><h1>Engineer</h1>'
        result = extract_detail(html, expected_title="Engineer")
        self.assertEqual(result["description_completeness"], "summary")
        self.assertEqual(result["description_provenance"], "html_meta_description")


class DateSafetyTests(unittest.TestCase):
    def test_ambiguous_slash_date_is_unknown(self):
        from zoho_detail import normalize_date
        self.assertIsNone(normalize_date('10/11/2026'))

    def test_impossible_and_empty_dates_are_unknown(self):
        from zoho_detail import normalize_date
        self.assertIsNone(normalize_date('31/02/2026'))
        self.assertIsNone(normalize_date(''))

class R4DetailGateTests(unittest.TestCase):
    def test_long_generic_signin_meta_is_not_a_job(self):
        login = ('<meta name="description" content="' +
                 'Zoho Recruit secure sign in. Please sign in to continue. ' * 3 +
                 '"><h1>Sign in</h1><input type="password">')
        with self.assertRaisesRegex(ValueError, "lacks Job Description"):
            extract_detail(login, expected_title="IT Project Manager")

    def test_access_denied_meta_even_with_job_heading_is_rejected(self):
        html = ('<meta name="description" content="' +
                'Access denied. Your session expired. Authenticate to continue. ' * 3 +
                '"><h1>IT Project Manager</h1>')
        with self.assertRaisesRegex(ValueError, "lacks Job Description"):
            extract_detail(html, expected_title="IT Project Manager")

    def test_consent_meta_even_with_job_heading_is_rejected(self):
        html = ('<meta name="description" content="' +
                'Cookie consent required. Accept cookies to continue viewing. ' * 3 +
                '"><h1>IT Project Manager</h1>')
        with self.assertRaisesRegex(ValueError, "lacks Job Description"):
            extract_detail(html, expected_title="IT Project Manager")

    def test_changed_widget_meta_without_job_heading_is_rejected(self):
        html = ('<meta name="description" content="' +
                'Explore our latest vacancies and interesting career opportunities. ' * 3 +
                '"><h1>Careers</h1>')
        with self.assertRaisesRegex(ValueError, "lacks Job Description"):
            extract_detail(html, expected_title="IT Project Manager")

    def test_summary_requires_job_heading_even_if_title_in_body(self):
        html = ('<meta name="description" content="' +
                'Interesting roles in software consulting, delivery and projects. ' * 3 +
                '"><p>IT Project Manager</p>')
        with self.assertRaisesRegex(ValueError, "lacks Job Description"):
            extract_detail(html, expected_title="IT Project Manager")

    def test_plain_title_heading_and_job_specific_summary_accepted(self):
        html = ('<meta name="description" content="' +
                'Lead delivery, plan projects and coordinate technical workstreams. ' * 3 +
                '"><h1><span>IT Project Manager</span></h1>')
        result = extract_detail(html, expected_title="IT Project Manager")
        self.assertEqual(result["description_completeness"], "summary")
        self.assertEqual(result["job_title"], "IT Project Manager")

    def test_no_expected_title_disallows_summary(self):
        html = ('<meta name="description" content="' +
                'Lead delivery and coordinate technical workstreams. ' * 3 +
                '"><h1>IT Project Manager</h1>')
        with self.assertRaisesRegex(ValueError, "lacks Job Description"):
            extract_detail(html)

    def test_login_page_with_job_description_heading_cannot_be_partial(self):
        html = ('<h1>Sign in</h1><h2>Job Description</h2>'
                '<p>Enter your credentials to proceed.</p>')
        with self.assertRaisesRegex(ValueError, "access gateway"):
            extract_detail(html, expected_title="IT Project Manager")

    def test_password_form_with_job_description_heading_cannot_be_partial(self):
        html = ('<h1>IT Project Manager</h1><h2>Job Description</h2>'
                '<p>Restricted content</p><input type="password" name="pwd">')
        with self.assertRaisesRegex(ValueError, "access gateway"):
            extract_detail(html, expected_title="IT Project Manager")


class R5AccessGatewayTests(unittest.TestCase):
    """R4-01: negative examples must fail at EVERY description admission path."""

    def test_matching_title_and_description_heading_with_signin_body_fails(self):
        html = ('<h1>IT Project Manager</h1><h2>Job Description</h2>'
                '<p>Please sign in to view this vacancy.</p>')
        with self.assertRaisesRegex(ValueError, "access gateway"):
            extract_detail(html, expected_title="IT Project Manager")

    def test_matching_title_and_description_heading_with_cookie_consent_fails(self):
        html = ('<h1>IT Project Manager</h1><h2>Job Description</h2>'
                '<p>Please accept cookies to continue viewing this job.</p>')
        with self.assertRaisesRegex(ValueError, "access gateway"):
            extract_detail(html, expected_title="IT Project Manager")

    def test_matching_title_and_description_heading_with_access_denied_fails(self):
        html = ('<h1>IT Project Manager</h1><h2>Job Description</h2>'
                '<p>Access denied.</p>')
        with self.assertRaisesRegex(ValueError, "access gateway"):
            extract_detail(html, expected_title="IT Project Manager")

    def test_embedded_full_payload_cannot_bypass_auth_shell(self):
        import json
        payload = {
            "jobTitle": "IT Project Manager",
            "jobDescriptionDetails": [{
                "richText": {
                    "fieldLabel": "Job Description",
                    "value": "<p>Plan roadmaps and coordinate projects.</p>"
                }
            }]
        }
        html = "<script>data=" + json.dumps(payload) + ";</script><h1>Sign in</h1>"
        with self.assertRaisesRegex(ValueError, "access gateway"):
            extract_detail(html, expected_title="IT Project Manager")

    def test_embedded_full_payload_containing_access_prompt_fails(self):
        import json
        payload = {
            "jobTitle": "IT Project Manager",
            "jobDescriptionDetails": [{
                "richText": {
                    "fieldLabel": "Job Description",
                    "value": "<p>Please sign in to view this vacancy.</p>"
                }
            }]
        }
        html = "<script>data=" + json.dumps(payload) + ";</script>"
        with self.assertRaisesRegex(ValueError, "access gateway"):
            extract_detail(html, expected_title="IT Project Manager")

    def test_matching_title_meta_login_prompt_still_rejected(self):
        html = ('<h1>IT Project Manager</h1>'
                '<meta name="description" content="Please sign in to view this vacancy. '
                'Please sign in to view this vacancy. Please sign in to view this vacancy.">')
        with self.assertRaisesRegex(ValueError, "access gateway"):
            extract_detail(html, expected_title="IT Project Manager")

    def test_legitimate_security_job_with_login_sso_cookie_words_is_not_blocked(self):
        html = ('<h1>Identity Security Engineer</h1><h2>Job Description</h2>'
                '<p>Implement sign in workflows, SSO, access control and cookie consent banners. '
                'Design login integration and monitor authentication failures.</p>')
        result = extract_detail(html, expected_title="Identity Security Engineer")
        self.assertEqual(result["description_completeness"], "partial")
        self.assertIn("SSO", result["description"])

    def test_legitimate_embedded_security_job_is_not_blocked(self):
        import json
        payload = {
            "jobTitle": "Identity Security Engineer",
            "jobDescriptionDetails": [{
                "richText": {
                    "fieldLabel": "Job Description",
                    "value": "<p>Build login, SSO, cookie-consent and identity access controls.</p>"
                }
            }]
        }
        html = "<script>data=" + json.dumps(payload) + ";</script>"
        result = extract_detail(html, expected_title="Identity Security Engineer")
        self.assertEqual(result["description_completeness"], "full")
        self.assertIn("identity access controls", result["description"])


class R6StandaloneGatewayTests(unittest.TestCase):
    """R5-01: content-context checks rather than exact previous review wording."""

    def test_short_login_ctas_under_valid_job_heading_fail(self):
        variants = (
            "Sign in to continue.",
            "Log in to continue.",
            "Login to proceed.",
            "Sign-in to view this job.",
            "Log-in to access the page.",
            "Please log in.",
            "Login required.",
            "Sign in to continue. Log in to continue.",
            "Accept cookies to continue.",
            "Cookie consent required.",
        )
        for prompt in variants:
            with self.subTest(prompt=prompt), self.assertRaisesRegex(ValueError, "access gateway"):
                extract_detail(
                    "<h1>IT Project Manager</h1><h2>Job Description</h2>"
                    "<p>" + prompt + "</p>",
                    expected_title="IT Project Manager",
                )

    def test_short_ctas_in_embedded_full_descriptions_fail(self):
        import json
        for phrase in ("Sign in to continue.", "Log in to continue.", "Accept cookies to continue."):
            with self.subTest(phrase=phrase), self.assertRaisesRegex(ValueError, "access gateway"):
                payload = {
                    "jobTitle": "IT Project Manager",
                    "jobDescriptionDetails": [
                        {"richText": {"fieldLabel": "Job Description",
                                      "value": "<p>" + phrase + "</p>"}}
                    ],
                }
                extract_detail("<script>data=" + json.dumps(payload) + ";</script>",
                               expected_title="IT Project Manager")

    def test_meta_only_repeated_login_ctas_fail(self):
        for phrase in ("Sign in to continue. ", "Log in to continue. "):
            html = ('<h1>IT Project Manager</h1>'
                    '<meta name="description" content="' + phrase * 4 + '">')
            with self.subTest(phrase=phrase), self.assertRaisesRegex(ValueError, "access gateway"):
                extract_detail(html, expected_title="IT Project Manager")

    def test_valid_security_engineering_requirements_survive(self):
        examples = (
            "Implement a secure sign in to continue onboarding user journey.",
            "Build login components and SSO integration for enterprise platforms.",
            "Write and test the Sign in to continue button in React.",
            "Design cookie consent required indicators and authentication workflows.",
        )
        for text in examples:
            with self.subTest(text=text):
                html = ('<h1>Identity Security Engineer</h1><h2>Job Description</h2>'
                        '<p>' + text + '</p>')
                out = extract_detail(html, expected_title="Identity Security Engineer")
                self.assertEqual(out["description"], text)
                self.assertEqual(out["description_completeness"], "partial")

    def test_security_meta_not_filtered(self):
        text = ("Implement SSO authentication, test login flows and build cookie consent "
                "features for enterprise identity platforms.")
        html = ('<h1>Identity Security Engineer</h1>'
                '<meta name="description" content="' + text + '">')
        out = extract_detail(html, expected_title="Identity Security Engineer")
        self.assertEqual(out["description_completeness"], "summary")
        self.assertEqual(out["description"], text)

class OSFRealTitleRegressionTests(unittest.TestCase):
    """Public OSF links say Full time while embedded detail has the job title."""

    @staticmethod
    def embedded(title, job_type="Full time"):
        import json
        return "<script>data=" + json.dumps({
            "jobTitle": title, "jobType": job_type,
            "jobDescriptionDetails": [{"richText": {
                "fieldLabel": "Job Description",
                "value": "<p>Deliver software integrations and maintain systems.</p>",
            }}],
        }) + ";</script>"

    def test_real_osf_portal_employment_label_cannot_override_title(self):
        for title in (
            "Back-End Developer, Sales",
            "Salesforce Business Analyst - English & Spanish",
            "Integration Developer",
        ):
            with self.subTest(title=title):
                result = extract_detail(self.embedded(title),
                                        expected_title="Full time")
                self.assertEqual(result["job_title"], title)
                self.assertEqual(result["employment_type"], "Full time")
                self.assertEqual(result["description_completeness"], "full")

    def test_empty_or_generic_embedded_and_portal_titles_fail_closed(self):
        for title in ("", None, "Full time", "Part-time", "Contract"):
            with self.subTest(title=title):
                with self.assertRaisesRegex(ValueError, "valid job title"):
                    extract_detail(self.embedded(title),
                                   expected_title="Full time")

    def test_legitimate_portal_title_fallback(self):
        result = extract_detail(self.embedded(None),
                                expected_title="Integration Developer")
        self.assertEqual(result["job_title"], "Integration Developer")

    def test_embedded_title_wins_when_both_sources_have_titles(self):
        result = extract_detail(self.embedded("Integration Developer"),
                                expected_title="Generic Consultant")
        self.assertEqual(result["job_title"], "Integration Developer")

    def test_security_engineer_title_and_legitimate_auth_requirements(self):
        import json
        payload = {
            "jobTitle": "Identity Security Engineer",
            "jobType": "Full time",
            "jobDescriptionDetails": [{"richText": {
                "fieldLabel": "Job Description",
                "value": "<p>Implement login, SSO and cookie consent protections.</p>"
            }}],
        }
        html = "<script>data=" + json.dumps(payload) + ";</script>"
        result = extract_detail(html, expected_title="Full time")
        self.assertEqual(result["job_title"], "Identity Security Engineer")
        self.assertIn("SSO", result["description"])

    def test_auth_gateway_still_rejected(self):
        html = self.embedded("Integration Developer") + "<h1>Sign in</h1>"
        with self.assertRaisesRegex(ValueError, "access gateway"):
            extract_detail(html, expected_title="Full time")

class OSFPartialAndSummaryTitleRegressionTests(unittest.TestCase):
    """A public job-type anchor must not become title in fallback detail paths."""

    def test_html_section_generic_anchor_uses_genuine_heading(self):
        html = ('<h1>Integration Developer</h1><h2>Job Description</h2>'
                '<p>Build production integrations.</p>')
        result = extract_detail(html, expected_title="Full time")
        self.assertEqual(result["job_title"], "Integration Developer")
        self.assertEqual(result["description_completeness"], "partial")

    def test_partial_placeholder_title_fails_closed(self):
        html = ('<h1>Full time</h1><h2>Job Description</h2>'
                '<p>Build production integrations.</p>')
        with self.assertRaisesRegex(ValueError, "valid job title"):
            extract_detail(html, expected_title="Full time")

    def test_partial_employment_label_with_company_is_rejected(self):
        html = ('<h1>Full time | OSF Digital</h1><h2>Job Description</h2>'
                '<p>Build production integrations.</p>')
        with self.assertRaisesRegex(ValueError, "valid job title"):
            extract_detail(html, expected_title="Full time")

    def test_summary_placeholder_heading_fails_closed(self):
        html = ('<h1>Full time</h1><meta name="description" content="'
                + ("Deliver enterprise integrations and maintain systems. " * 3)
                + '">')
        with self.assertRaisesRegex(ValueError, "lacks Job Description"):
            extract_detail(html, expected_title="Full time")

    def test_legitimate_summary_heading_remains_accepted(self):
        html = ('<h1>Integration Developer</h1><meta name="description" content="'
                + ("Deliver enterprise integrations and maintain systems. " * 3)
                + '">')
        result = extract_detail(html, expected_title="Integration Developer")
        self.assertEqual(result["job_title"], "Integration Developer")
        self.assertEqual(result["description_completeness"], "summary")

    def test_embedded_unknown_employment_type_is_not_job_title(self):
        result_html = OSFRealTitleRegressionTests.embedded("Permanent-remote", "Permanent-remote")
        with self.assertRaisesRegex(ValueError, "valid job title"):
            extract_detail(result_html, expected_title="Full time")
