"""Compatibility for unscoped legacy runtime seeds (JS migrateRoleCriteria parity)."""
import json
from pathlib import Path

LEGACY = {
    "PROJECT_MANAGEMENT": ("PROJECT_DELIVERY_MANAGEMENT", ["project_management"]),
    "DELIVERY": ("PROJECT_DELIVERY_MANAGEMENT", ["delivery_management"]),
    "PROGRAM_PMO": ("PROJECT_DELIVERY_MANAGEMENT", ["program_management", "pmo"]),
    "SERVICE_MANAGEMENT": ("SERVICE_OPERATIONS_MANAGEMENT", ["service_management"]),
    "SCRUM_AGILE": ("PRODUCT_AGILE", ["agile_scrum"]),
}
GROUPS = {"pm": "PROJECT_MANAGEMENT", "delivery": "DELIVERY", "program": "PROGRAM_PMO",
          "service": "SERVICE_MANAGEMENT", "scrum": "SCRUM_AGILE"}
LEGACY_SUB = {
    "project_manager": ["project_management"], "it_project_manager": ["project_management"],
    "technical_project_manager": ["project_management"], "agile_project_manager": ["project_management"],
    "delivery_manager": ["delivery_management"], "technical_delivery_manager": ["delivery_management"],
    "program_manager": ["program_management"], "technical_program_manager": ["program_management"],
    "pmo_manager": ["pmo"], "service_manager": ["service_management"],
    "service_delivery_manager": ["service_management"], "scrum_master": ["agile_scrum"],
}


def normalize_unscoped_seed(config, taxonomy_path):
    """Convert legacy criteria without truncating >2 system-wide families."""
    if not isinstance(config, dict):
        raise ValueError("Seed must be an object")
    groups = config.get("role_groups", {})
    if not isinstance(groups, dict) or any(g not in GROUPS or not isinstance(v, dict)
                                           or not isinstance(v.get("enabled", False), bool)
                                           for g, v in groups.items()):
        raise ValueError("Invalid legacy role_groups")
    families_in = config.get("target_role_families", [])
    sub_in = config.get("target_role_subfamilies", [])
    if not isinstance(families_in, list) or not isinstance(sub_in, list) or any(
        not isinstance(x, str) for x in families_in + sub_in
    ):
        raise ValueError("Invalid role selection")
    taxonomy = json.loads(Path(taxonomy_path).read_text(encoding="utf-8"))
    family_order = [f for f in taxonomy["canonical_families"] if f != "UNKNOWN"]
    sub_order = [m["code"] for f in family_order for m in taxonomy["families"][f]["members"]]
    owners = {m["code"]: f for f in family_order for m in taxonomy["families"][f]["members"]}
    chosen_f, chosen_s = set(), set()

    def select_sub(s):
        if s not in owners:
            raise ValueError("Unsupported subfamily")
        chosen_f.add(owners[s])
        chosen_s.add(s)

    for f in families_in:
        code = f.strip().upper()
        if code in family_order:
            chosen_f.add(code)
        elif code in LEGACY:
            chosen_f.add(LEGACY[code][0])
            chosen_s.update(LEGACY[code][1])
        else:
            raise ValueError("Unsupported family")
    for group, value in groups.items():
        if value.get("enabled") is True:
            family, members = LEGACY[GROUPS[group]]
            chosen_f.add(family)
            chosen_s.update(members)
    for s in sub_in:
        if s in LEGACY_SUB:
            for target in LEGACY_SUB[s]:
                select_sub(target)
        else:
            select_sub(s)
    if not chosen_f:
        raise ValueError("Unscoped seed selects no families")
    for f in chosen_f:
        if not any(owners[s] == f for s in chosen_s):
            chosen_s.update(s for s in sub_order if owners[s] == f)
    result = dict(config)
    result.pop("role_groups", None)
    result["target_role_families"] = [f for f in family_order if f in chosen_f]
    result["target_role_subfamilies"] = [s for s in sub_order if s in chosen_s]
    return result
