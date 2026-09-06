# Strategia surselor

Versiune aplicatie: `0.05`
Ultima actualizare: `2026-09-06`

## 1. Principiu

Strategia executata de runner este `all active sources equally`.

Nu exista prioritate operationala 1-5. Campul `priority` din catalogul legacy este ignorat si este eliminat la normalizarea registrului.

## 2. Catalog vs connector

`data/sources.json` este catalogul gestionat din UI. Prezenta unei surse in catalog nu inseamna connector operational.

Stare curenta:

- 130 intrari in catalog, inclusiv JobsPipe explicit;
- connectori implementati: JobsPipe si Jobicy; E2E Jobicy de confirmat;
- transport activ: `apify`;
- plafon curent Apify: 100 joburi brute/rulare;
- modificarile Surse sunt persistate prin Command API;
- suportul se deriva din `shared/source-connectors.json`, dupa URL; nu este acordat printr-un flag trimis de client.

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

`jobspipe_mode=disabled` garanteaza zero cereri JobsPipe/Apify pentru acest provider. Celelalte surse active continua independent.

## 6. Reguli specifice surselor

- Monster nu este sursa operationala;
- cardurile Indeed nu sunt folosite, dar un link Indeed poate ramane link de job daca acesta este linkul disponibil;
- excluderile teritoriale si excluderile de business sunt reguli de selectie, nu reguli ale catalogului de surse, si sunt documentate in `docs/requirements.md` / `data/search-config.json`.

## 7. Executie si limitari (#49)

- Fiecare intrare este clasificata: `inactive`, `unsupported`, `skipped`, `completed` sau `failed`.
- Toate sursele active suportate participa; `priority` nu limiteaza selectia.
- Sursele cu acelasi connector/endpoint sunt colectate o singura data; aliasurile sunt raportate ca `skipped`.
- JobsPipe respecta modul configurat si guard-ul lunar Direct. Dezactivarea/eliminarea din catalog opreste providerul.
- Jobicy: un GET pentru cele mai recente 200 listari, fara filtre upstream care ar favoriza o categorie. Filtrarea ramane comuna. Feed-ul nu garanteaza toate joburile publicate vreodata.
- Cel mult o incercare Jobicy pe ora, inclusiv la eroare; timestamp-ul se pastreaza in `search-state.json`. Rularile intre timp raporteaza motivul omiterii si pastreaza rezultatele existente.
- Restrictiile teritoriale Jobicy necunoscute nu sunt transformate in Worldwide; necesita suport explicit in normalizare.
- URL-ul si atribuirea Jobicy sunt pastrate. HTML-ul descrierii este convertit in text.
- Documentatie provider: https://github.com/Jobicy/remote-jobs-api
- Nu exista scraper generic. Restul de 128 intrari sunt raportate `unsupported`, fara pretentia ca au fost verificate prin JobsPipe.
- Erorile per sursa sunt izolate. Esecul tuturor colectarilor pastreaza `jobs.json` neschimbat.
- Deduplicarea comuna compara URL-uri fara tracking si titlu/companie/geografie/mod intre surse; ID-urile locale sunt separate pe provider.
- Aceleasi campuri de acoperire sunt publicate in status si istoric, apoi afisate in Loguri.
- Validare E2E dupa merge: de confirmat.

## 8. Extindere

Fiecare provider nou livreaza `CollectionResult`. Adaugarea in registru necesita implementarea adapterului; filtrarea, geografia si scoring-ul nu se duplica in connector. Nu se modifica mecanismul GitHub Actions, persistenta sau autentificarea.
