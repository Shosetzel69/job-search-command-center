import json
from pathlib import Path

PATH = Path("data/sources.json")
DISABLED = {
    "NTT",
    "Allianz Careers",
    "Fortive",
    "ClickHouse",
}

catalog = json.loads(PATH.read_text(encoding="utf-8"))
sources = catalog.get("sources")
if not isinstance(sources, list):
    raise SystemExit("data/sources.json must contain a sources array")

found = set()
changed = []
for source in sources:
    name = source.get("name")
    if name in DISABLED:
        found.add(name)
        if source.get("active") is not False:
            source["active"] = False
            changed.append(name)

missing = DISABLED - found
if missing:
    raise SystemExit("Missing expected sources: " + ", ".join(sorted(missing)))

catalog["count"] = len(sources)
PATH.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Disabled: " + (", ".join(sorted(changed)) if changed else "no changes"))
