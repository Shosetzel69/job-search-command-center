# Strategia surselor

Versiune aplicatie: `0.06-dev`
Ultima actualizare: `2026-09-22`

## 1. Principiu

### Shared collection invariant — ADR-005

Retrieval-ul extern este shared/system-owned. O sursa eligibila este colectata ca parte din corpusul comun, nu separat pentru fiecare user/profil.

Profilele utilizatorilor nu controleaza provider calls si nu creeaza Full Search propriu. Ele aplica ulterior eligibility/FIT/state peste shared canonical job corpus.

Consecinta de capacitate: cresterea numarului de utilizatori nu trebuie sa multiplice direct traficul catre surse.

Strategia executata de runner ramane `all active sources equally` pentru sursele eligibile operational.

Nu exista prioritate operationala 1-5. Campul `priority` nu mai exista in catalogul fizic si nu participa la normalizare sau selectie.

Prin #93, toate intrarile non-Monster sunt materializate fizic cu starea persistenta de guvernanta (`collection_method`, `connector_available`, `validation_status`, `approval_status`, `last_validated_at`, `validation_reason`, `policy_excluded`). Aceste campuri sunt diferite de outcome-urile unei rulari.

O regula explicita de excludere operationala prevaleaza peste un eventual `active=true` ramas intr-o intrare legacy.

## 2. Catalog vs connector

`data/sources.json` este catalogul gestionat din UI. Prezenta unei surse in catalog nu inseamna connector operational.

Stare curenta:

- 130 intrari in catalog, inclusiv JobsPipe explicit;
- adaptere API existente sunt validate/activate controlat conform Package 2C;
- JobsPipe este `disabled` in configuratia runtime;
- Jobicy ramane operational independent;
- Remote OK foloseste feed-ul JSON public oficial `https://remoteok.com/api`, cu link-back la anuntul furnizorului; nu mai consuma generic web crawl;
- collector web comun pentru sursele HTTP(S) active, eligibile si nerutate/amanate explicit;
- suportul se deriva din cod/registru, nu dintr-un flag trimis de client.

## 3. Administrarea registrului - Package 2A

Zona `Administrare -> Surse` separa catalogul de guvernanta operationala.

Flux:

```text
pending
  -> validating
  -> validated / requires_connector / rejected
  -> approved
  -> active
```

Reguli:

- sursa noua intra `pending` si `active=false`;
- validarea, aprobarea si activarea sunt actiuni distincte;
- activarea necesita `validation_status=validated` si `approval_status=approved`;
- o sursa poate fi dezactivata fara a pierde istoricul de validare/aprobare;
- validarea tehnica automata URL/API/ATS este scope Package 2C; 2A implementeaza contractul si tranzitiile de guvernanta;
- URL duplicat este blocat;
- stergerea necesita confirmare UI;
- secretele connectorilor nu se stocheaza in catalog;
- o sursa HTTP(S) activa este colectata numai daca exista o strategie operationala permisa pentru ea.

Categoriile sunt controlate prin `data/source-categories.json`; nu se creeaza accidental prin text liber. Redenumirea muta referintele surselor, iar stergerea unei categorii este blocata cat timp exista surse asociate.

## 4. Excluderi operationale de politica

Monster este exclus operational.

Protectia este aplicata in doua locuri:

- Command API / source governance forteaza starea operationala inactiva si blocheaza `activate`;
- search orchestration marcheaza sursa `inactive` si nu o trimite niciunui collector, chiar daca o intrare legacy contine `active=true`.

Astfel, o stare legacy din JSON nu poate reactiva accidental Monster.

Cleanup-ul fizic al intrarii Monster este separat si amanat in #237. #93 nu modifica acea intrare; aceasta este singura exceptie fizica legacy tolerata temporar.

Star Storage si companiile grupului raman excluse prin regulile de business/search configurate; acestea nu sunt reintroduse prin source governance.

## 5. Reguli rezultate

- se folosesc date publice sau API-uri autorizate;
- se prefera link direct la job;
- descrierea se pastreaza cand providerul o furnizeaza;
- repostarile sunt marcate;
- toate rezultatele intra in modelul intern comun;
- sursa nu primeste avantaj de scoring;
- geo-eligibility este separata de FIT;
- in target-ul ADR-005, source collection este separata de personal eligibility/FIT;
- lipsa rezultatelor sau coverage incomplet nu poate fi interpretata ca monitorizare exhaustiva a sursei.

## 6. JobsPipe

JobsPipe este o singura sursa operationala la nivel de arhitectura. Apify si Direct sunt transporturi ale aceleiasi surse si nu sunt numarate separat in `sources_processed`.

### Stare runtime curenta

`jobspipe_mode=disabled`.

Aceasta stare garanteaza zero cereri JobsPipe/Apify pentru provider. Celelalte surse eligibile continua independent.

Codul transporturilor Apify/Direct ramane disponibil, dar nu este activat in Package 2A.

## 7. Providere amanate din crawlerul generic

Urmatoarele intrari generice nu sunt trimise collectorului web cat timp ruta dedicata este amanata:

- LinkedIn;
- Indeed;
- Workday;
- Greenhouse;
- Workable;
- SmartRecruiters;
- Ashby;
- Lever.

Regula se aplica radacinii generice a providerului din catalog. Un job board concret al unui angajator poate fi eligibil numai conform rutarii si gate-ului de validare aplicabil.

Aceste intrari apar in `source_results` ca `skipped`, cu motiv explicit. Nu sunt raportate fals ca site-uri fara joburi.

## 8. Executie si raportare

Campul legacy `status` ramane temporar pentru compatibilitate (`inactive|unsupported|skipped|completed|failed`), dar contractul canonic per run este `outcome`:

- `success`;
- `success_empty`;
- `failed`;
- `deferred_provider`;
- `blocked_credentials`;
- `validation_pending`;
- `disabled_config`;
- `excluded_policy`;
- `skipped` pentru omisiuni operationale intentionate care nu sunt failure.

Reguli:

- `priority` nu limiteaza selectia;
- Source Registry state nu este acelasi lucru cu execution outcome;
- o excludere de politica produce `excluded_policy`;
- provider roots amanate produc `deferred_provider`;
- connectorii blocati de credentiale si rutele nevalidate sunt raportate distinct;
- sursele cu acelasi connector/endpoint sunt colectate o singura data; aliasurile pot fi `skipped`;
- JobsPipe dezactivat produce `disabled_config`;
- Jobicy cooldown/quota guards sunt `skipped`, nu failure;
- executia reusita fara rezultate este `success_empty`, nu failure;
- orice `failed` are `error_code` si `failure_stage` structurate;
- textul `error` / `failure_reason` este numai pentru oameni si nu este parsabil ca API contract;
- exceptia legacy JobsPipe direct pentru monthly quota este provider-specific si amanata in #236; nu apartine contractului generic;
- aceleasi rezultate structurate sunt publicate in status si istoric.
- lifecycle-ul run/source emite evenimente JSON structurate si sanitizate; aceste loguri sunt evidence operational, nu sursa de adevar pentru status.

## 9. Colectare web HTTP

Collectorul web foloseste transportul HTTP existent cu limite si protectii:

- descoperire linkuri de cariere, anunturi si paginare;
- extractie `JobPosting` JSON-LD;
- anunturile expirate sunt eliminate;
- maximum 12 pagini / 45 secunde / 2 MiB per pagina;
- minimum 0,5 secunde intre cereri pe host;
- maximum 12 surse concurente;
- robots.txt, DNS public, redirect-uri validate;
- fara cookie-uri/credentiale si fara ocolire CAPTCHA/login.

Un HTTP 200 fara `JobPosting` nu este contabilizat ca succes.

## 10. Browser fallback

Daca prima pagina este accesibila prin HTTP, pare dinamica si nu contine `JobPosting`, collectorul poate face o singura incercare Chromium/Playwright in limitele aprobate.

Nu este folosit pentru bypass robots, HTTP 401/403/429, login obligatoriu sau CAPTCHA.

## 11. Outcome-uri web

`web_outcome` poate fi:

- `extracted`;
- `partial`;
- `no_active_jobs`;
- `no_extractable_jobs`;
- `blocked`;
- `error`.

`coverage_complete=false` inseamna ca collectorul generic nu garanteaza acoperire exhaustiva.

Lipsa rezultatelor nu demonstreaza lipsa joburilor.

## 12. Package 2C

Activarea connectorilor suplimentari se face numai dupa:

```text
implementat
+ testat
+ validat pe sursa concreta
+ aprobat
-> activare registry
```

Nu se introduce in Package 2 obiectivul de acoperire completa a tuturor surselor active. #49 ramane exclus din Package 2 conform deciziei ownerului.

Referinta pentru date structurate: https://schema.org/JobPosting

Decizie initiala colectare web: `docs/adr/ADR-001-web-source-collection.md`.
