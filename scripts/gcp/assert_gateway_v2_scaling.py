#!/usr/bin/env python3
"""ADR-009: assert Cloud Run Admin API v2 gateway revision scaling, no CLI schema fallback."""
import json
import sys


def verify(payload):
    if not isinstance(payload, dict):
        raise ValueError("v2 service response must be an object")
    # --max-instances is revision-level scaling in the Service template.
    value = ((payload.get("template") or {}).get("scaling") or {}).get("maxInstanceCount")
    if value != 1 and value != "1":
        raise ValueError("v2 template.scaling.maxInstanceCount must equal 1")
    return True


def main():
    try:
        verify(json.load(sys.stdin))
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        print("FAIL gateway v2 template.scaling.maxInstanceCount = 1: " + str(error), file=sys.stderr)
        return 1
    print("PASS gateway v2 template.scaling.maxInstanceCount = 1")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
