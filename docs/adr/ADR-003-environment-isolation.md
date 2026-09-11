# ADR-003 - Medii DEV / TEST / PROD complet izolate

Status: Accepted
Data: 2026-09-11
Refs: #161

## Context

Aplicatia ruleaza in prezent ca un singur stack operational: Cloudflare Worker `job-search-command-api`, frontend React/Vite livrat ca Worker Static Assets, date runtime in repository-ul principal si search engine orchestrat prin GitHub Actions.

Owner-ul a aprobat introducerea a trei medii complet separate: DEV, TEST si PROD.

Separarea nu trebuie sa fie doar de naming. Un credential DEV compromis sau o configuratie DEV gresita nu trebuie sa permita modificarea resurselor TEST sau PROD. Aceeasi regula se aplica TEST fata de PROD.

Proiectul pastreaza principiul `free architecture`: cost operational preferabil 0; costul poate fi introdus numai cu beneficiu clar si aprobare separata.

## Problema

Configuratia actuala are coupling incompatibil cu izolarea ceruta:

- `GITHUB_REF` controleaza atat accesul la date, cat si workflow dispatch;
- datele runtime sunt in acelasi repository cu source code-ul;
- build-ul Worker copiaza `data/*` in Static Assets;
- full search ruleaza in repository-ul principal si publica inapoi in acelasi repository;
- un singur Cloudflare account nu ofera izolarea credentialelor de deploy la nivel de Worker, deoarece `Workers Scripts Write` este permisiune account-scoped;
- GitHub Environments nu trebuie sa fie o dependinta obligatorie, deoarece pentru repository privat necesita un plan GitHub care poate introduce cost.

## Obiectiv

Trei stack-uri runtime independente, cu aceeasi baza de cod si aceleasi template-uri de automatizare:

```text
SOURCE CODE / templates
          |
    +-----+-----+
    |     |     |
   DEV   TEST  PROD
```

Runtime data, secretele, credentialele de write, joburile de search si deploy target-urile nu sunt promovate intre medii.

Promovarea muta numai identitatea codului/build-ului aprobat.

## Optiuni analizate

### A. Un Cloudflare account + Wrangler environments + date in acelasi repository

Avantaje:
- configurare simpla;
- putine resurse;
- suport nativ Wrangler `--env`.

Dezavantaje:
- `Workers Scripts Write` este account-scoped, deci credentialul DEV poate avea blast radius asupra Worker-ului PROD;
- un token GitHub pe acelasi repository nu poate fi restrictionat la un director `data/dev`;
- izolarea depinde de configuratie si naming, nu de permissions.

Respinsa pentru cerinta de separare totala.

### B. Workers separati in acelasi Cloudflare account + runtime repositories separate

Avantaje:
- datele GitHub pot fi izolate prin permissions;
- cost 0 probabil.

Dezavantaje:
- deploy credential Cloudflare ramane account-scoped;
- nu satisface criteriul strict DEV credential != PROD capability.

Respinsa ca arhitectura tinta.

### C. Cloudflare accounts separate + runtime repositories separate

Avantaje:
- boundary real de permissions pentru Cloudflare;
- boundary real de permissions pentru date si Actions;
- provider secrets pot ramane exclusiv in repository-ul runtime al mediului;
- compromiterea unui environment nu ofera implicit credentiale spre altul;
- Cloudflare permite conturi Free separate; owner-ul poate folosi contul existent pentru PROD si doua conturi Free noi pentru DEV si TEST.

Dezavantaje:
- doua conturi Cloudflare noi de creat;
- trei runtime repositories;
- bootstrap mai complex;
- trebuie automatizate template-urile pentru a evita administrarea manuala repetitiva.

Aleasa.

## Decizie

Se adopta optiunea C.

### Source repository

`Shosetzel69/job-search-command-center` ramane repository-ul canonic pentru:

- source code;
- teste;
- documentatie;
- reusable workflow / template logic;
- scripturile de provisioning si deployment.

Nu devine datastore comun pentru cele trei runtime-uri.

### Runtime repositories

Se creeaza trei repository-uri private dedicate:

```text
job-search-runtime-dev
job-search-runtime-test
job-search-runtime-prod
```

Fiecare contine exclusiv starea runtime si wrapper-ul minim necesar executiei acelui environment.

Fiecare repository are propriile:

- `data/*.json`;
- Actions secrets;
- provider credentials;
- workflow execution history;
- write token/context nativ al repository-ului.

`GITHUB_TOKEN` al workflow-ului runtime scrie numai in repository-ul caller.

Nu exista copiere automata DEV -> TEST -> PROD pentru date.

### Cloudflare accounts

Se folosesc trei Cloudflare accounts distincte:

```text
Job Search DEV
Job Search TEST
Job Search PROD
```

Contul Cloudflare actual devine PROD. Owner-ul creeaza doua conturi Free suplimentare pentru DEV si TEST.

Motiv: permisiunea de deploy Worker este account-scoped. Conturile separate transforma boundary-ul DEV/TEST/PROD intr-un boundary de permissions.

Fiecare account contine propriul `command-api` Worker si propriile Worker secrets.

Numele Worker-ului poate fi acelasi in fiecare account deoarece account-ul este boundary-ul principal. URL-ul trebuie sa ramana distinct si verificabil.

### Runtime deployment credential

Fiecare runtime repository detine numai credentialul Cloudflare pentru account-ul corespunzator.

```text
runtime-dev  -> Cloudflare DEV only
runtime-test -> Cloudflare TEST only
runtime-prod -> Cloudflare PROD only
```

Un credential DEV nu trebuie configurat cu acces la account-ul TEST sau PROD.

### Source access din runtime workflows

Runtime workflows trebuie sa poata executa codul canonic fara a copia implementation logic in trei repository-uri.

Model tinta:

1. runtime workflow porneste in repository-ul environment-ului;
2. checkout runtime repository;
3. checkout source repository la un SHA/tag explicit;
4. ruleaza logica din source repository;
5. publica rezultatele numai in runtime repository-ul caller;
6. construieste/deployeaza Worker-ul numai in Cloudflare account-ul environment-ului.

Accesul runtime -> source trebuie sa fie read-only si environment-specific. Varianta preferata este cate un deploy key read-only distinct pentru fiecare runtime repository. Nu se foloseste PAT classic.

### Reusable workflow

Logica GitHub Actions se centralizeaza in source repository ca reusable workflow / template canonic.

Cele trei runtime repositories contin numai wrapper minim, generat automat din acelasi template.

Source repository trebuie configurat sa permita folosirea reusable workflows de catre repository-uri private detinute de acelasi owner.

### GitHub Environments

Nu sunt dependinta obligatorie a arhitecturii.

Motiv: pentru repository privat, configurarea GitHub Environments poate depinde de planul GitHub. Izolarea se obtine prin repository-uri separate, repository-level secrets si credentials separate.

Daca owner-ul are ulterior un plan care include private Environments, acestea pot fi adaugate ca defense-in-depth fara schimbarea boundary-urilor de baza.

### Command API

Configuratia trebuie sa separe explicit conceptele astazi comprimate in `GITHUB_REF`.

Contract minim conceptual:

```text
APP_ENV
GITHUB_RUNTIME_REPO
GITHUB_RUNTIME_REF
GITHUB_WORKFLOW
SOURCE_VERSION / BUILD_SHA
SEARCH_MODE
```

Numele finale pot respecta conventiile codului, dar responsabilitatile nu pot fi recombinate.

Tokenul GitHub al fiecarui Worker este scoped exclusiv la runtime repository-ul acelui environment.

### Static Assets si runtime data

Se pastreaza modelul Worker Static Assets daca implementarea poate mentine izolarea fara duplicare de cod.

Build-ul environment-ului primeste date numai din runtime repository-ul acelui environment si le copiaza in `command-api/public/data` prin mecanismul existent/adaptat.

Dupa publicarea datelor de search, workflow-ul environment-ului trebuie sa declanseze rebuild/deploy pentru acelasi environment astfel incat asset snapshot-ul sa fie sincronizat.

Schimbarea catre un datastore nou sau catre fetch runtime direct din GitHub nu este aprobata de acest ADR si necesita change separat daca devine necesara.

### Search execution

Politica implicita:

```text
DEV  -> full live search disabled; mock/smoke controlat
TEST -> smoke/controlled search
PROD -> live search
```

Provider secrets sunt separate per runtime repository. Daca un provider nu permite trei credentials distincte, exceptia se documenteaza explicit inainte de activare; nu se presupune sharing silent.

### OAuth / Google

Fiecare environment foloseste propriul OAuth client/origin configuration. Client ID-urile pot apartine aceluiasi Google Cloud project, deoarece nu reprezinta write credential spre datele altui environment, dar origin-urile si client configuration trebuie separate.

`ALLOWED_GOOGLE_SUB` si orice secret Worker se configureaza separat in fiecare Cloudflare account.

### ai-github-bridge

`ai-github-bridge` ramane engineering/control-plane infrastructure si nu este runtime dependency a aplicatiei. Nu se multiplica DEV/TEST/PROD prin acest ADR.

Daca in viitor bridge-ul devine componenta runtime a aplicatiei, separarea lui se trateaza ca change arhitectural separat.

## Automatizare obligatorie

Nu se implementeaza trei scripturi copiate.

Se construieste un singur environment tool parametrizat, cu operatii echivalente:

```text
env validate <dev|test|prod>
env bootstrap <dev|test|prod>
env bootstrap-all
env deploy <dev|test|prod> --source-ref <sha>
env status
env isolation-test
```

Config non-secret este tinut intr-un manifest canonic. Secretele nu se comit.

Nicio comanda nu are voie sa foloseasca PROD ca default implicit.

## Provisioning manual inevitabil

Pentru conturile Cloudflare self-service, crearea noilor Free accounts se face din dashboard. API-ul general de creare account este disponibil tenant admins, deci bootstrap-ul normal nu trebuie sa presupuna ca poate crea aceste accounts programatic.

Owner action unica inainte de bootstrap automat:

1. pastreaza account-ul actual ca PROD;
2. creeaza `Job Search DEV`;
3. creeaza `Job Search TEST`;
4. furnizeaza scriptului cele trei Cloudflare account IDs si bootstrap credentials necesare.

Restul provisioning-ului trebuie automatizat cat mai mult posibil.

## Promotion model

```text
source SHA X
   |
   +-> DEV  build X
   |
   +-> TEST build X
   |
   +-> PROD build X
```

Acelasi source SHA este promovat. Nu se merge pe ramuri permanente care contin implementari diferite per environment.

Environment data nu este promovata.

## Safety rules

Deployment-ul trebuie sa fail closed daca:

- environment-ul nu este explicit;
- Cloudflare account ID nu corespunde environment-ului;
- runtime repository nu corespunde environment-ului;
- exista placeholder/config lipsa;
- credentialul runtime nu poate demonstra accesul asteptat;
- DEV/TEST incearca target PROD;
- health metadata dupa deploy nu corespunde manifestului;
- source SHA deployat nu este cel solicitat.

Pentru PROD este necesar owner GO conform governance-ului existent.

## Acceptance boundary

Izolarea este acceptata numai daca testele negative demonstreaza:

- DEV nu poate scrie TEST;
- DEV nu poate scrie PROD;
- TEST nu poate scrie PROD;
- DEV deployment credential nu poate modifica Cloudflare TEST/PROD;
- TEST deployment credential nu poate modifica Cloudflare PROD;
- runtime workflow nu poate publica date in alt runtime repository cu credentialele sale normale;
- datele nu sunt mutate de promotion;
- fiecare `/health` identifica environment-ul, build SHA si runtime target-ul corect.

## Consecinte

Pozitive:
- blast radius redus la un singur environment;
- izolarea este impusa de provider permissions;
- nu este necesar GitHub Pro doar pentru environment secrets;
- codul si automation logic raman centralizate;
- provisioning-ul poate fi repetabil si auditat.

Trade-off-uri:
- doua Cloudflare accounts suplimentare;
- trei runtime repositories;
- workflow orchestration mai complex;
- deployment-ul trebuie sa sincronizeze Static Assets dupa schimbarea datelor;
- bootstrap-ul initial necesita cateva owner actions care nu pot fi automatizate in mod normal.

## Impact asupra documentelor si codului

Implementarea #161 va afecta cel putin:

- `ARCHITECTURE.md`;
- `docs/command-api.md`;
- `CONTRIBUTING.md`;
- `CHANGELOG.md`;
- `command-api/wrangler.jsonc` sau generatorul lui;
- Command API environment configuration;
- build/static data flow;
- GitHub Actions search/deploy orchestration;
- scripturile de provisioning.

Acest ADR documenteaza arhitectura tinta. Nu afirma ca cele trei medii exista deja.

## Referinte externe verificate

- Cloudflare Wrangler environments: https://developers.cloudflare.com/workers/wrangler/environments/
- Cloudflare API token permissions: https://developers.cloudflare.com/fundamentals/api/reference/permissions/
- Cloudflare Free accounts dashboard creation: https://developers.cloudflare.com/changelog/post/2026-08-04-free-dashboard-button/
- GitHub Actions access across private repositories: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository
- GitHub deployment environments plan constraints: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
