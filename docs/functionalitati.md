# Functionalitati

Actualizare: 2026-09-05
Versiune aplicatie: 0.03

Acest document descrie functionalitatea curenta a aplicatiei, separat de cerintele detaliate si de arhitectura.

## 1. Acces si autentificare

- Google Sign-In prin Google Identity Services;
- autorizare single-user prin Google `sub`;
- continut privat ascuns pana la autentificare;
- token Google pastrat numai in memoria paginii;
- profil discret in header cu dropdown;
- logout explicit;
- datele sunt incarcate numai dupa validarea sesiunii;
- eroarea de incarcare a datelor nu produce logout;
- `Reincearca incarcarea` pentru erori post-login.

## 2. Dashboard `Joburi noi`

- lista joburilor publicate de motor;
- KPI-uri:
  - roluri noi;
  - FIT ridicat;
  - repostari;
  - remote;
- KPI-urile apar numai in `Joburi noi`;
- contoarele sunt calculate din setul de date incarcat si filtrele curente.

## 3. Filtrare si sortare

- cautare text dupa rol, companie sau continut relevant;
- filtru rapid `Toate`;
- filtru rapid `Fit ridicat`;
- filtru rapid `B2B`;
- vechime:
  - 24h;
  - 36h;
  - 48h;
  - 5 zile;
- multiselect mod lucru:
  - Remote;
  - Hibrid;
  - Onsite;
  - N/A;
- sortare FIT:
  - descrescator implicit;
  - crescator;
- `Reseteaza filtrele`;
- filtrele se aplica local fara GitHub Actions.

## 4. Tabel joburi

- randuri compacte;
- titlu, companie, locatie, FIT, mod de lucru si vechime;
- badge-uri pentru informatii relevante;
- actiuni la hover:
  - Arhiveaza;
  - Aplica;
  - Vezi detalii;
- click pe detalii deschide drawer-ul jobului.

## 5. Detalii job

Drawer-ul afiseaza:

- titlu;
- companie;
- locatie;
- sursa;
- FIT;
- argumente pro;
- riscuri;
- descrierea pozitiei;
- link extern catre job cand este disponibil.

Linkurile externe se deschid separat si folosesc protectie `noopener noreferrer`.

## 6. `De evaluat`

- afiseaza joburile cu status de review;
- foloseste aceleasi filtre si sortare ca lista principala;
- KPI-urile de dashboard nu sunt afisate.

## 7. `Aplicari`

- afiseaza istoricul din `data/applications.json`;
- include companie, rol, locatie, data aplicarii, referinta, status si urmatorul status check cand exista;
- aplicarile nu sunt inca editabile server-side din UI.

## 8. `Criterii de selectie`

Pagina foloseste grid responsive 1/2 coloane si permite configurarea:

- grupuri de roluri;
- Remote / Hibrid;
- mod JobsPipe: Oprit / Apify / Direct;
- plafon configurabil de joburi brute/rulare pentru Apify;
- buget si prag lunar configurabile pentru Direct;
- vechime implicita;
- prag FIT ridicat;
- repostari;
- interval B2B;
- disponibilitate imediata;
- excluderi.

`Salveaza preferintele`:

- necesita autentificare;
- trimite `PUT /config`;
- actualizeaza `data/search-config.json` prin Worker/GitHub;
- commit-ul configuratiei declanseaza automat workflow-ul de cautare.

## 9. `Surse`

- afiseaza catalogul `data/sources.json`;
- cautare si grupare pe categorii;
- toggle activ/inactiv in UI;
- starea individuala a sursei este momentan locala;
- catalogul nu reprezinta lista connectorilor operationali.

## 10. Rulare manuala

`Ruleaza verificarea`:

- este vizibil numai dupa autentificare;
- este actiunea primara albastra;
- executa `POST /commands/run`;
- Worker-ul evita duplicate run;
- GitHub Actions ruleaza motorul;
- frontend-ul face polling pe `run-status.json`;
- la publicarea noilor date, lista este reincarcata.

## 11. Rulare programata

Workflow-ul `Full job search` ruleaza programat la:

- 06:00 UTC;
- 15:00 UTC.

Rularea poate fi declansata si de schimbari ale configuratiei/codului motorului.

## 12. JobsPipe

Transport configurabil:

- `disabled` - fara cereri externe; implicit in perioada de stabilizare;
- `apify` - transport recomandat pentru volum, prin Actorul oficial `jobspipe~jobspipe-job-search`;
- `direct` - fallback/diagnostic cu mecanismele existente de quota.

Apify:

- plafon implicit: 5.000 joburi brute/rulare;
- plafon UI permis: 100-20.000;
- doua cautari fara suprapunere: geografiile prioritare si remote Europe;
- Actorul pagineaza automat;
- necesita `APIFY_TOKEN` in GitHub Actions Secrets.

Direct:

- preview gratuit;
- polling incremental;
- cursor backlog;
- buget per rulare;
- guard lunar;
- circuit breaker quota;
- necesita `JOBSPIPE_API_KEY`.

Stare curenta:

`jobspipe_mode=disabled`

## 13. Persistenta

Persistenta canonica:

- joburi -> GitHub JSON;
- run status -> GitHub JSON;
- configuratie -> GitHub JSON;
- aplicari -> GitHub JSON;
- catalog surse -> GitHub JSON;
- stare JobsPipe -> GitHub JSON intern.

Persistenta locala browser:

- arhivare rapida;
- toggle-uri individuale surse;
- unele preferinte temporare UI.

## 14. Design si ergonomie

- React functional components;
- Tailwind CSS;
- fundal slate foarte deschis;
- carduri albe cu border si shadow discret;
- sidebar dark;
- continut max 1400 px;
- filtre pe doua randuri;
- KPI-uri conditionale;
- badge-uri sidebar cu contrast ridicat;
- header compact;
- profil neutru;
- verde rezervat statusurilor active/succes;
- albastru rezervat actiunii primare si focus states.

## 15. Limitari curente

- E2E browser dupa refactorul React trebuie confirmat pe mediul live;
- JobsPipe este oprit;
- numai JobsPipe are connector operational;
- sursele individuale nu sunt persistate server-side;
- arhivarea nu este persistata server-side;
- aplicarile nu sunt editabile server-side;
- fara baza de date;
- fara multi-user;
- fara MCP.
