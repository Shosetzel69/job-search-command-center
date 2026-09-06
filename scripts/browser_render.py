"""Bounded subprocess rendering; browser workers never inherit provider secrets."""

import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time

from web_transport import FetchError, MAX_BYTES

SLOTS = threading.BoundedSemaphore(3)
MAX_SECONDS = 20
ENV_NAMES = {"PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "SYSTEMROOT", "PLAYWRIGHT_BROWSERS_PATH"}


def safe_environment():
    return {key: value for key, value in os.environ.items() if key in ENV_NAMES}


def render(url, html, deadline):
    if not SLOTS.acquire(timeout=max(0, min(3, deadline - time.monotonic()))):
        raise FetchError("Browser capacity unavailable within source budget", "partial")
    process = None
    try:
        seconds = min(MAX_SECONDS, deadline - time.monotonic())
        if seconds < 2:
            raise FetchError("Insufficient source budget for browser", "partial")
        process = subprocess.Popen(
            [sys.executable, str(Path(__file__).with_name("browser_worker.py"))],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, env=safe_environment(), start_new_session=True,
        )
        payload = json.dumps({"url": url, "html": html, "seconds": seconds})
        try:
            output, _ = process.communicate(payload, timeout=seconds)
        except subprocess.TimeoutExpired as exc:
            raise FetchError("Browser rendering timed out", "partial") from exc
        if process.returncode:
            raise FetchError("Browser worker failed; check Playwright/Chromium installation")
        result = json.loads(output)
        if result.get("error"):
            raise FetchError(result["error"], result.get("kind", "error"))
        if not isinstance(result.get("html"), str) or len(result["html"].encode()) > MAX_BYTES:
            raise FetchError("Rendered page exceeds 2 MiB limit", "partial")
        return result
    except (OSError, ValueError) as exc:
        raise FetchError("Browser worker unavailable: " + type(exc).__name__) from exc
    finally:
        if process is not None:
            # Kill the complete session even if the driver exited before Chromium.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
        SLOTS.release()
