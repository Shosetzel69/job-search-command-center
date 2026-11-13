# Audit de arhitectură JSCC — 2026-11-13

Status: `WORKING`
Version: `v1.0`
Applicability: `CURRENT`
Applies to: `BOTH`
Effective from: `2026-11-13`
Autor: Claude (audit independent, read-only), la cererea owner-ului. Etichetă: `ai-generated`.

## 0. Domeniu, metodă, limite

- **Auditat:** `Shosetzel69/job-search-command-center` la `main@ce9206644c4d0556b3852dfe50a6717ebd5c4615`; `Shosetzel69/job-search-discovery` la `main@6b658ad3c812bd6d4a1db2e0098f9fa34214e7cf`; Issues și PR-uri GitHub citite prin REST API pe 2026-11-13.
- **Rulat local:** testele Node și Python (rezultate în §4, T-09).
- **Nu am avut acces** la Google Cloud și la Nile (sesiunea nu are credențiale `gcloud`). Tot ce spun despre runtime (revizii, digesturi, rulări) vine din dovezile deja postate în Issues, nu din observație proprie.
- **Nu am modificat** cod, configurație, date, Issues sau medii. Singura schimbare este acest fișier.
- Documentul este analiză (L3 în `docs/documentation-policy.md`). Propunerile din §6–§8 **nu sunt aprobate**; nu autorizează implementare.

## 1. Verdict pe scurt

1. **Produsul este sănătos la nivel de cod și izolare.** Tenant Data Gateway, legarea bazei de date de mediu, sesiunea server-side și testele Node (456 de teste, toate trec) sunt solide.
2. **Livrarea este blocată de propriul control, nu de produs.** Calea canonică de deploy este oprită din cod din 2026-10-23 (`exit 86`), iar deploy-urile reale se fac prin fișiere și scripturi denumite după tichete, rulate manual de owner în Cloud Shell.
3. **Efortul s-a mutat de la produs la unelte și guvernanță.** Între 2026-10-11 și 2026-11-13, pe `main` au intrat 32 de commit-uri; 9 sunt de produs (28%), 23 sunt control-plane, CI și guvernanță.
4. **Documentul de arhitectură nu mai descrie sistemul real.** `ARCHITECTURE.md` amestecă starea veche (Cloudflare Worker, GitHub Actions, JSON), starea curentă (Cloud Run, Nile) și ținta, fără separare.
5. **Calitatea datelor este riscul de produs numărul unu.** Din 166 de surse, 0 au dovada completă că funcționează cap-coadă; 3 au corupere confirmată de câmpuri și 48 au risc structural de contaminare.
6. **Nu există PROD pe GCP și TEST este oprit.** În #425, M5 „PROD cutover” este `NOT STARTED`; `K2=A TEST_STOP` este în vigoare (conform #555).

## 2. Arhitectura reală azi (din cod, nu din documente)

| Zonă | Ce rulează efectiv | Unde |
|---|---|---|
| UI | React 18.3.1 + Tailwind 3.4.17 + Vite 5.4.14, servit de același container ca API-ul | `frontend/`, `command-api/src/static-frontend.js` |
| API | Handler în formă de Cloudflare Worker (`fetch`), împachetat de un adaptor `node:http` pe Cloud Run | `command-api/src/server.js` → `secure-entry.js` → `multiuser-api.js` / `index.js` |
| Căutare | Cloud Run Job Python pe imagine Playwright (`mcr.microsoft.com/playwright/python:v1.55.0-noble`), 2 CPU / 4 GiB / 45 min | `Dockerfile`, `scripts/job_search_runner.py` |
| Date | Nile/PostgreSQL (`jobsearch_dev`, `jobsearch_test`, `jobsearch_prod`), migrații 001–010 | `command-api/migrations/` |
| Stare de rulare | GCS (`runs/{run_id}/run-status.json`, `current.json`) **și** Nile `search_runs` | `scripts/gcp_finalize_run.py`, `scripts/shared_corpus_repository.py` |
| Registru surse | Git `data/sources.json` (TEST/PROD) **și** GCS `seed/sources.json` (doar DEV, #585) | `command-api/src/runtime-gcp.js` |
| Unelte de inginerie | 3 servicii Cloud Run în DEV + registry separat `jscc-ops` | `ops/` |
| Bridge GitHub pentru AI | Cloudflare Worker separat | `ai-github-bridge/` |

Servicii DEV raportate în #618 (2026-11-11): `jscc-command-api-dev` (produs) și trei de unelte: `jscc-dev-workspace-manager`, `jscc-ops-gateway-dev`, `jscc-dev-sandbox-worker`.

## 3. Activitate recentă, mod de lucru, sincope

### 3.1 Cifre

| Indicator | Valoare |
|---|---:|
| Commit-uri pe `main`, total (din 2026-09-03) | 1.547 |
| Commit-uri până la 2026-10-05 | 1.507 |
| Commit-uri din 2026-10-09 până la 2026-11-13 | 32 |
| — din care de produs | 9 (28%) |
| — din care unelte Remote Executor / ops | 10 |
| — din care CI Nile / enforcement #539–#555 | 11 |
| — din care documente de guvernanță | 2 |
| Issues deschise / PR-uri deschise | 50 / 18 |
| Issues deschise marcate PARKED sau hold WP #574 | 11 |
| Ultimele 100 de PR-uri (#469–#620): merged / închise fără merge / deschise | 56 / 27 / 17 |
| Branch-uri în repository | 291 |
| Comentarii în cele mai lungi 8 Issues (#539, #531, #555, #541, #589, #540, #535, #486) | 788 |

Împărțirea codului din `main` (linii): cod de produs 25.505 (30,5%), teste de produs 18.609 (22,2%), control-plane de inginerie 16.219 (19,4%), Markdown 15.108 (18,1%), configurație CI/build 4.662 (5,6%).

### 3.2 Cronologia sincopelor

| Dată | Ce s-a întâmplat | Efect |
|---|---|---|
| 2026-09-30 | #448: joburile GitHub Actions cad înainte de alocarea runner-ului | CI indisponibil; pe 2026-10-01 se propune reducerea consumului automat (PR #459, încă deschis) |
| 2026-10-04/05 | Cutover la GCP; Command API pe Cloudflare retras (#478) | `/jscc-deploy` rămâne stricat (#492, deschis din 2026-10-05) |
| 2026-10-09 | Incident de guvernanță GI-001 (ATC-535-01 / PR #536) → #539 și #540 | 206 și 60 de comentarii; se cere „execution authority” |
| 2026-10-12 | Remote Executor DEV (#537, PR #548) intră în `main` | Apare un control-plane propriu pentru ca ChatGPT să execute în DEV |
| 2026-10-23 | Commit `7393f8a`: `exit 86` în `cloudbuild.promotion.yaml` și `scripts/gcp/promote.sh` | Calea canonică de deploy este oprită |
| 2026-10-25 | WP #574: #539, #540, #555, #557, #560 trec în `PARKED_BY_OWNER` | Programul de securitate/automatizare rămâne nerezolvat, dar gate-urile lui rămân active |
| 2026-10-29 → 2026-11-12 | #589 Remote Executor vNext (74 comentarii), #593 P0 `file_count_limit` | Workspace-ul de dezvoltare cade la limita `MAX_FILES=80`; reparat pe 2026-11-12 prin ștergeri, nu structural |
| 2026-11-11 | Rularea DEV `run-852fd378-e22b-4fed-aa44-b2de5619584c` | 135 surse evaluate: 99 `success`, 9 `success_empty`, 26 erori, 1 blocaj; 6.600 înregistrări colectate, 110 joburi publicate |
| 2026-11-12 | Audit pe 166 de surse (repo discovery) | 0 surse cu toate cele 5 dovezi; 3 coruperi confirmate |
| 2026-11-13 | SDQ-01 aprobat; ATC-SDQ-01-01 → PR #620 → `ce92066` | Review R2 `REVIEW_FAIL` (F-01), R3 `REVIEW_PASS` (#621) — primul ciclu complet scurt |

### 3.3 Impedimente — cauze rădăcină

- **I-01 Capabilitate confundată cu autoritate, rezolvată prin interdicții în loc de un canal de lucru.** După GI-001 s-a interzis scrierea prin GitHub API și GitHub Actions ca executor, dar executorul GCP DEV „autorizat” nu exista complet. Rezultatul: orice schimbare cere owner-ul în Cloud Shell. Dovezile din #589 sunt marcate „owner-supplied Cloud Shell evidence”.
- **I-02 Uneltele au devenit proiect.** Pentru ca un AI să editeze cod în DEV s-a construit un sistem de fișiere la distanță peste GCS (Workspace Manager), cu limită de 80 de fișiere / 2 MiB (`MAX_FILES=80`, conform #593). Un depozit cu 500 de fișiere nu încape; #593 a fost P0 din această cauză.
- **I-03 Gate-uri identice pentru orice risc.** Aceeași secvență (Development Analysis → ATC → `APPROVE_TASK_CONTRACT` → Evidence Bundle → review exact-SHA → DEV) se aplică și unui fix de fixture, și unei schimbări de IAM. `GOVERNANCE.md` §2.8 definește 15 faze și 62 de statusuri; fluxul nominal are 19 pași.
- **I-04 Taxonomia de statusuri nu este respectată nici de proiect.** Exemple: #425 `M4_FUNCTIONAL_ACCEPTANCE_PASS_SOURCE_HEALTH_PENDING`; #593 `BLOCKED_BY_UNAVAILABLE_WORKSPACE_BACKEND_SOURCE`; #520 are în header `READY_FOR_DEV_ANALYSIS` și „Implementation authorized: NO”, deși a fost implementat (commit `7561ede`, 2026-10-07).
- **I-05 Issues folosite ca jurnal.** Fire de 120–206 comentarii, revizii R1…R12, arhive ZIP verificate prin SHA256. Costul de context pentru orice agent nou este exact problema pe care AgentFlow trebuia s-o reducă.
- **I-06 Parcare fără închidere.** 11 Issues parcate țin gate-uri „fail-closed” active, dar fără plan de ieșire. 27 din ultimele 100 de PR-uri au fost închise fără merge; 7 dintre ele (#595, #596, #597, #598, #599, #601, #602) sunt cod #589 păstrat doar pe branch.
- **I-07 Independența review-ului este de procedură, nu de identitate.** În #621 review-ul „independent” este postat cu tokenul owner-ului, nu cu identitatea `jobsearch-claude-agent[bot]`.

## 4. Componente tehnice — constatări

Severitate: **A** = blochează livrarea sau strică date; **B** = risc de alunecare; **C** = igienă.

| ID | Sev. | Constatare | Dovadă |
|---|---|---|---|
| T-01 | A | Calea canonică de deploy este oprită, dar documentele o declară singura autorizată. | `cloudbuild.promotion.yaml` pasul `validate-input` și `scripts/gcp/promote.sh` linia 6: `exit 86`; `command-api/BUILD_TRIGGER.md` (Status: CURRENT) și `ARCHITECTURE.md` §14 |
| T-02 | A | Deploy-urile reale merg prin artefacte denumite după tichete. În rădăcină sunt 11 fișiere `cloudbuild*.yaml`. | `cloudbuild.531.dev-service.yaml`, `scripts/gcp/build_531_role_family_dev_service.sh`, `scripts/gcp/stage_531_role_family_dev_service.sh`, `cloudbuild.workspace-manager-cap-100.yaml`, `cloudbuild.workspace-manager-r2.yaml`, `cloudbuild.capture-r33-source-589.yaml`, `cloudbuild.m01.dev.yaml`, `cloudbuild.m01.candidate.dev.yaml` |
| T-03 | A | Registrul de surse nu este dovadă. Git spune 147 active și 157 „validated + approved”; 132 din 166 au `last_validated_at` gol; 128 folosesc metoda `web`. #87 numără doar 9 `implemented` și 105 `web_fallback`. | `data/sources.json`, #87 |
| T-04 | A | Contaminarea vine din parserele pe „card”. Un singur fișier de 3.180 de linii (126 KB) conține 25 de clase `HTMLParser`, majoritatea scrise per site. | `scripts/job_search_public_boards.py`; `evidence/source-contamination-audit-166-20261112.md` (Luxoft, Stripe, Crossover confirmate) |
| T-05 | B | Randament mic al colectării: 6.600 colectate → 6.490 excluse → 110 publicate (1,7%); 26 din 135 surse cu eroare. Filtrarea se face după colectare (F520-01 `FAIL` în #520). | `evidence/source-extraction-166-20261112.md`, #520 |
| T-06 | B | `ARCHITECTURE.md` v1.21 (2026-10-11) nu separă vechi / curent / țintă: §2 spune „static-first”, operații prin Cloudflare Worker și GitHub Actions ca runtime; §14 spune Cloudflare retras. Două secțiuni au numărul 19. Versiunea aplicației apare ca `0.07-dev` (ARCHITECTURE), `0.06-dev` (README) și `0.10.0` (`frontend/package.json`, CHANGELOG). | fișierele numite |
| T-07 | B | Cod vechi încă legat. `JSCC_RUNTIME_BACKEND` lipsă cade pe `github`, nu eșuează. Rămân `command-api/wrangler.jsonc` cu `APP_ENV=prod`, `config/environments.json` cu depozitele runtime vechi, 19 workflow-uri GitHub (inclusiv `job-search-full.yml`, `prod-cutover.yml`, `deploy-environment.yml`). | `command-api/src/runtime-backend.js`, `command-api/src/environment-config.js` |
| T-08 | B | Două limbaje scriu aceeași schemă fără contract explicit. Migrațiile sunt în Node; Python (`psycopg`) scrie `canonical_jobs`, `source_postings`, `search_runs`. Taxonomia de roluri și nomenclatoarele au logică dublată JS + Python. | `command-api/migrations/`, `scripts/shared_corpus_repository.py` (1.445 linii), `shared/job-classification.mjs`, `scripts/role_taxonomy.py`, `shared/nomenclatures.mjs`, `scripts/nomenclatures.py` |
| T-09 | B | Testele nu sunt ermetice. Node: 201 (`command-api`) + 125 (`frontend`) + 130 (`ops`) trec. Python: 432 de teste; pe Python 3.12 cade `test_float_zero_records_is_success_empty_not_failure`; pe 3.13 mai apar 4 erori. Float este rutat acum pe `workable` (`floatjobs`), dar testul simulează `web.collect`, deci rezultatul depinde de rețea. `scripts/web_transport.py` suprascrie metoda privată `_add_entry` din `urllib.robotparser`, care s-a schimbat în 3.13. | rulare locală 2026-11-13 |
| T-10 | B | Build-ul nu este reproductibil: 0 fișiere `package-lock.json` în repository; `Dockerfile.service` rulează `npm install`. PR #569 (lockfile ops) este deschis din 2026-10-24. Contrazice regula „build once / immutable”. | `Dockerfile.service` |
| T-11 | B | Stare duplicată. Starea de rulare stă în GCS și în Nile; registrul de surse stă în Git și, doar pentru DEV, în GCS. `ARCHITECTURE.md` §16.2 interzice dual-write permanent. | §2 de mai sus |
| T-12 | C | Fișiere prea mari pentru lucru cu agenți cu buget de context: `command-api/src/multiuser-repository.js` 1.689 linii (68 KB); `frontend/src/main.jsx` 90 KB cu 47 de linii peste 400 de caractere; `frontend/src/admin-shell.jsx` 48 KB. | fișierele numite |
| T-13 | C | Copie identică de cod: `ops/r33-baseline/src/gateway.mjs` este byte-identic cu `ops/src/gateway.mjs`. | `diff` fără diferențe |
| T-14 | C | Control-plane-ul de inginerie are 3 servicii față de 1 serviciu de produs în DEV și un registry separat. Curățarea artefactelor nu are inventar (#618). | #618, `ops/` |

**Ce este bun și trebuie păstrat:** `command-api/src/db/tenant-gateway.js` (`SET LOCAL nile.tenant_id` pe tranzacție, verificat); `command-api/src/db/config.js` (refuză baza de date care nu corespunde `APP_ENV`; roluri distincte runtime/migrare); `npm run check:tenant-boundary` în CI; cookie `__Host-jscc_session`; Gitleaks și pinning pe SHA al action-urilor; separarea „colectare shared / evaluare personală” (ADR-005); contractul `CollectionResult`; modelul SDQ-01 (verdict de calitate per job) și ciclul scurt de pe 2026-11-13.

## 5. Unde poate aluneca arhitectura

- **D-01 Proliferarea căilor de deploy.** Fiecare tichet își aduce propriul `cloudbuild` și propriul script. Fără limită, „build once, promote digest” devine ficțiune.
- **D-02 Control-plane care crește mai repede decât produsul.** #589 are RE-01…RE-09, din care RE-07 și RE-09 sunt `NOT IMPLEMENTED`; fiecare cere IAM, ledger, rollback și review proprii.
- **D-03 Tranziție permanentă.** „Tranzitoriu” apare în `ARCHITECTURE.md` din septembrie pentru JSON, GitHub Actions și Cloudflare. Fără dată de expirare, codul vechi rămâne cale de execuție (T-07).
- **D-04 Surse „active” fără dovadă.** Un flag în Git trece drept stare operațională; un `success` de colectare trece drept calitate.
- **D-05 Parser nou per site.** Fiecare sursă nouă adaugă o clasă în fișierul de 3.180 de linii și un nou risc de contaminare.
- **D-06 A treia cale de acces la date.** Scripturile de diagnostic și de „repair” (SDQ ATC-06/07) pot ocoli Tenant Data Gateway dacă nu sunt constrânse.
- **D-07 Divergență DEV față de TEST/PROD.** Registrul de surse din GCS există doar în DEV; steagurile `JSCC_DEV_*` schimbă comportamentul doar în DEV. Ce trece în DEV nu este neapărat ce se promovează.
- **D-08 Procesul ca produs.** Statusuri, tokenuri și ID-uri de dovadă noi apar mai repede decât funcționalitățile.

## 6. Limite și restricții de design propuse (fiecare verificabilă automat)

| ID | Limită | Verificare |
|---|---|---|
| L-01 | O singură cale de deploy de produs: `cloudbuild.promotion.yaml` + `scripts/gcp/promote.sh`. Niciun fișier `cloudbuild.*` sau script din `scripts/gcp/` cu număr de tichet în nume. | Guard CI pe numele fișierelor |
| L-02 | Uneltele de inginerie din DEV: cel mult 1 serviciu Cloud Run și 1 Job. Niciun serviciu nou fără ADR. Nicio extindere #589 până când o schimbare de produs trece DEV → TEST pe calea L-01. | Inventar în ADR + review |
| L-03 | Fără valori implicite spre vechi: `JSCC_RUNTIME_BACKEND` lipsă = eroare. Orice cale marcată „tranzitorie” are dată de expirare în `ARCHITECTURE.md`. | Test unitar + căutare CI după „tranzitor” fără dată |
| L-04 | `ARCHITECTURE.md` are două părți clare: „Ce rulează azi” și „Țintă”. O singură sursă pentru versiunea aplicației: `frontend/package.json`. | Verificare de documentație |
| L-05 | Plafon de mărime: fișier sursă nou ≤ 600 de linii; fișierele de la T-04 și T-12 nu mai cresc (ratchet). | Guard CI cu lista de plafoane |
| L-06 | SQL pe tabelele shared numai în `scripts/shared_corpus_repository.py` și `command-api/src/multiuser-repository.js`; SQL pe tabelele personale numai prin Tenant Data Gateway. Un test de contract compară coloanele folosite de Python cu migrațiile. | Extinderea `check-tenant-boundary.mjs` + test nou |
| L-07 | O sursă de adevăr per domeniu, aceeași în toate mediile: starea de rulare în Nile `search_runs` (GCS doar artefact); registrul de surse cu același mecanism în DEV/TEST/PROD. | Review de arhitectură |
| L-08 | „Activă” înseamnă dovedită: `active=true` cere `last_validated_at` completat și verdict de calitate din SDQ-01. Nicio clasă nouă de parser pe „card”; sursă nouă doar prin feed structurat/ATS sau pagina de detaliu. | Validator pe `data/sources.json` + ratchet pe fișierul public boards |
| L-09 | Build reproductibil: `package-lock.json` pentru `command-api`, `frontend`, `ops`; `npm ci` în Dockerfile și CI. | CI cade fără lockfile |
| L-10 | Teste ermetice: niciun test nu atinge rețeaua; aceeași versiune Python (3.12) în CI, Dockerfile și local. | Rulare CI cu rețeaua blocată |
| L-11 | Buget de proces: 3 clase de risc cu gate-uri diferite (vezi R-05); cel mult 2 Issues root active simultan; cel mult 2 cicluri de remediere per review; dovezile stau în PR, nu în arhive ZIP. | Template de Issue + review |
| L-12 | Review-ul independent se postează cu identitatea agentului (`jobsearch-claude-agent[bot]`), nu cu tokenul owner-ului. | Autorul comentariului |

## 7. Îmbunătățiri propuse, în ordine

**P0 — deblochează livrarea**

- **R-01** Decizie pe calea de deploy DEV: fie se scoate `exit 86` după un review țintit, fie se aprobă explicit ruta „image-only” cerută chiar de comentariul din `promote.sh`. Până atunci T-01 rămâne.
- **R-02** Îngheață extinderea #589 (RE-03…RE-09) și alege executorul de dezvoltare: (a) Remote Executor actual, cu limita de 80 de fișiere; sau (b) un agent cu clonă Git completă și push pe branch, plus o identitate GCP restrânsă pentru build și deploy DEV. Varianta (b) elimină Workspace Manager ca dependență.
- **R-03** Închide SDQ-01 Delivery A (ATC-02 non-degradare, ATC-03 corecții Luxoft/Stripe/Crossover din PR #617, ATC-05 rollout DEV). Este singurul flux activ care îmbunătățește direct produsul.

**P1 — oprește alunecarea**

- **R-04** Un PR de curățare a codului vechi (T-07) și rescrierea `ARCHITECTURE.md` în forma L-04.
- **R-05** Simplifică procesul la 3 clase: (1) documente/teste — PR + CI; (2) cod de produs în DEV — ATC scurt + review + deploy DEV; (3) schemă/date/IAM/TEST/PROD — fluxul complet actual. Reduce statusurile la cele folosite efectiv.
- **R-06** Triere: cele 18 PR-uri deschise și 291 de branch-uri; pentru cele 11 Issues parcate, fie criteriu de reactivare, fie închidere cu `DEFERRED`.
- **R-07** Lockfile-uri (L-09), test Float reparat și Python fixat (L-10).

**P2 — eficiență**

- **R-08** Filtrare înainte de colectarea de detalii (F520-01) și scoaterea din rulare a surselor care eșuează repetat, ca să crească randamentul de 1,7%.
- **R-09** Sparge `job_search_public_boards.py` pe familii de adaptoare și `multiuser-repository.js` pe domenii, fără schimbare de comportament.
- **R-10** Inventar și politică de retenție pentru Artifact Registry și GCS (#618).

## 8. Decizii care aparțin owner-ului

1. R-01: cum se redeschide calea de deploy DEV.
2. R-02: (a) sau (b) pentru executorul de dezvoltare.
3. R-05: dacă procesul se împarte pe 3 clase de risc.
4. Care dintre limitele L-01…L-12 devin reguli în `GOVERNANCE.md` / `.ai-instructions.md`.
5. R-06: soarta celor 11 Issues parcate.
