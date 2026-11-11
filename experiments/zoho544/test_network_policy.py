import unittest
from network_policy import authorize_connect, authorize_navigation

class NetworkPolicyTests(unittest.TestCase):
    def test_connect_only_named_hosts_443(self):
        for host in ("osf-global.zohorecruit.com", "madiffpl.zohorecruit.com"):
            self.assertTrue(authorize_connect(host+":443"))
        for item in ("evil.example:443", "osf-global.zohorecruit.com:80",
                     "osf-global.zohorecruit.com:444",
                     "osf-global.zohorecruit.com.evil.example:443",
                     "user@osf-global.zohorecruit.com:443",
                     "osf-global.zohorecruit.com:443/path",
                     "127.0.0.1:443", "[::1]:443", "metadata.google.internal:443",
                     "osf-global.zohorecruit.com:443 ", ""):
            self.assertFalse(authorize_connect(item), item)
    def test_navigation_redirect_targets(self):
        self.assertTrue(authorize_navigation("https://osf-global.zohorecruit.com/jobs/Careers/12"))
        for target in ("http://osf-global.zohorecruit.com/",
                       "https://evil.example/",
                       "https://madiffpl.zohorecruit.com.evil.example/",
                       "https://127.0.0.1/",
                       "file:///etc/passwd",
                       "data:text/html,hello"):
            self.assertFalse(authorize_navigation(target),target)
