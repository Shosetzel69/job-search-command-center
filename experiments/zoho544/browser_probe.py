"""Temporary Zoho browser feasibility probe. No raw HTML is logged or persisted."""
import os
import re
import shutil
import signal
import subprocess
import tempfile
import time
from html.parser import HTMLParser

LIMIT_OUT = 3 * 1024 * 1024
LIMIT_ERR = 128 * 1024
TIMEOUT = 45
PAGES = (
    ("OSF", "https://osf-global.zohorecruit.com/jobs/Careers/67512000083366008/Back-End-Architect?source=CareerSite"),
    ("MADIFF", "https://madiffpl.zohorecruit.com/jobs/careers/300725000052385018/Senior-DevOps-Engineers?source=CareerSite"),
)
ERROR_MARKERS = ("page not found", "page is currently unavailable", "access denied", "not authorized")
DESCRIPTION_MARKERS = ("job description", "responsibilities", "requirements")

class Visible(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self.skip += 1
        if tag in ("p", "br", "div", "li", "h1", "h2", "h3"):
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript") and self.skip:
            self.skip -= 1

    def handle_data(self, value):
        if not self.skip:
            self.parts.append(value)

def classify(body):
    if not body:
        return "EMPTY", 0
    try:
        parser = Visible()
        parser.feed(body.decode("utf-8", "replace"))
        visible = " ".join("".join(parser.parts).split())
    except (ValueError, UnicodeError):
        return "INVALID", 0
    lower = visible.casefold()
    if any(marker in lower for marker in ERROR_MARKERS):
        return "ERROR_PAGE", len(visible)
    if len(visible) < 80:
        return "EMPTY", len(visible)
    if not any(marker in lower for marker in DESCRIPTION_MARKERS):
        return "UNSUPPORTED", len(visible)
    return "DETAIL_CANDIDATE", len(visible)

def bounded_run(argv, timeout=TIMEOUT, stdout_limit=LIMIT_OUT, stderr_limit=LIMIT_ERR):
    """Read both pipes incrementally; terminate entire process group on timeout/overflow."""
    import selectors
    proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    sel = selectors.DefaultSelector()
    outputs = {proc.stdout: bytearray(), proc.stderr: bytearray()}
    limits = {proc.stdout: stdout_limit, proc.stderr: stderr_limit}
    for stream in outputs:
        os.set_blocking(stream.fileno(), False)
        sel.register(stream, selectors.EVENT_READ)
    start = time.monotonic()
    status = "OK"
    try:
        while sel.get_map() or proc.poll() is None:
            if time.monotonic() - start >= timeout:
                status = "TIMEOUT"
                break
            for key, _ in sel.select(timeout=0.15):
                stream = key.fileobj
                chunk = os.read(stream.fileno(), min(65536, limits[stream] - len(outputs[stream]) + 1))
                if not chunk:
                    sel.unregister(stream)
                    continue
                if len(outputs[stream]) + len(chunk) > limits[stream]:
                    status = "OUTPUT_LIMIT"
                    break
                outputs[stream].extend(chunk)
            if status != "OK":
                break
        if status == "OK" and proc.returncode not in (0, None):
            status = "BROWSER_EXIT"
        return status, bytes(outputs[proc.stdout]), proc.returncode
    finally:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        sel.close()
        for stream in outputs:
            stream.close()

def main():
    browser = next((shutil.which(n) for n in ("google-chrome", "chromium", "chromium-browser") if shutil.which(n)), None)
    if not browser:
        print("BROWSER_MISSING")
        return 1
    version_status, version_out, _ = bounded_run([browser, "--version"], timeout=5, stdout_limit=2048, stderr_limit=2048)
    if version_status != "OK":
        print("BROWSER_VERSION_ERROR")
        return 1
    print("BROWSER_VERSION", version_out.decode("utf-8", "replace").strip()[:120])
    failures = 0
    for name, url in PAGES:
        with tempfile.TemporaryDirectory(prefix="zoho-544-") as profile:
            args = [browser, "--headless", "--disable-gpu", "--disable-extensions",
                    "--disable-background-networking", "--disable-sync",
                    "--disable-download-notification", "--no-first-run",
                    "--user-data-dir=" + profile, "--virtual-time-budget=12000",
                    "--dump-dom", url]
            status, output, returncode = bounded_run(args)
        if status == "OK":
            status, chars = classify(output)
        else:
            chars = 0
        print(f"TENANT={name} STATUS={status} VISIBLE_CHARS={chars} EXIT={returncode}")
        if status != "DETAIL_CANDIDATE":
            failures += 1
    print("RESULT=" + ("PASS_CANDIDATE" if failures == 0 else "FAIL"))
    return int(failures != 0)

if __name__ == "__main__":
    raise SystemExit(main())
