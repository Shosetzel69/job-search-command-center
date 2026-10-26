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
