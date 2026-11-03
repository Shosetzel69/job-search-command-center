# JSCC #593 — Workspace Manager limit 100 (source-only patch)

The live DEV Workspace Manager currently applies `MAX_FILES=80` in
`service/common.py`, using a GCS snapshot of `workspace/v3/`.
Its source is present in the **deployed manager image**, but not in this
repository's `main` tree. This change intentionally does **not**
fabricate a manager image, replace the active gateway, or silently deploy.

## Apply to the verified image source

1. Extract the exact active `jscc-dev-workspace-manager` image source into an
   isolated directory, record its immutable digest and file SHA256.
2. Run tests: `python3 -m unittest discover -s tests -p 'test_workspace_manager_cap_patch.py'`
3. Dry run:
   `python3 scripts/gcp/patch_workspace_manager_limit.py --source-dir /path/to/manager`
4. Apply the source-only patch:
   `python3 scripts/gcp/patch_workspace_manager_limit.py --source-dir /path/to/manager --apply`
5. Confirm the **exact source diff**, build an image pinned to the reviewed source,
   and run manager acceptance tests at **99/100/101** objects (99/100 accepted;
   101 rejected), including boundary cases and regressions.
6. After independent review and owner-authorized DEV deploy, verify *effective*
   Cloud Run traffic revision and immutable image digest; rollback if needed.

Preserve `MAX_FILE=128KiB`, `MAX_TOTAL=2MiB`, all other limit/path/auth
checks, HTTP rejection semantics, sandbox isolation and OAuth.
No TEST/PROD changes. No new paid resources. No unapproved deployment.

**Important:** this PR provides a fail-closed patch and tests for its
transformation. It does not yet deliver runtime boundary tests or a
deployable exact-source manager image. Those are necessary acceptance gates.
