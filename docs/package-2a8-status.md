# Package 2A8 - status implementare

Ultima actualizare: 2026-09-09

## Scope

Umbrella: #116.
Branch: `feature/116-canonical-nomenclatures`.
PR: #124.

## Stare

- #117 Contract canonic nomenclatoare: `DONE`;
- #118 Geografie canonica: `DONE - CI/preview green`;
- #119 Work modes + contract types: `DONE - CI/preview green`;
- #120 Admin + integritate referentiala: `DONE - CI/preview green`;
- #121 Runtime asset safety: `DONE`;
- #122 Migrare + E2E: `NEXT`.

## Livrat

- `data/nomenclatures.json` schema 1.0, system/extensible;
- geografie canonica comuna React / Command API / Python;
- `Remote`, `Hibrid`, `Onsite`; `unknown` ramane tehnic;
- tipuri contract canonice `permanent`, `temporary`, `contract`, `freelance`;
- `contract_type` + `employment_type_raw` in normalizarea joburilor;
- `Administrare -> Nomenclatoare` functional;
- codurile system sunt immutable si nu au Add/Delete;
- domeniile extensibile permit Add/Edit/Activate/Deactivate/Delete;
- deactivate/delete pe valoare referentiata -> 409 + lista referintelor;
- `applied` este protejat de istoricul aplicarilor;
- manifest unic pentru protected runtime assets;
- niciuna dintre operatiile de nomenclator nu face dispatch full search.

## Urmatorul gate

#122 executa migrarea/E2E finala si verifica parity + zero trigger neintentionat. Maximum un full search controlat numai daca este necesar pentru verificarea finala.

## Guardrails

- #49 exclus;
- JobsPipe disabled;
- fara dependinte noi;
- fara live crawl in CI;
- Save/config/source/category/nomenclature != Run;
- full search ramane manual-only pana la Package 2B.

Separarea DEV/TEST/PROD este analizata separat in #125 si nu modifica runtime-ul in PR #124.
