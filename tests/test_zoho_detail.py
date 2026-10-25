import unittest
from zoho_detail import extract_detail
class DetailTests(unittest.TestCase):
    def test_osf(self):
        text='<h1>Engineer</h1><p>Full time | OSF Digital | India</p><h3>Posted On 14.10.2026</h3><h3>Job Information</h3><p>City</p><p>Hyderabad</p><p>State/Province</p><p>Telangana</p><h3>Job Description</h3><div>Build scalable systems.</div><h3>Requirements</h3><p>Python</p>'
        d=extract_detail(text)
        self.assertIn('Build scalable systems',d["description"])
        self.assertEqual(d["date_posted"],"14.10.2026")
        self.assertEqual(d["location"],"Hyderabad, Telangana")
        self.assertEqual(d["employment_type"],"Full time")
    def test_hr_plus(self):
        text='<h1>Operations Officer</h1><p>Full time | HR Plus Consultancy | Kuwait</p><p>Posted On 19/10/2026</p><h2>Job Description</h2><p>Admin role</p>'
        d=extract_detail(text)
        self.assertEqual(d["date_posted"],"19/10/2026")
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
        self.assertEqual(d["date_posted"], "10/21/2026")
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
        result = extract_detail(html)
        self.assertEqual(result["description_completeness"], "summary")
        self.assertEqual(result["description_provenance"], "html_meta_description")
