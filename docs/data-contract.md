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

## Compatibilitate

Schimbarile care adauga doar campuri optionale pot pastra aceeasi versiune.

Schimbarile incompatibile, precum redenumirea sau eliminarea campurilor obligatorii, necesita cresterea versiunii contractului.

## Validare

Workflow-ul valideaza structura minima dupa generare si inainte de commit/publicare.
