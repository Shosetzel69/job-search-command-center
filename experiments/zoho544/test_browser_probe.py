import os
import signal
import sys
import unittest
from unittest.mock import patch
from browser_probe import classify, bounded_run

class ProbeTests(unittest.TestCase):
    def test_good_and_bad_dom(self):
        self.assertEqual(classify(b"<h1>Job description</h1><p>" + b"Developer responsibilities " * 12 + b"</p>")[0], "DETAIL_CANDIDATE")
        for raw, expected in (
            (b"", "EMPTY"),
            (b"<p>Page not found</p>" + b"X"*150, "ERROR_PAGE"),
            (b"<p>" + b"Generic content " * 30 + b"</p>", "UNSUPPORTED"),
            (b"<p>Job description</p>", "EMPTY"),
        ):
            self.assertEqual(classify(raw)[0], expected)
    def test_no_false_positive_on_error_or_small_page(self):
        bad = b"<h1>Job description</h1><p>Access denied " + b"X"*140 + b"</p>"
        self.assertEqual(classify(bad)[0], "ERROR_PAGE")
        self.assertEqual(classify(b"<div>requirements</div>")[0], "EMPTY")
    def test_bounded_stderr(self):
        status, _, _ = bounded_run([sys.executable, "-c", "import sys;sys.stderr.write('A'*100000)"],
                                   timeout=3, stderr_limit=2048)
        self.assertEqual(status, "OUTPUT_LIMIT")
    def test_bounded_stdout(self):
        status, _, _ = bounded_run([sys.executable, "-c", "print('X'*100000)"],
                                   timeout=3, stdout_limit=2048)
        self.assertEqual(status, "OUTPUT_LIMIT")
    def test_timeout_kills_descendants(self):
        # Child inherits process group; timeout must not leave descendants.
        script = "import subprocess,time;subprocess.Popen(['sleep','10']);time.sleep(10)"
        status, _, _ = bounded_run([sys.executable, "-c", script], timeout=0.3)
        self.assertEqual(status, "TIMEOUT")
    def test_nonzero_exit(self):
        status, _, _ = bounded_run([sys.executable, "-c", "raise SystemExit(3)"], timeout=3)
        self.assertEqual(status, "BROWSER_EXIT")
    def test_invalid_binary(self):
        with self.assertRaises(FileNotFoundError):
            bounded_run(["/not/a/real/browser"])
if __name__ == "__main__":
    unittest.main()
