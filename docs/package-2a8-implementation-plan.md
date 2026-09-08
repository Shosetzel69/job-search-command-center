# Package 2A8 - Plan implementare nomenclatoare canonice

Data: 2026-09-09
Status: `READY FOR IMPLEMENTATION`
Umbrella: #116
Subtasks: #117-#122

## 1. Obiectiv

Eliminarea listelor functionale duplicate pentru geografie/work modes/contract types si transformarea `Administrare -> Nomenclatoare` intr-o functie reala, fara schimbarea boundary-urilor arhitecturale existente.

## 2. Guardrails

- #49 exclus;
- JobsPipe disabled;
- fara dependinte noi;
- fara live crawl in CI;
- Save/config/source/category/nomenclature != Run;
- full search ramane manual-only pana la 2B;
- maximum un full search controlat la E2E final daca este necesar;
- target geografic gol ramane invalid;
- fara migrare silent a referintelor;
- seniority este infrastructura only.

## 3. Ordinea de implementare

### Etapa A - #117 Contract canonic

1. creare `data/nomenclatures.json` schema 1.0;
2. definire domenii si metadata `kind/extensible`;
3. seed din comportamentul actual;
4. adaugare validator schema in CI;
5. documentare contract.

Gate A:

- schema validata;
- nicio schimbare functionala inca;
- configuratia curenta ramane valida.

### Etapa B - #118 Geografie

1. mutare countries/regions membership in nomenclator;
2. loader comun per strat, fara shared executable runtime;
3. React citeste labels/options din nomenclator;
4. Worker foloseste membership canonic la validare conflict;
5. Python foloseste membership canonic la geo eligibility;
6. parity tests pentru EU/US/ASIA si configuratii curente;
7. eliminare constante duplicate numai dupa PASS.

Gate B:

- parity 100% pentru scenariile aprobate;
- target gol/conflict continua sa fie respins;
- EU isi pastreaza semantica.

### Etapa C - #119 Work modes + contract types

1. seed `remote/hybrid/onsite`;
2. extindere `search-config.work_modes.onsite`;
3. eliminare `N/A` din criteriu normal, pastrare tehnica in job data;
4. seed contract types: permanent/temporary/contract/freelance;
5. adaugare `contract_type` in job contract;
6. optional `employment_type_raw`;
7. mapping conservator + `unknown`;
8. integrare filtrare UI/API/runner.

Gate C:

- work modes end-to-end;
- contract types end-to-end;
- unknown nu este fortat intr-o categorie.

### Etapa D - #120 Admin + integritate

1. endpoint read nomenclatures;
2. mutatii aprobate conform `kind/extensible`;
3. UI Admin Nomenclatoare functional;
4. reference checker;
5. 409 + references[] la deactivate/delete folosit;
6. `applied` pastrat;
7. seniority fara filtru activ.

Gate D:

- nicio mutatie administrativa nu face dispatch;
- coduri system immutable;
- referential integrity testata.

### Etapa E - #121 Runtime asset safety

1. adaugare `nomenclatures.json` in protected runtime assets;
2. manifest canonic sau parity test intre build/Worker/CI/frontend;
3. regresie 401/404/no-store;
4. `search-state.json` explicit excluded.

Gate E:

- nu poate exista protected asset publicat dar neallowlisted fara fail CI.

### Etapa F - #122 Migrare + E2E

1. build/CI complet;
2. Cloudflare preview;
3. merge numai dupa green;
4. production deploy;
5. E2E scenarii #122;
6. confirmare owner;
7. inchidere #116, #96, #85 daca #93 este si el rezolvat/acceptat.

## 4. Fisiere probabile afectate

### Data
- `data/nomenclatures.json` nou;
- `data/search-config.json` migrare aditiva;
- `data/jobs.json` contract extins prin runner;
- `data/applications.json` doar validare status existent.

### Frontend
- `frontend/src/main.jsx`;
- `frontend/src/admin-shell.jsx`;
- teste/model helpers noi sau existente.

### Command API
- `command-api/src/index.js`;
- eventual modul nou `command-api/src/nomenclatures.js` pentru a evita cresterea excesiva a `index.js`;
- `command-api/src/secure-entry.js` sau manifest runtime comun;
- teste Node.

### Search engine
- `scripts/job_search.py`;
- `scripts/job_search_runner.py` daca este necesar pentru load/validation;
- connector normalization helpers doar unde employment type mapping este necesar;
- teste Python.

### Build/CI
- `command-api/scripts/build-static.mjs`;
- `.github/workflows/command-api-check.yml`;
- manifest comun daca se alege aceasta varianta.

### Documentatie
- `ARCHITECTURE.md`;
- `docs/data-contract.md`;
- `docs/requirements.md`;
- `docs/package-2-status.md`;
- `CHANGELOG.md`.

## 5. Strategia de contract

Preferinta:

```text
nomenclatures.json
  domains
    <domain>
      kind: system | configurable
      extensible: boolean
      values[]
```

Value:

```text
code
label
active
sort_order
aliases?        # metadata tehnica
country_codes?  # numai regions
```

Codurile sunt folosite in configuratie/business logic; label-urile sunt UI.

## 6. Compatibilitate

### search-config

Se pastreaza campurile geografice curente:

- `target_regions`;
- `target_country_codes`;
- `excluded_regions`;
- `excluded_country_codes`.

Valorile lor sunt validate fata de nomenclator.

`work_modes` ramane obiect boolean si primeste `onsite`.

Pentru contract type se adauga un camp nou documentat, preferabil lista de coduri active selectate, fara a supraincarca `type` legacy.

### jobs

Se adauga campuri additive; clientul trebuie sa ramana compatibil cu istoricul fara `contract_type`.

### applications

`applied` ramane valid. Nu se transforma istoricul daca nu este necesar.

## 7. Test matrix minima

### Geografie
- EU membership;
- US membership;
- ASIA membership;
- target country only;
- region + country conflict;
- included region + excluded member country;
- excluded region + included member country;
- target empty;
- Worldwide/EMEA remote scope unchanged.

### Work modes
- remote;
- hybrid;
- onsite;
- N/A job data;
- UI excludes N/A criterion.

### Contract types
- canonical direct value;
- common alias;
- ambiguous provider value -> unknown;
- missing provider value -> unknown;
- filtering by each of four canonical types.

### Integrity
- active value unused -> deactivate allowed where policy permits;
- active value referenced -> 409;
- delete system code -> rejected;
- rename label -> code/ref unchanged.

### Runtime assets
- each protected asset no token -> 401;
- each protected asset valid token -> not 404;
- unknown data path -> 404;
- internal state not exposed.

## 8. PR strategy

Recomand un singur feature branch de implementare cu commit-uri pe etape, dar PR-ul poate fi deschis draft de la Etapa A.

Branch tinta dupa aprobarea pregatirii:

`feature/116-canonical-nomenclatures`

PR-ul se marcheaza Ready numai dupa A-E green. E2E #122 se executa dupa merge/deploy, conform modelului proiectului.

## 9. Rollback

Daca parity tests descopera diferente de geografie:

- nu se elimina constantele vechi;
- migrarea se opreste in branch;
- se corecteaza seed/contract;
- nu se merge in main.

Daca production protected asset esueaza:

- nu se porneste full search;
- hotfix pe asset manifest/allowlist;
- datele existente nu se migreaza automat.

## 10. Definition of Done 2A8

- #117-#121 implementate si testate;
- CI green;
- Cloudflare preview green;
- documentatie sincronizata;
- merge/deploy production green;
- E2E #122 PASS;
- owner confirma comportamentul;
- zero full search neintentionat;
- #49 ramane exclus si JobsPipe disabled.
