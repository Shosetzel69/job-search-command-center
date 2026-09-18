# GOVERNANCE.md - Job Search Command Center

Versiune document: `v1.6`
Ultima actualizare: `2026-09-18`

## 1. Principiu

Proiectul are un singur owner. Cerintele, schimbarile de scop si deciziile arhitecturale sunt aprobate de owner inainte de implementare.

Flux formal:

`Ideas / Requirements -> Analiza -> cerinta/decizie aprobata explicit -> Development -> DEV -> TEST -> PROD`

Nu exista trecere directa din `Ideas / Requirements` in `Development`.

Procesul operational complet de livrare este definit in `docs/software-delivery-lifecycle.md`.

## 2. Etapele fluxului

### 2.1 Ideas / Requirements

Scop:

- colectare de idei;
- brainstorming;
- explorare de variante;
- identificare de probleme si oportunitati;
- maturizarea ideilor.

Reguli:

- nu se implementeaza niciodata functionalitati discutate in acest context;
- nu se scrie si nu se modifica cod;
- nu se iau decizii tehnice sau arhitecturale finale;
- o discutie nu devine automat cerinta aprobata;
- AI recomanda mutarea in `Analiza` cand ideea este suficient de matura;
- denumirea chatului nu se modifica.

O idee este suficient de matura pentru `Analiza` cand sunt clare, cel putin preliminar:

1. problema sau nevoia;
2. utilizatorul sau procesul afectat;
3. rezultatul dorit;
4. conturul functional;
5. limitele principale;
6. nu mai exista necunoscute majore care pot schimba natura ideii;
7. ideea merita analizata formal.

La transfer, AI pregateste un sumar scurt cu:

- Idee;
- Problema / nevoia;
- Rezultatul dorit;
- Contur functional;
- Limite / constrangeri cunoscute;
- Aspecte ramase pentru analiza.

### 2.2 Analiza

Scop:

- clarificarea formala a functionalitatii;
- analiza impactului;
- definirea alternativelor si compromisurilor;
- definirea scope-ului;
- transformarea ideii in cerinte clare.

Reguli:

- nu se implementeaza cod;
- rezultatul analizei nu intra in Development fara aprobarea explicita a owner-ului;
- unde este necesar se actualizeaza `docs/requirements.md` numai dupa stabilirea continutului relevant.

### 2.3 Aprobare

Owner-ul decide explicit daca o cerinta sau schimbare intra in `Development`.

Pentru orice cerinta noua:

1. analiza impactului;
2. propunere de optimizare, daca este cazul;
3. confirmare explicita;
4. transfer in Development.

### 2.4 Development

Numai cerintele aprobate explicit pot intra in Development.

In Development se pot face:

- design tehnic;
- ADR, daca este necesar;
- modificari de cod;
- teste;
- pull request;
- actualizarea documentatiei afectate.

Development se executa pe branch dedicat. `main`, TEST si PROD nu sunt medii de implementare sau debugging.

Dupa implementare se aplica obligatoriu lifecycle-ul definit in `docs/software-delivery-lifecycle.md`.

Pentru un release simplu/single-wave:

```text
DEV verification
-> candidate freeze
-> TEST independent validation
-> release approval
-> PROD readiness + rollback
-> owner GO
-> PROD
```

Pentru un release multi-wave, TEST poate fi folosit pentru checkpoint-uri intermediare. Acestea se opresc dupa verdictul TEST; numai Final Release Candidate (FRC), care contine scope-ul complet al release-ului, poate continua spre PROD.

Un defect gasit in TEST sau PROD revine in DEV. Nu se aplica patch-uri ad-hoc direct in TEST/PROD.

## 3. Surse de adevar si precedenta

Documentele de referinta obligatorii sunt:

- `ARCHITECTURE.md` - arhitectura canonica si adevar tehnic;
- `GOVERNANCE.md` - reguli de proces, decizie si control;
- `docs/software-delivery-lifecycle.md` - procesul canonic DEV -> TEST -> PROD, gate-uri, candidate identity si rollback;
- `.ai-instructions.md` - reguli obligatorii de lucru pentru AI;
- `docs/requirements.md` - cerinte;
- `docs/functionalitati.md` - comportament implementat;
- `docs/data-contract.md` - contracte de date;
- `docs/command-api.md` - Command API si autentificare;
- `docs/source-strategy.md` - surse si connectori;
- `CONTRIBUTING.md` - mod de lucru;
- `CHANGELOG.md` - istoric schimbari relevante.

`README.md` este doar overview.

Precedenta:

- fapte tehnice si boundary-uri -> `ARCHITECTURE.md`;
- proces, aprobare si control -> `GOVERNANCE.md` + `docs/software-delivery-lifecycle.md`;
- comportamentul AI -> `.ai-instructions.md`.

Daca documentatia contrazice codul sau doua documente se contrazic, discrepanta se semnaleaza si se clarifica inainte de modificari functionale.

### 3.1 Baseline tehnic obligatoriu

Pentru orice analiza tehnica, implementare, review sau fix, starea curenta din GitHub este baseline-ul operational care trebuie verificat inainte de actiune.

Reguli:

- conversatiile, memoria AI, rezumatele si copiile locale sunt context, nu sursa de adevar tehnic;
- AI verifica `main` curent si fisierele relevante din repository inainte de a propune sau modifica implementarea;
- inainte de modificare se citesc minimum `ARCHITECTURE.md`, `GOVERNANCE.md`, `.ai-instructions.md`, Issue-ul aprobat si codul afectat;
- daca memoria/conversatia contrazice repository-ul, repository-ul verificat are prioritate ca stare curenta;
- daca repository-ul contrazice documentatia canonica aprobata, schimbarea se opreste si discrepanta se clarifica; AI nu decide singur care varianta devine noul adevar;
- o copie locala a repository-ului nu este niciodata canonica si nu poate fi folosita ca justificare pentru a suprascrie starea GitHub.

## 4. Arhitectura

Schimbarile arhitecturale majore necesita aprobare explicita si ADR inainte de implementare.

Exemple:

- introducerea sau schimbarea bazei de date;
- schimbarea mecanismului principal de autentificare;
- schimbarea boundary-ului Cloudflare Worker / Command API;
- schimbarea mecanismului de orchestrare;
- schimbarea contractului comun al connectorilor;
- arhitectura multi-user.

Un connector nou care respecta contractul existent nu necesita ADR.

Daca o schimbare tehnica ar necesita cresterea versiunii majore a `ARCHITECTURE.md`, aceasta trebuie semnalata explicit owner-ului inainte de implementare, cu motiv si impact.

### 4.1 Implementation Preservation Rule

Aprobarea unei cerinte functionale autorizeaza numai modificarile necesare pentru rezultatul aprobat. Daca cerinta nu solicita explicit schimbarea mecanismului de implementare, mecanismul existent se pastreaza.

Fara aprobare explicita separata nu se schimba, doar pentru ca o alternativa pare mai buna:

- boundary-uri intre componente;
- responsabilitati intre frontend, Worker, Actions, search engine si connectors;
- contracte/API-uri si fluxuri de date;
- persistenta si sursa canonica a datelor;
- autentificare/autorizare;
- orchestrare si mecanism de deploy;
- provider, runtime, framework sau stack;
- dependinte si biblioteci;
- algoritmi sau semantics deja aprobate, daca ticketul nu cere schimbarea lor.

O alternativa tehnica material diferita se trateaza ca change request separat: analiza impactului, optiuni, recomandare si aprobare explicita inainte de implementare.

### 4.2 No Opportunistic Refactoring

Un bugfix, feature sau task de mentenanta nu autorizeaza refactorizarea oportunista a codului adiacent, redesign-ul, reorganizarea componentelor sau "curatarea" arhitecturala.

Refactorizarea in afara scope-ului aprobat se propune separat. Daca este necesara pentru a putea implementa cerinta, necesitatea si impactul se documenteaza si se aproba inainte de modificare.

## 5. Cod, Issues si branching

- `main` trebuie sa ramana coerent si deployable;
- `main` nu este mediu de development, debugging sau QA;
- nu se face push direct pe `main`;
- orice schimbare aprobata se face pe branch dedicat si se integreaza prin pull request;
- cerintele, defectele si change request-urile relevante se urmaresc prin GitHub Issues;
- codul functional nu se modifica in cadrul unei actualizari strict documentare;
- fiecare Issue ramane deschis pana la validarea criteriilor de acceptare;
- PR-ul trebuie sa permita verificarea clara a modificarilor fata de baseline-ul GitHub de la care a pornit taskul;
- modificarile care depasesc scope-ul Issue-ului nu se includ silent in acelasi PR;
- dupa candidate freeze, branch-ul nu se modifica; orice modificare genereaza un nou candidate SHA si reia DEV -> TEST;
- un TEST PASS este valabil numai pentru SHA-ul exact testat.

### 5.1 Branch Target Safety Rule

Orice operatie de write executata de AI prin GitHub API trebuie sa aiba un branch tinta explicit si verificat inainte de modificare.

Reguli obligatorii:

- `main` nu este niciodata tinta directa pentru `create_file`, `update_file`, `delete_file`, `update_ref` sau operatii echivalente;
- inainte de orice write, AI verifica existenta branch-ului tinta si baseline-ul/SHA-ul de la care acesta porneste;
- parametrul de branch nu se omite la operatiile de continut; nu se permite fallback implicit la default branch;
- daca branch-ul tinta lipseste, este invalid sau nu poate fi verificat, operatia se opreste; AI nu incearca o alta tinta si nu cade pe `main`;
- fisierele de test, temporare, marker-ele si trigger-ele de deploy se creeaza numai pe branch dedicat;
- `main` se modifica exclusiv prin merge-ul unui pull request aprobat;
- dupa orice write, AI verifica faptul ca modificarea a ajuns pe branch-ul asteptat si ca `main` nu contine schimbari neintentionate;
- daca o operatie neintentionata ajunge totusi pe `main`, aceasta se raporteaza imediat owner-ului si se corecteaza prin branch + PR; istoricul nu se rescrie fara aprobare explicita.

### 5.2 Issue Metadata Preservation Rule

La actualizarea unui Issue existent, titlul si label-urile se pastreaza implicit.

- titlul sau label-urile se modifica numai la cererea sau aprobarea explicita a owner-ului;
- o solicitare de modificare a body-ului, de inchidere sau de redeschidere nu autorizeaza implicit schimbarea titlului sau a label-urilor;
- inchiderea unui Issue se face numai dupa validarea criteriilor de acceptare;
- eticheta `ai-generated` se pastreaza pentru Issues/PR-uri generate de AI.

## 6. Testare

Pentru logica critica se mentin teste pentru:

- geografie;
- deduplicare;
- filtrare;
- scoring;
- connectori.

CI trebuie sa valideze cel putin Python, JSON, React/Vite si Cloudflare Worker dry-run.

TEST este mediul canonic de validare independenta a candidate-ului frozen. QA trebuie sa inregistreze SHA-ul exact testat si verdictul aferent.

## 7. Securitate

- secretele nu se introduc in cod, documentatie sau frontend;
- Google ID token ramane numai in memoria paginii sau in mecanismul server-side aprobat de sesiune;
- `GITHUB_TOKEN` ramane Cloudflare Secret;
- cheile providerilor raman GitHub Actions Secrets;
- datele private sunt accesate prin Cloudflare Worker;
- credentialele GitHub nu ajung in browser.

## 8. Documentatie

Documentele interne in limba romana se redacteaza fara diacritice.

Documentatia trebuie sa fie simpla si concisa. Daca nu exista informatie pentru un camp sau o sectiune obligatorie, se foloseste `#####`.

Documentatia descrie implementarea reala. Functionalitatile planificate sunt marcate explicit ca neimplementate.

La schimbari materiale se actualizeaza documentele afectate si, daca este relevant, `CHANGELOG.md`.

Pentru orice implementare sau schimbare functionala, documentatia de analiza asociata se actualizeaza in aceeasi interventie, fara solicitare separata din partea owner-ului. Actualizarea trebuie sa reflecte decizia finala, diferentele fata de analiza initiala si statusul rezultat. Daca nu exista o analiza asociata, nu se creeaza artificial un document numai pentru a satisface aceasta regula; se actualizeaza documentele canonice relevante.

Nu se creeaza commit numai pentru documentatie daca nu exista o diferenta materiala de documentat.

## 9. Deploy, promovare si release

Procesul canonic este definit in `docs/software-delivery-lifecycle.md`.

Flux operational:

```text
approved change
-> development branch
-> DEV verification
-> candidate freeze
-> TEST exact candidate
-> TEST PASS
-> integration/release approval
-> PROD readiness + rollback
-> owner GO
-> PROD exact candidate
-> smoke/acceptance
```

### 9.1 Multi-wave Release Checkpoint Rule

Un release mare poate folosi checkpoint-uri intermediare DEV -> TEST pentru a valida un subset stabilizat inainte de finalizarea intregului release.

Reguli:
- checkpoint-ul foloseste un SHA immutable si TEST primeste exact SHA-ul verificat in DEV;
- checkpoint PASS autorizeaza numai continuarea catre urmatorul wave;
- checkpoint-ul se opreste inainte de PROD si nu primeste owner GO;
- evidence-ul checkpoint-ului ramane atasat scope-ului testat, dar nu inlocuieste validarea Final Release Candidate;
- modificarile din wave-urile ulterioare pot produce SHA-uri noi fara a invalida istoric verdictul checkpoint-ului;
- dupa finalizarea scope-ului release-ului se selecteaza un singur **Final Release Candidate (FRC)**;
- FRC executa integral ciclul DEV -> TEST -> PROD si este singurul candidat eligibil pentru Release Record.

Pentru Release 1, Wave 2 este tratat ca intermediate TEST validation checkpoint; dupa Wave 3/4 se va selecta FRC-ul Release 1.

### 9.2 Candidate Identity Rule

Fiecare validation/promotion cycle foloseste un SHA immutable. Pentru ciclul final, SHA-ul este Final Release Candidate al release-ului.

Reguli:

- DEV si TEST trebuie sa ruleze exact acelasi SHA pentru ciclul curent; pentru checkpoint ciclul se opreste dupa TEST, iar pentru FRC continua spre PROD;
- orice modificare dupa freeze produce un SHA nou si invalideaza TEST PASS anterior;
- dupa TEST PASS, integrarea in `main` nu poate rescrie candidate-ul prin squash/rebase;
- daca integrarea necesita conflict resolution care modifica continutul candidate-ului, candidate-ul se invalideaza si revine in DEV/TEST;
- PROD deployeaza exact candidate-ul validat, dupa ce acesta este integrat/reachable din `main`;
- `main` este linia aprobata de integrare/history, nu substitut implicit pentru payload identity.

### 9.3 Deploy Immutability Rule

Deploy-ul nu este o etapa de development si nu poate introduce modificari noi.

Pentru PROD:

```text
TEST PASS pe CANDIDATE_SHA
-> candidate integrat fara mutatie in main
-> PROD preflight + rollback ready
-> owner GO
-> deploy exact CANDIDATE_SHA
```

Reguli:

- nu se fac patch-uri locale, editari manuale sau modificari intermediare intre TEST PASS si deploy;
- un artefact diferit de candidate-ul validat nu se promoveaza ca acelasi release;
- daca apare o problema dupa TEST PASS, se creeaza fix separat in DEV, se genereaza SHA nou si se reia ciclul;
- deploy-ul manual dintr-o copie locala modificata este interzis pentru PROD;
- copia locala poate fi folosita pentru development/testare, dar nu ca sursa de release;
- dupa deploy se pastreaza trasabilitatea la candidate SHA, post-merge main SHA si, unde platforma ofera, Version ID / Build ID / deployment URL.

### 9.4 Merge is not Deploy Rule

Merge-ul in `main` si deploy-ul sunt evenimente separate.

- merge-ul nu autorizeaza implicit PROD;
- merge-ul nu trebuie sa declanseze silent un deploy functional;
- PROD necesita propriul readiness gate si owner GO;
- daca un workflow face deploy automat doar prin push/merge pe `main`, acesta este incompatibil cu lifecycle-ul canonic daca nu exista un gate de release echivalent.

### 9.5 Rollback Readiness Rule

Niciun PROD deploy nu porneste fara rollback definit inainte de executie.

Minimum:

- known-good PROD source identity;
- known-good runtime/config identity;
- procedura de redeploy/restore;
- pentru modificari DB destructive sau greu reversibile: backup verificat, checksum si restore demonstrat non-PROD;
- criterii clare pentru activarea rollback-ului.

Rollback-ul nu foloseste date DEV/TEST ca date PROD.

### 9.6 Release Record Rule

Fiecare promovare PROD trebuie sa aiba un release record non-secret care leaga minimum:

- Issue / PR;
- `CANDIDATE_SHA`;
- baseline main SHA la freeze;
- post-merge main SHA;
- DEV evidence;
- TEST evidence + verdict;
- schema/config version;
- known-good PROD anchors;
- rollback procedure;
- owner GO;
- PROD deploy evidence;
- smoke/acceptance verdict.

## 10. Versionare

Versiunea aplicatiei foloseste formatul `X.XX` conform regulii curente a proiectului.

`ARCHITECTURE.md` foloseste propria schema de versionare si politica de pastrare definite in document.

Documentele de guvernanta cu versiune proprie isi actualizeaza versiunea la fiecare modificare materiala.

Contractele JSON principale folosesc `schema_version`. Schimbarile incompatibile necesita versiune noua de contract.
