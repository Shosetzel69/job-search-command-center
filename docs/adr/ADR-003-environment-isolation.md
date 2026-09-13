# ADR-003 - Medii DEV / TEST / PROD complet izolate

Status: Accepted - implementation gate
Data initiala: 2026-09-11
Revizie finala: 2026-09-13
Refs: #161

## Context

Aplicatia ruleaza in prezent ca un singur stack operational: Cloudflare Worker `job-search-command-api`, frontend React/Vite livrat ca Worker Static Assets, date runtime in repository-ul principal si search engine orchestrat prin GitHub Actions.

Owner-ul a aprobat introducerea a trei medii runtime separate: DEV, TEST si PROD.

Separarea nu trebuie sa fie doar de naming. Un credential DEV compromis sau o configuratie DEV gresita nu trebuie sa permita modificarea resurselor TEST sau PROD. Aceeasi regula se aplica TEST fata de PROD.

Proiectul pastreaza principiul `free architecture`: cost operational preferabil 0; costul poate fi introdus numai cu beneficiu clar si aprobare separata.

Stabilizarea baseline-ului curent a fost inchisa la 2026-09-13. Implementarea mediilor incepe numai dupa merge-ul acestui ADR si owner GO pentru #161.

## Scope-ul izolarii

`Complet izolate` inseamna izolarea runtime si a credentialelor de write, nu duplicarea intregului control-plane.

Sunt separate obligatoriu:
- Cloudflare account si Worker runtime;
- runtime repository si date;
- credentiale GitHub cu drepturi de write;
- credentiale Cloudflare de deploy;
- secrets si provider credentials;
- search execution state si rezultate;
- OAuth client/origin configuration unde este necesar;
- health/evidence per environment.

Raman shared by design:
- source repository-ul canonic;
- owner identity GitHub/Cloudflare;
- source commit history;
- template-urile si automation logic;
- GitHub Actions billing/quota la nivelul planului owner-ului;
- `ai-github-bridge`, cat timp ramane engineering/control-plane infrastructure si nu runtime dependency.

Aceste elemente shared nu au voie sa ofere credentiale runtime DEV cu acces de write spre TEST/PROD sau TEST spre PROD.

## Problema

Configuratia actuala are coupling incompatibil cu izolarea ceruta:
- `GITHUB_REF` controleaza simultan date si workflow dispatch;
- runtime data sunt in acelasi repository cu source code-ul;
- build-ul Worker copiaza `data/*` in Static Assets;
- full search ruleaza in source repository si publica inapoi in acelasi repository;
- Cloudflare `Workers Scripts Write` este account-scoped;
- source repository-ul are in prezent Git integration care poate produce preview deployments pentru `job-search-command-api`;
- un singur SHA runtime nu identifica astazi explicit atat codul de UI/API, cat si codul search executat.

## Obiectiv

```text
                    SOURCE / CONTROL-PLANE
                code + tests + templates
                           |
             +-------------+-------------+
             |             |             |
            DEV           TEST          PROD
         runtime repo   runtime repo   runtime repo
         CF account     CF account     CF account
```

Promotion muta numai un `SOURCE_SHA` immutable aprobat. Runtime data nu sunt promovate intre medii.

## Optiuni analizate

### A. Un Cloudflare account + Wrangler environments + acelasi datastore
Respinsa: deploy credential-ul are blast radius la nivel de account, iar izolarea ar depinde de naming/config.

### B. Workers separati in acelasi Cloudflare account + runtime repositories separate
Respinsa ca arhitectura tinta: datele GitHub pot fi separate, dar deploy credential-ul Cloudflare ramane account-scoped.

### C. Cloudflare accounts separate + runtime repositories separate
Aleasa.

Avantaje:
- boundary real de permissions Cloudflare;
- boundary real de permissions GitHub pentru runtime data;
- secrets si provider credentials per environment;
- compromiterea unui environment nu ofera implicit write in altul;
- compatibila cu tinta de cost 0 folosind conturi Free separate.

Trade-off-uri:
- doua conturi Cloudflare suplimentare;
- trei runtime repositories;
- bootstrap si orchestration mai complexe;
- Static Assets necesita sincronizare explicita cu runtime data.

## Decizie

### 1. Source repository

`Shosetzel69/job-search-command-center` ramane repository-ul canonic pentru:
- source code;
- teste;
- documentatie;
- template-uri;
- provisioning/deployment logic.

Nu devine datastore comun pentru cele trei runtime-uri.

Dupa cutover-ul PROD, source repository-ul NU mai are voie sa deployeze direct `job-search-command-api` in niciun mediu prin Cloudflare Git integration sau alta cale implicita.

Flux permis dupa cutover:

```text
source commit -> runtime workflow -> environment Cloudflare account
```

Flux interzis:

```text
source push/PR -> direct command-api deploy
```

`ai-github-bridge` nu este afectat de aceasta regula cat timp ramane control-plane separat.

Acceptance obligatoriu dupa cutover: push/PR in source repository produce zero deployment `job-search-command-api` in DEV/TEST/PROD.

### 2. Runtime repositories

Se creeaza trei repository-uri private:

```text
job-search-runtime-dev
job-search-runtime-test
job-search-runtime-prod
```

Fiecare detine exclusiv:
- `data/*.json` runtime;
- wrapper workflow minim;
- Actions secrets;
- provider credentials;
- execution history;
- credentialele proprii de deploy.

`GITHUB_TOKEN` al workflow-ului runtime scrie numai in repository-ul caller.

Nu exista copiere automata DEV -> TEST -> PROD pentru date.

### 3. Cloudflare accounts

Se folosesc trei Cloudflare accounts distincte:

```text
Job Search DEV
Job Search TEST
Job Search PROD
```

Contul actual devine PROD. Se creeaza doua conturi Free suplimentare pentru DEV si TEST.

Fiecare account contine propriul `job-search-command-api`, propriile secrets si credential de deploy.

Un runtime deploy credential trebuie sa aiba acces numai la account-ul environment-ului sau.

### 4. Access runtime -> source

Runtime workflows executa codul canonic fara sa copieze business logic in cele trei runtime repositories.

Model:
1. workflow-ul porneste in runtime repository;
2. primeste obligatoriu `SOURCE_SHA` complet si immutable;
3. checkout runtime repository;
4. checkout source repository exact la `SOURCE_SHA`, read-only;
5. ruleaza scripturile/build-ul din acel checkout;
6. publica numai in runtime repository-ul caller;
7. deployeaza numai in Cloudflare account-ul caller.

Accesul runtime -> source este read-only si environment-specific. Preferat: deploy key read-only distinct per runtime repository. PAT classic este interzis.

Deploy keys sunt credentiale long-lived; implementarea trebuie sa documenteze revocarea si rotatia lor.

### 5. Reusable workflow / template

Runtime repositories contin wrapper minim generat dintr-un template unic.

Business logic nu este duplicata in wrapper.

Daca se foloseste GitHub reusable workflow din source repository, referinta workflow-ului trebuie sa fie pinuita la un ref immutable compatibil cu `SOURCE_SHA`. Nu este permis ca search/build-ul sa ruleze din `main` in timp ce Worker-ul declara alt `SOURCE_SHA`.

Varianta simpla acceptata este wrapper generic + checkout source la `SOURCE_SHA` + executia scripturilor din checkout.

### 6. GitHub Environments

Nu sunt dependinta obligatorie. Izolarea de baza se obtine prin runtime repositories separate, repository secrets separate si credentials separate.

Pot fi adaugate ulterior ca defense-in-depth fara schimbarea boundary-urilor.

### 7. Command API si identity contract

Conceptele astazi comprimate in `GITHUB_REF` se separa explicit:

```text
APP_ENV
GITHUB_RUNTIME_REPO
GITHUB_RUNTIME_REF
GITHUB_WORKFLOW
SOURCE_SHA
RUNTIME_DATA_SHA
SEARCH_MODE
```

`SOURCE_SHA` este SHA-ul exact al source code-ului deployat si executat.

`RUNTIME_DATA_SHA` este commit-ul runtime repository-ului din care a fost construit snapshot-ul de date servit de Worker.

Niciunul nu poate avea fallback implicit la `main` pentru executie PROD.

### 8. Run identity contract

Orice `POST /commands/run` trebuie sa fie legat de codul Worker-ului care accepta comanda:

```text
Worker health SOURCE_SHA=abc123
        -> POST /commands/run
        -> workflow_dispatch(source_sha=abc123)
        -> checkout source @ abc123
```

Obligatoriu:
- `run-status.json` include `source_sha`;
- `run-history.json` include `source_sha`;
- workflow-ul refuza lipsa/mismatch-ul `source_sha`;
- checkout-ul search nu foloseste implicit `main`;
- `/health` confirma acelasi `source_sha`.

### 9. Static Assets si runtime data

Build-ul environment-ului primeste date numai din runtime repository-ul environment-ului.

Snapshot identity:
1. checkout source @ `SOURCE_SHA`;
2. checkout runtime data la commit `RUNTIME_DATA_SHA`;
3. build Static Assets;
4. deploy Worker;
5. `/health` expune ambele SHA-uri.

Dupa publicarea rezultatelor search:
1. runtime workflow commit-uieste datele;
2. obtine noul `RUNTIME_DATA_SHA`;
3. rebuild/deploy pentru acelasi environment;
4. verifica `/health.runtime_data_sha`.

Daca redeploy-ul esueaza, runtime repository poate avea date mai noi decat Worker-ul servit. Aceasta stare trebuie raportata explicit `DEGRADED/STALE_ASSET`, nu mascata ca succes.

Schimbarea la un datastore nou nu este aprobata de acest ADR.

### 10. Search execution policy

```text
DEV  -> live full search disabled implicit; mock/smoke controlat
TEST -> controlled/smoke search
PROD -> live search
```

Provider secrets sunt separate per runtime repository. Orice exceptie de sharing impusa de provider se documenteaza explicit inainte de activare.

### 11. OAuth / Google

Fiecare environment foloseste propriul OAuth client/origin configuration. Client IDs pot apartine aceluiasi Google Cloud project, dar origin-urile/configuratia sunt separate.

`ALLOWED_GOOGLE_SUB` si Worker secrets sunt configurate separat in fiecare Cloudflare account.

### 12. ai-github-bridge

Ramane control-plane infrastructure si nu se multiplica DEV/TEST/PROD prin acest ADR.

Daca devine runtime dependency, necesita change arhitectural separat.

## Automatizare obligatorie

Un singur environment tool parametrizat:

```text
env validate <dev|test|prod>
env bootstrap <dev|test|prod>
env bootstrap-all
env deploy <dev|test|prod> --source-sha <sha>
env status
env isolation-test
```

Regula speciala:

```text
env bootstrap-all -> DEV + TEST only
```

PROD NU este inclus in nicio comanda convenience/all.

PROD necesita comanda explicita `--env prod`, source SHA explicit si owner GO separat.

Nicio comanda nu foloseste PROD ca default.

## Provisioning manual inevitabil

Owner action initial:
1. pastreaza account-ul actual ca PROD;
2. creeaza `Job Search DEV`;
3. creeaza `Job Search TEST`;
4. furnizeaza account IDs si bootstrap credentials necesare.

Bootstrap credentials largi nu se stocheaza in runtime repositories si se revoca/rotesc dupa provisioning daca nu mai sunt necesare.

## Promotion model

```text
SOURCE_SHA X
   +-> DEV
   +-> TEST
   +-> PROD
```

Acelasi SHA este promovat. Nu se promoveaza branch-uri mutable si nu se promoveaza runtime data.

## Safety rules

Deployment-ul fail closed daca:
- environment lipseste;
- `SOURCE_SHA` lipseste sau nu este commit SHA valid;
- account ID nu corespunde environment-ului;
- runtime repository nu corespunde environment-ului;
- credentialul are scope neasteptat;
- exista placeholder/config lipsa;
- DEV/TEST incearca target PROD;
- health environment/source/runtime SHA nu corespund build-ului solicitat;
- search policy nu corespunde environment-ului.

PROD necesita owner GO explicit.

## Acceptance boundary

Izolarea este acceptata numai daca se demonstreaza:
- DEV nu poate scrie TEST;
- DEV nu poate scrie PROD;
- TEST nu poate scrie PROD;
- DEV Cloudflare credential nu poate modifica TEST/PROD;
- TEST Cloudflare credential nu poate modifica PROD;
- runtime workflow nu poate publica in alt runtime repository;
- promotion nu muta date;
- `/health` identifica `environment`, `source_sha`, `runtime_repo`, `runtime_data_sha`, `search_mode`;
- Run executa exact `source_sha` declarat de Worker;
- push/PR in source repository nu produce direct `job-search-command-api` deployment dupa cutover;
- compromiterea credentialelor DEV nu ofera o cale de write in TEST/PROD cu acele credentiale.

## Consecinte

Pozitive:
- blast radius redus la un environment;
- izolarea este impusa de provider permissions;
- codul ramane unic;
- deploy/search sunt auditabile prin SHA immutable;
- drift-ul Static Assets poate fi detectat prin `runtime_data_sha`.

Trade-off-uri:
- doua Cloudflare accounts suplimentare;
- trei runtime repositories;
- orchestration mai complex;
- bootstrap initial necesita owner actions;
- GitHub owner identity si plan/quota raman shared control-plane.

## Impact implementare #161

Cel putin:
- `ARCHITECTURE.md`;
- `docs/command-api.md`;
- `CONTRIBUTING.md`;
- `CHANGELOG.md`;
- Command API environment/run identity;
- `/health` contract;
- Static Assets build flow;
- GitHub Actions runtime orchestration;
- Cloudflare Git integration pentru `job-search-command-api` la cutover;
- provisioning/deployment scripts.

Acest ADR defineste tinta. Nu afirma ca mediile exista deja.

## Referinte externe verificate

- Cloudflare Wrangler environments: https://developers.cloudflare.com/workers/wrangler/environments/
- Cloudflare API token permissions: https://developers.cloudflare.com/fundamentals/api/reference/permissions/
- Cloudflare Free accounts: https://developers.cloudflare.com/changelog/post/2026-08-04-free-dashboard-button/
- GitHub Actions private repository sharing: https://docs.github.com/en/actions/how-tos/reuse-automations/share-across-private-repositories
- GitHub Environments: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
- GitHub deploy keys: https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys
