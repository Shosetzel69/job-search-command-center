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
- adaptere API: JobsPipe si Jobicy; collector web comun pentru restul surselor HTTP(S) active;
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
- orice sursa HTTP(S) activa este incercata: prin adapter dedicat sau prin collector web; disponibilitatea collectorului nu garanteaza extragerea pe orice site.

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
- Colectarea web incearca fiecare URL activ fara API dedicat. Nicio sursa web nu este deduplicata doar pentru ca foloseste acelasi collector.
- Erorile per sursa sunt izolate. Esecul tuturor colectarilor pastreaza `jobs.json` neschimbat.
- Deduplicarea comuna compara URL-uri fara tracking si titlu/companie/geografie/mod intre surse; ID-urile locale sunt separate pe provider.
- Aceleasi campuri de acoperire sunt publicate in status si istoric, apoi afisate in Loguri.
- Validare E2E dupa merge: de confirmat.

## 8. Extindere

Fiecare provider nou livreaza `CollectionResult`. Adaugarea in registru necesita implementarea adapterului; filtrarea, geografia si scoring-ul nu se duplica in connector. Nu se modifica mecanismul GitHub Actions, persistenta sau autentificarea.

## 9. Colectare web aprobata (#49)

- Descoperire linkuri de cariere, anunturi si paginare; extractie `JobPosting` JSON-LD, inclusiv `@graph`/liste. Linkurile ATS descoperite explicit pot fi urmate.
- Titlu, companie, descriere text, data si URL provin din anunt. Anunturile expirate sunt eliminate; cele fara data nu sunt publicate drept recente.
- `applicantLocationRequirements` are prioritate fata de sediul companiei pentru Remote. Teritoriile explicite nerecunoscute nu devin Worldwide.
- 12 pagini / 45 secunde / 2 MiB per pagina / minimum 0,5 secunde intre cereri pe host; maximum 12 surse concurente. Limitele sunt identice pentru toate sursele.
- robots.txt si delay/request-rate sunt respectate. DNS public si IP fixat pe conexiune, redirect-uri validate, fara cookie-uri/credentiale, fara ocolire CAPTCHA/login.
- `web_outcome`: `extracted`, `partial`, `no_active_jobs` (numai anunturi structurate expirate in paginile parcurse), `no_extractable_jobs`, `blocked`, `error`.
- `coverage_complete=false`: collectorul generic nu garanteaza acoperire exhaustiva. `discovered_pages_complete` se refera numai la linkurile descoperite in bugetul rularii.
- Un HTTP 200 fara JobPosting nu este contabilizat ca sursa colectata cu succes. Site-urile dinamice si HTML fara date structurate necesita extractori suplimentari.
- Afisarea Surse foloseste `Colectare: Web/API`; Loguri arata paginile incercate, anunturile detectate, motivele si limitele.
- Referinta standard: https://schema.org/JobPosting ; decizie: `docs/adr/ADR-001-web-source-collection.md`.

## Randare JavaScript (ADR-002)

Cu WEB_BROWSER_ENABLED=1, paginile HTML accesibile care contin scripturi, dar nu JobPosting, primesc o incercare Chromium. Maximum 2 randari/sursa, 20 secunde/randare, 3 browsere concurente; bugetul total ramane 45 secunde/sursa. Dupa randare se extrag JSON-LD si linkuri; nu se inventeaza date din text liber. Erorile pastreaza linkurile HTML initiale. Nu se incearca browserul dupa robots/CAPTCHA/HTTP blocat. Fara login, cookie-uri persistente, requesturi POST sau ocolirea restrictiilor. Pagini care necesita POST, click sau extractori HTML dedicati raman partiale/neextractibile.

Instalare: `python3 -m pip install -r scripts/requirements-browser.txt`, apoi `python3 -m playwright install --with-deps chromium --only-shell`. Dezactivare operationala: eliminarea WEB_BROWSER_ENABLED sau valoarea 0. JobsPipe ramane controlat de configuratia existenta.
