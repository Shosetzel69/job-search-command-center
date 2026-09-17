# ADR-003 - Medii DEV / TEST / PROD complet izolate

Status: Accepted - implementation gate; delivery lifecycle alignment applied
Data initiala: 2026-09-11
Revizie finala: 2026-09-18
Refs: #161 #175 #177 #183 #197 #198

## Context

Aplicatia ruleaza initial ca un singur stack operational: Cloudflare Worker `job-search-command-api`, frontend React/Vite livrat ca Worker Static Assets, date runtime in repository-ul principal si search engine orchestrat prin GitHub Actions.

Owner-ul a aprobat introducerea a trei medii runtime separate: DEV, TEST si PROD.

Separarea nu trebuie sa fie doar de naming. Un credential DEV compromis sau o configuratie DEV gresita nu trebuie sa permita modificarea resurselor TEST sau PROD. Aceeasi regula se aplica TEST fata de PROD.

Proiectul pastreaza principiul `free architecture`: cost operational preferabil 0; costul poate fi introdus numai cu beneficiu clar si aprobare separata.

Stabilizarea baseline-ului curent a fost inchisa la 2026-09-13. Implementarea mediilor incepe numai dupa merge-ul acestui ADR si owner GO pentru #161.

Revizia din 2026-09-17 aliniaza ADR-ul cu deciziile si controalele implementate in Phase 6: PROD foloseste un account Cloudflare nou si dedicat, runtime repository-ul canonic este `Shosetzel69/job-search-prod`, iar legacy PROD ramane neschimbat ca rollback target pana la un Phase 7 aprobat separat. GitHub Environments devin obligatorii pentru credentialele de deployment/control-plane conform #177.

Revizia din 2026-09-18 aliniaza promovarea cu #197 si `docs/software-delivery-lifecycle.md`: DEV si TEST valideaza un candidate SHA immutable inainte de integrarea finala in `main`; dupa TEST PASS candidate-ul este integrat fara rescriere si PROD deployeaza exact acelasi SHA. `main` nu mai este o conditie prealabila pentru candidate deployment in DEV/TEST.

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

Configuratia initiala are coupling incompatibil cu izolarea ceruta:
- `GITHUB_REF` controleaza simultan date si workflow dispatch;
- runtime data sunt in acelasi repository cu source code-ul;
- build-ul Worker copiaza `data/*` in Static Assets;
- full search ruleaza in source repository si publica inapoi in acelasi repository;
- Cloudflare `Workers Scripts Write` poate avea blast radius de account daca nu este limitat prin roluri granulare disponibile;
- source repository-ul are o cale istorica de deployment pentru `job-search-command-api`;
- un singur SHA runtime nu identifica initial explicit atat codul de UI/API, cat si codul search executat;
- workflow-ul istoric DEV/TEST cere candidate-ului sa fie deja reachable din `main`, ceea ce muta integrarea inaintea validarii independente si slabeste trasabilitatea candidate-ului testat.

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

Promotion muta numai un `SOURCE_SHA` / `CANDIDATE_SHA` immutable aprobat. Runtime data nu sunt promovate intre medii.

Fluxul operational canonic este:

```text
Development branch
 -> DEV exact candidate SHA
 -> candidate freeze
 -> TEST exact same SHA
 -> TEST PASS
 -> integrate candidate without rewriting it
 -> PROD exact same SHA
```

Legacy PROD ramane un stack separat de tranzitie si rollback pana la retragerea aprobata separat.

## Optiuni analizate

### A. Un Cloudflare account + Wrangler environments + acelasi datastore
Respinsa: deploy credential-ul poate avea blast radius la nivel de account, iar izolarea ar depinde de naming/config.

### B. Workers separati in acelasi Cloudflare account + runtime repositories separate
Respinsa ca arhitectura tinta: datele GitHub pot fi separate, dar boundary-ul Cloudflare ramane mai slab decat accounts distincte.

### C. Cloudflare accounts separate + runtime repositories separate
Aleasa.

Avantaje:
- boundary real de permissions Cloudflare;
- boundary real de permissions GitHub pentru runtime data;
- secrets si provider credentials per environment;
- compromiterea unui environment nu ofera implicit write in altul;
- compatibila cu tinta de cost 0 folosind conturi Free separate.

Trade-off-uri:
- trei conturi Cloudflare tinta separate, plus legacy PROD pastrat temporar pentru rollback;
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

Flux permis:

```text
explicit candidate SHA -> controlled environment workflow -> environment Cloudflare account
```

Flux interzis:

```text
source push/PR/merge -> direct implicit command-api deploy
```

`ai-github-bridge` nu este afectat de aceasta regula cat timp ramane control-plane separat.

Acceptance obligatoriu: push/PR/merge in source repository produce zero deployment implicit `job-search-command-api` in DEV/TEST/PROD.

### 2. Runtime repositories

Se folosesc trei repository-uri private:

```text
job-search-runtime-dev
job-search-runtime-test
job-search-prod
```

Fiecare detine exclusiv:
- `data/*.json` runtime;
- wrapper workflow minim;
- Actions secrets;
- provider credentials;
- execution history;
- credentialele proprii de deploy/runtime.

Nu exista copiere automata DEV -> TEST -> PROD pentru date.

### 3. Cloudflare accounts

Se folosesc trei Cloudflare accounts tinta distincte:

```text
Job Search DEV
Job Search TEST
Job Search PROD
```

Toate trei sunt dedicate environment-ului Job Search corespunzator. `Job Search PROD` este un account nou si separat de legacy PROD.

Legacy PROD existent, cu origin `https://job-search-command-api.myeboda.workers.dev`, ramane complet neschimbat si este rollback target pana la o decizie separata de retragere.

Fiecare account tinta contine propriul `job-search-command-api`, propriile secrets si credential de deploy.

Un runtime deploy credential trebuie sa aiba acces numai la account-ul/Worker-ul environment-ului sau. Daca provider-ul ofera rol granular pe Worker, se foloseste cel mai restrans scope disponibil.

### 4. Access runtime -> source

Runtime workflows executa codul canonic fara sa copieze business logic in cele trei runtime repositories.

Model:
1. workflow-ul porneste pentru un environment explicit;
2. primeste obligatoriu `SOURCE_SHA` complet si immutable;
3. checkout runtime repository al environment-ului;
4. checkout source repository exact la `SOURCE_SHA`, read-only;
5. ruleaza scripturile/build-ul din checkout-ul aprobat conform control-plane trust model;
6. publica numai in runtime repository-ul caller;
7. deployeaza numai in Cloudflare account-ul caller.

Accesul runtime -> source este read-only si environment-specific. PAT classic este interzis; implementarea curenta foloseste credentiale fine-grained separate cu repository boundary verificat operational.

Credentialele long-lived au expirare/rotatie documentata si nu sunt reutilizate intre environment-uri.

### 5. Reusable workflow / template si trusted control-plane

Runtime repositories contin wrapper minim generat dintr-un template unic.

Business logic nu este duplicata in wrapper.

Deployment/provisioning control-plane care primeste environment credentials ruleaza numai dintr-un baseline trusted/reviewed. Candidate `SOURCE_SHA` este checkout separat si inert; nu poate inlocui orchestration scripts, package manifests, Wrangler config sau build/deploy tooling care ruleaza privilegiat.

Candidate identity rules:
- pentru DEV si TEST, candidate-ul poate fi un commit immutable existent in source repository chiar daca nu este inca reachable din `main`;
- candidate-ul trebuie verificat prin exact SHA checkout si nu prin branch mutable;
- TEST trebuie sa primeasca exact candidate-ul frozen in DEV;
- dupa TEST PASS candidate-ul este integrat in `main` fara squash/rebase/rescriere;
- daca integrarea necesita conflict resolution care modifica candidate content sau SHA, TEST PASS este invalidat si se reia DEV -> TEST;
- pentru PROD candidate-ul trebuie sa fie exact TEST-passed SHA si sa fie reachable din `main` dupa integrare.

### 6. GitHub Environments

GitHub Environments `dev`, `test`, `prod` sunt obligatorii pentru live deployment/control-plane credentials.

Reguli:
- fiecare live job se leaga de exact un singur GitHub Environment selectat;
- un job nu primeste simultan credentialele mai multor environment-uri;
- environment secrets/variables contin credentialele si configuratia specifica acelui environment;
- credentialele bootstrap, runtime si source-read sunt distincte;
- `prod` este restrictionat la calea de deployment aprobata folosind cel mai puternic control disponibil pe planul GitHub curent;
- `owner_gate` text ramane numai defense-in-depth, nu boundary principal de autorizare;
- PROD necesita owner GO explicit dupa TEST PASS si rollback readiness.

Daca planul GitHub nu permite branch protection/rulesets suficient de puternice pentru un repository privat, riscul rezidual de single-operator authorization trebuie documentat si acceptat explicit sau eliminat prin protectie suplimentara.

### 7. Command API si identity contract

Conceptele initial comprimate in `GITHUB_REF` se separa explicit:

```text
APP_ENV
GITHUB_RUNTIME_REPO
GITHUB_RUNTIME_REF
GITHUB_WORKFLOW
SOURCE_SHA
RUNTIME_DATA_SHA
SEARCH_MODE
```

`SOURCE_SHA` este SHA-ul exact al source code-ului deployat si executat. In lifecycle-ul de release acest SHA este `CANDIDATE_SHA`.

`RUNTIME_DATA_SHA` este commit-ul runtime repository-ului din care a fost construit snapshot-ul de date servit de Worker.

Niciunul nu poate avea fallback implicit la `main` ca payload identity.

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

Legacy account-ul pe care ruleaza poate coexista temporar cu legacy PROD; noul `Job Search PROD` este separat si nu include `ai-github-bridge` ca runtime dependency.

Daca `ai-github-bridge` devine runtime dependency, necesita change arhitectural separat.

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

Reguli lifecycle:
- DEV poate deploya un SHA immutable nemerge-uit pentru verificare;
- dupa DEV PASS se face candidate freeze;
- TEST deployeaza exact candidate SHA frozen;
- PROD ramane separat si necesita TEST PASS, integrarea candidate-ului in `main` fara rewrite, rollback readiness si owner GO;
- nicio comanda nu foloseste PROD sau `main` ca payload default.

## Provisioning manual inevitabil

Owner actions pentru target-ul izolat:
1. pastreaza legacy PROD actual neschimbat ca rollback target;
2. creeaza/mentine `Job Search DEV`;
3. creeaza/mentine `Job Search TEST`;
4. creeaza/mentine noul account dedicat `Job Search PROD`;
5. configureaza GitHub Environments `dev`, `test`, `prod` cu valori environment-scoped;
6. furnizeaza account IDs si credentials separate pe rol;
7. autorizeaza explicit PROD numai dupa gate-urile lifecycle.

Bootstrap credentials largi nu se stocheaza in Worker/runtime si se revoca/rotesc dupa provisioning daca nu mai sunt necesare.

## Promotion model

```text
approved Issue
   -> development branch
   -> DEV: SHA X
   -> DEV PASS
   -> freeze CANDIDATE_SHA = X
   -> TEST: exact SHA X
   -> TEST PASS
   -> integrate X in main without rewriting X
   -> PROD readiness + rollback + owner GO
   -> PROD: exact SHA X
```

Daca TEST esueaza:

```text
TEST FAIL
   -> DEV remediation
   -> SHA Y
   -> DEV PASS
   -> freeze Y
   -> TEST exact Y
```

Acelasi candidate SHA este promovat; nu se promoveaza branch-uri mutable si nu se promoveaza runtime data.

Merge-ul in `main` nu este deploy si nu autorizeaza PROD implicit.

Procedura detaliata, gate-urile si release record sunt definite in `docs/software-delivery-lifecycle.md`.

## Safety rules

Deployment-ul fail closed daca:
- environment lipseste;
- `SOURCE_SHA` lipseste sau nu este commit SHA valid;
- exact candidate checkout nu corespunde SHA-ului solicitat;
- TEST candidate difera de candidate-ul frozen/promovat din DEV;
- account ID nu corespunde environment-ului;
- runtime repository nu corespunde environment-ului;
- credentialul are scope neasteptat;
- exista placeholder/config lipsa;
- DEV/TEST incearca target PROD;
- health environment/source/runtime SHA nu corespund build-ului solicitat;
- search policy nu corespunde environment-ului;
- candidate-ul a fost modificat dupa freeze;
- integrarea post-TEST rescrie candidate-ul;
- PROD candidate nu este exact TEST-passed SHA sau nu este reachable din approved `main`;
- rollback readiness lipseste pentru PROD;
- owner GO lipseste pentru PROD.

## Acceptance boundary

Izolarea si promovarea sunt acceptate numai daca se demonstreaza:
- DEV nu poate scrie TEST;
- DEV nu poate scrie PROD;
- TEST nu poate scrie PROD;
- DEV Cloudflare credential nu poate modifica TEST/PROD;
- TEST Cloudflare credential nu poate modifica PROD;
- PROD Cloudflare credential nu poate opera asupra DEV/TEST sau legacy account;
- runtime workflow nu poate publica in alt runtime repository;
- promotion nu muta date;
- DEV si TEST pot valida exact un candidate SHA fara a necesita integrare prealabila in `main`;
- TEST primeste exact candidate-ul frozen in DEV;
- TEST FAIL revine in DEV si genereaza candidate nou;
- dupa TEST PASS, candidate SHA ramane reachable din `main` fara rewrite;
- PROD deployeaza exact TEST-passed candidate;
- merge in source repository nu produce direct `job-search-command-api` deployment;
- `/health` identifica `environment`, `source_sha`, `runtime_repo`, `runtime_data_sha`, `search_mode`;
- Run executa exact `source_sha` declarat de Worker;
- compromiterea credentialelor DEV nu ofera o cale de write in TEST/PROD cu acele credentiale;
- control-plane executabil ramane trusted si separat de candidate payload;
- PROD authorization boundary, rollback readiness si orice risc rezidual sunt documentate.

## Consecinte

Pozitive:
- blast radius redus la un environment;
- izolarea este impusa de provider permissions;
- codul ramane unic;
- candidate identity devine predictibila si auditabila end-to-end;
- acelasi source SHA este verificat DEV -> TEST -> PROD;
- `main` nu mai trebuie folosit ca staging area inainte de QA;
- deploy/search sunt auditabile prin SHA immutable;
- drift-ul Static Assets poate fi detectat prin `runtime_data_sha`;
- legacy PROD ofera rollback separat in timpul tranzitiei.

Trade-off-uri:
- trei Cloudflare accounts tinta, plus legacy PROD temporar;
- trei runtime repositories;
- orchestration mai complex;
- bootstrap initial necesita owner actions;
- candidate freeze si release evidence adauga disciplina operationala;
- GitHub owner identity si plan/quota raman shared control-plane;
- pe planuri GitHub fara protectii avansate poate ramane un risc rezidual de single-operator authorization care necesita tratament explicit.

## Impact implementare

Cel putin:
- `ARCHITECTURE.md`;
- `GOVERNANCE.md`;
- `docs/software-delivery-lifecycle.md`;
- `docs/command-api.md` unde candidate identity afecteaza contractul;
- `CONTRIBUTING.md`;
- `CHANGELOG.md`;
- Command API environment/run identity;
- `/health` contract;
- Static Assets build flow;
- GitHub Actions environment/promotion orchestration;
- provisioning/deployment scripts;
- `docs/environment-provisioning-runbook.md`;
- `docs/prod-cutover-rollback-runbook.md`.

Implementarea automatizarii lifecycle este urmarita separat prin #198. Acest ADR defineste tinta si boundary-urile; nu autorizeaza coding in task-ul de arhitectura #197.

## Referinte externe verificate

- Cloudflare Wrangler environments: https://developers.cloudflare.com/workers/wrangler/environments/
- Cloudflare API token permissions: https://developers.cloudflare.com/fundamentals/api/reference/permissions/
- Cloudflare Free accounts: https://developers.cloudflare.com/changelog/post/2026-08-04-free-dashboard-button/
- GitHub Actions private repository sharing: https://docs.github.com/en/actions/how-tos/reuse-automations/share-across-private-repositories
- GitHub Environments: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
- GitHub fine-grained PATs: https://docs.github.com/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
