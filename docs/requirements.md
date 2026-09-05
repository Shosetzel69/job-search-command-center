# Cerinte - sumar

Actualizare: 2026-09-05
Versiune aplicatie: 0.03

## Regula de lucru pentru cerinte

Pentru orice cerinta noua se aplica obligatoriu fluxul:
1. analiza impactului;
2. propunere de optimizare, daca este cazul;
3. confirmarea utilizatorului;
4. implementare numai dupa confirmare.

Documentatia proiectului este revizuita periodic si sincronizata cu implementarea reala. Documentele in limba romana se redacteaza fara diacritice.

## 1. Cerinte functionale

### 1.1 Cautare si rezultate

- CFR-01: Sistemul colecteaza roluri din sursele conectate si active.
- CFR-02: Motorul poate pastra rezultate pentru o fereastra maxima de 5 zile, independent de filtrul implicit din UI.
- CFR-03: Daca furnizorul nu livreaza un timestamp verificabil, rezultatul nu este exclus automat atunci cand interogarea sursei limiteaza deja vechimea maxima.
- CFR-04: Sistemul normalizeaza si deduplica rezultatele.
- CFR-05: Repostarile sunt marcate si pastrate vizibile cand `keep_reposts=true`.
- CFR-06: Sistemul calculeaza FIT si prezinta argumente pro si riscuri.
- CFR-07: Fiecare rezultat foloseste linkul disponibil pentru job; un rezultat nu este exclus doar pentru ca linkul disponibil este catre Indeed.
- CFR-08: Detaliile jobului includ descrierea pozitiei atunci cand sursa o furnizeaza.
- CFR-09: Excluderile automate trebuie sa aiba justificare verificabila in logica de filtrare.
- CFR-43: Colectarea JobsPipe foloseste `discovered_at_gte` si stare persistenta per interogare pentru polling incremental.
- CFR-44: JobsPipe foloseste preview gratuit cu `blur_company_data=true` pentru estimarea volumului inaintea colectarii platite.
- CFR-45: Interogarile JobsPipe evita suprapunerea geografica intre geografiile prioritare si restul Europei remote eligibile.
- CFR-46: Daca volumul depaseste bugetul unei rulari, cursorul este pastrat si backlog-ul continua ulterior.
- CFR-47: Rezultatele deja colectate sunt pastrate pana la expirarea ferestrei maxime sau pana cand regulile de filtrare le elimina.
- CFR-48: JobsPipe are buget configurabil per rulare si prag lunar local.
- CFR-49: Cand `jobspipe_enabled=false`, workflow-ul nu executa cereri JobsPipe si nu consuma credite provider.

### 1.2 Interfata si navigare

- CFR-10: Utilizatorul autentificat poate accesa `Joburi noi`, `De evaluat`, `Aplicari`, `Criterii de selectie` si `Surse`.
- CFR-11: Utilizatorul poate gestiona criteriile de cautare si excluderile din UI.
- CFR-12: Utilizatorul poate modifica local starea surselor; persistenta server-side a registrului de surse nu este inca implementata.
- CFR-13: Aplicatia afiseaza istoricul aplicarilor din `data/applications.json`.
- CFR-14: Cand utilizatorul nu este autentificat, continutul functional privat nu este afisat.
- CFR-15: In starea neautentificata raman vizibile brandul, controlul Google Sign-In si mesajele de autentificare relevante.
- CFR-16: Dupa validarea Google, aplicatia afiseaza profilul si gestioneaza separat incarcarea datelor protejate.
- CFR-17: Lista de joburi are filtru de vechime: `24h`, `36h`, `48h`, `5 zile`.
- CFR-18: Filtrul implicit de vechime este 24h; configuratia poate salva 24, 36, 48 sau 120 ore.
- CFR-19: Lista are multiselectie pentru `Remote`, `Hibrid`, `Onsite`, `N/A`.
- CFR-20: Toate cele patru moduri de lucru sunt selectate implicit la resetarea filtrelor.
- CFR-21: Vechimea, modul de lucru, cautarea text, FIT ridicat si B2B se aplica cumulativ.
- CFR-22: FIT se sorteaza crescator sau descrescator; implicit este descrescator.
- CFR-23: Filtrul Remote simplu separat nu exista; modul de lucru este gestionat prin multiselectie.
- CFR-24: Contoarele si KPI-urile se actualizeaza din acelasi set de date filtrat.
- CFR-25: Toate paginile sunt aliniate la partea de sus a ecranului.
- CFR-50: `Criterii de selectie` include checkbox-ul `Activeaza JobsPipe`, mapat la `jobspipe_enabled`.
- CFR-51: JobsPipe este dezactivat in perioada de stabilizare si se reactiveaza controlat prin salvarea configuratiei.
- CFR-56: Header-ul foloseste widget de profil discret cu avatar/text si dropdown pentru logout.
- CFR-57: Albastrul este rezervat actiunii primare `Ruleaza verificarea` si focus states; verdele este folosit pentru stari active/succes.
- CFR-58: Fundalul general este slate/gri deschis; cardurile sunt albe cu border discret si shadow fin.
- CFR-59: Continutul principal este centrat si limitat la maximum 1400 px.
- CFR-60: Filtrele sunt impartite pe doua randuri: cautare pe primul rand, filtre rapide si reset pe al doilea.
- CFR-61: KPI-urile sunt afisate numai in `Joburi noi`.
- CFR-62: Randurile tabelului sunt compacte si afiseaza la hover actiuni rapide: arhivare, aplicare si detalii.
- CFR-63: Badge-urile numerice din sidebar au contrast ridicat si text alb.
- CFR-64: `Criterii de selectie` foloseste grid responsive cu o coloana pe ecrane mici si doua coloane de la breakpoint mediu.
- CFR-65: `Reseteaza filtrele` restaureaza cautarea goala, filtrul `Toate`, toate modurile de lucru, vechimea implicita si FIT descrescator.
- CFR-66: Arhivarea rapida este locala in MVP si nu modifica sursa canonica server-side.

### 1.3 Autentificare si date protejate

- CFR-26: Autentificarea foloseste Google Identity Services.
- CFR-27: Numai Google `sub` egal cu `ALLOWED_GOOGLE_SUB` poate accesa datele si comenzile protejate.
- CFR-28: `/data/jobs.json`, `/data/run-status.json`, `/data/search-config.json`, `/data/sources.json` si `/data/applications.json` sunt Worker-first si necesita bearer Google valid.
- CFR-29: Accesul direct la datele protejate fara autentificare este refuzat.
- CFR-30: Tokenul Google este trimis numai same-origin si este pastrat doar in memoria aplicatiei React.
- CFR-31: La logout, datele incarcate sunt eliminate din memoria clientului.
- CFR-32: `Ruleaza verificarea` nu este afisat in starea neautentificata.
- CFR-33: Dupa autentificare autorizata, `Ruleaza verificarea` este afisat ca actiune primara albastra.
- CFR-34: In timpul unei rulari, actiunea de rulare este dezactivata pana la terminarea polling-ului.
- CFR-35: Logout-ul ascunde continutul privat imediat.
- CFR-36: Profilul autentificat este neutru vizual; starea activa a monitorului este afisata separat.
- CFR-37: Dropdown-ul profilului permite deconectarea explicita.
- CFR-52: La initializarea paginii, frontend-ul nu solicita `/data/*.json` inainte de validarea sesiunii Google.
- CFR-53: Sesiunea Google valida este separata logic de incarcarea datelor protejate.
- CFR-54: Lista, contoarele, KPI-urile si statusul rularii provin dintr-o incarcare valida coerenta; erorile nu lasa valori stale.
- CFR-55: Daca incarcarea datelor esueaza dupa login valid, utilizatorul ramane autentificat, vede eroarea si poate folosi `Reincearca incarcarea`.
- CFR-67: Numai esecul `/auth/session` impiedica stabilirea sesiunii autentificate; erorile ulterioare de date sunt tratate separat.
- CFR-68: Erorile de autentificare si incarcare raman vizibile in UI.

### 1.4 Comenzi si configurare

- CFR-38: `Ruleaza verificarea` porneste `job-search-full.yml` prin Command API fara credentiale GitHub in browser.
- CFR-39: Aplicatia blocheaza pornirea unei a doua rulari daca exista deja una `queued` sau `in_progress`.
- CFR-40: Dupa pornirea cautarii, frontend-ul face polling pe `run-status.json` si reincarca datele cand apare o rulare noua.
- CFR-41: `Salveaza preferintele` necesita utilizator autorizat si persista configuratia canonica prin `PUT /config`.
- CFR-42: Commit-ul rezultat pentru `data/search-config.json` declanseaza automat workflow-ul de cautare.

## 2. Cerinte non-functionale

- CNF-01: Interfata este responsive pentru desktop si mobil.
- CNF-02: Secretele nu sunt stocate in repository sau frontend.
- CNF-03: Google ID token nu este stocat in `localStorage`.
- CNF-04: GitHub PAT este stocat exclusiv ca secret Cloudflare.
- CNF-05: Worker-ul verifica semnatura Google JWT, issuer, audience si `ALLOWED_GOOGLE_SUB`.
- CNF-06: Arhitectura MVP ramane static-first, cu Cloudflare Worker pentru Static Assets, access control si Command API.
- CNF-07: Datele protejate sunt livrate cu `cache-control: no-store` si `x-content-type-options: nosniff`.
- CNF-08: Solutia urmareste cost operational minim.
- CNF-09: Arhitectura permite introducerea SQLite/PostgreSQL cand apar cerinte tranzactionale sau multi-user.
- CNF-10: Filtrele locale nu declanseaza GitHub Actions si trebuie sa raspunda instant din setul incarcat.
- CNF-11: Strategia JobsPipe trebuie sa protejeze quota prin polling incremental, buget per run si guard lunar.
- CNF-12: `data/search-state.json` nu este publicat in bundle-ul Cloudflare.
- CNF-13: `jobspipe_enabled=false` garanteaza zero consum JobsPipe pentru rularile ulterioare pana la reactivare.
- CNF-14: Frontend-ul nu foloseste interceptari globale `fetch` sau monkey-patching intre module pentru autentificare.
- CNF-15: Frontend-ul foloseste React functional components, Tailwind CSS si Vite.
- CNF-16: Browserul primeste numai bundle-ul construit; JSX-ul sursa nu este runtime public.
- CNF-17: Schimbarile majore frontend/Worker sunt validate prin GitHub Actions cu build Vite si `wrangler deploy --dry-run`.

## 3. Configuratie functionala curenta

- roluri: Project Manager, IT Project Manager, Technical/Agile PM, Delivery Manager, Service Manager, Scrum Master, Program/PMO Manager;
- geografie prioritara: RO, BE, LU;
- remote eligibil: lista europeana din `data/search-config.json`;
- moduri prioritare: Remote, apoi Hybrid;
- FIT ridicat: prag implicit 80;
- B2B: 250-650 EUR/zi;
- freshness UI: 24h implicit;
- colectare maxima: 120h / 5 zile;
- repostari: pastrate si marcate;
- JobsPipe: `jobspipe_enabled=false` in perioada de stabilizare;
- buget JobsPipe cand este activ: 14 credite/rulare;
- guard lunar local: 950 credite;
- overlap incremental: 2 minute.

## 4. Status implementare

### Implementat in cod

- React + Tailwind + Vite;
- Google Sign-In si autorizare prin `sub`;
- acces protejat la `/data/*`;
- profil discret + logout;
- separare login / data loading / retry;
- filtre 24h/36h/48h/5 zile;
- multiselect Remote/Hibrid/Onsite/N/A;
- FIT ascendent/descendent;
- reset filtre;
- KPI numai in Joburi noi;
- tabel compact cu hover actions;
- criterii in grid responsive;
- `Ruleaza verificarea` prin Command API;
- `Salveaza preferintele` prin Command API;
- JobsPipe enable/disable si protectie quota.

### Limitari / gap-uri cunoscute

- validarea E2E in browser dupa refactorul React trebuie confirmata in mediul Cloudflare live;
- toggle-urile individuale din `Surse` sunt locale si nu controleaza inca connectorii reali;
- `data/sources.json` este un catalog de surse, nu inseamna ca toate sursele sunt conectate la motor;
- arhivarea rapida este locala;
- aplicarile nu sunt editabile server-side din UI;
- nu exista baza de date activa;
- nu exista multi-user sau MCP in MVP.

## 5. Format documentatie completa

Documentul detaliat de cerinte, cand este extins per cerinta, foloseste: ID, Titlu, Descriere, Categorie, Sursa, Prioritate, Criterii de acceptanta, Dependinte, Note, Versiune.
