# Strategia surselor

Versiune aplicatie: `0.06-dev`
Ultima actualizare: `2026-09-27`

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

- 160 intrari in catalog, inclusiv JobsPipe explicit; 159 sunt fizic active dupa decizia ownerului din 2026-09-25, iar Oyster ramane singura intrare inactiva (`validating + pending`); Monster ramane exclus operational indiferent de starea legacy fizica;
- adaptere API existente sunt validate/activate controlat conform Package 2C;
- JobsPipe este `disabled` in configuratia runtime;
- Jobicy ramane operational independent;
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

### 3.1 Evaluarea unei surse noi

O sursa candidata se evalueaza dupa valoarea reala pentru corpusul JSCC, nu dupa popularitatea site-ului sau numarul total de anunturi afisat de provider.

Auditul minim obligatoriu verifica:

1. **Acoperire geografica reala** — tarile/regiunile dominante in joburile efectiv publicate, nu doar aria declarata de platforma.
2. **Relevanta pentru rolurile tinta JSCC** — Project Manager, IT Project Manager, Agile Project Manager, Scrum Master, Service Manager si Delivery/Technical PM.
3. **Remote real si eligibilitate geografica** — se distinge `worldwide / Europe / EU` de formule restrictive precum `remote from country X`, rezidenta obligatorie sau relocare.
4. **Volum relevant dupa filtrele JSCC** — se estimeaza joburile care pot supravietui criteriilor JSCC; volumul total al platformei nu este criteriu de calificare.
5. **Recente/calitate/duplicate** — activitatea anunturilor, vechimea, repostarile, duplicatele si semnalele de joburi expirate sau agregate slab.
6. **Tip contractual** — B2B/contract/freelance/permanent si, unde exista, transparenta ratei sau salariului.
7. **Acces tehnic** — API/feed/sitemap/ATS/pagini publice, stabilitatea rutei, limite tehnice, robots/challenge/login si necesitatea unui connector dedicat.
8. **Permisiune de colectare** — ToS/licenta/conditii de reutilizare si orice restrictie care face colectarea automata neautorizata sau nepotrivita.
9. **Canonical source resolution** — posibilitatea de a rezolva anuntul catre pagina first-party a angajatorului si de a pastra provenance fara a folosi agregatorul drept identitate canonica.

Regula de calificare:

> O sursa nu se califica dupa volumul total de joburi, ci dupa volumul estimat de joburi relevante si eligibile care supravietuiesc filtrelor JSCC.

Outputul unei evaluari trebuie sa contina cel putin:
- valoare JSCC `HIGH / MEDIUM / LOW` ca evaluare analitica, nu ca field operational din Source Registry;
- scope geografic util si restrictiile de eligibilitate;
- ruta tehnica disponibila sau blocker-ul;
- restrictii ToS/policy relevante;
- recomandarea de guvernanta (`validate`, `defer` sau `reject`) si next action;
- daca sursa intra in registry, starea initiala ramane conform fluxului canonic: `pending`, `approval_status=pending`, `active=false`.

Aceasta sectiune nu reintroduce campul legacy `priority` si nu modifica schema Source Registry. Ea standardizeaza analiza care precede o decizie de validare/aprobare.

## 4. Excluderi operationale de politica

Monster este exclus operational.

Protectia este aplicata in doua locuri:

- Command API / source governance forteaza starea operationala inactiva si blocheaza `activate`;
- search orchestration marcheaza sursa `inactive` si nu o trimite niciunui collector, chiar daca o intrare legacy contine `active=true`.

Astfel, o stare legacy din JSON nu poate reactiva accidental Monster.

Cleanup-ul fizic al intrarii Monster este separat si amanat in #237. #93 nu modifica acea intrare; aceasta este singura exceptie fizica legacy tolerata temporar.

Excluderile company-specific sunt profile-owned si nu fac parte din Source Registry sau din baseline-ul repository-ului.

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

Decizia ownerului din 2026-09-25 reactiveaza #49: Full Search normal traverseaza intregul registru activ prin orchestrarea existenta. Excluderile de politica, credentialele lipsa, providerii amanati si rutele nevalidate raman fail-closed si sunt raportate prin outcome-uri explicite.

### Remote-first batch #313-#320

Implementarea autorizata adauga 29 surse sub categoria existenta `Companii remote-first`. Starea curenta este 28 `validated + approval pending + active=false` si Oyster `validating + approval pending + active=false`.

Rutarea reutilizeaza:
- 11 board-uri Greenhouse prin connectorul generic existent;
- 12 board-uri Ashby prin connectorul generic existent;
- Whereby prin Lever si Slite prin BambooHR;
- Cal.com prin noul connector generic BreezyHR;
- SafetyWing prin noul connector generic Pinpoint;
- Traefik Labs printr-un collector bounded, source-specific, care reutilizeaza transportul web securizat;
- Float prin collectorul web existent, unde zero rezultate valide ramane `success_empty`.

Cele 28 de intrari Remote-first deja validate au fost aprobate si activate prin decizia ownerului din 2026-09-25. Oyster ramane `validating + pending + inactive` pana la validarea connector-level. Validarea, aprobarea si activarea raman tranzitii distincte pentru sursele viitoare.

Referinta pentru date structurate: https://schema.org/JobPosting

Decizie initiala colectare web: `docs/adr/ADR-001-web-source-collection.md`.
