# Functionalitati

Versiune aplicatie: `0.05`
Ultima actualizare: `2026-09-06`

## 1. Acces

- Google Sign-In;
- mecanismul de autorizare curent permite un singur utilizator prin Google `sub`;
- suportul multi-user este `UNDER ANALYSIS` conform `ARCHITECTURE.md`;
- continut privat ascuns pana la autentificare;
- token numai in memoria paginii;
- profil + logout;
- retry separat pentru erori de incarcare date.

## 2. Joburi

- lista joburilor publicate de motor;
- KPI numai in `Joburi noi`;
- KPI `Roluri noi`, `Fit ridicat`, `Repostari`, `Remote` sunt filtre rapide single-select;
- filtre text, FIT, B2B, vechime 24h/36h/48h/5 zile;
- multiselect Remote/Hibrid/Onsite/N/A;
- sortare FIT;
- reset filtre, inclusiv filtrul KPI;
- tara afisata separat in liste;
- multi-country afisat compact `prima tara + N`;
- tabel compact cu arhivare locala, aplicare si detalii;
- drawer cu locatie, lista completa de tari, remote scope, descriere, pro, riscuri, sursa si link job.

## 3. Aplicari

- `Aplicari` citeste `data/applications.json`;
- afiseaza tara cand aceasta poate fi determinata din datele aplicarii/jobului;
- aplicarile nu sunt editabile server-side din UI.

## 4. Criterii de selectie

UI permite configurarea:

- grupuri de roluri;
- Remote / Hibrid;
- regiuni `EU`, `US`, `Asia`;
- tari individuale;
- excluderi teritoriale pe regiuni si tari;
- JobsPipe: Oprit / Apify / Direct;
- plafon Apify;
- buget si prag lunar Direct;
- freshness;
- prag FIT;
- repostari;
- interval B2B;
- disponibilitate imediata;
- excluderi de business.

Reguli:

- `Worldwide` si `EMEA` sunt scope-uri Remote, nu regiuni selectabile in criteriul principal;
- Remote fara teritoriu explicit = `Worldwide`;
- Remote cu tari explicite necesita Romania in lista acceptata;
- conflictul dintre includeri si excluderi geografice blocheaza salvarea;
- cardul Excluderi este compact.

`Salveaza preferintele` trimite `PUT /config`; configuratia este salvata in `data/search-config.json`, iar commit-ul declanseaza workflow-ul de cautare.

## 5. Surse

Pagina `Surse`:

- citeste `data/sources.json`;
- cautare si sortare;
- adaugare sursa;
- editare nume, URL, categorie si stare activa/inactiva;
- activare/dezactivare persistenta;
- stergere efectiva dupa confirmare;
- blocheaza URL duplicat;
- afiseaza separat daca exista connector operational.

Modificarile sunt facute prin Command API autentificat. `localStorage` nu mai este sursa canonica pentru registrul Surse.

O sursa adaugata manual poate exista in catalog fara connector; nu devine automat operationala.

## 6. Rulare si status

`Ruleaza verificarea`:

- necesita autentificare;
- executa `POST /commands/run`;
- evita pornirea unei a doua rulari active;
- face polling pe `run-status.json`;
- reincarca datele dupa publicare.

Zona `Ultima rulare` afiseaza si numarul surselor procesate. JobsPipe reprezinta o singura sursa indiferent de transportul Apify/Direct.

Publicarea datelor reincearca de maximum 3 ori daca `main` se modifica intre colectare si push.

Rulare programata: 06:00 si 15:00 UTC.

## 7. Loguri

Pagina `Loguri`:

- foloseste `data/run-history.json`;
- pastreaza maximum 10 rulari de cautare;
- afiseaza status, trigger, ora, durata, transport, surse procesate, joburi inspectate/publicate/excluse;
- permite extinderea unei rulari pentru source results, erori si limitari;
- istoricul este protejat prin Cloudflare Worker.

## 8. JobsPipe

Transporturi disponibile:

- `disabled` - fara cereri JobsPipe/Apify;
- `apify` - transport activ curent;
- `direct` - fallback/diagnostic.

Stare curenta:

- `jobspipe_mode=apify`;
- `jobspipe_apify_max_items_per_run=100`.

Apify foloseste Actorul `jobspipe~jobspipe-job-search` si `APIFY_TOKEN` din GitHub Actions Secrets. Colectarea Remote este larga, iar eligibilitatea geografica finala este aplicata in pipeline-ul comun.

Direct pastreaza preview, polling incremental, cursor backlog, buget per run, guard lunar si circuit breaker; foloseste `JOBSPIPE_API_KEY`.

## 9. Persistenta

Canonica in GitHub JSON:

- joburi;
- run status;
- istoric 10 rulari;
- configuratie;
- aplicari;
- catalog surse.

Starea JobsPipe Direct este in `search-state.json` intern.

Locala in browser: arhivarea rapida a joburilor.

## 10. Limitari

- numai JobsPipe are connector operational;
- catalogul Surse legacy este normalizat/versionat la prima modificare persistenta;
- arhivarea nu este persistata server-side;
- aplicarile nu sunt editabile server-side;
- fara baza de date activa;
- mecanismul de autorizare curent este pentru un singur utilizator; multi-user este `UNDER ANALYSIS`;
- fara MCP;
- validarea E2E live pentru 0.05 este de confirmat.


## Remediere #49 (Unreleased)

Runner-ul foloseste sursele active din catalog, cu JobsPipe si Jobicy colectate independent. Suportul connectorului este derivat identic in UI, Worker si Python. Loguri afiseaza configurate/active/incercate/reusite/esuate/nesuportate/omise, motive si rezultate per sursa. Deduplicarea acopera rezultatele noi si cele retinute din rulari anterioare. Testele izolate acopera succes, esec partial/total, deaktivare, quota, cooldown si duplicate. E2E dupa merge: de confirmat.

## Colectare web (#49)

Collector comun pentru sursele HTTP(S) active fara API dedicat: descoperire cariere/anunturi/paginare, extractie JobPosting JSON-LD, normalizare in pipeline. Loguri include outcome web, pagini si limite; Surse distinge API/Web. Testele sunt izolate, cu cazuri de blocaj, partial, schema invalida, geografie si acces la retea privata. Validarea live a acoperirii ramane de confirmat.

## Colectare pagini dinamice

Fallback Chromium dupa HTML, numai pentru pagini cu scripturi fara JobPosting static. Loguri arata randari incercate/reusite, anunturi extrase dupa randare si erori de resurse. Bugete uniforme si pastrarea colectarii HTML la esec. Validarea live pe site-uri: de confirmat.
