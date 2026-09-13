#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Missing marker in {path}: {old[:80]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


def append_once(path: str, marker: str, block: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    if marker in text:
        return
    target.write_text(text.rstrip() + "\n\n" + block.strip() + "\n", encoding="utf-8")


# ARCHITECTURE.md
replace_once("ARCHITECTURE.md", "Versiune document: `v1.12`", "Versiune document: `v1.13`")
append_once(
    "ARCHITECTURE.md",
    "## 20. Phase 3 - Environment automation (#161)",
    r'''## 20. Phase 3 - Environment automation (#161)

Gate G2 este PASS. Phase 3 introduce automatizarea parametrizata fara provisioning de resurse si fara mutarea PROD.

Artefacte canonice:

```text
config/environments.json
scripts/environment.mjs
scripts/environment/contract.mjs
scripts/environment/plans.mjs
scripts/environment/report.mjs
.github/workflows/deploy-environment.yml
```

Contract:
- environment-ul este obligatoriu si poate fi numai `dev|test|prod`;
- `SOURCE_SHA` este obligatoriu si trebuie sa fie SHA complet immutable;
- runtime repository este mapat canonic per environment;
- DEV foloseste `SEARCH_MODE=disabled`, TEST `smoke`, PROD `live`;
- lipsa account ID / credential / origin produce FAIL;
- `bootstrap-all` include structural numai DEV + TEST;
- orice operatie PROD necesita owner gate explicit;
- Phase 3 permite numai validate/dry-run; live bootstrap/deploy ramane blocat pana la faza environment-specific;
- runtime data seed se deriva din `shared/runtime-data.mjs`, nu din trei liste copiate;
- nicio resursa runtime DEV/TEST/PROD nu este creata de Phase 3.

Workflow-ul `deploy-environment.yml` este manual-only si `dry_run=true` implicit. G3 cere validarea statica/dry-run pentru toate cele trei environments si zero mutatii PROD.

**Gate G3:** automation + CI + dry-run PASS. Dupa G3 se opreste; bootstrap DEV necesita Phase 4 / GO conform planului #161.''',
)

# Provisioning runbook
replace_once(
    "docs/environment-provisioning-runbook.md",
    "Status: Planned / implementation gate",
    "Status: Phase 3 automation implemented / provisioning not started",
)
replace_once(
    "docs/environment-provisioning-runbook.md",
    "## 6. Environment tool - contract\n\nUn singur entry point, de exemplu:",
    "## 6. Environment tool - contract\n\nPhase 3 status: contractul parametrizat, manifestul canonic, comenzile npm si workflow-ul generic dry-run sunt implementate. Live provisioning/deploy este blocat intentionat pana la Phase 4/5/6; Phase 3 nu creeaza si nu modifica resurse runtime.\n\nUn singur entry point, de exemplu:",
)

# Command API docs: no API change, but automation consumes the identity contract.
append_once(
    "docs/command-api.md",
    "## Environment automation - Phase 3 / #161",
    r'''## Environment automation - Phase 3 / #161

Phase 3 nu modifica endpoint-urile Command API. Automatizarea foloseste contractul identity introdus in Phase 2 si il trateaza ca input obligatoriu pentru viitoarele deploy-uri environment-specific.

Manifest: `config/environments.json`.

CLI: `scripts/environment.mjs`.

Reguli relevante pentru Command API:
- `APP_ENV`, runtime repo/ref, `SOURCE_SHA`, `RUNTIME_DATA_SHA`, `SEARCH_MODE` si `FRONTEND_ORIGIN` raman fail-closed;
- Phase 3 nu schimba mapping-ul operational PROD curent;
- niciun live bootstrap/deploy nu este permis in Phase 3;
- viitoarele Phase 4+ trebuie sa configureze Worker-ul exclusiv cu valorile environment-ului selectat si sa confirme identity prin `/health`.''',
)

# CONTRIBUTING
append_once(
    "CONTRIBUTING.md",
    "## 8. Environment automation (Phase 3)",
    r'''## 8. Environment automation (Phase 3)

Comenzi canonice:

```text
npm run env:validate -- --env dev|test|prod --source-sha <full-sha>
npm run env:bootstrap -- --env dev|test|prod --source-sha <full-sha> --dry-run
npm run env:bootstrap-all -- --source-sha <full-sha> --dry-run
npm run env:deploy -- --env dev|test|prod --source-sha <full-sha> --dry-run
npm run env:status -- --source-sha <full-sha> --dry-run
npm run env:isolation-test -- --source-sha <full-sha> --dry-run
npm run test:environment
```

In Phase 3, bootstrap/deploy/status/isolation ruleaza numai dry-run. PROD necesita suplimentar `--owner-gate APPROVED`; aceasta confirmare nu autorizeaza cutover-ul PROD, care ramane gate separat in Phase 6/7.

Lipsa `--env`, un ref mutabil in loc de SHA complet, un target runtime gresit sau credential/config lipsa produce FAIL. `bootstrap-all` nu include PROD.''',
)

# CHANGELOG
replace_once(
    "CHANGELOG.md",
    "- #161 / Phase 2: introdus contract environment-aware fail-closed (`APP_ENV`, runtime repo/ref, immutable `SOURCE_SHA`, `RUNTIME_DATA_SHA`, `SEARCH_MODE`, `FRONTEND_ORIGIN`), `/health` identity, dispatch cu `source_sha` si marker UI DEV/TEST; fara provisioning DEV/TEST si fara schimbarea functionala a PROD.",
    "- #161 / Phase 3: adaugat manifestul canonic `config/environments.json`, CLI unic `env:*`, guard-uri fail-closed, dry-run plans pentru bootstrap/deploy/status/isolation si workflow generic manual-only; Phase 3 nu provision-eaza resurse si nu modifica PROD.\n- #161 / Phase 2: introdus contract environment-aware fail-closed (`APP_ENV`, runtime repo/ref, immutable `SOURCE_SHA`, `RUNTIME_DATA_SHA`, `SEARCH_MODE`, `FRONTEND_ORIGIN`), `/health` identity, dispatch cu `source_sha` si marker UI DEV/TEST; fara provisioning DEV/TEST si fara schimbarea functionala a PROD.",
)

# CI watches and validates the Phase 3 automation.
ci_path = ROOT / ".github/workflows/command-api-check.yml"
ci = ci_path.read_text(encoding="utf-8")
watch_marker = '      - ".github/workflows/job-search-full.yml"'
watch_extra = watch_marker + '\n      - ".github/workflows/deploy-environment.yml"\n      - "config/environments.json"\n      - "package.json"'
if '      - ".github/workflows/deploy-environment.yml"' not in ci:
    if ci.count(watch_marker) != 2:
        raise SystemExit("Unexpected command-api-check path structure")
    ci = ci.replace(watch_marker, watch_extra)
step_marker = "      - name: Run frontend unit tests\n"
step = "      - name: Run environment automation tests\n        run: npm run test:environment\n\n"
if "Run environment automation tests" not in ci:
    if step_marker not in ci:
        raise SystemExit("Missing frontend CI step marker")
    ci = ci.replace(step_marker, step + step_marker, 1)
ci_path.write_text(ci, encoding="utf-8")
