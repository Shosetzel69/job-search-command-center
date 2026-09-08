# Package 1 Implementation Plan

## Status
Implementation ready.

Data: 2026-09-08
Umbrella issue: #79
Roadmap: `docs/solution-roadmap.md`

## Obiectiv

Stabilizarea executiei, corectitudinea filtrarii geografice si observabilitatea minima necesara pentru folosirea controlata a aplicatiei.

Pachetul 1 trebuie sa elimine rularile necerute si sa garanteze ca un full search foloseste criteriile curente validate din interfata.

## Principii obligatorii

1. Salvarea configuratiei este separata de executia cautarii.
2. Full search ruleaza numai la comanda explicita in Pachetul 1.
3. Automatizarea este OFF.
4. JobsPipe ramane disabled.
5. Configuratia geografica invalida se trateaza fail-safe.
6. Testele locale/mock sunt preferate; run-urile live se folosesc numai pentru validarea finala.
7. Nu se introduc dependinte sau arhitectura noua daca nu sunt necesare pentru scope.

---

# 1. Current state confirmat

## Workflow
`.github/workflows/job-search-full.yml` are in prezent trei cai de declansare:
- `push` pe cod/config/surse;
- `workflow_dispatch`;
- cron `0 6,15 * * *`.

Acest model trebuie eliminat pentru full search in Pachetul 1.

## Configuratie
`data/search-config.json` are in prezent:

```json
"target_regions": [],
"target_country_codes": [],
"search_country_codes": []
```

Aceasta stare a permis joburilor din tari netinta sa treaca deoarece motorul trateaza lista tinta goala permisiv.

`jobspipe_mode` este `disabled` si trebuie sa ramana astfel.

## Command API
`command-api/src/index.js` are deja:
- autentificare Google;
- `PUT /config`;
- `POST /commands/run`;
- verificare run activ;
- validare includeri/excluderi geografice.

Modificarile necesare sunt incrementale, nu necesita un nou serviciu.

## Frontend
`frontend/src/main.jsx` contine deja:
- selector regiuni/tari;
- criterii salvabile;
- `Ruleaza verificarea`;
- tara normalizata pentru joburi;
- polling pentru starea rularii.

Pachetul 1 trebuie sa alinieze comportamentul existent, nu sa reconstruiasca frontend-ul.

---

# 2. Scope si issues

| Workstream | Issues |
|---|---|
| Control executie | #77, #18, #19, #24 |
| Geografie | #35, #36, #37 |
| Observabilitate | #13, #38, #39 |
| Security / release | #21, #33, #17, #24 |

Issue de executie: #79.

---

# 3. Workstream A - Control executie

## A1. Full search manual-only

Fisier:
- `.github/workflows/job-search-full.yml`

Schimbari:
- elimina `push`;
- elimina `schedule`;
- pastreaza `workflow_dispatch`;
- adauga input `run_trigger`, default `manual-ui`;
- seteaza `RUN_TRIGGER` din inputul canonic.

Forma tinta:

```yaml
on:
  workflow_dispatch:
    inputs:
      run_trigger:
        required: false
        default: manual-ui
```

Nu se modifica CI-ul separat pentru validarea codului.

## A2. Command API - Save

Fisier:
- `command-api/src/index.js`

`PUT /config`:
- authenticate;
- validate;
- persist;
- return success;
- zero dispatch.

## A3. Command API - Run

`POST /commands/run` trebuie sa:
1. autentifice;
2. primeasca criteriile curente din UI sau sa foloseasca explicit configuratia canonica curenta;
3. valideze acelasi contract ca `PUT /config`;
4. persiste configuratia daca exista diferente;
5. verifice `hasActiveRun`;
6. faca exact un workflow dispatch;
7. trimita `run_trigger=manual-ui`;
8. returneze 202.

Erori:
- invalid config -> 400;
- unauthorized -> 401/403;
- run activ -> 409;
- GitHub failure -> 502 controlat.

Important: la eroare de validare nu se face dispatch.

## A4. Frontend

Fisier principal:
- `frontend/src/main.jsx`

Comportament tinta:

```text
Salveaza preferintele
-> PUT /config
-> success
-> STOP

Ruleaza acum
-> trimite criteriile curente
-> POST /commands/run
-> 202
-> polling run-status
```

UI:
- buton Run dezactivat in timpul unei rulari;
- 409 -> mesaj `Exista deja o rulare activa`;
- 400 -> afiseaza mesajul de validare;
- save success nu schimba statusul in `running`.

---

# 4. Workstream B - Geografie fail-safe

## B1. Regula pentru selectie goala

Configuratia:

```text
targetRegions=[] AND targetCountries=[]
```

nu este o cerere implicita `Worldwide`.

In Pachetul 1:
- Save/Run trebuie sa respinga configuratia tinta goala;
- runner-ul trebuie sa aiba protectie secundara pentru cazul in care configuratia invalida ajunge totusi in fisier;
- `geography_matches()` nu trebuie sa transforme lipsa targetului intr-un allow-all silentios.

## B2. Migrare configuratie existenta

La release se porneste de la o configuratie valida.

Default de recuperare, daca utilizatorul nu selecteaza explicit altceva inainte de release:
- `RO`
- `BE`
- `LU`

Acestea reprezinta ultima selectie valida cunoscuta inainte de incidentul care a golit targeturile.

## B3. #36 - Selectie pozitiva

Frontend/API/runner trebuie sa foloseasca acelasi contract:
- `targetRegions`: `EU`, `US`, `ASIA`;
- `targetCountries`: coduri ISO2;
- selectie multipla;
- aceeasi normalizare uppercase/trim;
- persistenta canonica.

## B4. #37 - Excluderi

- `excludedRegions`;
- `excludedCountries`;
- conflict country-country blocat;
- conflict region-country blocat;
- aceleasi reguli in frontend si backend.

## B5. Semantica work mode

### Hybrid / Onsite
Jobul trebuie sa intersecteze geografia tinta explicita.

### Remote
Se pastreaza semantica aprobata:
- `Worldwide` explicit -> eligibil conform regulilor remote;
- `EU` / `EMEA` explicit -> evaluat ca scope;
- tari explicite -> se verifica restrictia concreta;
- lipsa datelor nu produce o tara inventata.

## B6. Regression fixtures

Minimum:

### Case 1 - JP rejected
```json
{
  "title": "Technical Project Manager",
  "mode": "Hybrid",
  "country_codes": ["JP"]
}
```
Target: `RO, BE, LU`.
Rezultat: excluded.

### Case 2 - BE accepted
Hybrid BE, target BE -> geography pass.

### Case 3 - target empty
Target regions/countries empty -> configuration error, nu allow-all.

### Case 4 - conflict
Target EU + excluded BE -> conflict conform regulii aprobate -> save/run blocat.

---

# 5. Workstream C - Observabilitate

## C1. Trigger canonic

Pachet 1:
- `manual-ui`.

Rezervat ulterior:
- `scheduled`.

`config` nu mai este trigger de full search.

## C2. Run status contract

Runner-ul trebuie sa expuna coerent, unde este tehnic disponibil:
- `sources_configured`;
- `sources_attempted` / processed;
- `sources_succeeded`;
- `sources_failed`;
- `sources_skipped` / deferred;
- `records_inspected`;
- `jobs_published`;
- `excluded_count`;
- `started_at`;
- `completed_at`;
- `trigger`;
- erori sanitizate.

## C3. UI progres

#13/#38:
- `X din Y` foloseste sursele executabile reale;
- procentul nu este calculat din numarul total brut din catalog daca acele surse nu sunt attempted;
- finalul ajunge la 100% numai cand run-ul s-a finalizat;
- status partial/error ramane vizibil.

## C4. Loguri

#39 in Pachetul 1:
- ultimele 10 rulari;
- trigger;
- durata;
- surse;
- records;
- published/excluded;
- erori sanitizate.

Integrarea completa sub `Administrare` ramane Pachetul 2.

## C5. Tara jobului

#35:
- liste: prima tara + N pentru multi-country;
- Job Details: lista completa;
- fara tara -> `Nespecificat`/valoare neutra;
- nu se deduce fictiv tara dintr-un location ambiguu.

---

# 6. Workstream D - Security si release

## D1. Teste negative

#21 minimum:
- GET protected data fara bearer -> 401/403;
- user Google neautorizat -> 403;
- Origin nepermis -> 403;
- payload config invalid -> 400;
- payload run invalid -> 400 si zero dispatch;
- run concurent -> 409;
- scan minimal ca logurile nu contin token/PAT/API key.

## D2. Publicare concurenta

#33:
- simuleaza schimbarea `main` intre checkout si publish;
- daca schimbarea concurenta nu modifica semantic rezultatele generate, runner-ul trebuie sa reaplice outputul peste HEAD curent;
- fara force push;
- conflict real pe aceleasi date -> eroare explicita.

## D3. Cloudflare

#17:
- build Worker;
- deploy;
- `/health` live;
- protected data auth.

## D4. E2E final #24

Se executa o singura validare live completa dupa ce testele locale/CI sunt green.

Scenariu:
1. Login.
2. Seteaza geografie valida.
3. Save.
4. Confirma ca nu apare run.
5. Ruleaza acum.
6. Confirma exact un run.
7. Confirma trigger `manual-ui`.
8. Urmareste progresul.
9. Confirma finalizare si refresh rezultate.
10. Verifica job/tara eligibila si absenta fixture-ului/cazului JP neeligibil.
11. Verifica logurile.

---

# 7. Fisiere tinta

Lista initiala; implementarea poate descoperi dependente suplimentare legitime.

## Workflow
- `.github/workflows/job-search-full.yml`

## Command API
- `command-api/src/index.js`
- teste Command API existente/noi

## Frontend
- `frontend/src/main.jsx`
- teste frontend existente/noi

## Search engine
- `scripts/job_search.py`
- `scripts/job_search_runner.py`
- teste `scripts/test_*.py`

## Data
- `data/search-config.json`
- `data/run-status.json` contract
- `data/run-history.json` contract

## Docs
- `docs/requirements.md`
- `docs/command-api.md`
- `docs/data-contract.md`
- `docs/functionalitati.md`
- `docs/solution-roadmap.md`
- `CHANGELOG.md`

---

# 8. Ordine recomandata de commits / PR

Se recomanda un singur branch de pachet, dar commits mici si verificabile.

1. `fix: make full search manual only`
2. `fix: separate config save from run dispatch`
3. `fix: reject empty target geography`
4. `feat: align geography controls and exclusions`
5. `test: add geography regression coverage`
6. `feat: normalize run trigger and source progress`
7. `feat: expose country consistently in job UI`
8. `test: add command API security negatives`
9. `test: validate concurrent result publication`
10. `docs: align package 1 contracts and release notes`

PR-ul final trebuie sa refere #79 si issues-urile componente.

---

# 9. Strategie de testare cu cost minim

In timpul developmentului:
- unit tests;
- mocked GitHub API;
- mocked provider/network;
- fixtures locale;
- build frontend/Worker;
- zero full search live pentru fiecare commit.

Live:
- maxim run-urile necesare pentru E2E final si eventual un rerun daca primul expune un defect real;
- JobsPipe ramane disabled;
- fara cron/scheduler.

---

# 10. Rollback

Daca release-ul produce regresie critica:
1. revert PR-ul Pachetului 1;
2. nu se reactiveaza cron-ul automat ca fallback;
3. full search ramane manual sau este oprit pana la fix;
4. se pastreaza ultima versiune valida de `jobs.json`;
5. configuratia geografica nu se revine la lista goala permisiva.

Principiu: rollback-ul nu trebuie sa reintroduca rularea automata necontrolata sau allow-all geografic.

---

# 11. Definition of Ready

- [x] Solution Roadmap documentat;
- [x] umbrella Administrare #77 existent;
- [x] issue de executie Pachet 1 #79 creat;
- [x] #18 aliniat cu Save != Run;
- [x] #19 aliniat cu Save != Run;
- [x] #24 aliniat cu noul E2E;
- [x] #39 aliniat cu trigger `manual-ui`;
- [x] current-state workflow verificat;
- [x] current-state config verificat;
- [x] fisierelor tinta identificate;
- [x] test matrix definita;
- [x] out-of-scope explicit.

Pachetul 1 este gata pentru implementare.

---

# 12. Definition of Done

- [ ] full search este manual-only;
- [ ] Save nu produce run;
- [ ] Run produce exact un dispatch;
- [ ] configuratia geografica goala este fail-safe;
- [ ] geografia este coerenta frontend/API/runner;
- [ ] cazul JP este regresie acoperita;
- [ ] trigger/progres/surse/loguri sunt coerente;
- [ ] tara este afisata conform #35;
- [ ] security negatives trec;
- [ ] #33 revalidat;
- [ ] CI green;
- [ ] E2E live green;
- [ ] documentatia actualizata;
- [ ] JobsPipe ramane disabled;
- [ ] scheduler-ul ramane in afara release-ului.
