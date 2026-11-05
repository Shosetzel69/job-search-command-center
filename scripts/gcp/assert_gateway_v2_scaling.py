#!/usr/bin/env python3
"""ADR-009: assert Cloud Run Admin API v2 gateway service scaling, no CLI schema fallback."""
import json
import sys


def verify(payload):
    if not isinstance(payload, dict):
        raise ValueError("v2 service response must be an object")
    # The gateway contract is the service-level maximum (not the revision-level maximum).
    value = (payload.get("scaling") or {}).get("maxInstanceCount")
    if value != 1 and value != "1":
        raise ValueError("v2 scaling.maxInstanceCount must equal 1")
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
