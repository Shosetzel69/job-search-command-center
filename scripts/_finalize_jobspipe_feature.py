#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def p(path: str) -> Path:
    return ROOT / path


def replace(path: str, old: str, new: str, required: bool = True) -> None:
    text = p(path).read_text(encoding="utf-8")
    if old not in text:
        if required:
            raise RuntimeError(f"marker not found in {path}: {old[:80]}")
        return
    p(path).write_text(text.replace(old, new, 1), encoding="utf-8")


# Application version
replace("frontend/src/main.jsx", "Versiunea 0.03", "Versiunea 0.04")
package_path = p("frontend/package.json")
package = json.loads(package_path.read_text(encoding="utf-8"))
package["version"] = "0.4.0"
package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

for doc in ["docs/requirements.md", "docs/architecture.md", "docs/functionalitati.md"]:
    replace(doc, "Versiune aplicatie: 0.03", "Versiune aplicatie: 0.04", required=False)

# Requirements: distinguish Apify from Direct and describe the UI settings.
replace(
    "docs/requirements.md",
    "- CFR-43: Colectarea JobsPipe foloseste `discovered_at_gte` si stare persistenta per interogare pentru polling incremental.\n- CFR-44: JobsPipe foloseste preview gratuit cu `blur_company_data=true` pentru estimarea volumului inaintea colectarii platite.\n- CFR-45: Interogarile JobsPipe evita suprapunerea geografica intre geografiile prioritare si restul Europei remote eligibile.\n- CFR-46: Daca volumul depaseste bugetul unei rulari, cursorul este pastrat si backlog-ul continua ulterior.\n- CFR-47: Rezultatele deja colectate sunt pastrate pana la expirarea ferestrei maxime sau pana cand regulile de filtrare le elimina.\n- CFR-48: JobsPipe are buget configurabil per rulare si prag lunar local.\n- CFR-49: Cand `jobspipe_enabled=false`, workflow-ul nu executa cereri JobsPipe si nu consuma credite provider.\n",
    "- CFR-43: JobsPipe foloseste un transport configurabil: `disabled`, `apify` sau `direct`.\n- CFR-44: Modul `apify` foloseste Actorul oficial `jobspipe~jobspipe-job-search`, cu `APIFY_TOKEN` pastrat exclusiv in GitHub Actions Secrets.\n- CFR-45: Atat Apify, cat si Direct evita suprapunerea geografica intre geografiile prioritare si restul Europei remote eligibile.\n- CFR-46: Modul `apify` are plafon tehnic configurabil pentru numarul maxim de joburi brute pe rulare; valoarea implicita este 5.000.\n- CFR-47: Modul `direct` foloseste preview gratuit, `discovered_at_gte`, cursor de backlog si stare persistenta pentru polling incremental.\n- CFR-48: Modul `direct` pastreaza buget configurabil de credite/rulare, prag lunar local si circuit breaker de quota.\n- CFR-49: Cand `jobspipe_mode=disabled`, workflow-ul nu executa nicio cerere JobsPipe sau Apify si pastreaza rezultatele existente.\n",
)
replace(
    "docs/requirements.md",
    "- CFR-50: `Criterii de selectie` include checkbox-ul `Activeaza JobsPipe`, mapat la `jobspipe_enabled`.\n- CFR-51: JobsPipe este dezactivat in perioada de stabilizare si se reactiveaza controlat prin salvarea configuratiei.\n",
    "- CFR-50: `Criterii de selectie` include selectorul JobsPipe `Oprit / Apify / Direct`, mapat la `jobspipe_mode`.\n- CFR-51: Pentru Apify, UI permite configurarea plafonului de joburi brute/rulare; pentru Direct, UI permite configurarea bugetului de credite/rulare si a pragului lunar local. JobsPipe ramane `disabled` in perioada de stabilizare.\n",
)
replace(
    "docs/requirements.md",
    "- CNF-11: Strategia JobsPipe trebuie sa protejeze quota prin polling incremental, buget per run si guard lunar.\n- CNF-12: `data/search-state.json` nu este publicat in bundle-ul Cloudflare.\n- CNF-13: `jobspipe_enabled=false` garanteaza zero consum JobsPipe pentru rularile ulterioare pana la reactivare.\n",
    "- CNF-11: Modul JobsPipe Direct protejeaza quota prin polling incremental, buget per run, guard lunar si circuit breaker; modul Apify foloseste un plafon tehnic de volum.\n- CNF-12: `data/search-state.json` nu este publicat in bundle-ul Cloudflare.\n- CNF-13: `jobspipe_mode=disabled` garanteaza zero cereri JobsPipe/Apify pana la reactivare.\n- CNF-18: `APIFY_TOKEN` si `JOBSPIPE_API_KEY` sunt pastrate exclusiv in GitHub Actions Secrets si nu ajung in frontend sau Worker.\n",
)
replace(
    "docs/requirements.md",
    "- JobsPipe: `jobspipe_enabled=false` in perioada de stabilizare;\n- buget JobsPipe cand este activ: 14 credite/rulare;\n- guard lunar local: 950 credite;\n- overlap incremental: 2 minute.\n",
    "- JobsPipe: `jobspipe_mode=disabled` in perioada de stabilizare;\n- transport recomandat dupa stabilizare: `apify`; `direct` ramane fallback;\n- plafon Apify implicit: 5.000 joburi brute/rulare;\n- Direct: 14 credite/rulare, guard lunar 950, overlap incremental 2 minute.\n",
)
replace(
    "docs/requirements.md",
    "- JobsPipe enable/disable si protectie quota.\n",
    "- JobsPipe `disabled/apify/direct`, configuratie UI si protectii specifice fiecarui transport.\n",
)

# Architecture: add Apify module/flow and split transport strategies.
replace(
    "docs/architecture.md",
    "        +--> job_search_optimized.py\n        +--> connectors",
    "        +--> job_search_optimized.py\n        +--> job_search_apify.py\n        +--> transport: disabled / apify / direct\n        +--> connectors",
)
replace(
    "docs/architecture.md",
    "- `scripts/job_search.py` - model intern, normalizare, filtrare, scoring, contract output;\n- `scripts/job_search_optimized.py` - strategie JobsPipe incremental/paginare/quota;\n- `scripts/job_search_runner.py` - provider enablement, circuit breaker si entry point workflow.\n",
    "- `scripts/job_search.py` - model intern, normalizare, filtrare, scoring, contract output;\n- `scripts/job_search_optimized.py` - transport JobsPipe Direct: preview, incremental, cursor si quota guards;\n- `scripts/job_search_apify.py` - transport JobsPipe prin Actorul oficial Apify;\n- `scripts/job_search_runner.py` - selector `disabled/apify/direct`, circuit breaker Direct si entry point workflow.\n",
)
replace(
    "docs/architecture.md",
    "Connector implementat operational:\n\n- JobsPipe.\n\nStare curenta:\n\n- `jobspipe_enabled=false` pentru stabilizare;\n- cand este dezactivat, workflow-ul nu apeleaza providerul si pastreaza lista existenta;\n- `data/sources.json` este catalog UI, nu lista connectorilor implementati;\n- toggle-urile individuale din pagina `Surse` sunt locale;\n- campul legacy `priority` din catalog nu controleaza ordinea de colectare;\n- strategia canonica este `all active sources equally` pentru momentul in care connectorii sunt implementati.\n\n## 12. JobsPipe quota strategy\n\nCand providerul este activ:\n\n- preview gratuit;\n- `discovered_at_gte` pentru polling incremental;\n- doua arii geografice fara suprapunere intentionata;\n- cursor pentru backlog;\n- maximum 14 credite/rulare configurat curent;\n- guard local lunar 950;\n- overlap incremental 2 minute;\n- circuit breaker dupa raportarea quota provider exhausted.\n\nStarea incrementala este in `data/search-state.json`.\n",
    "Connector logic implementat operational:\n\n- JobsPipe, cu doua transporturi alternative: Apify si Direct.\n\nStare curenta:\n\n- `jobspipe_mode=disabled` pentru stabilizare;\n- cand este dezactivat, workflow-ul nu apeleaza JobsPipe/Apify si pastreaza lista existenta;\n- dupa stabilizare, `apify` este transportul recomandat pentru volum;\n- `direct` ramane fallback/diagnostic;\n- `data/sources.json` este catalog UI, nu lista connectorilor implementati;\n- toggle-urile individuale din pagina `Surse` sunt locale;\n- campul legacy `priority` din catalog nu controleaza ordinea de colectare;\n- strategia canonica este `all active sources equally` pentru momentul in care connectorii suplimentari sunt implementati.\n\n## 12. JobsPipe transport strategy\n\n### Apify\n\n- Actor: `jobspipe~jobspipe-job-search`;\n- autentificare prin `APIFY_TOKEN` din GitHub Actions Secrets;\n- doua cautari fara suprapunere: geografiile prioritare si remote in restul Europei eligibile;\n- Actorul pagineaza automat;\n- plafon implicit 5.000 joburi brute/rulare, configurabil 100-20.000;\n- rezultatele intra in acelasi pipeline de normalizare, dedup, filtrare si scoring.\n\n### Direct\n\n- `JOBSPIPE_API_KEY` din GitHub Actions Secrets;\n- preview gratuit;\n- `discovered_at_gte` pentru polling incremental;\n- cursor pentru backlog;\n- 14 credite/rulare implicit;\n- guard local lunar 950;\n- overlap incremental 2 minute;\n- circuit breaker dupa quota exhausted.\n\nStarea incrementala Direct este in `data/search-state.json`. Markerul vechi de quota a fost resetat deoarece exista quota noua, dar modul ramane dezactivat pana la stabilizare.\n",
)
replace(
    "docs/architecture.md",
    "- JobsPipe API key -> GitHub Actions Secret;\n",
    "- `APIFY_TOKEN` -> GitHub Actions Secret pentru modul Apify;\n- `JOBSPIPE_API_KEY` -> GitHub Actions Secret pentru modul Direct;\n",
)

# Data contract cleanup and transport metadata.
replace("docs/data-contract.md", "- `jobspipe_enabled`;\n", "- `jobspipe_mode`;\n- `jobspipe_apify_max_items_per_run`;\n")
replace("docs/data-contract.md", "- `jobspipe_enabled = false`;\n", "")
replace(
    "docs/data-contract.md",
    "- `jobspipe_optimization`.\n",
    "- `jobspipe_optimization` - detalii Direct;\n- `jobspipe_transport` - modul efectiv `disabled/apify/direct` si metadate transport.\n",
)

# Command API documentation: new configurable fields.
command_doc = p("docs/command-api.md").read_text(encoding="utf-8")
command_doc = command_doc.replace(
    "- excluderi.\n",
    "- excluderi;\n- `jobspipeMode`: `disabled | apify | direct`;\n- `jobspipeApifyMaxItems`: 100-20.000;\n- `jobspipeDirectRunBudget`;\n- `jobspipeDirectMonthlyGuard`.\n",
    1,
)
command_doc += "\n## JobsPipe transport\n\nCommand API persista numai configuratia, nu secretele providerilor. `APIFY_TOKEN` si `JOBSPIPE_API_KEY` exista numai in GitHub Actions Secrets. Alegerea `apify` din UI nu transmite tokenul prin browser sau Worker.\n"
p("docs/command-api.md").write_text(command_doc, encoding="utf-8")

print("JobsPipe feature finalization applied")
