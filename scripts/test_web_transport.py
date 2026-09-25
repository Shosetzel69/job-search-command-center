import time
import unittest
from unittest.mock import patch

import web_transport


class _Socket:
    def settimeout(self, value):
        return None


class _Response:
    status = 200
    def __init__(self):
        self._reads = [b"<html></html>", b""]
    def getheaders(self):
        return [("Content-Type","text/html")]
    def read1(self, size):
        return self._reads.pop(0)


class _Connection:
    target = None
    def __init__(self, host, address, port, timeout, secure):
        self.sock = _Socket()
    def request(self, method, target, headers=None):
        type(self).target = target
    def getresponse(self):
        return _Response()
    def close(self):
        pass


class WebTransportTests(unittest.TestCase):
    def setUp(self):
        web_transport.HOST_LOCKS.clear()
        web_transport.HOST_LAST.clear()
        _Connection.target = None

    def test_unicode_path_and_query_are_percent_encoded_before_http_request(self):
        with patch.object(web_transport,"public_addresses",return_value=["203.0.113.10"]), \
             patch.object(web_transport,"PinnedHTTP",_Connection):
            status, _, body = web_transport.request_once(
                "https://example.com/job/Project–Manager?city=București",
                time.monotonic()+5,
                delay=0,
            )
        self.assertEqual(status,200)
        self.assertEqual(body,b"<html></html>")
        self.assertIn("Project%E2%80%93Manager",_Connection.target)
        self.assertIn("Bucure%C8%99ti",_Connection.target)
        self.assertNotIn("–",_Connection.target)
        self.assertNotIn("ș",_Connection.target)


if __name__ == "__main__":
    unittest.main()
