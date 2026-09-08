#!/usr/bin/env python3
from pathlib import Path

# One-time trigger after workflow creation.
ARCH = Path('ARCHITECTURE.md')
ARCHIVE = Path('docs/archive/architecture/ARCHITECTURE-v1.3.md')
CHANGELOG = Path('CHANGELOG.md')

text = ARCH.read_text(encoding='utf-8')
if 'Versiune document: `v1.3`' not in text:
    raise SystemExit('Expected ARCHITECTURE v1.3')
if ARCHIVE.exists():
    raise SystemExit('ARCHITECTURE-v1.3.md already exists')
ARCHIVE.write_text(text, encoding='utf-8')

replacements = [
    ('Versiune document: `v1.3`', 'Versiune document: `v1.4`'),
    ('Ultima actualizare: `2026-09-06`', 'Ultima actualizare: `2026-09-08`'),
    ('| `GitHub Actions` | scheduling, orchestration, secrets provider, executie search engine, publicare rezultate | Nu implementeaza logica UI |',
     '| `GitHub Actions` | orchestration, secrets provider, executie search engine, publicare rezultate | Nu implementeaza logica UI |'),
    ('Trigger-uri:\n\n- `workflow_dispatch`;\n- schedule;\n- modificari relevante in configuratie sau motor.\n\nSchedule curent:\n\n`0 6,15 * * * UTC`',
     'Trigger operational curent:\n\n- numai `workflow_dispatch`.\n\nIn Pachetul 1 de stabilizare, full search nu ruleaza la `push` si nu are `schedule`. Salvarea configuratiei nu declanseaza cautarea. Rularea este pornita explicit prin Command API si foloseste triggerul canonic `manual-ui`.'),
    ('Worker-ul nu executa motorul de cautare.\n\n---\n\n## 6. GitHub Actions',
     'Worker-ul nu executa motorul de cautare.\n\nSemantica comenzilor in Pachetul 1:\n\n- `PUT /config` valideaza si persista configuratia, fara dispatch;\n- `POST /commands/run` valideaza criteriile efective, persista modificarile transmise daca este necesar, blocheaza o rulare concurenta si face un singur `workflow_dispatch`;\n- targetul geografic gol este invalid.\n\n---\n\n## 6. GitHub Actions'),
    ('Geo-eligibility este evaluata separat de FIT.\n\n---\n\n## 8. Surse si connectors',
     'Geo-eligibility este evaluata separat de FIT. Configuratia trebuie sa contina cel putin o tara sau regiune tinta; un target gol nu este interpretat ca Worldwide. Pentru Hybrid/Onsite, geografia necunoscuta nu este presupusa eligibila.\n\n---\n\n## 8. Surse si connectors'),
    ('### 9.2 Configuratie\n\n```text\nFrontend\n   |\n   v\nCloudflare Worker\n   |\n   v\nGitHub Contents API\n   |\n   +--> data/search-config.json\n   |\n   +--> data/sources.json\n```',
     '### 9.2 Configuratie\n\n```text\nFrontend\n   |\n   v\nPUT /config\n   |\n   v\nCloudflare Worker\n   |\n   v\nGitHub Contents API\n   |\n   +--> data/search-config.json\n   |\n   +--> data/sources.json\n```\n\nPersistarea configuratiei nu porneste full search.'),
    ('### 9.3 Lansare manuala\n\n```text\nFrontend\n   |\n   v\nPOST /commands/run\n   |\n   v\nCloudflare Worker\n   |\n   v\nGitHub Actions\n   |\n   v\nSearch Engine\n```',
     '### 9.3 Lansare manuala\n\n```text\nFrontend\n   |\n   v\nPOST /commands/run\n   |\n   v\nCloudflare Worker\n   |\n   +--> valideaza / persista criteriile curente\n   |\n   +--> verifica rulare concurenta\n   |\n   v\nworkflow_dispatch (manual-ui)\n   |\n   v\nSearch Engine\n```\n\nO actiune explicita de rulare produce maximum un dispatch.'),
    ('- React/Vite production build;\n- Cloudflare Worker dry-run.',
     '- React/Vite production build;\n- teste Command API, inclusiv validare configuratie si cazuri negative de securitate;\n- guard CI pentru full search manual-only;\n- Cloudflare Worker dry-run.'),
    ('- [x] Scheduled search', '- [ ] Scheduled search - dezactivat in Pachetul 1 de stabilizare'),
    ('**v1.3**\n\nVersiune aplicatie de referinta:', '**v1.4**\n\nVersiune aplicatie de referinta:'),
]
for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Architecture replacement expected once, got {count}: {old[:80]}')
    text = text.replace(old, new, 1)
ARCH.write_text(text, encoding='utf-8')

changelog = CHANGELOG.read_text(encoding='utf-8')
marker = '### Remedieri\n\n'
entry = (
    '- #79 / Pachetul 1: full search este manual-only; eliminate trigger-ele `push` si `schedule`, iar `PUT /config` nu mai porneste cautarea.\n'
    '- #79 / Pachetul 1: `POST /commands/run` foloseste criteriile curente, blocheaza concurenta si produce un singur dispatch `manual-ui`.\n'
    '- #79 / Pachetul 1: geografia devine fail-safe: target explicit obligatoriu, RO/BE/LU restaurat, iar Hybrid/Onsite cu geografie necunoscuta nu este presupus eligibil.\n'
    '- #79 / Pachetul 1: adaugate teste de regresie, securitate si guard CI pentru a preveni reintroducerea trigger-elor automate.\n\n'
)
if entry.strip() not in changelog:
    if changelog.count(marker) != 1:
        raise SystemExit('Unexpected CHANGELOG Remedieri marker')
    changelog = changelog.replace(marker, marker + entry, 1)
CHANGELOG.write_text(changelog, encoding='utf-8')
print('Architecture v1.4 and changelog prepared')
