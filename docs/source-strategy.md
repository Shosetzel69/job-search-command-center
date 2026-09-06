# Strategia surselor

Actualizare: 2026-09-06

## 1. Principiu

Strategia tinta este `all active sources equally`.

Nu exista prioritate operationala 1-5. Campul `priority` din catalogul legacy este ignorat si este eliminat la normalizarea registrului.

## 2. Catalog vs connector

`data/sources.json` este catalogul gestionat din UI. Prezenta unei surse in catalog nu inseamna connector operational.

Stare curenta:

- aproximativ 129 intrari in catalog;
- connector operational: JobsPipe;
- transport activ: `apify`;
- plafon curent Apify: 100 joburi brute/rulare;
- modificarile Surse sunt persistate prin Command API;
- o sursa noua manual are implicit `connector_available=false`.

## 3. Administrarea registrului

Din UI se poate:

- adauga sursa;
- edita nume, URL, categorie;
- activa/dezactiva;
- sterge efectiv.

Reguli:

- URL duplicat este blocat;
- stergerea necesita confirmare UI;
- istoricul modificarilor ramane disponibil prin Git;
- nu se implementeaza audit separat in MVP;
- secretele connectorilor nu se stocheaza in catalog;
- `active=true` nu este suficient pentru executie: este necesar si connector operational.

La prima mutatie, catalogul legacy este normalizat la schema 1.0 cu `id` stabil si `connector_available`.

## 4. Reguli rezultate

- se folosesc date publice sau API-uri autorizate;
- se prefera link direct la job;
- descrierea se pastreaza cand providerul o furnizeaza;
- repostarile sunt marcate;
- toate rezultatele intra in modelul intern comun;
- sursa nu primeste avantaj de scoring;
- geo-eligibility este separata de FIT.

## 5. JobsPipe

JobsPipe este o singura sursa operationala. Apify si Direct sunt transporturi ale aceleiasi surse si nu sunt numarate separat in `sources_processed`.

### Apify - activ curent

- `jobspipe_mode=apify`;
- Actor oficial `jobspipe~jobspipe-job-search`;
- `APIFY_TOKEN` in GitHub Actions Secrets;
- colectare geografie tinta + Remote larga;
- plafon configurabil 100-20.000; valoare curenta 100;
- filtrare geografica finala in pipeline-ul comun.

### Direct - fallback

- `JOBSPIPE_API_KEY` in GitHub Actions Secrets;
- preview gratuit;
- polling incremental `discovered_at_gte`;
- cursor backlog;
- query geografie tinta + Remote scope;
- 14 credite/rulare implicit;
- guard lunar 950;
- circuit breaker la quota exhausted.

### Disabled

`jobspipe_mode=disabled` garanteaza zero cereri JobsPipe/Apify si `sources_processed=0` pentru rularea respectiva.

## 6. Excluderi

- Star Storage si companiile grupului;
- implementari ERP care cer experienta specializata ampla;
- roluri non-IT;
- Monster nu este sursa operationala;
- cardurile Indeed nu sunt folosite, dar un link Indeed poate ramane link de job daca acesta este linkul disponibil;
- excluderile teritoriale sunt configurate separat de catalogul de surse.

## 7. Gap-uri

- fisierul catalog existent este legacy pana la prima mutatie persistenta;
- numai JobsPipe are connector operational;
- nu exista orchestrare multi-provider reala;
- deduplicarea cross-provider devine relevanta dupa conectarea altor provideri.

## 8. Extindere

Fiecare provider nou trebuie sa implementeze connectorul comun. Filtrarea, geografia si scoring-ul nu se duplica in connector.
