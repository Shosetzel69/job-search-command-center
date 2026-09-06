# Strategia surselor

Versiune aplicatie: `0.05`
Ultima actualizare: `2026-09-06`

## 1. Principiu

Strategia executata de runner este `all active sources equally`.

Nu exista prioritate operationala 1-5. Campul `priority` din catalogul legacy este ignorat si este eliminat la normalizarea registrului.

Se prefera, in ordine:

1. API public oficial fara credentiale;
2. job board ATS public si documentat;
3. API/provider autorizat;
4. HTTP/JSON-LD;
5. browser fallback limitat pentru randare JavaScript.

Browserul nu este folosit pentru ocolirea robots, autentificarii, HTTP 401/403/429 sau CAPTCHA.

## 2. Catalog vs connector

`data/sources.json` este catalogul gestionat din UI. Prezenta unei surse in catalog nu inseamna connector operational.

URL-ul din catalog este URL-ul uman/canonic al sursei. Daca pentru colectare exista un endpoint public mai bun, ruta operationala este pastrata separat in `shared/source-api-routes.json`.

```text
Source catalog != Operational route != Connector
```

Stare curenta:

- 130 intrari in catalog, inclusiv JobsPipe explicit;
- adaptoare API implementate: JobsPipe, Jobicy, Jobgether, Himalayas, Working Nomads, Remote OK, Remotive, SmartRecruiters, Greenhouse si Ashby;
- JobsPipe este `disabled` in configuratia runtime;
- Jobicy si API-urile publice fara credentiale raman independente de JobsPipe;
- collector web comun pentru sursele HTTP(S) active care nu sunt rutate sau amanate explicit;
- suportul se deriva din cod/registru, nu dintr-un flag trimis de client.

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
- o sursa HTTP(S) activa este colectata numai daca exista o strategie operationala permisa pentru ea.

La prima mutatie, catalogul legacy este normalizat la schema 1.0 cu `id` stabil si `connector_available`.

## 4. Reguli rezultate

- se folosesc date publice sau API-uri autorizate;
- se prefera link direct la job;
- descrierea se pastreaza cand providerul o furnizeaza;
- data publicarii trebuie sa fie disponibila pentru ca un rezultat API nou sa poata trece filtrul de freshness;
- repostarile sunt marcate;
- toate rezultatele intra in modelul intern comun;
- sursa nu primeste avantaj de scoring;
- geo-eligibility este separata de FIT.

## 5. JobsPipe

JobsPipe este o singura sursa operationala la nivel de arhitectura. Apify si Direct sunt transporturi ale aceleiasi surse si nu sunt numarate separat in `sources_processed`.

### Stare runtime curenta

`jobspipe_mode=disabled`.

Aceasta stare garanteaza zero cereri JobsPipe/Apify pentru provider. Celelalte surse active continua independent.

### Transporturi disponibile, dar inactive

Apify:

- Actor oficial `jobspipe~jobspipe-job-search`;
- `APIFY_TOKEN` in GitHub Actions Secrets;
- plafon configurabil 100-20.000.

Direct:

- `JOBSPIPE_API_KEY` in GitHub Actions Secrets;
- preview gratuit;
- polling incremental `discovered_at_gte`;
- cursor backlog;
- guard lunar si circuit breaker la quota exhausted.

Reactivarea JobsPipe se trateaza separat dupa stabilizarea celorlalte surse.

## 6. API-uri publice directe (#56)

Adaptoarele de mai jos folosesc endpointuri publice, fara credentiale:

| Sursa | Ruta operationala | Regula operationala |
|---|---|---|
| Jobicy | `https://jobicy.com/api/v2/remote-jobs?count=200` | maximum o incercare/ora |
| Jobgether | `https://jobgether.com/api/v1/jobs` | sortare dupa data, interogari pe rol, paginare limitata |
| Himalayas | `https://himalayas.app/jobs/api/search` | maximum o incercare/24h, conform ritmului de refresh al feedului |
| Working Nomads | `https://www.workingnomads.com/api/exposed_jobs/` | feed public complet |
| Remote OK | `https://remoteok.com/api` | feed public; primul obiect de metadata nu este tratat ca job |
| Remotive | `https://remotive.com/api/remote-jobs` | maximum o incercare/6h; feedul public poate avea intarziere de aproximativ 24h |

Toate adaptoarele livreaza `CollectionResult` si nu implementeaza reguli proprii de scoring.

## 7. Job board-uri ATS publice (#56)

### SmartRecruiters

Job board-urile concrete de companie sunt rutate prin Posting API public. Se foloseste `releasedAfter` pentru fereastra de colectare si `destination=PUBLIC`.

Companii rutate:

- Netcompany / Intrasoft;
- Thales;
- GlobalLogic;
- Endava;
- Bosch Romania;
- Infinity Quest;
- Talan Belgium / Luxembourg;
- ARHS / Accenture.

### Greenhouse

Job board-urile concrete folosesc Job Board API public. Lista este prefiltrata dupa `updated_at`, iar pentru joburile candidate se citeste detaliul si se foloseste `first_published` ca data canonica de publicare.

Companii rutate:

- Xebia CEE;
- ClickHouse;
- Snyk;
- Datadog.

### Ashby

Job board-urile concrete folosesc Public Job Posting API si campul `publishedAt`. `workplaceType` este folosit pentru Remote/Hybrid/Onsite.

Companii rutate:

- Camunda;
- Kong;
- LocalStack.

### Lever

Contentsquare este rutat catre board-ul public Lever curent, dar ramane pe colectare web. Adapterul Lever dedicat este amanat deoarece schema publica documentata nu ofera o data de publicare suficient de clara pentru regula de freshness.

## 8. Providere generice amanate

Urmatoarele radacini generice nu sunt trimise collectorului web:

- LinkedIn;
- Indeed;
- Workday;
- Greenhouse;
- Workable;
- SmartRecruiters;
- Ashby;
- Lever.

Radacina generica a unui ATS nu este tratata ca feed global. Numai un board concret de companie cu identificator cunoscut poate folosi adapterul ATS dedicat.

Aceste intrari apar in `source_results` ca `skipped`, cu `collection_method=deferred` si motiv explicit.

## 9. Rute operationale separate de catalog

`shared/source-api-routes.json` contine suprascrieri operationale pentru sursele unde URL-ul uman din catalog nu este endpointul optim de colectare.

Exemple:

```text
Endava catalog: https://careers.endava.com/
Endava operational: https://careers.smartrecruiters.com/Endava

Camunda catalog: https://camunda.com/career/
Camunda operational: https://jobs.ashbyhq.com/camunda
```

Aceasta separare evita transformarea UI-ului Surse intr-o lista de endpointuri tehnice.

## 10. Restrictii explicite

- EURES nu este automatizat prin API/scraping in lipsa unui statut EURES Partner autorizat;
- LinkedIn si Indeed nu sunt tratate ca API-uri publice de job search;
- Workday nu este tratat ca API public global;
- API-urile care cer parteneriat, credentiale sau acces privat nu sunt activate prin aceasta schimbare;
- endpointurile interne nedocumentate ale site-urilor nu sunt declarate drept API oficial;
- Lever ramane fara adapter dedicat pana cand freshness poate fi determinat fiabil.

## 11. Reguli specifice surselor

- Monster nu este sursa operationala preferata; crawlerul nu mai urmareste zone evidente non-job precum pricing, products, resources, webinars, status, demo sau career-advice;
- cardurile Indeed nu sunt folosite;
- excluderile teritoriale si excluderile de business sunt reguli de selectie, nu reguli ale catalogului de surse, si sunt documentate in `docs/requirements.md` / `data/search-config.json`.

## 12. Executie si raportare

- Fiecare intrare este clasificata: `inactive`, `unsupported`, `skipped`, `completed` sau `failed`.
- Toate sursele active cu strategie operationala participa; `priority` nu limiteaza selectia.
- Sursele cu acelasi endpoint global sunt colectate o singura data; board-urile ATS concrete sunt independente.
- JobsPipe respecta modul configurat; in starea curenta nu face apeluri.
- Erorile per sursa sunt izolate. Esecul tuturor colectarilor pastreaza `jobs.json` neschimbat.
- Deduplicarea comuna compara URL-uri fara tracking si titlu/companie/geografie/mod intre surse.
- `source_results` pastreaza atat URL-ul din catalog, cat si `operational_url` si motivul rutei, unde exista.

Diagnosticul web per sursa include, unde este disponibil:

- `collection_method`;
- `requested_url`;
- `final_url`;
- `http_status`;
- `robots_status`;
- `browser_attempted`;
- `browser_status`;
- `failure_reason`;
- pagini incercate/fetch-uite si joburi detectate.

## 13. Colectare web HTTP

Collectorul web foloseste mai intai transportul HTTP existent:

- descoperire linkuri de cariere, anunturi si paginare;
- extractie `JobPosting` JSON-LD, inclusiv `@graph`/liste;
- titlu, companie, descriere, data si URL din anunt;
- anunturile expirate sunt eliminate;
- `applicantLocationRequirements` are prioritate fata de sediul companiei pentru Remote;
- 12 pagini / 45 secunde / 2 MiB per pagina / minimum 0,5 secunde intre cereri pe host;
- maximum 12 surse concurente;
- robots.txt, DNS public, redirect-uri validate, fara cookie-uri/credentiale si fara ocolire CAPTCHA/login.

Un HTTP 200 fara `JobPosting` nu este contabilizat ca succes.

## 14. Browser fallback

Daca prima pagina este accesibila prin HTTP, pare dinamica si nu contine `JobPosting`, collectorul poate face o singura a doua incercare cu Chromium/Playwright.

Reguli:

- browserul este pentru randare JavaScript, nu pentru bypass;
- nu ruleaza dupa blocaj robots, HTTP 401/403/429, login obligatoriu sau CAPTCHA;
- maximum 2 sesiuni Chromium simultan;
- maximum 8 secunde de randare pentru o pagina si in limita bugetului total al sursei;
- HTML-ul randat reintra in acelasi parser JSON-LD si acelasi pipeline comun;
- nu se fac presupuneri DOM specifice site-ului in fallback-ul generic.

## 15. Outcome-uri web

`web_outcome` poate fi:

- `extracted`;
- `partial`;
- `no_active_jobs`;
- `no_extractable_jobs`;
- `blocked`;
- `error`.

`coverage_complete=false`: collectorul generic nu garanteaza acoperire exhaustiva.

Lipsa rezultatelor nu demonstreaza lipsa joburilor.

## 16. Extindere

Fiecare provider nou livreaza `CollectionResult`. Adaugarea unui adapter care respecta contractul existent nu modifica geografia, filtrarea sau scoring-ul si nu necesita ADR.

Referinta pentru date structurate: https://schema.org/JobPosting

Decizie initiala colectare web: `docs/adr/ADR-001-web-source-collection.md`.
