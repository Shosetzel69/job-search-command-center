# Changelog

## [Unreleased]

### Remedieri

- Validare live #49: 128 surse web incercate, 56 anunturi extrase din 12 site-uri. Corectate atribute HTML nule, adrese JSON-LD in liste si detectarea eronata a login-ului; Loguri separa rezultatele partiale si blocajele.

- #49 redeschis: colectare web reala pentru surse fara API, prin pagini de cariere/anunturi/paginare si JobPosting JSON-LD. Rezultate si limite per pagina/sursa, transport public protejat, teste izolate; fara dependinte noi.

- #49: colectare din catalog pentru toate sursele active suportate; JobsPipe si Jobicy independente, fara modificarea scoring-ului.
- Loguri: acoperire reala, surse nesuportate si omiteri motivate, erori/query si records/sursa.
- Deduplicare intre provideri si protectie pentru ID-uri locale identice; pastrarea rezultatelor la esec total.
- Rutare comuna Python/Worker/UI; cooldown Jobicy de o ora si teste izolate in CI. E2E de confirmat dupa merge.

### Documentatie

- Definit fluxul formal `Ideas / Requirements -> Analiza -> cerinta/decizie aprobata explicit -> Development -> implementare` si interzisa trecerea directa din idei sau analiza in Development.
- Adaugate criteriile de maturitate pentru transferul unei idei in `Analiza` si formatul scurt de sumar pentru transfer.
- Aliniate `GOVERNANCE.md`, `.ai-instructions.md`, `CONTRIBUTING.md` si `README.md` cu noul flux de lucru.
- Aliniate `GOVERNANCE.md`, `.ai-instructions.md`, `CONTRIBUTING.md`, `README.md` si documentele tehnice cu `ARCHITECTURE.md` v1.0.
- Clarificata precedenta intre arhitectura, guvernanta si instructiunile AI.
- Documentat taskul programat ChatGPT `Actualizare documentatie proiect` pentru review periodic la 2 ore.
- Restructurat `docs/requirements.md` conform structurii oficiale a documentului de cerinte.
- Eliminata documentatia backend legacy care contrazice arhitectura curenta.
- Clarificat faptul ca autorizarea curenta este single-user, iar arhitectura multi-user este `UNDER ANALYSIS`.

## 0.05 - 2026-09-06

### Interfata

- KPI-urile din `Joburi noi` devin filtre rapide single-select.
- Tara este afisata separat in Joburi noi, De evaluat si Aplicari.
- Joburile multi-country folosesc `prima tara + N` in lista si toate tarile in detalii.
- Detaliile jobului includ campuri separate pentru locatie, tari, remote scope si sursa.
- `Criterii de selectie` include regiuni `EU`, `US`, `Asia` si tari individuale.
- Adaugate excluderi teritoriale pe regiuni si tari.
- Cardul `Excluderi` este compactat.
- `Ultima rulare` afiseaza numarul surselor procesate.
- Adaugata pagina `Loguri` cu ultimele 10 rulari.

### Surse

- Pagina `Surse` permite adaugare, editare, activare/dezactivare si stergere.
- Modificarile sunt persistate canonic prin Command API si GitHub Contents API.
- URL-urile duplicate sunt blocate.
- UI separa starea din catalog de disponibilitatea connectorului.
- Catalogul legacy este normalizat la schema 1.0 la prima modificare persistenta.

### Geografie

- Adaugate campurile canonice `countries`, `country_codes`, `remote_scope`.
- Remote fara teritoriu explicit este tratat ca Worldwide.
- Remote cu tari explicite necesita Romania intre tarile acceptate.
- Remote EU/EMEA foloseste restrictia declarata.
- Remote Worldwide ramane eligibil la excluderi regionale.
- Conflictele includere/excludere sunt blocate in UI, Command API si configuratia motorului.

### Rulare si loguri

- `run-status.json` include `sources_processed` si `failed_sources`.
- JobsPipe este numarat ca o singura sursa indiferent de transportul Apify/Direct.
- Adaugat `data/run-history.json`, maximum 10 rulari.
- Publicarea rezultatelor reincearca de maximum 3 ori daca `main` se modifica in timpul push-ului.

### CI

- CI valideaza si Python/search configuration.
- Adaugate teste de regresie pentru geografie si normalizarea sursei JobsPipe.
- Raman active validarile React/Vite si Cloudflare Worker dry-run.

### Stare operationala

- JobsPipe transport: `apify`.
- Plafon Apify: 100 joburi brute/rulare.
- Validarea CI este finalizata; validarea E2E live pentru 0.05 ramane de confirmat.

## 0.04 - 2026-09-05

### JobsPipe transport

- Adaugat `jobspipe_mode`: `disabled`, `apify`, `direct`.
- Apify devine transportul recomandat dupa stabilizare.
- JobsPipe Direct ramane fallback cu quota guards.
- UI permite selectarea transportului si configurarea limitelor specifice.
- Adaugat suport pentru secretul GitHub Actions `APIFY_TOKEN`.
- Plafon Apify implicit: 5.000 joburi brute/rulare; configurabil 100-20.000.
- La introducerea functionalitatii transportul a ramas initial dezactivat pentru stabilizare.

## 0.03 - 2026-09-05

### Frontend

- Migrare completa la React 18 + Tailwind CSS + Vite.
- Layout principal centrat, maximum 1400 px.
- Fundal slate deschis si carduri albe cu border/shadow discret.
- Profil discret cu dropdown si logout.
- Albastru rezervat actiunii primare `Ruleaza verificarea`.
- Verde folosit pentru stari active/succes.
- KPI-uri afisate numai in `Joburi noi`.
- Filtre impartite pe doua randuri.
- Filtru vechime: 24h / 36h / 48h / 5 zile.
- Multiselect Remote / Hibrid / Onsite / N/A.
- FIT descrescator implicit + optiune crescator.
- `Reseteaza filtrele`.
- Tabel compact cu actiuni la hover.
- Badge-uri sidebar cu contrast ridicat.
- `Criterii de selectie` in grid responsive 1/2 coloane.

### Autentificare si securitate

- Google Sign-In integrat in React.
- Separare explicita intre login si incarcarea datelor.
- Eroarea de date nu mai invalideaza sesiunea Google.
- Retry explicit pentru incarcarea datelor protejate.
- Token Google pastrat numai in memoria paginii.
- `/data/*` protejat prin Cloudflare Worker.
- Logout-ul goleste datele clientului.

### Command API

- `GET /auth/config`.
- `POST /auth/session`.
- `POST /commands/run`.
- `PUT /config`.
- Protectie duplicate run.
- Persistenta configuratie prin GitHub Contents API.

### Search engine

- Colectare maxima 5 zile pentru filtrare locala 24h/36h/48h/5 zile.
- JobsPipe polling incremental.
- Preview gratuit.
- Cursor backlog.
- Buget 14 credite/rulare.
- Guard lunar 950.
- Circuit breaker quota.
- JobsPipe a fost dezactivat in perioada initiala de stabilizare.

### Build si hosting

- GitHub Pages eliminat din arhitectura.
- Hosting prin Cloudflare Worker Static Assets.
- Build React/Vite integrat in build-ul Worker.
- CI valideaza frontend-ul si `wrangler deploy --dry-run`.

### Documentatie

- Cerinte sincronizate cu implementarea React.
- Arhitectura actualizata.
- Command API actualizat.
- Contractele JSON actualizate.
- Strategia surselor actualizata.
- Adaugat inventar functional separat.

## 0.02 - 2026-09-03

### Functionalitati

- Previzualizare dinamica a rezultatelor in Criterii de selectie.
- Redenumirea aplicatiei in Job Search.

### Buguri rezolvate

- Separarea continutului intre Joburi noi, De evaluat, Aplicari, Criterii de selectie si Surse.
- Ascunderea controalelor care apartin altor pagini.
- Ascunderea actiunii Ruleaza verificarea in Criterii de selectie.

## 0.01 - 2026-09-03

### Functionalitati

- Criterii de selectie salvate local.
- Excluderi dinamice.
- Afisarea versiunii aplicatiei.

### Observatie istorica

Prioritizarea initiala a maximum cinci surse a fost eliminata ulterior. Strategia curenta este `all active sources equally`.

