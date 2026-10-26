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

if __name__ == "__main__":
    unittest.main()
