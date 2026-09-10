# Stabilization Test Handbook - Claude QA

Date: 2026-09-11
Target: PROD
URL: https://job-search-command-api.myeboda.workers.dev

## 1. Scop

Acest handbook defineste executia autonoma a testarii de stabilizare pentru versiunea curenta a Job Search Command Center.

Obiectivul este sa validam ce este deja implementat si deployat, sa identificam defectele reale si sa obtinem un baseline PROD stabil inainte de dezvoltari noi.

Nu se testeaza functionalitati viitoare neimplementate.

## 2. Surse de adevar

Inainte de executie, Claude citeste din `main`:

- `ARCHITECTURE.md`;
- `GOVERNANCE.md`;
- `.ai-instructions.md`;
- `docs/package-2a8-e2e.md`;
- acest handbook;
- ticketul de executie indicat de owner.

Daca exista contradictii, regulile de securitate si governance au prioritate. Pentru ordinea si scope-ul testarii de stabilizare, ticketul de executie si acest handbook sunt autoritatea curenta.

## 3. Contract de autonomie

Dupa ce primeste ID-ul ticketului, Claude executa testarea cap-coada fara a cere confirmari intermediare.

Reguli:

- nu asteapta `GO` intre scenarii;
- nu cere utilizatorului confirmare pentru fiecare pas;
- un pas imposibil din lipsa unei sesiuni, permisiuni sau capabilitati se marcheaza `BLOCKED`, cu cauza exacta, iar testarea continua cu scenariile care pot fi executate in siguranta;
- nu inventeaza PASS pentru un test neexecutat;
- nu repara defecte in timpul testarii;
- nu modifica codul aplicatiei;
- nu modifica arhitectura;
- nu modifica alte Issues doar pentru ca a gasit un defect; defectele se listeaza in raport pentru triere ulterioara.

## 4. Reguli de siguranta PROD

1. Nu se modifica Surse sau Categorii surse.
2. Nu se activeaza/dezactiveaza surse.
3. JobsPipe ramane `disabled`.
4. Nu se activeaza niciun provider platit si nu se modifica moduri/cote/provider credentials.
5. Nu se testeaza si nu se implementeaza #49.
6. Orice mutatie reversibila permisa trebuie precedata de capturarea valorii initiale si urmata de rollback exact.
7. Daca rollback-ul unei mutatii esueaza, se opresc imediat toate testele mutabile si rezultatul devine `FAIL CRITICAL`; testele read-only pot continua doar pentru colectarea de dovezi.
8. Daca o actiune care nu trebuie sa porneasca Full Search declanseaza totusi un run, se opresc toate testele mutabile si se marcheaza `FAIL CRITICAL`.
9. Nu se expun tokenuri, cookies, Authorization headers, private keys, API keys sau alte credentiale.
10. Nu se face write direct pe `main`.
11. Titlul si label-urile ticketului de testare nu se modifica.

## 5. Clasificarea rezultatelor

Fiecare scenariu primeste exact una dintre starile:

- `PASS` - executat si rezultatul asteptat confirmat;
- `FAIL` - executat si rezultatul este incorect;
- `BLOCKED` - nu poate fi executat dintr-o cauza externa/capability/auth;
- `N/A` - scenariul nu este aplicabil starii observate, cu justificare.

Severitate defect:

- `P0` - pierdere/corupere date, securitate critica, aplicatie inutilizabila;
- `P1` - functionalitate principala blocata sau comportament periculos in PROD;
- `P2` - defect functional important cu workaround;
- `P3` - defect minor/UX fara impact major.

## 6. Ordinea obligatorie de testare

### PHASE 0 - Preflight si baseline

Inainte de orice mutatie:

- confirma URL-ul PROD;
- confirma ca aplicatia raspunde;
- citeste documentele obligatorii;
- citeste ticketul de executie;
- inregistreaza versiunea afisata in UI, daca este vizibila;
- inregistreaza `Ultima rulare`, `run_id`, status, `completed_at`, trigger si source counts disponibile;
- inregistreaza geografia curenta;
- inregistreaza Remote/Hibrid/Onsite;
- inregistreaza contract types selectate;
- confirma JobsPipe `disabled`.

Rezultatul se numeste:

- `BASELINE_RUN_STATE`;
- `BASELINE_CONFIG_STATE`.

Daca JobsPipe nu este `disabled` sau exista un provider platit activ neasteptat, nu il modifica. Marcheaza testul live Full Search `BLOCKED-COST-SAFETY` si continua restul testelor sigure.

### PHASE 1 - Health, autentificare si protected assets

Verifica:

- aplicatia se incarca;
- autentificarea curenta functioneaza sau sesiunea existenta este reutilizata;
- fara blank page;
- fara auth loop;
- fara `Not found` generic;
- fara eroare generica de incarcare date.

Navigheaza la:

- Joburi noi;
- De evaluat;
- Aplicari;
- Criterii de selectie;
- Administrare.

Unde inspectia network este disponibila, verifica accesul reusit la:

- `/data/jobs.json`;
- `/data/run-status.json`;
- `/data/run-history.json`;
- `/data/applications.json`;
- `/data/sources.json`;
- `/data/source-categories.json`;
- `/data/search-config.json`;
- `/data/nomenclatures.json`.

Regresie obligatorie #114: `source-categories.json` nu trebuie sa returneze 404.

Daca login-ul interactiv necesita interventie umana si nu exista sesiune reutilizabila, marcheaza testele UI dependente de auth `BLOCKED-AUTH`; nu astepta utilizatorul.

### PHASE 2 - Shell functional si navigatie

Verifica in `Administrare`:

- Overview;
- Actualizare date;
- Surse;
- Nomenclatoare;
- Loguri.

Verifica loading/empty/error states si absenta erorilor runtime vizibile.

Nu modifica Surse sau Categorii.

### PHASE 3 - Contracte si nomenclatoare canonice

In `Administrare -> Nomenclatoare` verifica cele sase domenii:

1. regions;
2. countries;
3. work_modes;
4. contract_types;
5. application_statuses;
6. seniority.

Verifica:

- pagina este functionala, nu placeholder;
- system/semantic vs extensible este respectat unde este expus;
- codurile system nu sunt liber editabile;
- EU, US, ASIA exista;
- Romania exista in countries;
- work modes normale: Remote, Hibrid, Onsite;
- `N/A` nu este optiune normala;
- contract types normale: Permanent, Temporar, Contract, Freelance;
- `unknown` nu este optiune normala;
- `applied` ramane status valid.

### PHASE 4 - Validari de configuratie fara persistenta invalida

In `Criterii de selectie`:

1. creeaza temporar in formular, fara Save, o selectie include/exclude in conflict;
2. confirma ca salvarea este blocata sau apare validare explicita;
3. revino la starea initiala;
4. elimina temporar toate targeturile geografice, fara Save;
5. confirma ca target gol este blocat;
6. revino la starea initiala.

Nu persista configuratii invalide.

### PHASE 5 - Save sigur + zero Full Search

#### 5A Work mode

- memoreaza valoarea initiala Onsite;
- toggle Onsite;
- Save;
- confirma persistenta;
- confirma ca nu apare run nou;
- restaureaza valoarea initiala;
- Save;
- confirma din nou zero run nou.

#### 5B Contract type

- memoreaza exact selectia initiala;
- modifica un singur contract type;
- Save;
- confirma persistenta;
- confirma zero run nou;
- restaureaza exact selectia initiala;
- Save;
- confirma zero run nou.

Dupa fiecare Save compara cu `BASELINE_RUN_STATE`.

### PHASE 6 - Nomenclator extensibil + rollback

Doar daca UI permite explicit Add pentru `application_statuses`:

- creeaza `e2e_stabilization_<timestamp>`;
- label `E2E Stabilization <timestamp>`;
- confirma aparitia;
- confirma zero Full Search;
- sterge aceeasi valoare;
- confirma disparitia;
- confirma zero Full Search.

Daca Add nu este disponibil, marcheaza `BLOCKED` sau `N/A` conform comportamentului intentionat observat.

Daca stergerea/cleanup esueaza: `FAIL CRITICAL` si stop mutatii.

Nu modifica `applied`.

### PHASE 7 - Integritate referentiala

Foloseste o valoare canonica referentiata, preferabil `RO` daca este in configuratia curenta.

- incearca dezactivarea prin UI;
- nu accepta niciun fallback destructiv;
- expected: operatia este blocata;
- daca request-ul ajunge la API, expected HTTP `409 Conflict` + referinte;
- verifica valoarea ramane activa;
- verifica search-config ramane neschimbat;
- verifica zero Full Search.

Daca UI blocheaza preventiv fara request API, marcheaza `PASS-UI-GUARD` in notes, dar rezultatul scenariului ramane `PASS` daca starea a ramas intacta.

### PHASE 8 - Aplicari, loguri si consistenta run state

Verifica:

- Aplicari se incarca;
- `applied` este afisat valid;
- nu edita istoricul aplicarilor;
- Loguri se incarca;
- ultimele run-uri sunt vizibile;
- trigger-ul este coerent;
- source counts sunt coerente intre UI, run-status si run-history unde sunt disponibile;
- niciun pas anterior nu a creat Full Search.

### PHASE 9 - Un singur Full Search live controlat

Acest handbook permite un singur Full Search live in cadrul ticketului de stabilizare, fara confirmare intermediara a owner-ului, NUMAI daca toate conditiile urmatoare sunt adevarate:

- scenariile anterioare nu au produs FAIL CRITICAL;
- JobsPipe este `disabled`;
- nu a fost activat niciun provider platit;
- nu exista run activ;
- configuratia curenta este valida si a fost restaurata la baseline;
- butonul `Ruleaza acum` este disponibil.

Daca o conditie nu este indeplinita, nu modifica sistemul pentru a o forta; marcheaza Phase 9 `BLOCKED` si continua cu finalizarea raportului.

Executie:

1. inregistreaza din nou pre-run state;
2. apasa o singura data `Ruleaza acum`;
3. confirma exact un run nou;
4. confirma trigger `manual-ui`;
5. confirma UI queued/running;
6. confirma ca o a doua lansare este indisponibila/blocata fara a forta o a doua executie;
7. urmareste run-ul pana la stare terminala;
8. daca depaseste 5 minute, polling-ul trebuie sa continue;
9. daca run-ul este inca activ si reload este sigur, executa un singur reload si confirma recovery; daca run-ul se termina prea repede, marcheaza acest subtest `N/A`;
10. confirma starea terminala user-friendly;
11. confirma `Ultima rulare` actualizata;
12. confirma run-status/run-history/logs coerente;
13. confirma rezultatele se reincarca;
14. confirma ca nu exista al doilea dispatch.

Nu se executa un al doilea Full Search pentru repetarea unui assertion esuat.

### PHASE 10 - Reload final si cleanup

- reload normal;
- confirma sesiunea/datele protejate se recupereaza;
- confirma Nomenclatoare poate fi deschis din nou;
- confirma toate mutatiile reversibile au fost restaurate;
- confirma nu exista `e2e_stabilization_*` ramas;
- confirma Surse/Categorii neschimbate;
- confirma JobsPipe in continuare `disabled`;
- compara starea finala cu baseline, tinand cont exclusiv de run-ul live autorizat din Phase 9.

## 7. Dovezi

Pentru fiecare FAIL/BLOCKED, inregistreaza minimum:

- ID scenariu;
- timestamp;
- pagina/URL;
- pasi exacti;
- expected;
- actual;
- HTTP status daca este disponibil;
- screenshot/evidence reference daca este disponibil;
- impact asupra datelor PROD;
- reproducibilitate observata.

Nu specula root cause fara dovezi.

## 8. Raport final obligatoriu

Fisier tinta:

`docs/testing/reports/YYYY-MM-DD-stabilization-e2e-issue-<ISSUE_ID>.md`

Structura:

```markdown
# Stabilization E2E Report

Environment: PROD
Execution ticket: #<ID>
Date/time:
Application version:
Overall: PASS / FAIL / PASS WITH BLOCKED ITEMS

| Phase | Area | Result | Evidence / Notes |
|---|---|---|---|
| 0 | Preflight / baseline | | |
| 1 | Auth / protected assets | | |
| 2 | Navigation / Admin shell | | |
| 3 | Canonical contracts | | |
| 4 | Invalid config guards | | |
| 5 | Save / zero-run | | |
| 6 | Extensible nomenclature | | |
| 7 | Referential integrity | | |
| 8 | Applications / logs | | |
| 9 | Controlled Full Search | | |
| 10 | Final reload / cleanup | | |

## Run safety
Baseline run_id:
Pre-live-run run_id:
Live run_id:
Final run_id:
Unexpected Full Search triggered: YES / NO
Authorized Full Search count: 0 / 1

## Mutations and rollback
...

## Defects
...

## Blocked items
...

## Stabilization recommendation
STABLE / NOT STABLE / CONDITIONAL
```

## 9. Salvarea raportului in Git

Raportul nu se scrie direct pe `main`.

Flux obligatoriu:

1. verifica `main` read-only si SHA-ul curent;
2. creeaza branch dedicat `test/<ISSUE_ID>-stabilization-report`;
3. creeaza fisierul de raport in `docs/testing/reports/`;
4. verifica branch-ul tinta dupa write;
5. creeaza PR catre `main` cu titlul `[TEST][#<ISSUE_ID>] Stabilization E2E report`;
6. nu face merge automat;
7. include link-ul PR in ticket.

Daca tool-urile disponibile nu permit branch/file/PR write, nu incerca fallback pe `main` si nu utiliza identitatea owner-ului printr-o ruta alternativa. Marcheaza `BLOCKED-REPORT-PERSISTENCE`, pastreaza raportul complet in ticket si lasa ticketul deschis.

## 10. Actualizarea ticketului la final

Claude actualizeaza doar body/state; titlul si label-urile se pastreaza.

In body adauga la final:

```markdown
## Execution result
Status: PASS / FAIL / BLOCKED
Overall stabilization: STABLE / NOT STABLE / CONDITIONAL
Report: <PR/file link or BLOCKED-REPORT-PERSISTENCE>
Completed at: <timestamp>
```

Regula de state:

- `PASS` + raport persistat in Git -> close ticket as completed;
- `FAIL` -> ticket ramane open;
- orice `BLOCKED` care impiedica verdictul final -> ticket ramane open;
- `BLOCKED-REPORT-PERSISTENCE` -> ticket ramane open chiar daca scenariile de produs au trecut.

Nu modifica titlul sau label-urile.

## 11. Exit criteria pentru stabilizare

Aplicatia poate fi recomandata `STABLE` numai daca:

- nu exista P0/P1 deschis rezultat din aceasta executie;
- protected assets si auth sunt functionale;
- Save nu declanseaza Full Search;
- configuratia invalida este blocata;
- rollback-ul testelor a fost complet;
- nomenclatoarele canonice sunt functionale;
- run state/logs sunt coerente;
- un Full Search live controlat trece sau este demonstrat suficient prin dovezi curente acceptate de ticket;
- raportul final este persistat si trasabil.
