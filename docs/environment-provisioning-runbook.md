# Environment Provisioning Runbook - DEV / TEST / PROD

Status: Planned / implementation gate
Data: 2026-09-11
ADR: `docs/adr/ADR-003-environment-isolation.md`
Implementation: #161

## 1. Scop

Procedura defineste pregatirea, crearea, validarea si promovarea celor trei medii complet izolate.

Acest document este contract operational pentru Development. Nu declara mediile ca fiind deja create.

Principii:

- acelasi source code;
- trei runtime stacks separate;
- trei data stores/repositories separate;
- trei Cloudflare accounts separate;
- credentiale de write separate;
- fara fallback implicit la PROD;
- fara copiere manuala repetitiva a configuratiei;
- provisioning idempotent unde API-urile permit;
- PROD existent nu este modificat in faza de pregatire DEV/TEST.

## 2. Resurse tinta

### 2.1 Source repository

```text
Shosetzel69/job-search-command-center
```

Contine cod, documentatie, teste, templates si automation logic.

### 2.2 Runtime repositories

```text
Shosetzel69/job-search-runtime-dev
Shosetzel69/job-search-runtime-test
Shosetzel69/job-search-runtime-prod
```

Toate private.

Structura minima generata in fiecare:

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

Lista finala `data/*` trebuie derivata din contractul canonic existent, nu hard-coded independent in trei locuri.

### 2.3 Cloudflare accounts

```text
Job Search DEV
Job Search TEST
Job Search PROD
```

- account-ul Cloudflare existent devine PROD;
- se creeaza doua Free accounts noi: DEV si TEST;
- fiecare account contine numai runtime resources ale environment-ului sau.

### 2.4 Worker

Numele recomandat in fiecare account:

```text
job-search-command-api
```

Account-ul este boundary-ul principal; acelasi nume simplifica template-ul.

URL-urile vor fi diferite deoarece accounts/workers.dev subdomains sunt diferite.

## 3. Ce se face manual si ce se automatizeaza

### Owner action - manual, inevitabil

Inainte de bootstrap:

1. confirma ca stabilizarea curenta este inchisa;
2. creeaza Cloudflare Free account `Job Search DEV`;
3. creeaza Cloudflare Free account `Job Search TEST`;
4. pastreaza account-ul actual ca `Job Search PROD`;
5. noteaza cele trei Cloudflare account IDs;
6. creeaza/autorizeaza credentialul bootstrap necesar provisioning-ului;
7. confirma ca PROD poate ramane neschimbat pana la faza de cutover.

Crearea self-service a Free accounts nu se presupune automatizabila prin API normal.

### Automatizat

Environment tool trebuie sa poata:

- crea/verifica runtime repositories;
- initializa structura si datele seed;
- genera wrapper workflows dintr-un template unic;
- genera deploy keys read-only pentru acces runtime -> source;
- configura source repository pentru Actions access din private repos ale aceluiasi owner;
- seta repository secrets fara a le scrie in fisiere versionate;
- valida Cloudflare account IDs;
- crea/deploya Worker in account-ul corect;
- seta Worker secrets;
- verifica `/health`;
- executa negative isolation tests;
- produce un raport final fara valori secrete.

## 4. Manifest canonic

Se implementeaza un singur manifest non-secret, de exemplu:

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

Valorile secrete nu apar in manifest.

## 5. Secret input

Secretele de bootstrap pot fi furnizate prin environment variables sau fisier local ignorat de Git.

Numele exacte se stabilesc in Development, dar contractul trebuie sa distinga explicit:

```text
BOOTSTRAP_GITHUB_TOKEN
BOOTSTRAP_CLOUDFLARE_TOKEN

DEV_GITHUB_RUNTIME_TOKEN / generated credential
TEST_GITHUB_RUNTIME_TOKEN / generated credential
PROD_GITHUB_RUNTIME_TOKEN / generated credential

DEV_CLOUDFLARE_TOKEN
TEST_CLOUDFLARE_TOKEN
PROD_CLOUDFLARE_TOKEN

DEV_ALLOWED_GOOGLE_SUB
TEST_ALLOWED_GOOGLE_SUB
PROD_ALLOWED_GOOGLE_SUB

provider secrets per environment
```

Daca tool-ul genereaza credentials, valoarea se scrie direct in secret store-ul destinatie si nu se afiseaza in log.

Un bootstrap credential cu drepturi largi trebuie revocat/rotit dupa provisioning daca nu mai este necesar.

## 6. Environment tool - contract

Se implementeaza un singur entry point. Exemplu:

```text
scripts/environment.mjs
```

Nu se creeaza `setup-dev.sh`, `setup-test.sh`, `setup-prod.sh` cu logica duplicata.

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
- runtime repo corect pentru environment;
- Worker name/origin coerent;
- credentialele obligatorii exista;
- credentialul GitHub nu are write in alt runtime repo;
- credentialul Cloudflare apartine account-ului asteptat;
- source ref exista;
- nu exista placeholder nerezolvat;
- PROD nu este default.

Exit code != 0 la orice abatere.

### 6.2 bootstrap

```text
npm run env:bootstrap -- --env dev
```

Operatie idempotenta:

1. ruleaza `validate` preflight;
2. verifica/exista runtime repo;
3. creeaza runtime repo daca lipseste;
4. initializeaza fisierele runtime din seed/template aprobat;
5. genereaza/configureaza read-only source access;
6. instaleaza wrapper workflow generat din template;
7. configureaza environment-specific repository secrets;
8. verifica Cloudflare account;
9. creeaza Worker daca lipseste;
10. configureaza Worker vars/secrets;
11. deploy initial;
12. verifica health;
13. produce raport.

Daca resursa exista, tool-ul o valideaza si o aduce la starea declarata numai in limitele scope-ului aprobat; nu o sterge/recreeaza implicit.

### 6.3 bootstrap-all

```text
npm run env:bootstrap-all
```

Executa intern aceeasi functie `bootstrap(environment)` pentru `dev`, `test`, `prod`.

Nu contine trei blocuri de logica separate.

Inainte de PROD trebuie sa existe owner GO. Fara GO, `bootstrap-all` se opreste dupa TEST si raporteaza PROD pending.

### 6.4 deploy

```text
npm run env:deploy -- --env dev --source-ref <commit-sha>
```

Reguli:

- source ref explicit;
- SHA rezolvat si logat;
- runtime data vine exclusiv din runtime repo-ul environment-ului;
- build-ul foloseste acelasi source SHA in toate mediile;
- deploy token corespunde Cloudflare account-ului environment-ului;
- post-deploy `/health` trebuie sa confirme environment + SHA;
- nu exista `--env prod` implicit;
- PROD necesita owner GO conform governance.

### 6.5 status

```text
npm run env:status
```

Output fara secrete:

```text
ENV   SOURCE_SHA   RUNTIME_REPO                  CF_ACCOUNT   WORKER                   HEALTH
DEV   abc123       job-search-runtime-dev        ...123       job-search-command-api   OK
TEST  abc123       job-search-runtime-test       ...456       job-search-command-api   OK
PROD  9fd321       job-search-runtime-prod       ...789       job-search-command-api   OK
```

Trebuie sa marcheze diferentele dintre source SHA-uri, configuratie si health.

### 6.6 isolation-test

```text
npm run env:isolation-test
```

Executa numai probe sigure/non-destructive sau probe create explicit pentru test.

Minimum:

- DEV credential -> write TEST: trebuie refuzat;
- DEV credential -> write PROD: trebuie refuzat;
- TEST credential -> write PROD: trebuie refuzat;
- DEV Cloudflare credential -> PROD account: trebuie refuzat;
- TEST Cloudflare credential -> PROD account: trebuie refuzat;
- wrong runtime repo in manifest: preflight FAIL;
- wrong account ID: preflight FAIL;
- missing env: FAIL;
- health mismatch dupa deploy: FAIL.

Testul nu modifica date business reale.

## 7. Runtime workflow

Fiecare runtime repository contine wrapper minim generat.

Conceptual:

```text
workflow_dispatch / approved trigger
        |
        +-> checkout runtime repo
        +-> checkout source repo @ SOURCE_SHA read-only
        +-> validate runtime contract
        +-> run search/build logic din source
        +-> publish data in caller runtime repo
        +-> rebuild/deploy Worker in caller Cloudflare account
        +-> health check
```

Provider secrets sunt citite numai din runtime repository-ul caller.

Wrapper-ul nu contine logica business duplicata.

## 8. Source access

Varianta preferata: trei deploy keys read-only distincte atasate source repository-ului.

```text
runtime-dev  -> key DEV  -> source READ
runtime-test -> key TEST -> source READ
runtime-prod -> key PROD -> source READ
```

Private keys sunt secrets in runtime repositories. Public keys sunt deploy keys read-only pe source repo.

Nu se foloseste PAT classic.

Orice alternativa trebuie sa pastreze acelasi nivel de least privilege.

## 9. Command API configuration

Configuratia finala trebuie sa faca imposibila confuzia dintre source si runtime.

Minimum semantic:

```text
APP_ENV=dev|test|prod
GITHUB_RUNTIME_OWNER=Shosetzel69
GITHUB_RUNTIME_REPO=job-search-runtime-<env>
GITHUB_RUNTIME_REF=main
GITHUB_WORKFLOW=runtime.yml
SOURCE_VERSION=<sha>
SEARCH_MODE=<policy>
FRONTEND_ORIGIN=<environment URL>
```

Tokenul Worker are acces exclusiv la runtime repo-ul environment-ului.

## 10. Static data build

Modelul actual copiaza fisierele protejate in Worker Static Assets. Pentru a pastra mecanismul:

1. checkout source repo;
2. checkout runtime repo;
3. build-ul foloseste runtime `data/` ca input;
4. frontend build ruleaza o singura data pentru environment;
5. protected data sunt copiate in asset snapshot;
6. Worker este deployat;
7. dupa orice search care modifica runtime data, acelasi runtime workflow redeployeaza Worker-ul environment-ului.

Development trebuie sa implementeze input path parametrizat. Nu se copiaza permanent runtime data in source repository.

## 11. Procedura DEV

Dupa stabilizare:

1. owner GO pentru #161;
2. completeaza account ID DEV in manifest/local config;
3. ruleaza validate DEV;
4. bootstrap DEV;
5. configureaza OAuth client/origin DEV daca nu este automatizabil;
6. ruleaza health;
7. ruleaza isolation tests DEV -> TEST/PROD;
8. executa smoke functional DEV;
9. marcheaza DEV ready numai dupa PASS.

PROD nu se modifica.

## 12. Procedura TEST

Numai dupa DEV PASS:

1. validate TEST;
2. bootstrap TEST;
3. configureaza OAuth client/origin TEST;
4. deploy exact acelasi source SHA validat in DEV;
5. ruleaza health;
6. ruleaza isolation tests TEST -> PROD;
7. executa smoke/E2E TEST;
8. marcheaza release candidate ready.

## 13. Procedura PROD

Numai dupa DEV + TEST PASS si owner GO explicit:

1. inventar/backup PROD actual;
2. validate configuratia PROD tinta;
3. bootstrap `job-search-runtime-prod` fara a distruge sursa actuala;
4. seed/migrare controlata a datelor PROD;
5. configureaza credentialele PROD;
6. deploy acelasi source SHA validat in TEST;
7. health + functional smoke;
8. verifica datele si search execution;
9. cutover;
10. pastreaza rollback target pana la validarea finala;
11. numai dupa acceptare se elimina mecanismele vechi devenite redundante.

## 14. Rollback

Rollback-ul de cod inseamna redeploy al ultimului source SHA PROD validat.

Rollback-ul nu copiaza date din TEST sau DEV.

Runtime data rollback, daca este necesar, foloseste istoric/backup PROD exclusiv.

## 15. Cost control

Target: cost 0.

- Cloudflare: Free accounts pentru cele trei medii;
- GitHub: private runtime repos; se urmareste consumul Actions inclus in plan;
- DEV full live search dezactivat implicit;
- TEST foloseste smoke/controlled search;
- provider calls costisitoare nu se tripleaza automat.

Orice componenta care introduce cost nou se opreste pentru aprobare inainte de activare.

## 16. Evidence la finalul bootstrap

Tool-ul trebuie sa genereze un raport machine-readable si unul scurt human-readable cu:

- environment;
- source SHA;
- runtime repo;
- Cloudflare account ID mascat partial;
- Worker name;
- Worker URL;
- search mode;
- health result;
- isolation test result;
- timestamp;
- fara secrete.

## 17. Gate-uri

```text
CURRENT STABILIZATION
        |
        v
ADR-003 merged
        |
        v
#161 owner GO
        |
        v
DEV bootstrap + isolation PASS
        |
        v
TEST bootstrap + isolation + E2E PASS
        |
        v
PROD owner GO
        |
        v
PROD migration/cutover
```

Orice FAIL opreste promovarea.
