# Contract date JSON

## Regula generala

Fisierele JSON generate de workflow si consumate de frontend folosesc un camp obligatoriu `schema_version`.

Versiunea initiala este `1.0`.

Timestamp-urile sunt UTC in format ISO-8601.

Frontend-ul trebuie sa trateze o versiune necunoscuta ca eroare controlata si sa nu presupuna existenta campurilor optionale.

## `data/jobs.json`

Campuri obligatorii la nivel root:

- `schema_version`;
- `generated_at`;
- `freshness_hours`;
- `criteria`;
- `records_inspected`;
- `results`;
- `excluded_count`;
- `jobs`.

Campuri optionale la nivel root:

- `collection_freshness_hours` - fereastra maxima folosita efectiv la colectare; pentru implementarea curenta este 120 ore / 5 zile;
- `incremental_sync` - indica folosirea colectarii incrementale;
- `expired_pruned` - numarul de rezultate eliminate deoarece au iesit din fereastra maxima;
- `jobspipe_usage` - sumar local al consumului estimat de credite JobsPipe.

`freshness_hours` de la nivel root reprezinta fereastra maxima a setului publicat. Cand exista `collection_freshness_hours`, cele doua valori sunt in mod normal identice.

`criteria.display_freshness_hours` poate indica valoarea implicita folosita de frontend pentru filtrarea locala a setului colectat.

Campuri obligatorii pentru fiecare job:

- `title`;
- `company`;
- `fit`;
- `location`;
- `mode`;
- `remote`;
- `b2b`;
- `repost`;
- `status`;
- `pros`;
- `risks`;
- `description`;
- `date_posted`;
- `source`.

Campuri optionale:

- `id`;
- `initial`;
- `type`;
- `age`;
- `url`;
- `verified_at`.

`mode` foloseste valorile normalizate `Remote`, `Hybrid`, `Onsite` sau `N/A`.

`age` reprezinta vechimea calculata in ore. Pentru un `date_posted` care contine numai data calendaristica, motorul foloseste inceputul zilei in UTC pentru un calcul conservator si predictibil.

`description` poate fi sir gol daca sursa nu furnizeaza descrierea.

`url` poate fi `null` daca nu exista un link direct verificabil.

## `data/run-status.json`

Campuri obligatorii:

- `schema_version`;
- `run_id`;
- `status`;
- `started_at`;
- `completed_at`;
- `sources`;
- `records_inspected`;
- `jobs_published`;
- `excluded`;
- `limitations`.

Campuri optionale recomandate:

- `source_results` - rezultat detaliat pentru fiecare connector/query executat;
- `jobspipe_optimization` - sumarul preview-urilor, creditelor consumate si backlog-ului incremental.

Fiecare element `source_results` poate contine:

- `connector`;
- `query`;
- `status`;
- `records`;
- `total_available`;
- `error`.

`jobspipe_optimization` poate contine:

- `preview_counts`;
- `credits_used`;
- `run_budget`;
- `estimated_monthly_credits`;
- `monthly_guard`;
- `incremental`;
- `query_progress` cu indicator de cursor si estimarea backlog-ului ramas.

Valori permise pentru statusul rularii:

- `running`;
- `completed`;
- `completed_with_errors`;
- `failed`.

Reguli:

- un connector/query esuat nu trebuie sa opreasca automat colectarile independente;
- daca exista rezultate valide si unele colectari esueaza, statusul este `completed_with_errors`;
- daca toate colectarile esueaza, statusul este `failed`;
- un esec total nu inlocuieste lista de joburi valida existenta cu o lista goala falsa.

## `data/search-config.json`

Este sursa canonica de configuratie pentru cautare.

Campuri obligatorii:

- `schema_version`;
- `role_groups`;
- `work_modes`;
- `freshness_hours`;
- `fit_threshold`;
- `keep_reposts`;
- `rate_min_eur_day`;
- `rate_max_eur_day`;
- `immediate_start`;
- `search_country_codes`;
- `eligible_remote_country_codes`;
- `work_mode_priority`;
- `source_strategy`;
- `exclusions`;
- `excluded_company_patterns`;
- `excluded_role_keywords`;
- `deep_erp_terms`.

Campuri optionale:

- `collection_freshness_hours` - fereastra de colectare independenta de filtrul implicit din UI. Daca lipseste, motorul foloseste `freshness_hours`;
- `jobspipe_credit_budget_per_run` - limita locala de credite JobsPipe pentru o rulare;
- `jobspipe_monthly_credit_guard` - prag local lunar sub limita furnizorului;
- `jobspipe_incremental_overlap_minutes` - suprapunere mica intre ferestrele incrementale pentru evitarea golurilor la limita de timp.

In configuratia curenta:

- `freshness_hours = 24` reprezinta filtrul implicit al listei;
- `collection_freshness_hours = 120` permite UI-ului sa filtreze local intre 24h, 36h, 48h si 5 zile fara o noua rulare;
- `jobspipe_credit_budget_per_run = 14`;
- `jobspipe_monthly_credit_guard = 950`;
- `jobspipe_incremental_overlap_minutes = 2`.

`role_groups` contine grupuri de roluri. Fiecare grup are:

- `enabled` - boolean;
- `titles` - lista titlurilor trimise catre sursa de cautare.

`work_modes` contine cel putin:

- `remote` - boolean;
- `hybrid` - boolean.

Reguli:

- motorul foloseste aceasta configuratie la construirea query-urilor si la filtrare/scoring;
- frontend-ul foloseste aceeasi configuratie pentru valorile canonice ale criteriilor;
- listarile din UI pot aplica local filtre suplimentare de vechime, mod de lucru si sortare fara a modifica setul colectat;
- configurarile locale nesalvate pot exista temporar in browser, dar nu devin configuratie efectiva a workflow-ului fara un mecanism securizat de persistenta;
- secretele si cheile API nu sunt permise in acest fisier.

## `data/search-state.json`

Fisier intern folosit numai de GitHub Actions pentru sincronizarea JobsPipe. Nu este copiat in bundle-ul static Cloudflare si nu este consumat de frontend.

Campuri:

- `schema_version`;
- `query_progress` - stare separata pentru fiecare interogare JobsPipe;
- `job_first_seen` - timestamp intern pentru joburile fara data de publicare utilizabila;
- `usage` - estimarea consumului lunar local.

`query_progress` poate pastra pentru fiecare interogare:

- `watermark` - ultimul punct incremental finalizat;
- `cursor` - cursorul JobsPipe pentru backlog neprocesat;
- `remaining_estimate`;
- `poll_started_at`;
- `max_discovered_at_seen`.

Reguli:

- watermark-ul nu avanseaza cat timp exista un cursor de backlog;
- la epuizarea cursorului, watermark-ul este avansat pe baza celui mai nou `discovered_at` procesat;
- un query esuat nu isi avanseaza watermark-ul;
- consumul estimat se reseteaza cand se schimba luna UTC;
- fisierul este versionat in repository, dar exclus explicit din lista fisierelor copiate de build-ul static.

## Compatibilitate

Schimbarile care adauga doar campuri optionale pot pastra aceeasi versiune.

Schimbarile incompatibile, precum redenumirea sau eliminarea campurilor obligatorii, necesita cresterea versiunii contractului.

## Validare

Motorul si workflow-ul valideaza configuratia, structura minima a output-ului si starea incrementala dupa generare si inainte de commit/publicare.
