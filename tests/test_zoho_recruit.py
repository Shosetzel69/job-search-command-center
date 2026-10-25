import io
import unittest
import job_search_zoho_recruit as zoho

BOARD = "https://alpha.zohorecruit.com/careers"
LIST = b'<a href="/recruit/PortalDetail.na?jobid=123456&digest=PUBLIC_TOKEN&widgetid=123456&embedsource=CareerSite">Engineer</a><a href="/recruit/PortalDetail.na?jobid=123456">Duplicate</a>'
DETAIL = b'<h1>Engineer</h1><p>Full time | Acme</p><h3>Job Description</h3><p>Public role description</p><h3>Requirements</h3><p>Python skills</p>'
class Resp(io.BytesIO):
    def __init__(self, body, url):
        super().__init__(body)
        self.url = url
    def geturl(self): return self.url
    def __enter__(self): return self
    def __exit__(self, *args): self.close()
def opener(req, timeout):
    return Resp(LIST if req.full_url.endswith("/careers") else DETAIL, req.full_url)
class TestZoho(unittest.TestCase):
    def test_url(self):
        self.assertEqual(zoho.validate_board(BOARD), BOARD)
        with self.assertRaises(ValueError): zoho.validate_board("https://evil.com/careers")
    def test_duplicate_jobid(self):
        rows = zoho.collect(BOARD, "Acme", opener=opener)
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]["id"].endswith(":123456"))
        self.assertIn("Public role description", rows[0]["description"])
        self.assertIn("Python skills", rows[0]["description"])
        self.assertNotIn("digest=", rows[0]["source_url"])
    def test_second_tenant(self):
        rows = zoho.collect("https://beta.zohorecruit.com/careers","Other",opener=opener)
        self.assertIn("beta.zohorecruit.com",rows[0]["id"])
    def test_empty(self):
        self.assertEqual(zoho.collect(BOARD,"Acme",opener=lambda req,timeout:Resp(b"<html>No openings</html>",req.full_url)),[])
    def test_malformed(self):
        with self.assertRaises(ValueError):
            zoho.enumerate_board('<a href="/recruit/PortalDetail.na?jobid=invalid">Bad</a>', BOARD)
    def test_large(self):
        with self.assertRaises(ValueError):
            zoho.collect(BOARD,"Acme",opener=lambda req,timeout:Resp(b"x"*(zoho.MAX_BYTES+1),req.full_url))
    def test_detail_missing(self):
        def broken(req,timeout): return Resp(LIST if req.full_url.endswith("/careers") else b'<h1>Missing</h1>',req.full_url)
        with self.assertRaises(ValueError): zoho.collect(BOARD,"Acme",opener=broken)

    def test_redirect_handler_fails_closed(self):
        from urllib.request import Request
        import job_search_zoho_recruit as m
        handler=m._NoRedirect()
        self.assertIsNone(handler.redirect_request(Request(BOARD), None, 302, "Found", {}, "https://evil.com/"))
    def test_redirect_off_tenant(self):
        class Redirect(Resp):
            def geturl(self): return "https://evil.com/"
        with self.assertRaises(ValueError): zoho.collect(BOARD,"Acme",opener=lambda req,timeout:Redirect(LIST,req.full_url))


class ModernZohoTests(unittest.TestCase):
    def test_modern_public_jobs_with_description(self):
        import json
        from html import escape
        items = [{"id": "866885000000930001",
                  "Posting_Title": "IT Project Manager",
                  "Job_Type": "Full time", "Date_Opened": "2026-09-02",
                  "Job_Description": "<p>Plan deliveries and control risks.</p>"}]
        modern = ('<input id="jobs" value="' + escape(json.dumps(items), quote=True) + '">').encode()
        def mock(req, timeout):
            return Resp(b"<html>Modern careers</html>" if req.full_url.endswith("/careers") else modern, req.full_url)
        rows = zoho.collect(BOARD, "MyEmployment", opener=mock)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["job_title"], "IT Project Manager")
        self.assertEqual(rows[0]["description_completeness"], "partial")
        self.assertEqual(rows[0]["description_provenance"], "public_modern_jobs_json")
        self.assertNotIn("<p>", rows[0]["description"])

    def test_modern_without_description_rejected(self):
        import json
        from html import escape
        modern = ('<input id="jobs" value="' + escape(json.dumps([
            {"id": "300725000052438066", "Posting_Title": "Android Developer"}
        ]), quote=True) + '">').encode()
        def mock(req, timeout):
            return Resp(b"<html>Modern careers</html>" if req.full_url.endswith("/careers") else modern, req.full_url)
        with self.assertRaisesRegex(ValueError, "lacks descriptions"):
            zoho.collect(BOARD, "MADIFF", opener=mock)

class PaginationSafetyTests(unittest.TestCase):

    def test_capped_portal_board_fails_closed(self):
        links = "".join(
            '<a href="/recruit/PortalDetail.na?jobid={0}&digest=token_{0}&widgetid=123456">Role</a>'.format(100000+i)
            for i in range(100)
        ).encode()
        with self.assertRaisesRegex(ValueError, "pagination required"):
            zoho.collect(BOARD, "Acme", opener=lambda req,timeout:Resp(links,req.full_url))

class PrescreenTests(unittest.TestCase):
    def test_conservative_scope(self):
        rows = [{"job_title":"IT Project Manager"}, {"job_title":"Android Developer"},
                {"job_title":"Technology Consultant"}, {"job_title":"Delivery Manager"}]
        picked = zoho.prefilter_public_metadata(rows, role_family="PROJECT_MANAGEMENT")
        self.assertEqual([r["job_title"] for r in picked],
                         ["IT Project Manager","Technology Consultant","Delivery Manager"])
        self.assertEqual(len(zoho.prefilter_public_metadata(rows)), 4)


class ScopedMetadataTests(unittest.TestCase):

    def test_scoped_detail_fetch_only_for_candidates(self):
        import json
        from html import escape
        listing = b'<a href="/recruit/PortalDetail.na?jobid=123456&digest=tok_1&widgetid=123456">IT Project Manager</a><a href="/recruit/PortalDetail.na?jobid=234567&digest=tok_2&widgetid=123456">Android Developer</a>'
        modern = ('<input id="jobs" value="' + escape(json.dumps([
            {"id":"123456","Posting_Title":"IT Project Manager","Publish":True},
            {"id":"234567","Posting_Title":"Android Developer","Publish":True}
        ]), quote=True) + '">').encode()
        calls=[]
        def mocked(req,timeout):
            calls.append(req.full_url)
            if req.full_url.endswith("/careers"): body=listing
            elif req.full_url.endswith("/jobs/Careers"): body=modern
            else: body=DETAIL
            return Resp(body,req.full_url)
        rows=zoho.collect(BOARD,"Acme",opener=mocked,role_family="PROJECT_MANAGEMENT")
        self.assertEqual(len(rows),1)
        self.assertEqual(sum("/recruit/PortalDetail.na" in x for x in calls),1)
        self.assertTrue(rows[0]["id"].endswith("123456"))

    def test_relevant_missing_public_detail_link_fails_closed(self):
        import json
        from html import escape
        html = ('<input id="jobs" value="' + escape(json.dumps([
            {"id":"123456789", "Posting_Title":"IT Project Manager",
             "Publish": True, "Job_Description":""}
        ]), quote=True) + '">').encode()
        def mocked(req, timeout):
            body = b'<a href="/recruit/PortalDetail.na?jobid=111111&digest=abc&widgetid=123456">Software Engineer</a>' if req.full_url.endswith("/careers") else html
            return Resp(body, req.full_url)
        records = zoho.collect(BOARD, "Acme", opener=mocked, role_family="PROJECT_MANAGEMENT")
        missing = [row for row in records if row["description_completeness"] == "missing"]
        self.assertEqual(len(missing), 1)
        self.assertEqual(missing[0]["job_title"], "IT Project Manager")
        self.assertEqual(missing[0]["description"], "")

class ScopedModernOnlyTests(unittest.TestCase):

    def test_scoped_modern_only_tenant(self):
        import json
        from html import escape
        items=[
            {"id":"866885000000930001","Posting_Title":"IT Project Manager",
             "Job_Description":"<p>Manage milestones and risks.</p>"},
            {"id":"866885000000930002","Posting_Title":"Android Developer",
             "Job_Description":"<p>Build Android apps.</p>"},
        ]
        html=('<input id="jobs" value="'+escape(json.dumps(items),quote=True)+'">').encode()
        def mocked(req,timeout):
            return Resp(b"<html>Modern careers</html>" if req.full_url.endswith("/careers") else html,req.full_url)
        rows=zoho.collect(BOARD,"Modern",opener=mocked,role_family="PROJECT_MANAGEMENT")
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"IT Project Manager")
