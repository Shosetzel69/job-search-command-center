#!/usr/bin/env python3
"""Fail-closed scope admission for the owner-authorized GOV85 DEV exception.

This admission check is NOT permission to build, deploy, migrate or change IAM.
It intentionally does not modify legacy exit-86 guards. The reviewed caller
must separately attest runtime/image state and obtain operation-specific gates.
"""
import argparse
import json
import re
import sys

CANDIDATE_SHA = "121f88e212013d2c4665bb70f881a3bcee365d21"
ALLOWED_TICKETS = ("515", "520", "535")
ALLOWED_ACTIONS = ("preflight", "build-images")
BUILD_CONFIRMATION = "APPROVE_GOV85_DEV_IMAGES_121F88"


def admit(*, environment: str, candidate_sha: str, tickets: str, action: str, owner_gate: str = "") -> dict:
    requested = tickets.split(",")
    if (
        environment != "dev"
        or candidate_sha != CANDIDATE_SHA
        or not re.fullmatch(r"[0-9a-f]{40}", candidate_sha)
        or tuple(requested) != ALLOWED_TICKETS
        or action not in ALLOWED_ACTIONS
        or (action == "build-images" and owner_gate != BUILD_CONFIRMATION)
        or (action == "preflight" and bool(owner_gate))
    ):
        raise ValueError("GOV85_DEV_EXCEPTION_DENIED")
    return {
        "decision": "GOV85_DEV_SCOPED_PREFLIGHT_ADMITTED",
        "environment": "dev",
        "candidate_sha": CANDIDATE_SHA,
        "ticket_roots": list(ALLOWED_TICKETS),
        "accepted_scope": [
            "515: responsive source already merged, UX E2E pending",
            "520: F520-06 only; F520-01 excluded",
            "535: pagination PR616 only; FIT PR591 excluded",
        ],
        "allowed_action": action,
        "build_authorized": action == "build-images",
        "deploy_authorized": False,
        "legacy_exit86_override": False,
        "database_migration_authorized": False,
        "iam_change_authorized": False,
        "test_prod_authorized": False,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", required=True)
    parser.add_argument("--candidate-sha", required=True)
    parser.add_argument("--tickets", required=True)
    parser.add_argument("--action", required=True)
    parser.add_argument("--owner-gate", default="")
    args = parser.parse_args(argv)
    try:
        proof = admit(
            environment=args.environment,
            candidate_sha=args.candidate_sha,
            tickets=args.tickets,
            action=args.action,
            owner_gate=args.owner_gate,
        )
    except ValueError:
        print("GOV85_DEV_EXCEPTION_DENIED", file=sys.stderr)
        return 86
    print(json.dumps(proof, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
