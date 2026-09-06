# Cerinte - sumar

Actualizare: 2026-09-06
Versiune aplicatie: 0.05

## Regula de lucru pentru cerinte

Pentru orice cerinta noua:
1. analiza impactului;
2. propunere de optimizare, daca este cazul;
3. confirmarea utilizatorului;
4. implementare numai dupa confirmare.

Documentatia se sincronizeaza cu implementarea reala. Documentele in romana se redacteaza fara diacritice.

## 1. Cerinte functionale

### Cautare si rezultate

- CFR-01: Colectare din sursele conectate si active.
- CFR-02: Fereastra maxima de colectare 5 zile.
- CFR-03: Lipsa timestamp-ului nu exclude automat rezultatul daca sursa limiteaza deja vechimea.
- CFR-04: Normalizare si deduplicare.
- CFR-05: Repostarile sunt marcate si pastrate cand `keep_reposts=true`.
- CFR-06: FIT cu argumente pro si riscuri.
- CFR-07: Se foloseste linkul disponibil pentru job.
- CFR-08: Descrierea este pastrata cand sursa o furnizeaza.
- CFR-09: Excluderile automate au justificare verificabila.
- CFR-43: JobsPipe suporta `disabled`, `apify`, `direct`.
- CFR-44: `apify` foloseste Actorul `jobspipe~jobspipe-job-search` si `APIFY_TOKEN` secret.
- CFR-46: Plafonul Apify este configurabil 100-20.000 joburi brute/rulare.
- CFR-47: Direct foloseste preview, `discovered_at_gte`, cursor si stare persistenta.
- CFR-48: Direct are buget/rulare, guard lunar si circuit breaker.
- CFR-49: `disabled` produce zero cereri JobsPipe/Apify si pastreaza rezultatele existente.
- CFR-69: Fiecare job publicat poate contine `countries`, `country_codes` si `remote_scope` normalizate.
- CFR-70: Remote fara teritoriu explicit este tratat `Worldwide`.
- CFR-71: Remote cu tari explicite este eligibil numai daca Romania este acceptata.
- CFR-72: Remote `EU`/`EMEA` este evaluat conform restrictiei explicite.
- CFR-73: `Remote Worldwide` nu este eliminat doar pentru ca o regiune este exclusa.
- CFR-74: Selectia geografica foloseste regiuni `EU`, `US`, `Asia` si/sau tari individuale.
- CFR-75: Conflictele includere/excludere geografica sunt respinse.

### Interfata

- CFR-10: Pagini: Joburi noi, De evaluat, Aplicari, Criterii de selectie, Surse, Loguri.
- CFR-11: Criteriile si excluderile sunt editabile din UI.
- CFR-13: Aplicarile vin din `data/applications.json`.
- CFR-14: Continutul privat este ascuns fara autentificare.
- CFR-17: Filtru vechime 24h/36h/48h/5 zile.
- CFR-18: 24h este implicit; configuratia accepta 24/36/48/120.
- CFR-19: Multiselect Remote/Hibrid/Onsite/N/A.
- CFR-21: Filtrele se aplica cumulativ.
- CFR-22: FIT sortabil; implicit descrescator.
- CFR-25: Paginile sunt aliniate sus.
- CFR-50: Selector JobsPipe Oprit/Apify/Direct mapat la `jobspipe_mode`.
- CFR-51: UI configureaza plafonul Apify si limitele Direct.
- CFR-56: Profil compact cu dropdown/logout.
- CFR-57: Albastru pentru actiune primara/focus; verde pentru activ/succes.
- CFR-59: Continut max 1400 px.
- CFR-61: KPI numai in Joburi noi.
- CFR-62: Tabel compact cu actiuni la hover.
- CFR-64: Criterii responsive 1/2 coloane.
- CFR-66: Arhivarea rapida este locala.
- CFR-76: Cele patru KPI-uri din Joburi noi sunt filtre rapide single-select si nu lanseaza workflow/API.
- CFR-77: Tara este afisata separat in Joburi noi, De evaluat si Aplicari; multi-country foloseste `prima tara + N`.
- CFR-78: Detaliile jobului afiseaza separat lista completa de tari.
- CFR-79: Criterii de selectie include control separat pentru regiuni si tari.
- CFR-80: Excluderile teritoriale accepta regiuni si tari; conflictul cu includerile blocheaza salvarea.
- CFR-81: Cardul Excluderi este compact.
- CFR-82: Zona Ultima rulare afiseaza numarul surselor procesate.
- CFR-83: JobsPipe este o singura sursa operationala indiferent daca transportul este Apify sau Direct.
- CFR-84: Pagina Loguri afiseaza ultimele 10 rulari de cautare si detaliile fiecarei rulari.
- CFR-85: Pagina Surse permite adaugare, editare, activare/dezactivare si stergere persistenta.
- CFR-86: URL-urile duplicate sunt blocate, iar sursele fara connector sunt marcate ca neoperationale.

### Autentificare si date

- CFR-26: Google Identity Services.
- CFR-27: Acces numai pentru `sub = ALLOWED_GOOGLE_SUB`.
- CFR-28: `/data/*.json` protejate necesita bearer Google valid.
- CFR-30: Tokenul Google ramane numai in memoria React.
- CFR-31: Logout elimina datele din memorie.
- CFR-32: `Ruleaza verificarea` nu apare neautentificat.
- CFR-34: Actiunea de rulare este blocata in timpul unei rulari.
- CFR-52: Datele protejate nu sunt cerute inainte de validarea sesiunii.
- CFR-53: Auth si data loading sunt stari separate.
- CFR-54: Lista/KPI/status provin dintr-o incarcare coerenta.
- CFR-55: Eroarea de date dupa login permite retry fara logout.
- CFR-67: Numai esecul `/auth/session` blocheaza sesiunea autentificata.
- CFR-68: Erorile de auth/data raman vizibile.
- CFR-87: `run-history.json` este protejat la fel ca celelalte date private.

### Comenzi si configurare

- CFR-38: `Ruleaza verificarea` porneste workflow-ul prin Command API.
- CFR-39: Nu se porneste o a doua rulare daca una este queued/in_progress.
- CFR-40: Frontend-ul face polling pe `run-status.json` si reincarca datele.
- CFR-41: `Salveaza preferintele` persista prin `PUT /config`.
- CFR-42: Commit-ul `search-config.json` declanseaza workflow-ul.
- CFR-88: CRUD-ul Surse foloseste Command API autentificat si GitHub Contents API; credentialele GitHub nu ajung in browser.
- CFR-89: Publicarea rezultatelor reincearca de maximum 3 ori daca `main` se modifica in timpul publicarii.

## 2. Cerinte non-functionale

- CNF-01: UI responsive.
- CNF-02: Fara secrete in repository/frontend.
- CNF-03: Google ID token nu intra in `localStorage`.
- CNF-04: GitHub PAT este Cloudflare Secret.
- CNF-05: Worker-ul verifica semnatura Google JWT, issuer, audience si `ALLOWED_GOOGLE_SUB`.
- CNF-06: Arhitectura static-first + Cloudflare Worker.
- CNF-07: Datele protejate folosesc `no-store` si `nosniff`.
- CNF-08: Cost operational minim.
- CNF-10: Filtrele locale nu declanseaza GitHub Actions.
- CNF-11: Direct protejeaza quota; Apify foloseste plafon tehnic de volum.
- CNF-12: `search-state.json` nu este publicat.
- CNF-13: Modul `disabled` garanteaza zero cereri JobsPipe/Apify.
- CNF-14: Fara interceptari globale `fetch`/monkey-patching pentru auth.
- CNF-15: React functional components + Tailwind + Vite.
- CNF-17: Schimbarile majore sunt validate CI.
- CNF-18: `APIFY_TOKEN` si `JOBSPIPE_API_KEY` raman numai in GitHub Actions Secrets.
- CNF-19: CI valideaza Python, regulile geografice, JSON, React/Vite si Worker dry-run.

## 3. Configuratie curenta

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

## 4. Gap-uri

- numai JobsPipe are connector operational;
- catalogul legacy `sources.json` este normalizat/versionat la prima modificare persistenta din UI;
- arhivarea joburilor este locala;
- aplicarile nu sunt editabile server-side;
- fara baza de date activa;
- fara multi-user;
- fara MCP;
- validarea E2E live pentru versiunea 0.05 este de confirmat.
