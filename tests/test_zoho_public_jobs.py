import json, html, unittest
from zoho_public_jobs import embedded_jobs
def page(items):
    return '<html><input type="hidden" id="jobs" value="'+html.escape(json.dumps(items),quote=True)+'"></html>'
class TestModernJobs(unittest.TestCase):
    def test_metadata_and_no_inferred_description(self):
        a=embedded_jobs(page([{"id":"123456","Posting_Title":"Project Manager","Country":"Romania","City":"Bucharest","Job_Type":"Full time","Remote_Job":True,"Publish":True}]))
        self.assertEqual(len(a),1)
        self.assertEqual(a[0]["country"],"Romania")
        self.assertEqual(a[0]["remote_raw"],True)
        self.assertIsNone(a[0]["description"])
        self.assertFalse(a[0]["description_available"])
    def test_unpublished_is_excluded(self):
        self.assertEqual(embedded_jobs(page([{"id":"123456","Posting_Title":"Hidden","Publish":False}])),[])
    def test_duplicates(self):
        obj={"id":"123456","Posting_Title":"Engineer"}
        self.assertEqual(len(embedded_jobs(page([obj,obj]))),1)
    def test_missing_field(self):
        with self.assertRaises(ValueError): embedded_jobs("<html></html>")
    def test_bad_id(self):
        with self.assertRaises(ValueError): embedded_jobs(page([{"id":"notvalid","Posting_Title":"Engineer"}]))
    def test_large(self):
        with self.assertRaises(ValueError): embedded_jobs("X"*(3*1024*1024+1))

    def test_optional_public_description(self):
        rows=embedded_jobs(page([{"id":"123456","Posting_Title":"Engineer","Job_Description":"Build public products","Date_Opened":"2026-10-20"}]))
        self.assertTrue(rows[0]["description_available"])
        self.assertEqual(rows[0]["description"],"Build public products")
        self.assertEqual(rows[0]["date_opened"],"2026-10-20")
    def test_missing_description_is_explicit(self):
        rows=embedded_jobs(page([{"id":"123456","Posting_Title":"Engineer"}]))
        self.assertFalse(rows[0]["description_available"])
        self.assertIsNone(rows[0]["description"])
