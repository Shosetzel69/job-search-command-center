# Strategia surselor

Actualizare: 2026-09-05

## 1. Principiu

Strategia tinta este `all active sources equally`.

Nu exista prioritate operationala 1-5. Campul `priority` din `data/sources.json` este legacy.

## 2. Catalog vs connector

`data/sources.json` este catalogul UI. Prezenta unei surse in catalog nu inseamna connector operational.

Stare curenta:

- aproximativ 129 intrari in catalog;
- connector operational: JobsPipe;
- transport activ: `apify`;
- plafon curent Apify: 100 joburi brute/rulare;
- toggle-urile individuale din `Surse` sunt locale.

## 3. Reguli

- se folosesc date publice sau API-uri autorizate;
- se prefera link direct la job;
- descrierea se pastreaza cand providerul o furnizeaza;
- repostarile sunt marcate;
- toate rezultatele intra in modelul intern comun;
- sursa nu primeste avantaj de scoring;
- geo-eligibility este separata de FIT.

## 4. JobsPipe

### Apify - activ curent

- `jobspipe_mode=apify`;
- Actor oficial `jobspipe~jobspipe-job-search`;
- `APIFY_TOKEN` in GitHub Actions Secrets;
- doua cautari geografice fara suprapunere;
- plafon configurabil 100-20.000; valoare curenta 100.

### Direct - fallback

- `JOBSPIPE_API_KEY` in GitHub Actions Secrets;
- preview gratuit;
- polling incremental `discovered_at_gte`;
- cursor backlog;
- 14 credite/rulare implicit;
- guard lunar 950;
- circuit breaker la quota exhausted.

### Disabled

`jobspipe_mode=disabled` garanteaza zero cereri JobsPipe/Apify.

## 5. Excluderi

- Star Storage si companiile grupului;
- implementari ERP care cer experienta specializata ampla;
- roluri non-IT;
- Monster nu este sursa operationala;
- cardurile Indeed nu sunt folosite, dar un link Indeed poate ramane link de job daca acesta este linkul disponibil.

## 6. Gap-uri

- `priority` legacy exista in catalog;
- activ/inactiv per sursa nu este persistat server-side;
- nu exista orchestrare multi-provider reala;
- deduplicarea cross-provider devine relevanta dupa conectarea altor provideri.

## 7. Extindere

Fiecare provider nou trebuie sa implementeze connectorul comun. Filtrarea si scoring-ul nu se duplica in connector.
