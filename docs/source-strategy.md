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
- adaptere API implementate: JobsPipe si Jobicy;
- JobsPipe este `disabled` in configuratia runtime;
- Jobicy ramane operational independent;
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

## 6. Providere amanate din crawlerul generic (#54)

Urmatoarele intrari generice nu sunt trimise collectorului web cat timp ruta dedicata este amanata:

- LinkedIn;
- Indeed;
- Workday;
- Greenhouse;
- Workable;
- SmartRecruiters;
- Ashby;
- Lever.

Regula se aplica radacinii generice a providerului din catalog. Un job board concret al unui angajator, de exemplu un URL Ashby/Greenhouse/Lever descoperit din pagina companiei, poate ramane eligibil pentru collectorul web daca respecta regulile de acces.

Aceste intrari apar in `source_results` ca `skipped`, cu `collection_method=deferred` si motiv explicit. Nu sunt raportate fals ca site-uri fara joburi.

## 7. Reguli specifice surselor

- Monster nu este sursa operationala preferata; crawlerul nu mai urmareste zone evidente non-job precum pricing, products, resources, webinars, status, demo sau career-advice;
- cardurile Indeed nu sunt folosite;
- excluderile teritoriale si excluderile de business sunt reguli de selectie, nu reguli ale catalogului de surse, si sunt documentate in `docs/requirements.md` / `data/search-config.json`.

## 8. Executie si raportare

- Fiecare intrare este clasificata: `inactive`, `unsupported`, `skipped`, `completed` sau `failed`.
- Toate sursele active cu strategie operationala participa; `priority` nu limiteaza selectia.
- Sursele cu acelasi connector/endpoint sunt colectate o singura data; aliasurile sunt raportate ca `skipped`.
- JobsPipe respecta modul configurat; in starea curenta nu face apeluri.
- Jobicy: un GET pentru cele mai recente 200 listari, cel mult o incercare pe ora.
- Erorile per sursa sunt izolate. Esecul tuturor colectarilor pastreaza `jobs.json` neschimbat.
- Deduplicarea comuna compara URL-uri fara tracking si titlu/companie/geografie/mod intre surse.
- Aceleasi campuri de acoperire sunt publicate in status si istoric, apoi afisate in Loguri.

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

## 9. Colectare web HTTP

Collectorul web foloseste mai intai transportul HTTP existent:

- descoperire linkuri de cariere, anunturi si paginare;
- extractie `JobPosting` JSON-LD, inclusiv `@graph`/liste;
- titlu, companie, descriere, data si URL din anunt;
- anunturile expirate sunt eliminate;
- `applicantLocationRequirements` are prioritate fata de sediul companiei pentru Remote;
- 12 pagini / 45 secunde / 2 MiB per pagina / minimum 0,5 secunde intre cereri pe host;
- maximum 12 surse concurente;
- robots.txt, DNS public, redirect-uri validate, fara cookie-uri/credentiale si fara ocolire CAPTCHA/login.

Link discovery exclude explicit zone care nu sunt joburi: login, privacy/terms, blog/news, pricing, products, solutions, resources, webinars, status/history, demo, contact, support/help si career-advice.

Un HTTP 200 fara `JobPosting` nu este contabilizat ca succes.

## 10. Browser fallback (#54)

Daca prima pagina este accesibila prin HTTP, pare dinamica si nu contine `JobPosting`, collectorul poate face o singura a doua incercare cu Chromium/Playwright.

Reguli:

- browserul este pentru randare JavaScript, nu pentru bypass;
- nu ruleaza dupa blocaj robots, HTTP 401/403/429, login obligatoriu sau CAPTCHA;
- navigarea initiala si finala este validata prin aceeasi politica robots/public URL;
- cererile browserului sunt limitate la domeniul sursei si la resurse necesare randarii;
- `document`, `xhr` si `fetch` sunt verificate prin politica robots;
- maximum 2 sesiuni Chromium simultan;
- maximum 8 secunde de randare pentru o pagina si in limita bugetului total al sursei;
- imaginile, media, fonturile si alte resurse nenecesare sunt blocate;
- HTML-ul randat reintra in acelasi parser JSON-LD si acelasi pipeline comun;
- nu se fac presupuneri DOM specifice site-ului in acest fallback generic.

Daca pagina randata expune linkuri de job, acestea pot fi urmate apoi de collectorul HTTP in limita bugetului existent.

## 11. Outcome-uri web

`web_outcome` poate fi:

- `extracted`;
- `partial`;
- `no_active_jobs`;
- `no_extractable_jobs`;
- `blocked`;
- `error`.

`coverage_complete=false`: collectorul generic nu garanteaza acoperire exhaustiva.

`discovered_pages_complete` se refera numai la linkurile descoperite in bugetul rularii.

Lipsa rezultatelor nu demonstreaza lipsa joburilor.

## 12. Extindere

Fiecare provider nou livreaza `CollectionResult`. Adaugarea unui adapter care respecta contractul existent nu modifica geografia, filtrarea sau scoring-ul si nu necesita ADR.

Extractoarele specifice site-urilor se adauga numai dupa ce HTTP + browser fallback demonstreaza ca pagina este accesibila, dar datele nu pot fi normalizate generic.

Referinta pentru date structurate: https://schema.org/JobPosting

Decizie initiala colectare web: `docs/adr/ADR-001-web-source-collection.md`.
