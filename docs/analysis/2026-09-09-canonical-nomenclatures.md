# Analiza - Nomenclatoare canonice

Data: 2026-09-09
Status: `APPROVED FOR DEVELOPMENT`
Issue principal: #116
Package: 2A8

## 1. Scop

Analiza rafineaza cerinta #116 dupa testarea Package 2A si stabileste modelul tehnic inainte de implementare.

Problema reala nu este doar faptul ca pagina `Administrare -> Nomenclatoare` este informativa. Aceleasi concepte de business sunt definite independent in mai multe straturi:

- React: regiuni, tari, work modes;
- Command API: membership regiuni si validari proprii;
- Python runner: membership regiuni, tari, aliases;
- `search-config.json`: selectii active;
- job data: employment type fara contract canonic complet.

Aceasta duplicare permite divergente si regresii. Obiectivul 2A8 este eliminarea surselor multiple de adevar pentru domeniile controlate incluse explicit in scope.

## 2. Constatari AS-IS

### 2.1 Geografie duplicata

Membership-ul `EU`, `US`, `ASIA` si denumirile tarilor sunt prezente in React, Worker si Python.

Risc:

- un cod poate fi adaugat intr-un strat si omis in altul;
- conflict checks si filtrarea pot produce rezultate diferite;
- testele locale pot trece in timp ce runtime-ul are alta taxonomie.

### 2.2 Work modes incomplet canonice

`search-config.json` foloseste in prezent `remote` si `hybrid`, in timp ce UI-ul recunoaste si `Onsite` si `N/A`.

Concluzie:

- `onsite` trebuie sa devina valoare canonica configurabila;
- `N/A` este stare tehnica pentru date incomplete, nu criteriu normal de selectie.

### 2.3 Contract type nu este un domeniu canonic

Joburile pot contine `type`/valori provider-specific si semnale precum B2B, dar nu exista un camp canonic stabil pentru filtrarea Permanent/Temporar/Contract/Freelance.

Concluzie:

- este necesar `contract_type` canonic;
- raw provider value trebuie pastrata separat unde este util;
- clasificarea trebuie sa fie conservatoare.

### 2.4 Admin generic ar fi periculos

Nu orice nomenclator poate permite `Add` arbitrar.

Exemplu: un cod nou `work_mode=field` ar putea aparea in UI, dar runner-ul nu i-ar cunoaste semantica.

Concluzie: este obligatorie distinctia `system/semantic` vs `extensible`.

### 2.5 Integritate referentiala insuficient definita

Dezactivarea unei valori deja folosite nu poate modifica silent configuratia. Pentru geografie, eliminarea automata a ultimei tinte ar putea recrea incidentul target gol/Worldwide implicit.

Concluzie: deactivate/delete pe valoare referentiata -> `409 Conflict` + lista referintelor.

### 2.6 Runtime protected assets are risc structural

Bugul #114 a aparut deoarece build-ul si allowlist-ul Worker nu erau sincronizate pentru `source-categories.json`.

Adaugarea `nomenclatures.json` ar repeta acelasi risc daca listele raman independente.

Concluzie: manifest comun sau CI parity guard obligatoriu.

## 3. Decizia de design

### 3.1 Sursa canonica

Se introduce:

`data/nomenclatures.json`

Schema: `1.0`.

Domenii initiale:

1. `regions`;
2. `countries`;
3. `work_modes`;
4. `contract_types`;
5. `application_statuses`;
6. `seniority` - infrastructura only.

Nu se muta in acest fisier:

- role groups/titles;
- freshness;
- FIT threshold;
- rate;
- immediate start;
- exclusions;
- JobsPipe settings.

## 4. Model system vs extensible

### 4.1 System / semantic

Codul are semantica folosita de business logic. Nu poate fi creat/sterg arbitrar din Admin.

Initial:

- countries;
- regions;
- work_modes;
- contract_types;
- seniority.

Operatii permise initial, unde sunt sigure:

- edit label;
- active/deactivate cu reference check;
- sort order.

Codul tehnic ramane immutable.

### 4.2 Extensible

Un domeniu poate fi extensibil doar daca:

- este declarat explicit `extensible=true`;
- toti consumatorii trateaza codurile generic;
- nu exista business logic hard-coded pentru fiecare valoare.

`application_statuses` poate evolua in acest sens. In prima migrare se garanteaza doar pastrarea `applied`.

## 5. Model de date propus

Structura conceptuala:

```json
{
  "schema_version": "1.0",
  "domains": {
    "work_modes": {
      "kind": "system",
      "extensible": false,
      "values": [
        {
          "code": "remote",
          "label": "Remote",
          "active": true,
          "sort_order": 10,
          "aliases": ["remote"]
        }
      ]
    }
  }
}
```

Campuri minime per valoare:

- `code`;
- `label`;
- `active`;
- `sort_order`.

Metadata optionala:

- `aliases`;
- `country_codes` pentru regiuni;
- alte metadata tehnice documentate explicit.

## 6. Geografie

### 6.1 Semantica pastrata

- `EU` = Uniunea Europeana;
- `US` = Statele Unite conform comportamentului curent;
- `ASIA` = membership-ul actual al aplicatiei la momentul migrarii.

Nu se redenumeste semantic `EU` in Europa.

Daca este nevoie ulterior de continentul Europa:

`EUROPE` = cod separat.

### 6.2 Remote scopes

`Worldwide` si `EMEA` raman scope-uri Remote, nu regiuni tinta in 2A8.

### 6.3 Fail-safe

Raman obligatorii:

- target tara/regiune nenul;
- reject conflict include/exclude;
- Hybrid/Onsite unknown geography nu este presupus eligibil;
- parity tests pentru comportamentul existent.

## 7. Work modes

Coduri canonice:

- `remote`;
- `hybrid`;
- `onsite`.

`N/A`:

- poate exista in job normalized data ca stare tehnica;
- nu este oferit ca selectie normala in `Criterii de selectie`.

Migrare:

- structura actuala `work_modes` din search config se pastreaza;
- se adauga compatibil `onsite`;
- nu se transforma inutil intr-un array nou.

## 8. Contract types

Coduri initiale:

- `permanent`;
- `temporary`;
- `contract`;
- `freelance`.

Camp job nou:

- `contract_type` - canonic;
- `employment_type_raw` - optional, valoare sursa/provider.

Fallback:

- `unknown` tehnic cand nu exista suficienta informatie.

Regula:

- nu se forteaza maparea pe baza unui semnal ambiguu;
- aliases/mapping-urile sunt metadata tehnica, nu configuratie libera de utilizator.

## 9. Application statuses

Datele curente contin `status=applied`.

2A8 trebuie sa garanteze:

- `applied` ramane cod valid;
- migrarea nu modifica istoricul aplicarii;
- nu se inventeaza automat statusuri suplimentare.

Taxonomia completa a lifecycle-ului aplicarilor necesita cerinta separata daca este dorita.

## 10. Seniority

Se pregateste domeniul in contract pentru extindere ulterioara.

Nu se implementeaza acum:

- selector Seniority;
- normalizare provider seniority;
- impact FIT;
- reguli de excludere.

Motiv: taxonomia si normalizarea nu sunt inca definite suficient.

## 11. Integritate referentiala

Flux obligatoriu:

```text
Admin cere deactivate/delete
        |
        v
Reference check
        |
        +-- nefolosit -> operatia poate continua
        |
        +-- folosit -> HTTP 409 + references[]
```

Exemple de referinte:

- `search-config.target_regions`;
- `search-config.target_country_codes`;
- `search-config.excluded_regions`;
- `search-config.excluded_country_codes`;
- `search-config.work_modes`;
- `search-config.contract_types`;
- `applications.status` unde devine aplicabil.

Nu exista cleanup/migrare silent.

## 12. Boundary tehnic

Single source of truth inseamna date comune, nu cod executabil comun.

```text
              nomenclatures.json
                     |
        +------------+-------------+
        |            |             |
      React      Command API      Python
      display     validation      business logic
```

React, Worker si Python isi pastreaza algoritmii specifici. Nu se introduce runtime cross-language dependency.

## 13. Runtime assets

Se adauga `nomenclatures.json` in protected runtime data.

#121 trebuie sa elimine riscul de mismatch intre:

- build static copy list;
- Worker protected allowlist;
- CI contract list;
- frontend load list.

Preferinta de design:

- manifest canonic comun daca poate fi facut fara complexitate artificiala;
- altfel CI parity test strict intre liste.

`search-state.json` ramane intern.

## 14. Impact pe componente

### Frontend

- elimina constantele functionale migrate;
- incarca nomenclatoarele dupa auth;
- foloseste label pentru afisare si code pentru configuratie;
- Admin diferentiaza system/extensible;
- adauga selector contract type;
- elimina N/A din work mode criteria.

### Command API

- endpoint read + mutatii aprobate;
- validare coduri active;
- reference checks;
- 409 cu referinte;
- no dispatch la save/mutation.

### Runner

- incarca acelasi fisier canonic;
- foloseste region membership si aliases;
- normalizeaza work mode/contract type;
- fail-fast pe schema invalida.

### Data contract

- `nomenclatures.json` schema 1.0;
- `jobs.json` extins cu `contract_type` si optional raw employment type;
- `search-config.json` extins cu `work_modes.onsite` si contract type selection.

### CI

- schema validation;
- parity geography;
- nomenclature reference checks;
- runtime assets parity;
- normalization tests;
- zero live crawl.

## 15. Migrare

Ordine recomandata:

1. introducere contract fara schimbare comportament;
2. seed din constantele curente;
3. parity tests;
4. mutare geografie;
5. mutare work modes;
6. introducere contract types;
7. Admin/API;
8. runtime parity guard;
9. E2E;
10. eliminare constante duplicate numai dupa parity PASS.

## 16. Riscuri si mitigari

| Risc | Severitate | Mitigare |
|---|---|---|
| schimbare accidentala membership EU/ASIA | P0/P1 | seed din comportamentul curent + parity tests |
| target geografic devine gol | P0 | reference check 409 + validation fail-safe |
| valoare noua semantica necunoscuta runnerului | P1 | system/extensible model |
| contract type clasificat gresit | P1 | mapping conservator + `unknown` |
| protected asset 404 | P0/P1 | #121 runtime manifest/parity guard |
| migrare rupe configuratia existenta | P1 | additive migration + compatibility tests |
| scope creep spre seniority | P2 | infrastructura only, fara selector |

## 17. ADR

Nu este necesar ADR nou.

Motiv:

- persistenta ramane JSON versionat;
- Command API ramane boundary pentru mutatii;
- React si Python isi pastreaza rolurile;
- nu se introduce DB, serviciu nou, dependency nou sau schimbare de boundary.

Daca implementarea necesita mutarea persistentei in DB/KV/D1 sau un serviciu nou, se opreste si se deschide ADR.

## 18. Decizie finala

#116 este acceptata cu rafinarile acestei analize.

Implementare aprobata in Package 2A8 prin:

- #117 contract;
- #118 geografie;
- #119 work modes + contract types;
- #120 Admin + integrity;
- #121 runtime manifest/CI;
- #122 E2E.

Package 2B incepe dupa inchiderea 2A8.

#49 ramane exclus. JobsPipe ramane disabled.
