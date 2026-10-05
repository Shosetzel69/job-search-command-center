# Cerinte - Job Search Command Center

Versiune aplicatie: `0.06-dev`
Ultima actualizare: `2026-09-13`

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
**Versiune aplicatie:** 0.06-dev  
**Scop:** monitorizarea, filtrarea, evaluarea si prioritizarea joburilor pe baza criteriilor definite de utilizator.

Aplicatia nu este un motor de cautare generic. Sistemul colecteaza joburi din sursele operationale, le normalizeaza, aplica eligibilitatea geografica, deduplicarea/repostarea, filtrarea si scoring-ul FIT, apoi publica rezultatele pentru evaluare.

Baseline-ul stabilizat foloseste Full Search manual-only. Salvarea configuratiei, modificarile administrative, commit-urile si push-urile nu declanseaza cautarea completa.

## 2. Obiective si Declaratia Nevoilor

### 2.1 Obiective

- colectarea controlata a joburilor relevante;
- prioritizarea familiilor de roluri configurate per profil;
- mod de lucru configurabil per profil;
- selectie geografica pe regiuni si tari;
- evaluare FIT, argumente pro si riscuri;
- pastrarea descrierii si a linkului de job cand sursa le furnizeaza;
- urmarirea rularilor si a surselor procesate;
- administrarea criteriilor, surselor, categoriilor si nomenclatoarelor din UI;
- separarea stricta intre configurare si executia Full Search.

### 2.2 Needs Statement

Utilizatorul are nevoie de un sistem care reduce volumul de joburi nerelevante si concentreaza evaluarea pe rolurile eligibile si cu FIT ridicat, pastrand trasabilitatea sursei, descrierii, geografiei, repostarilor si rularilor.

## 3. Domeniul de Aplicare

### 3.1 In-scope pentru baseline-ul stabilizat 0.06-dev

- colectare joburi din connectorii operationali;
- normalizare, geo-eligibility, deduplicare/repost, filtrare si scoring;
- UI pentru Joburi noi, De evaluat, Aplicari, Criterii de selectie si Administrare;
- Administrare: Overview, Actualizare date, Surse, Nomenclatoare, Loguri;
- configurare criterii si excluderi;
- CRUD persistent pentru catalogul Surse si categoriile de surse;
- nomenclatoare canonice pentru regions, countries, work_modes, contract_types, application_statuses si infrastructura seniority;
- Full Search manual prin comanda explicita;
- Google Sign-In si acces protejat la date;
- persistenta curenta in fisiere JSON versionate in GitHub.

### 3.2 Out-of-scope / neimplementat in baseline-ul stabilizat

- scheduler functional pentru Full Search; acesta ramane Package 2B, implicit OFF;
- baza de date activa;
- arhitectura multi-user - `UNDER ANALYSIS`;
- notificari/email automate;
- editarea server-side a aplicarilor;
- persistenta server-side pentru arhivarea rapida a joburilor;
- separarea runtime DEV/TEST/PROD - aprobata arhitectural separat si urmarita prin #161;
- extinderea completa #49 `all active sources equally`; #49 ramane parcat prin decizia ownerului.

Nota: Remote MCP / `ai-github-bridge` este infrastructura operationala de engineering/governance si nu face parte din runtime-ul functional al aplicatiei.

## 4. Cerinte Functionale

### 4.1 Cautare si rezultate

| ID | Titlu | Descriere | Categorie | Sursa | Prioritate |
|---|---|---|---|---|---|
| CFR-01 | Colectare surse | Colectare din sursele cu ruta operationala conform Source Registry si politicii curente. | Functionala | ##### | ##### |
| CFR-02 | Fereastra colectare | Fereastra maxima de colectare este 5 zile. | Functionala | ##### | ##### |
| CFR-03 | Timestamp lipsa | Lipsa timestamp-ului nu exclude automat rezultatul daca sursa limiteaza deja vechimea. | Functionala | ##### | ##### |
| CFR-04 | Normalizare si deduplicare | Joburile sunt normalizate si deduplicate. | Functionala | ##### | ##### |
| CFR-05 | Repostari | Repostarile sunt marcate si pastrate cand `keep_reposts=true`. | Functionala | ##### | ##### |
| CFR-06 | Evaluare FIT | FIT include argumente pro si riscuri. | Functionala | ##### | ##### |
| CFR-07 | Link job | Se foloseste linkul disponibil pentru job. | Functionala | ##### | ##### |
| CFR-08 | Descriere job | Descrierea este pastrata cand sursa o furnizeaza. | Functionala | ##### | ##### |
| CFR-09 | Excluderi automate | Excluderile automate au justificare verificabila. | Functionala | ##### | ##### |
| CFR-43 | Mod JobsPipe | JobsPipe suporta `disabled`, `apify`, `direct`; baseline-ul stabilizat este `disabled`. | Functionala | ##### | ##### |
| CFR-44 | JobsPipe Apify | Daca este aprobat ulterior, modul `apify` foloseste Actorul `jobspipe~jobspipe-job-search` si `APIFY_TOKEN` secret. | Functionala | ##### | ##### |
| CFR-46 | Plafon Apify | Daca Apify este activat, plafonul este configurabil intre 100 si 20.000 joburi brute/rulare. | Functionala | ##### | ##### |
| CFR-47 | JobsPipe Direct | Daca Direct este activat, foloseste preview, `discovered_at_gte`, cursor si stare persistenta. | Functionala | ##### | ##### |
| CFR-48 | Protectie quota Direct | Direct are buget/rulare, guard lunar si circuit breaker. | Functionala | ##### | ##### |
| CFR-49 | JobsPipe disabled | `disabled` produce zero cereri JobsPipe/Apify si pastreaza rezultatele existente. | Functionala | ##### | ##### |
| CFR-69 | Campuri geografice | Fiecare job publicat poate contine `countries`, `country_codes` si `remote_scope` normalizate. | Functionala | ##### | ##### |
| CFR-70 | Remote Worldwide | Remote fara teritoriu explicit este tratat `Worldwide`. | Functionala | ##### | ##### |
| CFR-71 | Remote cu tari | Remote cu tari explicite este eligibil numai daca Romania este acceptata. | Functionala | ##### | ##### |
| CFR-72 | Remote EU/EMEA | Remote `EU`/`EMEA` este evaluat conform restrictiei explicite. | Functionala | ##### | ##### |
| CFR-73 | Worldwide si excluderi | `Remote Worldwide` nu este eliminat doar pentru ca o regiune este exclusa. | Functionala | ##### | ##### |
| CFR-74 | Selectie geografica | Selectia geografica foloseste regiuni canonice `EU`, `US`, `ASIA` si/sau tari individuale. | Functionala | ##### | ##### |
| CFR-75 | Conflict geografic | Conflictele includere/excludere geografica sunt respinse. | Functionala | ##### | ##### |
| CFR-90 | Revalidare joburi retinute | Joburile pastrate din rulari anterioare sunt reevaluate fata de criteriile curente inainte de publicare. | Functionala | #160 | P1 |

### 4.2 Interfata

| ID | Titlu | Descriere | Categorie | Sursa | Prioritate |
|---|---|---|---|---|---|
| CFR-10 | Pagini aplicatie | Pagini principale: Joburi noi, De evaluat, Aplicari, Criterii de selectie si Administrare. | Functionala | ##### | ##### |
| CFR-11 | Editare criterii | Criteriile si excluderile sunt editabile din UI. | Functionala | ##### | ##### |
| CFR-13 | Date Aplicari | Aplicarile vin din `data/applications.json`. | Functionala | ##### | ##### |
| CFR-14 | Continut privat | Continutul privat este ascuns fara autentificare. | Functionala | ##### | ##### |
| CFR-17 | Filtru vechime | Filtru vechime 24h/36h/48h/5 zile. | Functionala | ##### | ##### |
| CFR-18 | Freshness implicit | 24h este implicit; configuratia accepta 24/36/48/120. | Functionala | ##### | ##### |
| CFR-19 | Work mode | Multiselect canonic Remote/Hibrid/Onsite; `unknown`/N/A ramane stare tehnica, nu optiune normala. | Functionala | #119 | ##### |
| CFR-21 | Filtre cumulative | Filtrele se aplica cumulativ. | Functionala | ##### | ##### |
| CFR-22 | Sortare FIT | FIT este sortabil; implicit descrescator. | Functionala | ##### | ##### |
| CFR-25 | Aliniere pagini | Paginile sunt aliniate sus. | Functionala | ##### | ##### |
| CFR-50 | Selector JobsPipe | Selector JobsPipe Oprit/Apify/Direct este mapat la `jobspipe_mode`; baseline-ul este Oprit. | Functionala | ##### | ##### |
| CFR-51 | Limite JobsPipe | UI poate configura limitele providerilor daca un mod JobsPipe este aprobat/activat. | Functionala | ##### | ##### |
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
| CFR-83 | JobsPipe sursa unica | JobsPipe este o singura sursa logica indiferent daca transportul este Apify sau Direct. | Functionala | ##### | ##### |
| CFR-84 | Loguri | Pagina Loguri afiseaza ultimele 10 rulari de cautare si detaliile fiecarei rulari. | Functionala | ##### | ##### |
| CFR-85 | CRUD Surse | Administrare -> Surse permite adaugare, editare, activare/dezactivare si stergere persistenta conform source governance. | Functionala | ##### | ##### |
| CFR-86 | Surse neoperationale | URL-urile duplicate sunt blocate, iar sursele fara ruta operationala sunt marcate corespunzator. | Functionala | ##### | ##### |
| CFR-91 | Administrare | Exista shell Administrare cu Overview, Actualizare date, Surse, Nomenclatoare si Loguri. | Functionala | #85 | P1 |
| CFR-92 | Nomenclatoare canonice | UI foloseste domeniile canonice regions, countries, work_modes, contract_types, application_statuses si seniority infrastructure. | Functionala | #116 | P1 |
| CFR-93 | Integritate nomenclatoare | O valoare referentiata nu poate fi dezactivata/stearsa silent; API raspunde 409 cu referinte. | Functionala | #120 | P1 |

### 4.3 Autentificare si date

| ID | Titlu | Descriere | Categorie | Sursa | Prioritate |
|---|---|---|---|---|---|
| CFR-26 | Google Identity | Autentificarea foloseste Google Identity Services. | Functionala | ##### | ##### |
| CFR-27 | Identitate autorizata | Mecanismul curent permite acces numai pentru `sub = ALLOWED_GOOGLE_SUB`. Suportul multi-user este `UNDER ANALYSIS`. | Functionala | ##### | ##### |
| CFR-28 | Date protejate | `/data/*.json` protejate necesita bearer Google valid. | Functionala | ##### | ##### |
| CFR-30 | Token in memorie | Google ID token nu este persistat in localStorage/sessionStorage. | Functionala | ##### | ##### |
| CFR-31 | Logout | Logout elimina starea autentificata si dezactiveaza auto-select. | Functionala | ##### | ##### |
| CFR-32 | Actiune autentificata | `Ruleaza verificarea` nu apare neautentificat. | Functionala | ##### | ##### |
| CFR-34 | Blocare rulare dubla | Actiunea de rulare este blocata in timpul unei rulari. | Functionala | ##### | ##### |
| CFR-52 | Incarcare dupa auth | Datele protejate nu sunt cerute inainte de validarea sesiunii. | Functionala | ##### | ##### |
| CFR-53 | Stari auth/data | Auth si data loading sunt stari separate. | Functionala | ##### | ##### |
| CFR-54 | Incarcare coerenta | Lista/KPI/status provin dintr-o incarcare coerenta. | Functionala | ##### | ##### |
| CFR-55 | Retry date | Eroarea de date dupa login permite retry fara logout. | Functionala | ##### | ##### |
| CFR-67 | Blocare sesiune | Numai esecul `/auth/session` blocheaza sesiunea autentificata. | Functionala | ##### | ##### |
| CFR-68 | Erori vizibile | Erorile de auth/data raman vizibile. | Functionala | ##### | ##### |
| CFR-87 | Run history protejat | `run-history.json` este protejat la fel ca celelalte date private. | Functionala | ##### | ##### |
| CFR-94 | Reload auth | La reload, fluxul Google favorizeaza contul autorizat prin login hint si revalideaza server-side noul credential. | Functionala | #153 | P1 |

### 4.4 Comenzi si configurare

| ID | Titlu | Descriere | Categorie | Sursa | Prioritate |
|---|---|---|---|---|---|
| CFR-38 | Lansare cautare | `Ruleaza verificarea` porneste workflow-ul prin Command API. | Functionala | ##### | ##### |
| CFR-39 | Duplicate run | Nu se porneste o a doua rulare daca una este `queued`/`in_progress`. | Functionala | ##### | ##### |
| CFR-40 | Polling status | Frontend-ul urmareste `run-status.json` pana la stare terminala si reincarca datele. | Functionala | #83 | ##### |
| CFR-41 | Salvare preferinte | `Salveaza preferintele` persista prin `PUT /config` si nu porneste Full Search. | Functionala | #18 | P1 |
| CFR-42 | Full Search manual-only | Full Search este pornit numai explicit prin `POST /commands/run` / `workflow_dispatch`; commit/push/config/admin nu il declanseaza. | Functionala | #79 | P1 |
| CFR-88 | CRUD Surse API | CRUD-ul Surse foloseste Command API autentificat si GitHub Contents API; credentialele GitHub nu ajung in browser. | Functionala | ##### | ##### |
| CFR-89 | Retry publicare | Publicarea rezultatelor reincearca controlat daca `main` se modifica in timpul publicarii si nu foloseste force push. | Functionala | #33 | ##### |
| CFR-95 | Trigger canonic | Rularea manuala este inregistrata cu trigger canonic `manual-ui`. | Functionala | #79 | P1 |

## 5. Cerinte Non-Functionale

| ID | Titlu | Descriere | Categorie | Sursa | Prioritate |
|---|---|---|---|---|---|
| CNF-01 | UI responsive | Interfata este responsive. | Non-functionala | ##### | ##### |
| CNF-02 | Fara secrete | Nu se introduc secrete in repository/frontend. | Non-functionala | ##### | ##### |
| CNF-03 | Token fara localStorage | Google ID token nu intra in `localStorage`. | Non-functionala | ##### | ##### |
| CNF-04 | GitHub secret | Credentialele GitHub privilegiate raman server-side ca secrets. | Non-functionala | ##### | ##### |
| CNF-05 | Validare JWT | Worker-ul verifica semnatura Google JWT, issuer, audience si configuratia de autorizare curenta. | Non-functionala | ##### | ##### |
| CNF-06 | Stil arhitectural | Arhitectura este `static-first + serverless command/access-control`. | Non-functionala | ##### | ##### |
| CNF-07 | Headers date | Datele protejate folosesc `no-store` si `nosniff`. | Non-functionala | ##### | ##### |
| CNF-08 | Cost operational | Cost operational minim; providerii cu cost nu sunt activati implicit. | Non-functionala | ##### | ##### |
| CNF-10 | Filtre locale | Filtrele locale nu declanseaza GitHub Actions. | Non-functionala | ##### | ##### |
| CNF-11 | Protectie quota | Orice provider quota/cost-based trebuie sa respecte limitele configurate. | Non-functionala | ##### | ##### |
| CNF-12 | Search state privat | `search-state.json` nu este publicat. | Non-functionala | ##### | ##### |
| CNF-13 | Disabled fara request | Modul `disabled` garanteaza zero cereri JobsPipe/Apify. | Non-functionala | ##### | ##### |
| CNF-14 | Fara monkey-patching | Fara interceptari globale `fetch`/monkey-patching pentru auth. | Non-functionala | ##### | ##### |
| CNF-15 | Frontend stack | React functional components + Tailwind + Vite. | Non-functionala | ##### | ##### |
| CNF-17 | CI schimbari majore | Schimbarile majore sunt validate CI. | Non-functionala | ##### | ##### |
| CNF-18 | Provider secrets | Secretele providerilor raman numai server-side/GitHub Actions Secrets. | Non-functionala | ##### | ##### |
| CNF-19 | CI tehnic | CI valideaza Python, regulile geografice, JSON, React/Vite, Worker build si guard-ul manual-only. | Non-functionala | ##### | ##### |

## 6. Restrictii, Ipoteze si Dependinte

### 6.1 Configuratie / politica baseline

Repository-ul sursa nu defineste preferinte personale implicite. Rolurile, geografia, modurile de lucru, pragurile FIT, compensatia, disponibilitatea si excluderile sunt configuratie profile-owned si se stabilesc in runtime.

Valorile versionate in repository sunt exclusiv seed-uri neutre / contracte de schema. Providerii cu cost raman dezactivati implicit, iar Full Search nu porneste automat.

### 6.2 Excluderi de business

Repository-ul public nu contine excluderi personale sau company-specific. Excluderile sunt configurate per profil in runtime.

### 6.3 Restrictii

- catalogul Source Registry poate contine surse fara ruta operationala; activarea nu echivaleaza automat cu validarea unui connector;
- #49 este reactivat prin decizia ownerului din 2026-09-25; Full Search trebuie sa traverseze toate sursele active eligibile operational;
- arhivarea joburilor este locala;
- aplicarile nu sunt editabile server-side;
- fara baza de date activa;
- mecanismul de autorizare curent permite un singur utilizator; multi-user este `UNDER ANALYSIS`;
- Full Search ramane manual-only pana la implementarea separata a Package 2B;
- JobsPipe ramane disabled in baseline;
- stabilizarea functionala a baseline-ului a fost validata in PROD la 2026-09-11; raport final: `docs/testing/reports/2026-09-13-stabilization-closeout.md`.

### 6.4 Ipoteze

#####

### 6.5 Dependinte

- Cloudflare Worker / Static Assets;
- GitHub Actions si GitHub Contents API;
- Google Identity Services;
- repository GitHub pentru cod, contracte si seed-uri neutre; runtime data si istoricul operational sunt externalizate;
- providerii/connectorii aprobati individual conform Source Registry.

## 7. Clarificare #49

Decizia ownerului din 2026-09-25 reactiveaza #49. Runner-ul pastreaza strategia `all active sources equally` pentru toate sursele eligibile operational. Excluderile de politica, credentialele lipsa, rutele nevalidate si providerii amanati raman fail-closed si sunt raportati explicit; nu se introduc bypass-uri pentru a obtine acoperire artificiala.

## 8. Stare stabilizare

Baseline-ul functional este declarat `STABLE / CLOSE` la 2026-09-13 pe baza:

- CI si build green;
- browser PROD E2E;
- Package 2A8 E2E PASS;
- remediere si retest pentru #153 si #154;
- Full Search controlat `workflow_dispatch` run #51 finalizat cu succes;
- #160 remediat prin PR #163, cu regression tests/CI green;
- zero P0/P1 cunoscute ramase deschise.

Nu exista un Full Search live suplimentar dupa fixul #160; acest lucru este retinut ca gap de verificare live acceptat, nu ca defect cunoscut. Orice regresie observata ulterior se trateaza ca bug nou, nu redeschide automat stabilizarea inchisa.
