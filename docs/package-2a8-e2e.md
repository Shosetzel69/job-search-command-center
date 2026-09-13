# Package 2A8 - matrice E2E

Ultima actualizare: 2026-09-13
Umbrella: #116
E2E: #122 / #126
Implementation PR: #124
Status: `PASS / COMPLETE`

## Regula

Testarea automata nu porneste Full Search. Full Search live se executa numai explicit si nu este necesar pentru fiecare smoke de configurare/admin.

## Matrice finala

| # | Scenariu | Acoperire | Stare finala |
|---|---|---|---|
| 1 | Login + protected assets | `security.test.mjs` + PROD smoke | PASS |
| 2 | Admin Nomenclatoare functional | frontend/API tests + PROD smoke | PASS |
| 3 | regions/countries/work_modes/contract_types canonice | JSON/JS/Python + PROD smoke | PASS |
| 4 | configuratia existenta se incarca fara pierdere | migration tests + PROD smoke | PASS |
| 5 | Save config/nomenclator nu porneste Full Search | manual-only guard + PROD mutation tests | PASS |
| 6 | target geografic gol respins | Command API/Python + PROD UI guard | PASS |
| 7 | conflict include/exclude respins | Command API/Python + PROD UI guard | PASS |
| 8 | deactivate/delete valoare folosita -> 409 + refs | governance test + PROD | PASS |
| 9 | Onsite configurabil; N/A nu este optiune normala | config/frontend + PROD | PASS |
| 10 | 4 tipuri contract configurabile | config/nomenclature + PROD | PASS |
| 11 | employment type necunoscut ramane unknown | Python regression | PASS |
| 12 | applications/applied valid | migration/governance + PROD | PASS |
| 13 | EU/US/ASIA parity | canonical geography tests + PROD | PASS |
| 14 | Full Search nu porneste accidental | CI manual-only guard + PROD baseline/final comparison | PASS |

## Smoke final PROD #126

Executat 2026-09-11.

Rezultat:

- E2E-01..E2E-12: PASS;
- baseline run_id: `github-20260911T062528Z`;
- final run_id: identic;
- Unexpected Full Search: NO;
- toate mutatiile temporare: rollback complet;
- Source/Source Category: neschimbate;
- JobsPipe: disabled;
- reload/session si protected data: functionale.

## Defecte neblocante

- P3 overlap vizual in tabele Nomenclatoare;
- P3 overlap status/Trigger in Loguri;
- P3 UX: `window.prompt()` pentru adaugare valoare extensibila.

Acestea sunt polish/backlog si nu blocheaza stabilizarea.

## Exit

Criteriile #122 sunt indeplinite:

- [x] CI green;
- [x] Cloudflare deployment/build green;
- [x] smoke autentificat confirmat;
- [x] nicio regresie Package 1 / 2A care sa blocheze baseline-ul;
- [x] zero trigger Full Search neintentionat;
- [x] cleanup complet.

#122 poate fi inchis `completed`.
