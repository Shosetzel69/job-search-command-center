# Functionalitati

Actualizare: 2026-09-05
Versiune aplicatie: 0.04

## 1. Acces

- Google Sign-In;
- autorizare single-user prin Google `sub`;
- continut privat ascuns pana la autentificare;
- token numai in memoria paginii;
- profil + logout;
- retry separat pentru erori de incarcare date.

## 2. Joburi

- lista joburilor publicate de motor;
- KPI numai in `Joburi noi`;
- filtre text, FIT, B2B, vechime 24h/36h/48h/5 zile;
- multiselect Remote/Hibrid/Onsite/N/A;
- sortare FIT;
- reset filtre;
- tabel compact cu arhivare locala, aplicare si detalii;
- drawer cu descriere, pro, riscuri si link job.

## 3. Aplicari si surse

- `Aplicari` citeste `data/applications.json`;
- aplicarile nu sunt editabile server-side din UI;
- `Surse` citeste `data/sources.json`;
- toggle-urile individuale sunt locale si nu controleaza connectorii reali.

## 4. Criterii de selectie

UI permite configurarea:

- grupuri de roluri;
- Remote / Hibrid;
- JobsPipe: Oprit / Apify / Direct;
- plafon Apify;
- buget si prag lunar Direct;
- freshness;
- prag FIT;
- repostari;
- interval B2B;
- disponibilitate imediata;
- excluderi.

`Salveaza preferintele` trimite `PUT /config`; configuratia este salvata in `data/search-config.json`, iar commit-ul declanseaza workflow-ul de cautare.

## 5. Rulare

`Ruleaza verificarea`:

- necesita autentificare;
- executa `POST /commands/run`;
- evita pornirea unei a doua rulari active;
- face polling pe `run-status.json`;
- reincarca datele dupa publicare.

Rulare programata: 06:00 si 15:00 UTC.

## 6. JobsPipe

Transporturi disponibile:

- `disabled` - fara cereri JobsPipe/Apify;
- `apify` - transport activ curent;
- `direct` - fallback/diagnostic.

Stare curenta:

- `jobspipe_mode=apify`;
- `jobspipe_apify_max_items_per_run=100`.

Apify foloseste Actorul `jobspipe~jobspipe-job-search` si `APIFY_TOKEN` din GitHub Actions Secrets.

Direct pastreaza preview, polling incremental, cursor backlog, buget per run, guard lunar si circuit breaker; foloseste `JOBSPIPE_API_KEY`.

## 7. Persistenta

Canonica: joburi, run status, configuratie, aplicari si catalog surse in JSON GitHub. Starea JobsPipe Direct este in `search-state.json` intern.

Locale in browser: arhivare rapida si toggle-uri surse.

## 8. Limitari

- numai JobsPipe are connector operational;
- sursele individuale nu sunt persistate server-side;
- arhivarea nu este persistata server-side;
- aplicarile nu sunt editabile server-side;
- fara baza de date;
- fara multi-user;
- fara MCP.
