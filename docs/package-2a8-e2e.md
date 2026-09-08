# Package 2A8 - matrice E2E

Ultima actualizare: 2026-09-09
Umbrella: #116
E2E: #122
PR: #124

## Regula

Testarea automata nu porneste full search. Un singur full search controlat este permis numai daca este necesar pentru confirmarea finala dupa deploy.

## Matrice

| # | Scenariu | Acoperire automata | Stare |
|---|---|---|---|
| 1 | Login + protected assets | `security.test.mjs`, runtime manifest | PASS automat; smoke autentificat final dupa deploy |
| 2 | Admin Nomenclatoare functional | frontend build + `nomenclature-admin.test.mjs` + API auth | PASS automat; smoke UI final dupa deploy |
| 3 | regions/countries/work_modes/contract_types canonice | JSON contract + JS/Python tests | PASS |
| 4 | configuratia existenta se incarca fara pierdere | `nomenclature-migration.test.mjs` valideaza config fara mutatie | PASS |
| 5 | Save config/nomenclator nu porneste full search | workflow manual-only guard + nomenclature API zero-dispatch test | PASS |
| 6 | target geografic gol respins | Command API + Python regression | PASS |
| 7 | conflict include/exclude respins | Command API + Python regression | PASS |
| 8 | deactivate/delete valoare folosita -> 409 + refs | `nomenclature-governance.test.mjs` | PASS |
| 9 | Onsite configurabil; N/A nu este optiune normala | config/frontend tests | PASS |
| 10 | 4 tipuri contract configurabile | config/nomenclature tests | PASS |
| 11 | employment type necunoscut ramane unknown | Python regression | PASS |
| 12 | applications/applied valid | migration + governance tests | PASS |
| 13 | EU/US/ASIA parity | canonical geography tests; ASIA include PK conform motorului | PASS |
| 14 | max. un full search controlat | nu se ruleaza in CI; decizie la smoke final | PASS guard / PENDING live |

## Smoke final dupa deploy

Necesita sesiune Google autorizata:

1. login;
2. toate paginile se incarca fara 404;
3. Administrare -> Nomenclatoare afiseaza cele 6 domenii;
4. editarea unui label/order sigur persista fara full-search;
5. incercarea de dezactivare a unei valori referentiate produce mesaj 409 cu referinta;
6. Criterii afiseaza Onsite si tipurile canonice de contract;
7. Save preferinte nu porneste full search;
8. numai daca este necesar, se executa o singura rulare manuala pentru verificarea contractului publicat.

## Exit

#122 se inchide numai dupa:
- CI green;
- Cloudflare deployment green;
- smoke autentificat confirmat;
- nicio regresie Package 1 / 2A;
- zero trigger full-search neintentionat.
