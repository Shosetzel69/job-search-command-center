# Cerinte - Job Search Command Center

Versiune aplicatie: `0.05`
Ultima actualizare: `2026-09-06`

## Regula de lucru pentru cerinte

Pentru orice cerinta noua:

1. analiza impactului;
2. propunere de optimizare, daca este cazul;
3. confirmarea utilizatorului;
4. implementare numai dupa confirmare.

Format standard pentru fiecare cerinta: `ID`, `Titlu`, `Descriere`, `Categorie`, `Sursa`, `Prioritate`.

Daca nu exista informatie pentru un camp sau o sectiune obligatorie, se foloseste `#####`.

---

## 1. Informatii Generale si Prezentare Generala

**Proiect:** Job Search Command Center  
**Versiune aplicatie:** 0.05  
**Scop:** monitorizarea, filtrarea, evaluarea si prioritizarea rolurilor de Project Management pe baza criteriilor definite de utilizator.

Aplicatia nu este un motor de cautare generic. Sistemul colecteaza joburi din sursele operationale, le normalizeaza, aplica eligibilitatea geografica, deduplicarea/repostarea, filtrarea si scoring-ul FIT, apoi publica rezultatele pentru evaluare.

## 2. Obiective si Declaratia Nevoilor

### 2.1 Obiective

- colectarea periodica si manuala a joburilor relevante;
- prioritizarea rolurilor PM / IT PM / Delivery / Service / Scrum / Program;
- Remote prioritar, apoi Hybrid;
- selectie geografica pe regiuni si tari;
- evaluare FIT, argumente pro si riscuri;
- pastrarea descrierii si a linkului de job cand sursa le furnizeaza;
- urmarirea rularilor si a surselor procesate;
- administrarea criteriilor si a catalogului de surse din UI.

### 2.2 Needs Statement

Utilizatorul are nevoie de un sistem care reduce volumul de joburi nerelevante si concentreaza evaluarea pe rolurile eligibile si cu FIT ridicat, pastrand trasabilitatea sursei, descrierii, geografiei, repostarilor si rularilor.

## 3. Domeniul de Aplicare

### 3.1 In-scope pentru versiunea 0.05

- colectare joburi din connectorii operationali;
- normalizare, geo-eligibility, deduplicare/repost, filtrare si scoring;
- UI pentru Joburi noi, De evaluat, Aplicari, Criterii de selectie, Surse si Loguri;
- configurare criterii si excluderi;
- CRUD persistent pentru catalogul Surse;
- rulare manuala si programata;
- Google Sign-In si acces protejat la date;
- persistenta curenta in fisiere JSON versionate in GitHub.

### 3.2 Out-of-scope / neimplementat in versiunea 0.05

- baza de date activa;
- arhitectura multi-user - `UNDER ANALYSIS`;
- MCP;
- notificari/email automate;
- connector generic URL/scraping;
- editarea server-side a aplicarilor;
- persistenta server-side pentru arhivarea rapida a joburilor.

## 4. Cerinte Functionale

### 4.1 Cautare si rezultate

| ID | Titlu | Descriere | Categorie | Sursa | Prioritate |
|---|---|---|---|---|---|
| CFR-01 | Colectare surse | Colectare din sursele conectate si active. | Functionala | ##### | ##### |
| CFR-02 | Fereastra colectare | Fereastra maxima de colectare este 5 zile. | Functionala | ##### | ##### |
| CFR-03 | Timestamp lipsa | Lipsa timestamp-ului nu exclude automat rezultatul daca sursa limiteaza deja vechimea. | Functionala | ##### | ##### |
| CFR-04 | Normalizare si deduplicare | Joburile sunt normalizate si deduplicate. | Functionala | ##### | ##### |
| CFR-05 | Repostari | Repostarile sunt marcate si pastrate cand `keep_reposts=true`. | Functionala | ##### | ##### |
| CFR-06 | Evaluare FIT | FIT include argumente pro si riscuri. | Functionala | ##### | ##### |
| CFR-07 | Link job | Se foloseste linkul disponibil pentru job. | Functionala | ##### | ##### |
| CFR-08 | Descriere job | Descrierea este pastrata cand sursa o furnizeaza. | Functionala | ##### | ##### |
| CFR-09 | Excluderi automate | Excluderile automate au justificare verificabila. | Functionala | ##### | ##### |
| CFR-43 | Mod JobsPipe | JobsPipe suporta `disabled`, `apify`, `direct`. | Functionala | ##### | ##### |
| CFR-44 | JobsPipe Apify | Modul `apify` foloseste Actorul `jobspipe~jobspipe-job-search` si `APIFY_TOKEN` secret. | Functionala | ##### | ##### |
| CFR-46 | Plafon Apify | Plafonul Apify este configurabil intre 100 si 20.000 joburi brute/rulare. | Functionala | ##### | ##### |
| CFR-47 | JobsPipe Direct | Direct foloseste preview, `discovered_at_gte`, cursor si stare persistenta. | Functionala | ##### | ##### |
| CFR-48 | Protectie quota Direct | Direct are buget/rulare, guard lunar si circuit breaker. | Functionala | ##### | ##### |
| CFR-49 | JobsPipe disabled | `disabled` produce zero cereri JobsPipe/Apify si pastreaza rezultatele existente. | Functionala | ##### | ##### |
| CFR-69 | Campuri geografice | Fiecare job publicat poate contine `countries`, `country_codes` si `remote_scope` normalizate. | Functionala | ##### | ##### |
| CFR-70 | Remote Worldwide | Remote fara teritoriu explicit este tratat `Worldwide`. | Functionala | ##### | ##### |
| CFR-71 | Remote cu tari | Remote cu tari explicite este eligibil numai daca Romania este acceptata. | Functionala | ##### | ##### |
| CFR-72 | Remote EU/EMEA | Remote `EU`/`EMEA` este evaluat conform restrictiei explicite. | Functionala | ##### | ##### |
| CFR-73 | Worldwide si excluderi | `Remote Worldwide` nu este eliminat doar pentru ca o regiune este exclusa. | Functionala | ##### | ##### |
| CFR-74 | Selectie geografica | Selectia geografica foloseste regiuni `EU`, `US`, `Asia` si/sau tari individuale. | Functionala | ##### | ##### |
| CFR-75 | Conflict geografic | Conflictele includere/excludere geografica sunt respinse. | Functionala | ##### | ##### |

### 4.2 Interfata

| ID | Titlu | Descriere | Categorie | Sursa | Prioritate |
|---|---|---|---|---|---|
| CFR-10 | Pagini aplicatie | Pagini: Joburi noi, De evaluat, Aplicari, Criterii de selectie, Surse, Loguri. | Functionala | ##### | ##### |
| CFR-11 | Editare criterii | Criteriile si excluderile sunt editabile din UI. | Functionala | ##### | ##### |
| CFR-13 | Date Aplicari | Aplicarile vin din `data/applications.json`. | Functionala | ##### | ##### |
| CFR-14 | Continut privat | Continutul privat este ascuns fara autentificare. | Functionala | ##### | ##### |
| CFR-17 | Filtru vechime | Filtru vechime 24h/36h/48h/5 zile. | Functionala | ##### | ##### |
| CFR-18 | Freshness implicit | 24h este implicit; configuratia accepta 24/36/48/120. | Functionala | ##### | ##### |
| CFR-19 | Work mode | Multiselect Remote/Hibrid/Onsite/N/A. | Functionala | ##### | ##### |
| CFR-21 | Filtre cumulative | Filtrele se aplica cumulativ. | Functionala | ##### | ##### |
| CFR-22 | Sortare FIT | FIT este sortabil; implicit descrescator. | Functionala | ##### | ##### |
| CFR-25 | Aliniere pagini | Paginile sunt aliniate sus. | Functionala | ##### | ##### |
| CFR-50 | Selector JobsPipe | Selector JobsPipe Oprit/Apify/Direct este mapat la `jobspipe_mode`. | Functionala | ##### | ##### |
| CFR-51 | Limite JobsPipe | UI configureaza plafonul Apify si limitele Direct. | Functionala | ##### | ##### |
| CFR-56 | Profil utilizator | Profil compact cu dropdown/logout. | Functionala | ##### | ##### |
| CFR-57 | Culori UI | Albastru pentru actiune primara/focus; verde pentru activ/succes. | Functionala | ##### | ##### |
| CFR-59 | Latime continut | Continut maximum 1400 px. | Functionala | ##### | ##### |
| CFR-61 | KPI Joburi noi | KPI sunt afisate numai in Joburi noi. | Functionala | ##### | ##### |
| CFR-62 | Tabel compact | Tabel compact cu actiuni la hover. | Functionala | ##### | ##### |
| CFR-64 | Criterii responsive | Criterii responsive 1/2 coloane. | Functionala | ##### | ##### |
| CFR-66 | Arhivare locala | Arhivarea rapida este locala. | Functionala | ##### | ##### |
| CFR-76 | KPI filtre rapide | Cele patru KPI-uri din Joburi noi sunt filtre rapide single-select si nu lanseaza workflow/API. | Functionala | ##### | ##### |
| CFR-77 | Tara in liste | Tara este afisata separat in Joburi noi, De evaluat si Aplicari; multi-country foloseste `prima tara + N`. | Functionala | ##### | ##### |
| CFR-78 | Tari in detalii | Detaliile jobului afiseaza separat lista completa de tari. | Functionala | ##### | ##### |
| CFR-79 | Regiuni si tari | Criterii de selectie include control separat pentru regiuni si tari. | Functionala | ##### | ##### |
| CFR-80 | Excluderi teritoriale | Excluderile teritoriale accepta regiuni si tari; conflictul cu includerile blocheaza salvarea. | Functionala | ##### | ##### |
| CFR-81 | Card Excluderi | Cardul Excluderi este compact. | Functionala | ##### | ##### |
| CFR-82 | Surse procesate | Zona Ultima rulare afiseaza numarul surselor procesate. | Functionala | ##### | ##### |
| CFR-83 | JobsPipe sursa unica | JobsPipe este o singura sursa operationala indiferent daca transportul este Apify sau Direct. | Functionala | ##### | ##### |
| CFR-84 | Loguri | Pagina Loguri afiseaza ultimele 10 rulari de cautare si detaliile fiecarei rulari. | Functionala | ##### | ##### |
| CFR-85 | CRUD Surse | Pagina Surse permite adaugare, editare, activare/dezactivare si stergere persistenta. | Functionala | ##### | ##### |
| CFR-86 | Surse neoperationale | URL-urile duplicate sunt blocate, iar sursele fara connector sunt marcate ca neoperationale. | Functionala | ##### | ##### |

### 4.3 Autentificare si date

| ID | Titlu | Descriere | Categorie | Sursa | Prioritate |
|---|---|---|---|---|---|
| CFR-26 | Google Identity | Autentificarea foloseste Google Identity Services. | Functionala | ##### | ##### |
| CFR-27 | Identitate autorizata | Mecanismul curent permite acces numai pentru `sub = ALLOWED_GOOGLE_SUB`. Suportul multi-user este `UNDER ANALYSIS`. | Functionala | ##### | ##### |
| CFR-28 | Date protejate | `/data/*.json` protejate necesita bearer Google valid. | Functionala | ##### | ##### |
| CFR-30 | Token in memorie | Tokenul Google ramane numai in memoria React. | Functionala | ##### | ##### |
| CFR-31 | Logout | Logout elimina datele din memorie. | Functionala | ##### | ##### |
| CFR-32 | Actiune autentificata | `Ruleaza verificarea` nu apare neautentificat. | Functionala | ##### | ##### |
| CFR-34 | Blocare rulare dubla | Actiunea de rulare este blocata in timpul unei rulari. | Functionala | ##### | ##### |
| CFR-52 | Incarcare dupa auth | Datele protejate nu sunt cerute inainte de validarea sesiunii. | Functionala | ##### | ##### |
| CFR-53 | Stari auth/data | Auth si data loading sunt stari separate. | Functionala | ##### | ##### |
| CFR-54 | Incarcare coerenta | Lista/KPI/status provin dintr-o incarcare coerenta. | Functionala | ##### | ##### |
| CFR-55 | Retry date | Eroarea de date dupa login permite retry fara logout. | Functionala | ##### | ##### |
| CFR-67 | Blocare sesiune | Numai esecul `/auth/session` blocheaza sesiunea autentificata. | Functionala | ##### | ##### |
| CFR-68 | Erori vizibile | Erorile de auth/data raman vizibile. | Functionala | ##### | ##### |
| CFR-87 | Run history protejat | `run-history.json` este protejat la fel ca celelalte date private. | Functionala | ##### | ##### |

### 4.4 Comenzi si configurare

| ID | Titlu | Descriere | Categorie | Sursa | Prioritate |
|---|---|---|---|---|---|
| CFR-38 | Lansare cautare | `Ruleaza verificarea` porneste workflow-ul prin Command API. | Functionala | ##### | ##### |
| CFR-39 | Duplicate run | Nu se porneste o a doua rulare daca una este `queued`/`in_progress`. | Functionala | ##### | ##### |
| CFR-40 | Polling status | Frontend-ul face polling pe `run-status.json` si reincarca datele. | Functionala | ##### | ##### |
| CFR-41 | Salvare preferinte | `Salveaza preferintele` persista prin `PUT /config`. | Functionala | ##### | ##### |
| CFR-42 | Config trigger | Commit-ul `search-config.json` declanseaza workflow-ul. | Functionala | ##### | ##### |
| CFR-88 | CRUD Surse API | CRUD-ul Surse foloseste Command API autentificat si GitHub Contents API; credentialele GitHub nu ajung in browser. | Functionala | ##### | ##### |
| CFR-89 | Retry publicare | Publicarea rezultatelor reincearca de maximum 3 ori daca `main` se modifica in timpul publicarii. | Functionala | ##### | ##### |

## 5. Cerinte Non-Functionale

| ID | Titlu | Descriere | Categorie | Sursa | Prioritate |
|---|---|---|---|---|---|
| CNF-01 | UI responsive | Interfata este responsive. | Non-functionala | ##### | ##### |
| CNF-02 | Fara secrete | Nu se introduc secrete in repository/frontend. | Non-functionala | ##### | ##### |
| CNF-03 | Token fara localStorage | Google ID token nu intra in `localStorage`. | Non-functionala | ##### | ##### |
| CNF-04 | GitHub secret | GitHub PAT este Cloudflare Secret. | Non-functionala | ##### | ##### |
| CNF-05 | Validare JWT | Worker-ul verifica semnatura Google JWT, issuer, audience si configuratia de autorizare curenta. | Non-functionala | ##### | ##### |
| CNF-06 | Stil arhitectural | Arhitectura este `static-first + serverless command/access-control`. | Non-functionala | ##### | ##### |
| CNF-07 | Headers date | Datele protejate folosesc `no-store` si `nosniff`. | Non-functionala | ##### | ##### |
| CNF-08 | Cost operational | Cost operational minim. | Non-functionala | ##### | ##### |
| CNF-10 | Filtre locale | Filtrele locale nu declanseaza GitHub Actions. | Non-functionala | ##### | ##### |
| CNF-11 | Protectie quota | Direct protejeaza quota; Apify foloseste plafon tehnic de volum. | Non-functionala | ##### | ##### |
| CNF-12 | Search state privat | `search-state.json` nu este publicat. | Non-functionala | ##### | ##### |
| CNF-13 | Disabled fara request | Modul `disabled` garanteaza zero cereri JobsPipe/Apify. | Non-functionala | ##### | ##### |
| CNF-14 | Fara monkey-patching | Fara interceptari globale `fetch`/monkey-patching pentru auth. | Non-functionala | ##### | ##### |
| CNF-15 | Frontend stack | React functional components + Tailwind + Vite. | Non-functionala | ##### | ##### |
| CNF-17 | CI schimbari majore | Schimbarile majore sunt validate CI. | Non-functionala | ##### | ##### |
| CNF-18 | Provider secrets | `APIFY_TOKEN` si `JOBSPIPE_API_KEY` raman numai in GitHub Actions Secrets. | Non-functionala | ##### | ##### |
| CNF-19 | CI tehnic | CI valideaza Python, regulile geografice, JSON, React/Vite si Worker dry-run. | Non-functionala | ##### | ##### |

## 6. Restrictii, Ipoteze si Dependinte

### 6.1 Configuratie curenta

- roluri: PM, IT PM, Technical/Agile PM, Delivery, Service, Scrum, Program/PMO;
- tari selectate initial: RO, BE, LU;
- regiuni selectate initial: niciuna;
- excluderi teritoriale initiale: niciuna;
- Remote prioritar, apoi Hybrid;
- FIT ridicat: 80;
- B2B: 250-650 EUR/zi;
- freshness UI: 24h;
- colectare maxima: 120h;
- repostari: pastrate si marcate;
- JobsPipe: `jobspipe_mode=apify`;
- plafon Apify curent: 100 joburi brute/rulare;
- Direct fallback: 14 credite/rulare, guard lunar 950, overlap 2 minute;
- istoric loguri: maximum 10 rulari.

### 6.2 Excluderi de business curente

- Star Storage si companiile grupului;
- implementari ERP care cer experienta specializata ampla;
- roluri non-IT.

### 6.3 Restrictii

- numai JobsPipe are connector operational;
- catalogul legacy `sources.json` este normalizat/versionat la prima modificare persistenta din UI;
- arhivarea joburilor este locala;
- aplicarile nu sunt editabile server-side;
- fara baza de date activa;
- mecanismul de autorizare curent permite un singur utilizator; multi-user este `UNDER ANALYSIS`;
- fara MCP;
- validarea E2E live pentru versiunea 0.05 este de confirmat.

### 6.4 Ipoteze

#####

### 6.5 Dependinte

- Cloudflare Worker / Static Assets;
- GitHub Actions si GitHub Contents API;
- Google Identity Services;
- JobsPipe;
- Apify pentru transportul activ curent;
- repository GitHub privat pentru configuratie, runtime data si istoric.


## Clarificare bug #49 - executia strategiei existente

`all active sources equally` inseamna colectarea tuturor surselor active cu connector implementat, fara prioritate 1-5. Catalogul controleaza selectia efectiva. Sursele nesuportate si omiterile justificate sunt raportate explicit; nu sunt numarate ca incercate. Un agregator nu substituie verificarea surselor pe care le indexeaza. Esuarea unei surse nu anuleaza celelalte rezultate; esecul total nu inlocuieste rezultatele valide. Deduplicarea precede publicarea. Criteriile complete si acceptanta raman in issue #49; E2E de confirmat.
