#!/usr/bin/env python3
"""Fail-closed, source-only patch for JSCC #593's deployed Workspace Manager.

This does NOT deploy a service, modify Cloud Run, or change GCS objects.
"""
import argparse
from pathlib import Path
import re
import sys

TARGET = Path("service/common.py")
OLD = 80
NEW = 100
LIMIT_PATTERN = re.compile(r"^(?P<indent>[ \t]*)MAX_FILES(?P<space>[ \t]*)=(?P<after>[ \t]*)(?P<value>\d+)(?P<tail>[ \t]*(?:#.*)?)$", re.M)


def patch_text(source: str, apply: bool = False) -> tuple[str, str]:
    matches = list(LIMIT_PATTERN.finditer(source))
    if len(matches) != 1:
        raise ValueError(f"expected exactly one MAX_FILES declaration, got {len(matches)}")
    match = matches[0]
    value = int(match.group("value"))
    if value == NEW:
        return source, "ALREADY_100"
    if value != OLD:
        raise ValueError(f"unexpected MAX_FILES={value}: refuse to patch")
    replacement = (
        match.group("indent") + "MAX_FILES" + match.group("space") + "="
        + match.group("after") + str(NEW) + match.group("tail")
    )
    changed = source[:match.start()] + replacement + source[match.end():]
    return (changed if apply else source), "PATCH_READY"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True,
                        help="root of verified extracted jscc-dev-workspace-manager image source")
    parser.add_argument("--apply", action="store_true", help="modify ONLY service/common.py (default: dry run)")
    args = parser.parse_args()
    target = args.source_dir / TARGET
    if not target.is_file() or target.is_symlink():
        parser.error(f"missing or symlink source file: {target}")
    raw = target.read_bytes()
    source = raw.decode("utf-8")
    new_text, status = patch_text(source, apply=args.apply)
    if args.apply and status == "PATCH_READY":
        original_mode = target.stat().st_mode
        tmp = target.with_name(target.name + ".jscc593.tmp")
        if tmp.exists():
            parser.error(f"temporary file already exists: {tmp}")
        try:
            with tmp.open("xb") as f:
                f.write(new_text.encode("utf-8"))
            tmp.chmod(original_mode)
            tmp.replace(target)
        finally:
            if tmp.exists():
                tmp.unlink()
        print("SOURCE_PATCH_APPLIED: MAX_FILES=100")
    else:
        print("SOURCE_STATUS:", status, "APPLY:", args.apply)
    print("SCOPE: source-only; no build, deploy, GCS mutation, or runtime change")
    return 0


if __name__ == "__main__":
    sys.exit(main())
