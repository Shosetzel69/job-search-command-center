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

Valori permise pentru `status`:

- `running`;
- `completed`;
- `completed_with_errors`;
- `failed`.

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

`role_groups` contine grupuri de roluri. Fiecare grup are:

- `enabled` - boolean;
- `titles` - lista titlurilor trimise catre sursa de cautare.

`work_modes` contine cel putin:

- `remote` - boolean;
- `hybrid` - boolean.

Reguli:

- workflow-ul foloseste aceasta configuratie la construirea query-urilor si la filtrare/scoring;
- frontend-ul foloseste aceeasi configuratie pentru valorile canonice ale criteriilor;
- configurarile locale nesalvate pot exista temporar in browser, dar nu devin configuratie efectiva a workflow-ului fara un mecanism securizat de persistenta;
- secretele si cheile API nu sunt permise in acest fisier.

## Compatibilitate

Schimbarile care adauga doar campuri optionale pot pastra aceeasi versiune.

Schimbarile incompatibile, precum redenumirea sau eliminarea campurilor obligatorii, necesita cresterea versiunii contractului.

## Validare

Workflow-ul valideaza configuratia si structura minima a output-ului dupa generare si inainte de commit/publicare.
