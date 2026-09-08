import os
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("publish_results.sh")
DATA_FILES = (
    "data/jobs.json",
    "data/run-status.json",
    "data/run-history.json",
    "data/search-state.json",
)


def run(command, cwd=None, env=None, check=True):
    return subprocess.run(
        command,
        cwd=cwd,
        env=env,
        check=check,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )


def configure_user(repo):
    run(["git", "config", "user.name", "test-user"], cwd=repo)
    run(["git", "config", "user.email", "test@example.invalid"], cwd=repo)


class PublishConcurrencyTests(unittest.TestCase):
    def test_retry_preserves_concurrent_docs_commit_and_publishes_generated_data(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            bare = root / "remote.git"
            seed = root / "seed"
            runner = root / "runner"
            concurrent = root / "concurrent"
            verify = root / "verify"
            marker = root / "reject-first-push"

            run(["git", "init", "--bare", "--initial-branch=main", str(bare)])
            run(["git", "init", "--initial-branch=main", str(seed)])
            configure_user(seed)

            for relative in DATA_FILES:
                path = seed / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('{"version":"old"}\n', encoding="utf-8")
            (seed / "docs").mkdir(parents=True, exist_ok=True)
            (seed / "docs" / "base.md").write_text("base\n", encoding="utf-8")
            (seed / "scripts").mkdir(parents=True, exist_ok=True)
            shutil.copy2(SCRIPT, seed / "scripts" / "publish_results.sh")

            run(["git", "add", "."], cwd=seed)
            run(["git", "commit", "-m", "seed"], cwd=seed)
            run(["git", "remote", "add", "origin", str(bare)], cwd=seed)
            run(["git", "push", "-u", "origin", "main"], cwd=seed)

            run(["git", "clone", str(bare), str(runner)])
            run(["git", "clone", str(bare), str(concurrent)])
            configure_user(runner)
            configure_user(concurrent)

            generated = {}
            for index, relative in enumerate(DATA_FILES, start=1):
                content = f'{{"version":"generated-{index}"}}\n'
                generated[relative] = content
                (runner / relative).write_text(content, encoding="utf-8")

            hook = bare / "hooks" / "pre-receive"
            hook.write_text(
                "#!/usr/bin/env bash\n"
                "set -e\n"
                f"marker={marker!s}\n"
                "if [ ! -f \"$marker\" ]; then\n"
                "  touch \"$marker\"\n"
                "  echo 'intentional first-push rejection' >&2\n"
                "  exit 1\n"
                "fi\n"
                "exit 0\n",
                encoding="utf-8",
            )
            hook.chmod(0o755)

            errors = []

            def publish_concurrent_docs_change():
                try:
                    deadline = time.time() + 10
                    while time.time() < deadline and not marker.exists():
                        time.sleep(0.02)
                    if not marker.exists():
                        raise AssertionError("first push rejection was not observed")
                    doc = concurrent / "docs" / "concurrent.md"
                    doc.write_text("concurrent documentation change\n", encoding="utf-8")
                    run(["git", "add", str(doc.relative_to(concurrent))], cwd=concurrent)
                    run(["git", "commit", "-m", "concurrent docs"], cwd=concurrent)
                    run(["git", "push", "origin", "main"], cwd=concurrent)
                except Exception as exc:  # pragma: no cover - surfaced below
                    errors.append(exc)

            thread = threading.Thread(target=publish_concurrent_docs_change, daemon=True)
            thread.start()
            env = os.environ.copy()
            env["PUBLISH_RETRY_SLEEP_BASE"] = "2"
            result = run(["bash", "scripts/publish_results.sh"], cwd=runner, env=env, check=False)
            thread.join(timeout=10)

            self.assertEqual(result.returncode, 0, result.stdout)
            self.assertFalse(thread.is_alive(), "concurrent publisher did not finish")
            self.assertFalse(errors, errors)
            self.assertIn("Publish attempt 2/3", result.stdout)
            self.assertIn("retrying from latest main", result.stdout)

            run(["git", "clone", str(bare), str(verify)])
            self.assertEqual(
                (verify / "docs" / "concurrent.md").read_text(encoding="utf-8"),
                "concurrent documentation change\n",
            )
            for relative, content in generated.items():
                self.assertEqual((verify / relative).read_text(encoding="utf-8"), content)

    def test_publication_script_never_force_pushes(self):
        text = SCRIPT.read_text(encoding="utf-8")
        self.assertNotIn("--force", text)
        self.assertNotIn("-f origin", text)


if __name__ == "__main__":
    unittest.main()
