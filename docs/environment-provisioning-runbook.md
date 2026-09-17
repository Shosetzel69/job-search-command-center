# Environment Provisioning Runbook - DEV / TEST / PROD

Status: Phase 6 readiness prepared; DEV/TEST operational; PROD live cutover not authorized
Data initiala: 2026-09-11
Revizie finala: 2026-09-17
ADR: `docs/adr/ADR-003-environment-isolation.md`
Implementation: #161 #175
Security / G6: #177 #183

## 1. Scop

Procedura defineste pregatirea, crearea, validarea, promovarea si cutover-ul celor trei medii runtime izolate.

Documentul este contract operational pentru Development. La revizia din 2026-09-17, DEV si TEST sunt provisionate si validate, iar target-ul PROD dedicat este configurat pentru readiness non-mutating. Legacy PROD ramane neschimbat; Phase 7 nu este autorizat.

Principii:
- acelasi source code;
- trei runtime stacks tinta separate;
- trei runtime repositories separate;
- trei Cloudflare accounts tinta separate;
- credentiale de write separate pe environment si rol;
- `SOURCE_SHA` immutable pentru build si Run;
- `RUNTIME_DATA_SHA` pentru snapshot-ul de date servit;
- fara fallback implicit la PROD sau `main` pentru identity finala;
- fara copiere manuala repetitiva a configuratiei;
- provisioning idempotent unde API-urile permit;
- legacy PROD nu se modifica in Phase 6;
- PROD cutover necesita G6 PASS si un owner GO nou, separat.

## 2. Resurse tinta

### 2.1 Source repository

```text
Shosetzel69/job-search-command-center
```

Contine cod, teste, documentatie, templates si automation logic.

Dupa cutover-ul PROD, source repository-ul nu mai deployeaza direct `job-search-command-api` prin Cloudflare Git integration sau alta cale implicita.

### 2.2 Runtime repositories

```text
Shosetzel69/job-search-runtime-dev
Shosetzel69/job-search-runtime-test
Shosetzel69/job-search-prod
```

Toate private.

Structura minima:

```text
.github/workflows/runtime.yml
data/
  applications.json
  jobs.json
  nomenclatures.json
  run-history.json
  run-status.json
  search-config.json
  search-state.json
  source-categories.json
  sources.json
README.md
```

Lista finala `data/*` se deriva din contractul canonic existent, nu se hard-codeaza independent in trei locuri.

Runtime data nu se promoveaza DEV -> TEST -> PROD.

### 2.3 Cloudflare accounts

Target-ul izolat foloseste:

```text
Job Search DEV
Job Search TEST
Job Search PROD
```

- fiecare este account dedicat environment-ului sau;
- `Job Search PROD` este un account nou si separat de legacy PROD;
- fiecare target account contine numai runtime resources ale environment-ului sau;
- legacy PROD existent ramane neschimbat ca rollback target pana la acceptarea Phase 7.

Legacy live origin in Phase 6:

```text
https://job-search-command-api.myeboda.workers.dev
```

Target PROD origin:

```text
https://job-search-command-api.job-search-prod.workers.dev
```

### 2.4 Worker

Nume in fiecare target account:

```text
job-search-command-api
```

Account-ul este boundary-ul principal. URL-ul/origin-ul trebuie sa fie distinct si verificabil per environment.

## 3. Manual vs automatizat

### 3.1 Owner actions manuale

Pentru target-ul izolat:
1. stabilizarea curenta este inchisa;
2. ADR-003 este merged;
3. owner GO pentru #161;
4. `Job Search DEV` exista separat;
5. `Job Search TEST` exista separat;
6. `Job Search PROD` exista ca account nou si dedicat;
7. legacy PROD actual ramane neschimbat;
8. cele trei Cloudflare account IDs sunt configurate environment-specific;
9. GitHub Environments `dev`, `test`, `prod` exista si au credentiale/config separate;
10. bootstrap/runtime/source-read credentials sunt separate pe rol;
11. Phase 7 nu incepe fara G6 PASS si un owner GO nou.

### 3.2 Automatizat

Environment tool trebuie sa poata:
- crea/verifica runtime repositories;
- initializa datele seed aprobate pentru non-PROD;
- genera wrapper workflow dintr-un template unic;
- configura source read-only access;
- seta repository secrets fara a le versiona;
- valida Cloudflare account IDs;
- crea/deploya Worker in account-ul corect atunci cand faza permite;
- seta Worker vars/secrets;
- verifica `/health`;
- executa negative isolation tests;
- produce raport machine-readable si human-readable fara secrete.

Bootstrap credentials largi nu se stocheaza in Worker/runtime si se revoca/rotesc dupa provisioning daca nu mai sunt necesare.

## 4. Manifest canonic

Exemplu:

```text
config/environments.json
```

Schema conceptuala:

```json
{
  "sourceRepository": "Shosetzel69/job-search-command-center",
  "environments": {
    "dev": {
      "runtimeRepository": "Shosetzel69/job-search-runtime-dev",
      "cloudflareAccountId": "<required>",
      "workerName": "job-search-command-api",
      "searchMode": "disabled-or-smoke"
    },
    "test": {
      "runtimeRepository": "Shosetzel69/job-search-runtime-test",
      "cloudflareAccountId": "<required>",
      "workerName": "job-search-command-api",
      "searchMode": "smoke"
    },
    "prod": {
      "runtimeRepository": "Shosetzel69/job-search-prod",
      "cloudflareAccountId": "<required>",
      "workerName": "job-search-command-api",
      "searchMode": "live"
    }
  }
}
```

Secretele nu apar in manifest.

## 5. Secret input si least privilege

Live deployment/control-plane foloseste GitHub Environments `dev`, `test`, `prod` cu aceeasi structura canonica.

Secrets per environment:

```text
CLOUDFLARE_TOKEN
GH_BOOTSTRAP_TOKEN
GH_RUNTIME_TOKEN
SOURCE_READ_TOKEN
ALLOWED_GOOGLE_SUB
```

Variables per environment:

```text
CLOUDFLARE_ACCOUNT_ID
GOOGLE_CLIENT_ID
FRONTEND_ORIGIN
```

Roluri:
- `GH_BOOTSTRAP_TOKEN`: bootstrap/configurare runtime repo; nu se instaleaza in Worker;
- `GH_RUNTIME_TOKEN`: runtime repo-ul environment-ului numai; minimum necesar pentru runtime content/Actions;
- `SOURCE_READ_TOKEN`: source repository read-only; nu acceseaza runtime repo;
- `CLOUDFLARE_TOKEN`: numai account-ul/Worker-ul environment-ului, cu cel mai restrans scope disponibil;
- credentialele celor trei roluri GitHub sunt distincte intre ele si environment-specific.

Runtime workflow poate folosi `GITHUB_TOKEN` nativ pentru operatii interne caller-ului acolo unde contractul permite; Worker-ul foloseste credentialul runtime separat si limitat la runtime repo-ul environment-ului.

PAT classic nu se foloseste pentru source-read. Implementarea curenta valideaza operational repository boundaries pentru fine-grained PATs.

Implementarea documenteaza expirarea, rotatia si revocarea credentialelor long-lived.

## 6. Environment tool - contract

Phase 6 status:
- contractul parametrizat, manifestul si comenzile sunt implementate;
- DEV si TEST live bootstrap/deploy sunt operationale si validate;
- PROD readiness foloseste configuratia reala `prod` intr-un workflow manual-only si strict non-mutating;
- orice live PROD bootstrap/deploy/migration/cutover este blocat pana la Phase 7.

Un singur entry point:

```text
scripts/environment.mjs
```

Nu se creeaza scripturi DEV/TEST/PROD cu logica duplicata.

### 6.1 validate

```text
npm run env:validate -- --env dev --source-sha <full-sha>
npm run env:validate -- --env test --source-sha <full-sha>
npm run env:validate -- --env prod --source-sha <full-sha> --dry-run --owner-gate APPROVED
```

Verifica minimum:
- environment explicit si valid;
- manifest valid;
- account ID prezent;
- runtime repo corespunde environment-ului;
- Worker/origin coerent;
- credentialele obligatorii exista;
- GitHub credential boundaries corespund rolului;
- Cloudflare token apartine target-ului asteptat;
- source SHA exista si este immutable;
- nu exista placeholder nerezolvat;
- PROD nu este default;
- search policy este compatibila cu environment-ul.

Exit code != 0 la orice abatere.

### 6.2 bootstrap

Pre-Phase-7:

```text
npm run env:bootstrap -- --env dev --source-sha <full-sha>
npm run env:bootstrap -- --env test --source-sha <full-sha>
```

Operatie idempotenta:
1. `validate` + provider preflight;
2. verifica/creeaza runtime repo;
3. initializeaza fisierele runtime din seed aprobat;
4. configureaza read-only source access;
5. instaleaza wrapper workflow generat;
6. configureaza environment-specific secrets;
7. verifica Cloudflare account/Worker access inainte de mutatii;
8. creeaza Worker daca lipseste si faza permite;
9. configureaza Worker vars/secrets;
10. deploy initial cu `SOURCE_SHA` explicit;
11. verifica health identity;
12. produce raport.

Resursele existente nu sunt sterse/recreate implicit.

### 6.3 bootstrap-all

```text
npm run env:bootstrap-all
```

Executa numai:

```text
bootstrap(dev)
bootstrap(test)
```

**PROD este exclus structural din `bootstrap-all`.**

Nu exista flag care transforma silent `bootstrap-all` in DEV+TEST+PROD.

### 6.4 PROD readiness si bootstrap

In Phase 6, singura actiune PROD aprobata este readiness/preflight non-mutating pe GitHub Environment `prod`.

Workflow-ul canonic este:

```text
PROD Readiness (Non-Mutating)
```

Acesta verifica configuratia reala, credential boundaries, trusted-main ancestry si accesul la dedicated PROD Worker fara a face deploy/migration/cutover.

Live PROD bootstrap/deploy devine eligibil numai dupa:
- G6 PASS;
- inchiderea/acceptarea blockerelor de securitate;
- owner GO nou si separat pentru Phase 7.

Atunci comanda explicita va folosi:

```text
npm run env:bootstrap -- --env prod --source-sha <full-sha>
```

Tool-ul trebuie sa refuze PROD live daca authorization gate-ul Phase 7 nu este satisfacut.

### 6.5 deploy

```text
npm run env:deploy -- --env dev --source-sha <full-commit-sha>
```

Reguli:
- `SOURCE_SHA` explicit si immutable;
- branch/tag/mutable ref nu este acceptat ca identity finala de deployment;
- candidate SHA trebuie sa fie reachable din trusted control-plane baseline;
- runtime data vin numai din runtime repo-ul environment-ului;
- privileged deployment tooling vine din trusted control-plane, nu din candidate payload;
- deploy token corespunde Cloudflare account-ului environment-ului;
- `/health` confirma `environment`, `source_sha`, `runtime_repo`, `runtime_data_sha`, `search_mode`;
- PROD live deploy necesita Phase 7 GO;
- lipsa `--env` sau `--source-sha` = FAIL.

### 6.6 status

```text
npm run env:status
```

Output minim:

```text
ENV   SOURCE_SHA   RUNTIME_DATA_SHA   RUNTIME_REPO             CF_ACCOUNT   HEALTH
DEV   abc123...    def456...          job-search-runtime-dev   ...123       OK
TEST  abc123...    987abc...          job-search-runtime-test  ...456       OK
PROD  9fd321...    555aaa...          job-search-prod          ...789       OK
```

Inainte de Phase 7, statusul target PROD poate fi `PREPARED/READINESS` fara runtime data migrata; legacy PROD ramane separat si live.

Trebuie sa marcheze drift-ul dintre source SHA, runtime data SHA, manifest si health.

### 6.7 isolation-test

```text
npm run env:isolation-test
```

Probe sigure/non-destructive:
- DEV GitHub credential -> write TEST: refuz;
- DEV GitHub credential -> write PROD: refuz;
- TEST GitHub credential -> write PROD: refuz;
- PROD runtime credential -> source repo: refuz;
- source-read credential -> runtime repo: refuz;
- DEV Cloudflare credential -> TEST/PROD: refuz;
- TEST Cloudflare credential -> PROD: refuz;
- PROD Cloudflare credential -> DEV/TEST/legacy account: refuz;
- wrong runtime repo in manifest: FAIL;
- wrong account ID: FAIL;
- missing env: FAIL;
- missing/wrong source SHA: FAIL;
- health source SHA mismatch: FAIL;
- health runtime data SHA mismatch: FAIL;
- DEV/TEST live policy invalid: FAIL.

Testul nu modifica date business reale.

## 7. Runtime workflow

Wrapper minimal:

```text
workflow_dispatch / approved trigger
        |
        +-> validate explicit SOURCE_SHA
        +-> checkout runtime repo
        +-> checkout source repo @ SOURCE_SHA read-only
        +-> validate runtime contract
        +-> execute approved source payload using trusted orchestration
        +-> publish data in caller runtime repo only
        +-> capture new RUNTIME_DATA_SHA
        +-> rebuild/deploy caller Worker only
        +-> health identity check
```

Provider secrets sunt citite numai din runtime repository/environment-ul caller.

Wrapper-ul nu contine business logic duplicata.

Control-plane deployment scripts, package manifests, Wrangler config si build/deploy tooling provin din trusted reviewed baseline. Candidate `SOURCE_SHA` este separat ca payload immutable si nu poate suprascrie orchestration-ul privilegiat.

## 8. Source access

Model curent de rol:

```text
job-search-runtime-dev  -> SOURCE_READ_TOKEN DEV  -> source (read-only)
job-search-runtime-test -> SOURCE_READ_TOKEN TEST -> source (read-only)
job-search-prod         -> SOURCE_READ_TOKEN PROD -> source (read-only)
```

Fiecare token source-read este fine-grained, scoped exclusiv la source repository si separat de runtime/bootstrap token.

Orice alternativa necesita acelasi nivel de least privilege.

## 9. Command API configuration

Minimum semantic:

```text
APP_ENV=dev|test|prod
GITHUB_RUNTIME_OWNER=Shosetzel69
GITHUB_RUNTIME_REPO=<canonical repo for selected env>
GITHUB_RUNTIME_REF=main
GITHUB_WORKFLOW=runtime.yml
SOURCE_SHA=<full-sha>
RUNTIME_DATA_SHA=<runtime-commit-sha>
SEARCH_MODE=<policy>
FRONTEND_ORIGIN=<environment-url>
```

Canonical runtime repo mapping:

```text
dev  -> job-search-runtime-dev
test -> job-search-runtime-test
prod -> job-search-prod
```

Tokenul Worker are acces exclusiv la runtime repo-ul environment-ului sau.

## 10. Run identity

`POST /commands/run` nu poate executa `main` implicit.

Flux obligatoriu:

```text
GET /health -> source_sha = abc123
POST /commands/run
workflow_dispatch(source_sha=abc123)
checkout source @ abc123
```

`run-status.json` si `run-history.json` includ `source_sha`.

Workflow-ul refuza lipsa sau mismatch-ul de `source_sha`.

## 11. Static data build si consistency

Build:
1. checkout source @ `SOURCE_SHA` ca payload aprobat;
2. checkout runtime repo la `RUNTIME_DATA_SHA`;
3. build frontend/Worker prin trusted build baseline;
4. copiaza protected runtime data in Static Assets;
5. deploy;
6. `/health` confirma cele doua SHA-uri.

Dupa search:
1. publica runtime data numai in caller repo;
2. obtine noul `RUNTIME_DATA_SHA`;
3. rebuild/deploy acelasi environment;
4. confirma `/health.runtime_data_sha`.

Daca commit-ul runtime reuseste dar redeploy-ul esueaza, statusul este explicit `DEGRADED/STALE_ASSET`. Nu se raporteaza Run ca complet sincronizat.

## 12. Procedura DEV

Status actual: operational / bootstrap PASS pentru candidate SHA aprobat in evidence G6.

Procedura:
1. owner GO #161;
2. completeaza DEV account/config;
3. validate DEV;
4. bootstrap DEV;
5. configureaza OAuth DEV;
6. health identity check;
7. isolation DEV -> TEST/PROD;
8. smoke functional;
9. DEV ready numai dupa PASS.

PROD nu se modifica.

## 13. Procedura TEST

Status actual: operational / bootstrap PASS pentru acelasi candidate SHA folosit in evidence G6.

Numai dupa DEV PASS:
1. validate TEST;
2. bootstrap TEST;
3. configureaza OAuth TEST;
4. deploy exact acelasi `SOURCE_SHA` validat in DEV;
5. health identity check;
6. isolation TEST -> PROD;
7. smoke/E2E TEST;
8. release candidate ready numai dupa PASS.

## 14. Procedura PROD

### Phase 6 — preparation only

Permis:
1. inventar complet legacy PROD;
2. backup/recovery design si runbook;
3. configurare target `job-search-prod` fara business-data migration;
4. configurare dedicated `Job Search PROD` account/Worker/OAuth/credentials;
5. non-mutating readiness against real `prod` environment;
6. independent G6 QA.

Interzis in Phase 6:
- live PROD bootstrap/deploy;
- migrare runtime data PROD;
- Full Search pe noul target ca actiune de cutover;
- switch de trafic;
- mutatie legacy PROD.

### Phase 7 — numai dupa G6 PASS + owner GO nou

1. re-probe legacy PROD live identity;
2. captureaza backup anchors immutable imediat inainte de cutover;
3. seed/migreaza controlat numai datele canonice PROD in `job-search-prod`;
4. configureaza/finalizeaza credentialele PROD runtime;
5. deploy exact `SOURCE_SHA` validat in DEV si TEST;
6. health/auth/protected-assets smoke;
7. verifica search execution cu acelasi `SOURCE_SHA` numai in limita aprobata;
8. confirma negative credential isolation inclusiv fata de legacy account;
9. cutover explicit;
10. dezactiveaza calea directa source repo -> Cloudflare deployment pentru legacy `job-search-command-api` numai dupa acceptare conform runbook;
11. verifica: push/PR in source repo produce zero command-api deployment;
12. pastreaza legacy rollback target pana la acceptarea finala;
13. elimina mecanismele vechi redundante numai prin decizie separata dupa observatie.

`ai-github-bridge` nu este dezactivat sau mutat de acest pas.

## 15. Rollback

Primary rollback in Phase 7 este revenirea operationala/traffic la legacy PROD neschimbat.

Rollback cod pentru noul target = redeploy ultimul `SOURCE_SHA` PROD validat, daca aceasta este actiunea aprobata.

Rollback data = backup/history din runtime PROD exclusiv.

Nu se copiaza date DEV/TEST in PROD.

Daca noul runtime PROD esueaza inainte de finalizarea cutover-ului, se revine la legacy PROD si noul stack se pastreaza pentru investigatie.

Detaliile autoritative sunt in `docs/prod-cutover-rollback-runbook.md`.

## 16. Cost control

Target: cost 0.

- Cloudflare: conturi Free separate;
- GitHub: runtime repos private, consum Actions monitorizat;
- DEV live full search disabled implicit;
- TEST controlled search;
- provider calls costisitoare nu se tripleaza automat.

Orice cost nou necesita aprobare inainte de activare.

## 17. Evidence

Raportul final al fiecarui bootstrap/deploy/readiness contine:
- environment;
- `SOURCE_SHA`;
- `RUNTIME_DATA_SHA` daca exista;
- runtime repo;
- Cloudflare account ID mascat;
- Worker name/URL;
- search mode;
- health/readiness result;
- credential/isolation result;
- timestamp;
- fara secrete.

G6 evidence trebuie sa includa suplimentar:
- acelasi approved candidate SHA prin DEV/TEST;
- PROD readiness non-mutating pe `prod` real;
- credential role/repository boundaries;
- Cloudflare target si negative cross-account isolation proof;
- documentatie canonica aliniata;
- tratamentul explicit al riscului S4 de authorization boundary.

## 18. Gate-uri

```text
STABILIZATION CLOSED
        |
        v
ADR-003 merged
        |
        v
#161 owner GO
        |
        v
environment-awareness + automation
        |
        v
DEV bootstrap + health/isolation PASS
        |
        v
TEST same SOURCE_SHA + health/isolation PASS
        |
        v
PROD readiness NON-MUTATING PASS
        |
        v
G6 independent QA PASS
        |
        v
NEW separate Phase 7 owner GO
        |
        v
PROD backup + migration + deploy + validation
        |
        v
explicit cutover
        |
        v
source direct command-api deploy disabled when runbook permits
        |
        v
final isolation + identity + owner acceptance PASS
```

Orice FAIL critic opreste promovarea.

G6 PASS nu autorizeaza automat Phase 7; owner GO pentru cutover este obligatoriu si separat.
