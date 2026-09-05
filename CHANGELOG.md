# Changelog

## 0.04 - 2026-09-05

### JobsPipe transport

- Adaugat `jobspipe_mode`: `disabled`, `apify`, `direct`.
- Apify devine transportul recomandat dupa stabilizare.
- JobsPipe Direct ramane fallback cu quota guards.
- UI permite selectarea transportului si configurarea limitelor specifice.
- Adaugat suport pentru secretul GitHub Actions `APIFY_TOKEN`.
- Plafon Apify implicit: 5.000 joburi brute/rulare; configurabil 100-20.000.
- Starea curenta ramane `disabled`.

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
- `jobspipe_enabled=false` in perioada de stabilizare.

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

### Limitari cunoscute

- E2E browser dupa refactorul React necesita confirmare live.
- Toggle-urile individuale Surse sunt locale.
- Arhivarea este locala.
- Numai JobsPipe are connector operational si este momentan dezactivat.

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
