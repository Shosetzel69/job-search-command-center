# Package 2A8 - status implementare

Ultima actualizare: 2026-09-13

## Scope

Umbrella: #116.
Implementation PR: #124.
Final E2E: #122 / #126.
Status: `DONE / PROD E2E PASS`.

## Stare

- #117 Contract canonic nomenclatoare: `DONE / CLOSED`;
- #118 Geografie canonica: `DONE / CLOSED`;
- #119 Work modes + contract types: `DONE / CLOSED`;
- #120 Admin + integritate referentiala: `DONE / CLOSED`;
- #121 Runtime asset safety: `DONE / CLOSED`;
- #122 Migrare + E2E: `PASS - ready to close`;
- #126 PROD smoke: `PASS`.

## Livrat

- `data/nomenclatures.json` schema 1.0, system/extensible;
- geografie canonica comuna React / Command API / Python;
- `Remote`, `Hibrid`, `Onsite`; `unknown` ramane tehnic;
- tipuri contract canonice `permanent`, `temporary`, `contract`, `freelance`;
- `contract_type` + `employment_type_raw` in normalizarea joburilor;
- `Administrare -> Nomenclatoare` functional;
- codurile system sunt immutable;
- domeniile extensibile permit operatiile aprobate;
- deactivate/delete pe valoare referentiata -> 409 + lista referintelor;
- `applied` ramane valid;
- manifest unic pentru protected runtime assets;
- niciuna dintre operatiile de nomenclator/config nu face dispatch Full Search.

## E2E final

#126 a executat E2E-01..E2E-12 in PROD:

- toate PASS;
- zero Full Search neintentionat;
- baseline/final run id identic;
- toate mutatiile temporare au fost restaurate;
- protected data, Admin, nomenclatoare, geografie, work modes, contract types, referential integrity, applications, logs si reload au fost validate.

Defectele ramase din #126 sunt P3/cosmetice si nu blocheaza stabilizarea.

## Guardrails

- #49 exclus;
- JobsPipe disabled;
- fara dependinte noi introduse de 2A8;
- fara live crawl in CI;
- Save/config/source/category/nomenclature != Run;
- Full Search ramane manual-only pana la Package 2B.

Separarea DEV/TEST/PROD este urmarita separat prin #161 si nu face parte din Package 2A8.

Raportul closeout istoric este retinut numai in repository-ul privat de arhiva.
