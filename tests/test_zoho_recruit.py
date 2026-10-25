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
