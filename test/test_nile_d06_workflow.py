#!/usr/bin/env python3
"""Exact-workflow D06 admission and diagnostic fixture regression (offline; requires jq)."""
import copy
import json
import pathlib
import re
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/nile-feasibility-experiment.yml"
TEXT = WORKFLOW.read_text(encoding="utf-8")

def jq_programs():
    start = TEXT.index("      - name: Fail-closed pre-SQL image and port readback")
    end = TEXT.index("      - name: Synthetic Phase A", start)
    section = TEXT[start:end]
    programs = re.findall(r"--slurpfile img \"\$RUNNER_TEMP/nile-image.json\" '([\s\S]*?)' \"\$RUNNER_TEMP/nile-inspect.json\"", section)
    if len(programs) != 2:
        raise AssertionError(f"Expected exactly two exact workflow jq programs, got {len(programs)}")
    return programs

def fixture():
    name = "a" * 64
    ref = "ghcr.io/niledatabase/testingcontainer@sha256:" + "b" * 64
    container = {
        "Id": "c" * 64, "State": {"Running": True}, "Config": {
            "Image": ref, "Env": ["NILE_TESTING_DB_NAME=jobsearch_dev",
                                   "NILE_TESTING_DB_USER=00000000-0000-0000-0000-000000000000"]},
        "Image": "sha256:" + "d" * 64,
        "HostConfig": {"Binds": None, "Mounts": None, "VolumesFrom": None, "Tmpfs": None,
                       "PortBindings": {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "55432"}]}},
        "Mounts": [{"Type": "volume", "Name": name, "Destination": "/var/lib/postgresql/data",
                    "Driver": "local", "RW": True, "Mode": ""}],
        "NetworkSettings": {"Ports": {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "55432"}]}}
    }
    image = {"Id": container["Image"], "Config": {"Volumes": {"/var/lib/postgresql/data": {}}}}
    return [container], [image], ref

def evaluate(program, containers, images, ref):
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        img = pathlib.Path(tmp) / "image.json"
        img.write_text(json.dumps(images), encoding="utf-8")
        cmd = ["jq", "-c", "--arg", "image", ref, "--arg", "db", "jobsearch_dev",
               "--arg", "user", "00000000-0000-0000-0000-000000000000",
               "--slurpfile", "img", str(img), program]
        return subprocess.run(cmd, input=json.dumps(containers), text=True, capture_output=True)

class D06ExactWorkflowTest(unittest.TestCase):
    def test_exact_admission_and_diagnostics(self):
        admission, diagnostic = jq_programs()
        cases = {"positive": lambda c, i: None,
                 "bind": lambda c, i: c[0]["HostConfig"].update(Binds=["/host:/var/lib/postgresql/data"]),
                 "explicit_mount": lambda c, i: c[0]["HostConfig"].update(Mounts=[{"Type": "volume"}]),
                 "volumes_from": lambda c, i: c[0]["HostConfig"].update(VolumesFrom=["donor"]),
                 "tmpfs": lambda c, i: c[0]["HostConfig"].update(Tmpfs={"/extra": ""}),
                 "second_mount": lambda c, i: c[0]["Mounts"].append({"Type": "volume"}),
                 "named_volume": lambda c, i: c[0]["Mounts"][0].update(Name="named"),
                 "wrong_destination": lambda c, i: c[0]["Mounts"][0].update(Destination="/unexpected"),
                 "read_only": lambda c, i: c[0]["Mounts"][0].update(RW=False),
                 "wrong_driver": lambda c, i: c[0]["Mounts"][0].update(Driver="remote"),
                 "mode_z": lambda c, i: c[0]["Mounts"][0].update(Mode="z"),
                 "missing_image_volumes": lambda c, i: i[0]["Config"].update(Volumes=None),
                 "extra_image_volume": lambda c, i: i[0]["Config"]["Volumes"].update({"/extra": {}}),
                 "wrong_digest": lambda c, i: c[0].update(Image="sha256:" + "e"*64),
                 "two_containers": lambda c, i: c.append(copy.deepcopy(c[0])),
                 "wrong_port": lambda c, i: c[0]["NetworkSettings"].update(Ports={"5432/tcp":[{"HostIp":"0.0.0.0","HostPort":"55432"}]})}
        for label, mutate in cases.items():
            with self.subTest(label=label):
                containers, images, ref = fixture()
                mutate(containers, images)
                primary = evaluate(admission, containers, images, ref)
                diag = evaluate(diagnostic, containers, images, ref)
                admitted = primary.returncode == 0 and primary.stdout.strip() == "true"
                diag_ids = diag.stdout.splitlines()
                self.assertEqual(diag.returncode, 0, diag.stderr)
                self.assertEqual(admitted, len(diag_ids) == 0, (label, diag_ids))
                self.assertEqual(admitted, label == "positive", label)
                if label != "positive":
                    self.assertTrue(diag_ids, label)


class D06CleanupRecordTest(unittest.TestCase):
    def test_actual_workflow_record_line_writes_newline_not_literal_slash_n(self):
        import os
        import tempfile
        line = next(line.strip() for line in TEXT.splitlines()
                    if line.strip().startswith("printf ") and "jscc-nile-volume-name" in line)
        with tempfile.TemporaryDirectory() as temp:
            env = dict(os.environ, VOLUME_NAME="a" * 64, RUNNER_TEMP=temp)
            run = subprocess.run(["bash", "-e", "-c", line], env=env, capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertEqual((pathlib.Path(temp) / "jscc-nile-volume-name").read_bytes(),
                             (("a" * 64) + "\n").encode("ascii"))

    def test_cleanup_volume_list_contract_present(self):
        cleanup = TEXT.split("      - name: Always remove ephemeral container", 1)[1]
        self.assertIn('[[ "$VOLUME_NAME" =~ ^[0-9a-f]{64}$ ]]', cleanup)
        self.assertIn('VOLUME_LIST="$(docker volume ls -q)"', cleanup)
        self.assertIn('grep -Fxq -- "$VOLUME_NAME" <<< "$VOLUME_LIST"', cleanup)
        self.assertIn("NILE_VOLUME_DISPOSAL_BLOCKED:VOLUME_LIST_FAILED", cleanup)


    def test_execute_real_cleanup_volume_check_with_mock_docker(self):
        import os
        import tempfile
        cleanup = TEXT.split("      - name: Always remove ephemeral container", 1)[1]
        start = cleanup.index('          if [ -f "$RUNNER_TEMP/jscc-nile-volume-name" ]; then')
        end = cleanup.index("          echo 'NILE_CONTAINER_DISPOSAL=VERIFIED_ABSENT'", start)
        actual = "\n".join(line[10:] if line.startswith("          ") else line
                           for line in cleanup[start:end].splitlines())
        with tempfile.TemporaryDirectory() as temp:
            temp_path = pathlib.Path(temp)
            docker = temp_path / "docker"
            docker.write_text('#!/bin/sh\n'
                              'if [ "$1" = volume ] && [ "$2" = ls ] && [ "$3" = -q ] && [ "$#" = 3 ]; then\n'
                              '  [ "$MOCK_FAIL" = 1 ] && exit 125\n'
                              '  [ -n "$MOCK_VOLUMES" ] && printf "%s\n" "$MOCK_VOLUMES"\n'
                              '  exit 0\n'
                              'fi\n'
                              'exit 125\n')
            docker.chmod(0o755)
            record = temp_path / "jscc-nile-volume-name"
            volume = "a" * 64
            for label, saved, existing, fail, expected_success in [
                ("absent", volume, "", "0", True),
                ("still_present", volume, volume, "0", False),
                ("docker_error", volume, "", "1", False),
                ("corrupt_record", volume + r"\n", "", "0", False),
            ]:
                with self.subTest(case=label):
                    record.write_text(saved)
                    env = dict(os.environ, RUNNER_TEMP=temp,
                               PATH=temp + os.pathsep + os.environ["PATH"],
                               MOCK_VOLUMES=existing, MOCK_FAIL=fail)
                    result = subprocess.run(["bash", "-e", "-c", actual],
                                            env=env, text=True, capture_output=True)
                    self.assertEqual(result.returncode == 0, expected_success,
                                     result.stdout + result.stderr)
                    if expected_success:
                        self.assertIn("NILE_VOLUME_DISPOSAL=VERIFIED_ABSENT", result.stdout)
                    else:
                        self.assertNotIn("NILE_VOLUME_DISPOSAL=VERIFIED_ABSENT", result.stdout)

if __name__ == "__main__":
    unittest.main()
