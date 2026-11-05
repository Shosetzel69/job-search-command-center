import json
import os
import pathlib
import subprocess
import tempfile
import textwrap
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/gcp/repair_remote_executor_dev_task_iam.sh"
READER = "jscc-diagnostics-dev@jscc-dev.iam.gserviceaccount.com"
ROLE = "projects/jscc-dev/roles/jsccDiagnosticsExecutionReaderDev"

FAKE_GCLOUD = textwrap.dedent("""\
#!/usr/bin/env python3
import json,os,pathlib,sys
args=sys.argv[1:]
log=pathlib.Path(os.environ["FAKE_LOG"])
with log.open("a",encoding="utf-8") as f: f.write(json.dumps(args)+"\\n")
state=pathlib.Path(os.environ["FAKE_STATE"])
current=state.read_text().strip()
if args[:3]==["run","jobs","describe"]:
    name=os.environ.get("FAKE_SA","jscc-diagnostics-dev@jscc-dev.iam.gserviceaccount.com")
    print(json.dumps({"template":{"template":{"serviceAccount":name}}}))
elif args[:3]==["iam","roles","describe"]:
    perms=["run.executions.get","run.tasks.list"]
    if os.environ.get("FAKE_ROLE_MISSING")=="1": perms=["run.executions.get"]
    if os.environ.get("FAKE_ROLE_MUTATING")=="1": perms.append("run.jobs.update")
    print(json.dumps({"includedPermissions":perms}))
elif args[:3]==["run","jobs","get-iam-policy"]:
    bindings=[]
    if current in ("PRESENT","CONDITIONAL"):
        row={"role":"projects/jscc-dev/roles/jsccDiagnosticsExecutionReaderDev",
             "members":["serviceAccount:jscc-diagnostics-dev@jscc-dev.iam.gserviceaccount.com"]}
        if current=="CONDITIONAL": row["condition"]={"expression":"request.time < timestamp('2030-01-01T00:00:00Z')"}
        bindings=[row]
    print(json.dumps({"bindings":bindings}))
elif args[:3]==["run","jobs","add-iam-policy-binding"]:
    assert "--project=jscc-dev" in args
    assert "--region=europe-west1" in args
    assert "--condition=None" in args
    assert "--role=projects/jscc-dev/roles/jsccDiagnosticsExecutionReaderDev" in args
    assert "--member=serviceAccount:jscc-diagnostics-dev@jscc-dev.iam.gserviceaccount.com" in args
    assert args[3]=="jscc-diagnostics-dev"
    state.write_text("PRESENT")
    print("updated")
else:
    print("Unexpected command: "+str(args),file=sys.stderr)
    sys.exit(80)
""")

class DevTaskIAMRepairTests(unittest.TestCase):
    def run_case(self, args, state="PRESENT", extra=None):
        with tempfile.TemporaryDirectory(prefix="jscc589-iam-") as temp:
            folder=pathlib.Path(temp)
            binary=folder/"gcloud"
            binary.write_text(FAKE_GCLOUD)
            binary.chmod(0o755)
            statefile=folder/"state"
            statefile.write_text(state)
            log=folder/"commands.jsonl"
            env={**os.environ,"PATH":str(folder)+os.pathsep+os.environ["PATH"],
                 "FAKE_LOG":str(log),"FAKE_STATE":str(statefile)}
            env.update(extra or {})
            result=subprocess.run(["bash",str(SCRIPT)]+args,env=env,
                capture_output=True,text=True,timeout=15)
            commands=[json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
            return result,commands,statefile.read_text()

    def assert_scoped(self,commands):
        for command in commands:
            self.assertFalse(command[:2]==["projects","add-iam-policy-binding"])
            self.assertFalse(command[:3]==["run","services","add-iam-policy-binding"])
            self.assertNotIn("--project=jscc-prod",command)
            self.assertNotIn("--region=us-central1",command)

    def test_read_only_check_existing_binding(self):
        r,commands,state=self.run_case(["--check"])
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertIn("EFFECTIVE_ACCESS_UNVERIFIED",r.stdout)
        self.assertNotIn("APPLYING",r.stdout)
        self.assertFalse(any(x[:3]==["run","jobs","add-iam-policy-binding"] for x in commands))
        self.assert_scoped(commands)

    def test_missing_binding_read_only_does_not_mutate(self):
        r,commands,state=self.run_case(["--check"],state="MISSING")
        self.assertEqual(r.returncode,7)
        self.assertEqual(state,"MISSING")
        self.assertFalse(any("add-iam-policy-binding" in x for command in commands for x in command))
        self.assert_scoped(commands)

    def test_apply_repairs_only_fixed_dev_job(self):
        r,commands,state=self.run_case(["--apply"],state="MISSING")
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(state,"PRESENT")
        changes=[x for x in commands if x[:3]==["run","jobs","add-iam-policy-binding"]]
        self.assertEqual(len(changes),1)
        self.assertEqual(changes[0][3],"jscc-diagnostics-dev")
        self.assertIn("JOB_BINDING_APPLIED_AND_CONFIRMED",r.stdout)
        self.assert_scoped(commands)

    def test_apply_is_idempotent(self):
        r,commands,state=self.run_case(["--apply"])
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(state,"PRESENT")
        self.assertFalse(any("add-iam-policy-binding" in x for command in commands for x in command))

    def test_refuse_conditional_binding_even_in_apply_mode(self):
        r,commands,state=self.run_case(["--apply"],state="CONDITIONAL")
        self.assertEqual(r.returncode,6)
        self.assertEqual(state,"CONDITIONAL")
        self.assertFalse(any("add-iam-policy-binding" in x for command in commands for x in command))

    def test_refuse_wrong_job_identity_and_incomplete_role(self):
        for extra,expected in [
            ({"FAKE_SA":"wrong@jscc-dev.iam.gserviceaccount.com"},4),
            ({"FAKE_ROLE_MISSING":"1"},5),
            ({"FAKE_ROLE_MUTATING":"1"},5),
        ]:
            with self.subTest(extra=extra):
                r,commands,state=self.run_case(["--apply"],state="MISSING",extra=extra)
                self.assertEqual(r.returncode,expected,r.stderr)
                self.assertEqual(state,"MISSING")
                self.assertFalse(any("add-iam-policy-binding" in x for command in commands for x in command))

    def test_invalid_flag_is_rejected_before_cloud_access(self):
        r,commands,_=self.run_case(["--project=jscc-prod"],state="MISSING")
        self.assertEqual(r.returncode,64)
        self.assertEqual(commands,[])

if __name__=="__main__":
    unittest.main()
