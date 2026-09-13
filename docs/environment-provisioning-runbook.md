# Environment Provisioning Runbook - DEV / TEST / PROD

Status: Planned / implementation gate
Data initiala: 2026-09-11
Revizie finala: 2026-09-13
ADR: `docs/adr/ADR-003-environment-isolation.md`
Implementation: #161

## 1. Scop

Procedura defineste pregatirea, crearea, validarea, promovarea si cutover-ul celor trei medii runtime izolate.

Documentul este contract operational pentru Development. Nu declara mediile ca fiind deja create.

Principii:
- acelasi source code;
- trei runtime stacks separate;
- trei runtime repositories separate;
- trei Cloudflare accounts separate;
- credentiale de write separate;
- `SOURCE_SHA` immutable pentru build si Run;
- `RUNTIME_DATA_SHA` pentru snapshot-ul de date servit;
- fara fallback implicit la PROD sau `main`;
- fara copiere manuala repetitiva a configuratiei;
- provisioning idempotent unde API-urile permit;
- PROD actual nu se modifica in faza DEV/TEST.

## 2. Resurse tinta

### 2.1 Source repository

```text
Shosetzel69/job-search-command-center
```

Contine cod, teste, documentatie, templates si automation logic.

Dupa cutover-ul PROD, source repository-ul nu mai deployeaza direct `job-search-command-api` prin Cloudflare Git integration.

### 2.2 Runtime repositories

```text
Shosetzel69/job-search-runtime-dev
Shosetzel69/job-search-runtime-test
Shosetzel69/job-search-runtime-prod
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

### 2.3 Cloudflare accounts

```text
Job Search DEV
Job Search TEST
Job Search PROD
```

- account-ul actual devine PROD;
- se creeaza doua Free accounts noi pentru DEV si TEST;
- fiecare account contine numai runtime resources ale environment-ului sau.

### 2.4 Worker

Nume recomandat in fiecare account:

```text
job-search-command-api
```

Account-ul este boundary-ul principal. URL-ul/origin-ul trebuie sa fie distinct si verificabil per environment.

## 3. Manual vs automatizat

### 3.1 Owner actions manuale

Inainte de bootstrap:
1. stabilizarea curenta este inchisa;
2. ADR-003 este merged;
3. owner GO pentru #161;
4. creeaza Cloudflare account `Job Search DEV`;
5. creeaza Cloudflare account `Job Search TEST`;
6. pastreaza account-ul actual ca `Job Search PROD`;
7. noteaza cele trei Cloudflare account IDs;
8. creeaza/autorizeaza bootstrap credentials necesare;
9. confirma ca PROD ramane neschimbat pana la cutover.

### 3.2 Automatizat

Environment tool trebuie sa poata:
- crea/verifica runtime repositories;
- initializa datele seed;
- genera wrapper workflow dintr-un template unic;
- configura source read-only access;
- seta repository secrets fara a le versiona;
- valida Cloudflare account IDs;
- crea/deploya Worker in account-ul corect;
- seta Worker vars/secrets;
- verifica `/health`;
- executa negative isolation tests;
- produce raport machine-readable si human-readable fara secrete.

Bootstrap credentials largi nu se stocheaza in runtime repositories si se revoca/rotesc dupa provisioning daca nu mai sunt necesare.

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
      "runtimeRepository": "Shosetzel69/job-search-runtime-prod",
      "cloudflareAccountId": "<required>",
      "workerName": "job-search-command-api",
      "searchMode": "live"
    }
  }
}
```

Secretele nu apar in manifest.

## 5. Secret input si least privilege

Contractul trebuie sa distinga explicit:

```text
BOOTSTRAP_GITHUB_TOKEN
BOOTSTRAP_CLOUDFLARE_TOKEN

DEV_CLOUDFLARE_TOKEN
TEST_CLOUDFLARE_TOKEN
PROD_CLOUDFLARE_TOKEN

DEV_ALLOWED_GOOGLE_SUB
TEST_ALLOWED_GOOGLE_SUB
PROD_ALLOWED_GOOGLE_SUB

provider secrets per environment
```

Runtime workflow foloseste `GITHUB_TOKEN` nativ pentru write numai in repository-ul caller.

Runtime -> source foloseste read-only access distinct per environment. Preferat: deploy key read-only. PAT classic nu se foloseste.

Implementarea documenteaza rotatia/revocarea deploy keys si a bootstrap credentials.

## 6. Environment tool - contract

Un singur entry point, de exemplu:

```text
scripts/environment.mjs
```

Nu se creeaza scripturi DEV/TEST/PROD cu logica duplicata.

### 6.1 validate

```text
npm run env:validate -- --env dev
npm run env:validate -- --env test
npm run env:validate -- --env prod
```

Verifica minimum:
- environment explicit si valid;
- manifest valid;
- account ID prezent;
- runtime repo corespunde environment-ului;
- Worker/origin coerent;
- credentialele obligatorii exista;
- GitHub write credential nu poate scrie alt runtime repo;
- Cloudflare token apartine account-ului asteptat;
- source SHA exista;
- nu exista placeholder nerezolvat;
- PROD nu este default;
- search policy este compatibila cu environment-ul.

Exit code != 0 la orice abatere.

### 6.2 bootstrap

```text
npm run env:bootstrap -- --env dev
npm run env:bootstrap -- --env test
```

Operatie idempotenta:
1. `validate` preflight;
2. verifica/creeaza runtime repo;
3. initializeaza fisierele runtime din seed aprobat;
4. configureaza read-only source access;
5. instaleaza wrapper workflow generat;
6. configureaza environment-specific secrets;
7. verifica Cloudflare account;
8. creeaza Worker daca lipseste;
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

### 6.4 PROD bootstrap

PROD necesita actiune separata si owner GO explicit:

```text
npm run env:bootstrap -- --env prod --source-sha <full-sha>
```

Tool-ul trebuie sa refuze PROD daca owner gate-ul definit de governance nu este satisfacut.

### 6.5 deploy

```text
npm run env:deploy -- --env dev --source-sha <full-commit-sha>
```

Reguli:
- `SOURCE_SHA` explicit si immutable;
- branch/tag/mutable ref nu este acceptat ca identity finala de deployment;
- runtime data vin numai din runtime repo-ul environment-ului;
- build-ul foloseste exact `SOURCE_SHA`;
- deploy token corespunde Cloudflare account-ului environment-ului;
- `/health` confirma `environment`, `source_sha`, `runtime_repo`, `runtime_data_sha`, `search_mode`;
- PROD necesita owner GO;
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
PROD  9fd321...    555aaa...          job-search-runtime-prod  ...789       OK
```

Trebuie sa marcheze drift-ul dintre source SHA, runtime data SHA, manifest si health.

### 6.7 isolation-test

```text
npm run env:isolation-test
```

Probe sigure/non-destructive:
- DEV GitHub credential -> write TEST: refuz;
- DEV GitHub credential -> write PROD: refuz;
- TEST GitHub credential -> write PROD: refuz;
- DEV Cloudflare credential -> TEST/PROD: refuz;
- TEST Cloudflare credential -> PROD: refuz;
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
        +-> execute source scripts @ SOURCE_SHA
        +-> publish data in caller runtime repo only
        +-> capture new RUNTIME_DATA_SHA
        +-> rebuild/deploy caller Worker only
        +-> health identity check
```

Provider secrets sunt citite numai din runtime repository-ul caller.

Wrapper-ul nu contine business logic duplicata.

Daca se foloseste reusable workflow din source repository, el trebuie pinuit la ref immutable compatibil cu release-ul. Nu se admite `uses: ...@main` pentru executia unui release care declara alt `SOURCE_SHA`.

## 8. Source access

Preferat:

```text
runtime-dev  -> read-only key DEV  -> source
runtime-test -> read-only key TEST -> source
runtime-prod -> read-only key PROD -> source
```

Private keys sunt secrets in runtime repositories; public keys sunt read-only deploy keys pe source repo.

Orice alternativa necesita acelasi nivel de least privilege.

## 9. Command API configuration

Minimum semantic:

```text
APP_ENV=dev|test|prod
GITHUB_RUNTIME_OWNER=Shosetzel69
GITHUB_RUNTIME_REPO=job-search-runtime-<env>
GITHUB_RUNTIME_REF=main
GITHUB_WORKFLOW=runtime.yml
SOURCE_SHA=<full-sha>
RUNTIME_DATA_SHA=<runtime-commit-sha>
SEARCH_MODE=<policy>
FRONTEND_ORIGIN=<environment-url>
```

Tokenul Worker are write exclusiv in runtime repo-ul environment-ului.

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
1. checkout source @ `SOURCE_SHA`;
2. checkout runtime repo la `RUNTIME_DATA_SHA`;
3. build frontend/Worker;
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

1. owner GO #161;
2. completeaza DEV account ID;
3. validate DEV;
4. bootstrap DEV;
5. configureaza OAuth DEV;
6. health identity check;
7. isolation DEV -> TEST/PROD;
8. smoke functional;
9. DEV ready numai dupa PASS.

PROD nu se modifica.

## 13. Procedura TEST

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

Numai dupa DEV + TEST PASS si owner GO separat:
1. inventar complet PROD actual;
2. backup/recovery verification;
3. pregatire `job-search-runtime-prod` fara distrugerea sursei actuale;
4. seed/migrare controlata numai a datelor PROD;
5. configureaza credentialele PROD;
6. deploy exact `SOURCE_SHA` validat in TEST;
7. health/auth/protected-assets smoke;
8. verifica search execution cu acelasi `SOURCE_SHA`;
9. cutover;
10. dezactiveaza calea directa source repo -> Cloudflare Git deployment pentru `job-search-command-api`;
11. verifica: push/PR in source repo produce zero command-api deployment;
12. pastreaza rollback target pana la acceptarea finala;
13. elimina mecanismele vechi redundante numai dupa acceptare.

`ai-github-bridge` nu este dezactivat de acest pas.

## 15. Rollback

Rollback cod = redeploy ultimul `SOURCE_SHA` PROD validat.

Rollback data = backup/history din runtime PROD exclusiv.

Nu se copiaza date DEV/TEST in PROD.

Daca noul runtime PROD esueaza inainte de finalizarea cutover-ului, se revine la target-ul PROD anterior si calea veche ramane disponibila pana la decizia de acceptare.

## 16. Cost control

Target: cost 0.

- Cloudflare: conturi Free separate;
- GitHub: runtime repos private, consum Actions monitorizat;
- DEV live full search disabled implicit;
- TEST controlled search;
- provider calls costisitoare nu se tripleaza automat.

Orice cost nou necesita aprobare inainte de activare.

## 17. Evidence

Raportul final al fiecarui bootstrap/deploy contine:
- environment;
- `SOURCE_SHA`;
- `RUNTIME_DATA_SHA`;
- runtime repo;
- Cloudflare account ID mascat;
- Worker name/URL;
- search mode;
- health result;
- isolation result;
- timestamp;
- fara secrete.

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
DEV bootstrap + isolation PASS
        |
        v
TEST same SOURCE_SHA + isolation + E2E PASS
        |
        v
PROD owner GO
        |
        v
PROD migration/cutover
        |
        v
source direct command-api deploy disabled
        |
        v
final isolation + identity PASS
```

Orice FAIL critic opreste promovarea.
