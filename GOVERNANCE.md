# GOVERNANCE.md - Job Search Command Center

Versiune document: `v1.11`
Ultima actualizare: `2026-09-21`

## 1. Principiu

Proiectul are un singur owner. Cerintele, schimbarile de scop si deciziile arhitecturale sunt aprobate de owner inainte de implementare.

Flux formal:

`Ideas / Requirements -> Analiza -> cerinta/decizie aprobata explicit -> Development -> DEV -> TEST -> PROD`

Nu exista trecere directa din `Ideas / Requirements` in `Development`.

Procesul operational complet de livrare este definit in `docs/software-delivery-lifecycle.md`.

Denumirea canonica pentru acest mod de lucru este **AgentFlow**.

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
3. `APPROVE REQUIREMENT` pentru cerinta curenta;
4. pregatirea DTP/handoff-ului, daca se aplica;
5. `APPROVE TRANSFER` pentru intrarea in Development.

### 2.3.1 AgentFlow - Control Keyword Rule

In AgentFlow, autorizarea owner-ului se exprima prin keywords explicite. Un keyword este o decizie **scoped la un singur obiect/gate**, nu o autorizare generala pentru etapele urmatoare.

Reguli:
- keyword-ul se recunoaste numai ca instructiune explicita; matching-ul este case-insensitive, dar simple mentionari, exemple, citate, negatii sau discutii despre keyword nu constituie autorizare;
- keyword-ul se aplica obiectului/gate-ului numit explicit sau, daca acesta nu este repetat, numai gate-ului curent daca este unic si neambiguu;
- daca tinta este ambigua, starea nu se schimba pana la clarificare;
- aprobarile nu se propaga automat: aprobarea unei decizii, cerinte, transfer, PR sau gate nu autorizeaza gate-ul urmator;
- fiecare tranzitie materiala pastreaza trasabilitatea minima: keyword, tinta si starea rezultata.

Keywords canonice de control:

| Keyword | Efect permis | Nu autorizeaza |
|---|---|---|
| `APPROVE PRODUCT DECISIONS` | inchide deciziile de produs pentru analiza curenta | aprobarea cerintei sau transferul in Development |
| `APPROVE REQUIREMENT` | marcheaza cerinta curenta ca aprobata | transferul in Development |
| `APPROVE TRANSFER` | autorizeaza transferul cerintei/contractului aprobat in Development, in scope-ul aprobat | schimbari de scope, TEST sau PROD |
| `APPROVE` | aproba numai obiectul/gate-ul curent cand tinta este explicita si unica | orice pas ulterior implicit |
| `PROD GO` / `PROD_GO` | autorizeaza exclusiv promovarea in PROD a FRC-ului exact care a trecut TEST si preflight-ul de rollback | schimbarea candidate-ului sau alta mutatie in PROD |
| `STOP` | opreste fluxul la gate-ul curent | continuarea automata |

Statusurile produse de agenti, inclusiv `TEST_PASSED`, `TEST_FAILED` si `BLOCKED`, sunt evidence/verdict, nu keywords de autorizare ale owner-ului si nu acorda singure permisiunea de a trece la urmatorul gate.

Machine gate tokens precum `APPROVED`, `G6_QA` sau alte valori interne de workflow sunt contracte tehnice, nu autorizari AgentFlow. `PROD_GO` poate reprezenta keyword-ul owner-ului numai cand este emis explicit ca decizie AgentFlow pentru FRC-ul curent; simpla prezenta a valorii intr-un workflow, log sau exemplu nu demonstreaza autorizarea owner-ului. Similar, cuvantul `STOP` folosit descriptiv intr-o diagrama sau procedura nu este keyword AgentFlow.

Aprobarile explicite ale owner-ului inregistrate inainte de formalizarea acestei reguli raman valide numai pentru obiectul/gate-ul pe care l-au aprobat istoric. Nu sunt rescrise retroactiv ca keywords si nu se propaga la gate-uri ulterioare.

### 2.3.2 AgentFlow - Routing Persistence Rule

Un work item intra in AgentFlow cand sursa aprobata de transfer, DTP-ul, Issue-ul sau owner-ul il marcheaza explicit ca `AgentFlow` / proces agentic AgentFlow.

Odata rutat in AgentFlow:
- ramane in AgentFlow end-to-end pentru acel scope;
- fiecare etapa foloseste artefactele, gate-urile, evidence-ul si control keywords AgentFlow aplicabile;
- un chat, agent sau executor ulterior nu poate reclasifica implicit item-ul ca legacy doar pentru ca titlul Issue-ului nu contine `AgentFlow`;
- absenta markerului din titlu nu anuleaza routing-ul daca body-ul, DTP-ul sau transferul aprobat identifica AgentFlow;
- revenirea la un proces legacy sau iesirea din AgentFlow necesita o decizie explicita a owner-ului, inregistrata pe work item;
- in caz de conflict intre memoria conversatiei si metadata/artefactele GitHub verificate, starea GitHub verificata are prioritate; daca artefactele GitHub se contrazic intre ele, executia se opreste pana la reconciliere.

Pentru handoff intre chaturi/agenti, Issue-ul trebuie sa afiseze explicit minimum `Process: AgentFlow` si gate-ul curent. Daca aceste campuri lipsesc pentru un item deja rutat AgentFlow, ele se completeaza ca normalizare de proces; lipsa lor nu schimba procesul aplicabil.

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
-> `PROD GO` / `PROD_GO`
-> PROD
```

Pentru un release multi-wave, TEST poate fi folosit pentru checkpoint-uri intermediare. Acestea se opresc dupa verdictul TEST; numai Final Release Candidate (FRC), care contine scope-ul complet al release-ului, poate continua spre PROD.

Un defect gasit in TEST sau PROD revine in DEV. Nu se aplica patch-uri ad-hoc direct in TEST/PROD.

## 3. Surse de adevar si precedenta

Sursele canonice sunt listate mai jos. Lista defineste precedenta, nu un set care trebuie citit integral pentru fiecare task:

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
- `docs/documentation-policy.md` - context budget, structura si reguli anti-duplicare;
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
- contextul documentar se incarca targetat conform `docs/documentation-policy.md`: Issue/task + fisiere afectate + numai sectiunile canonice relevante;
- documentele istorice, arhivele, analizele si runbook-urile superseded nu se citesc implicit;
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

Pentru testarea UI browser-based, contractul canonic de testabilitate este `docs/testing/qa-testability-ui-contract.md`. Fluxurile nominale DEV/TEST trebuie sa fie operabile prin controale DOM-addressable; blocajele produse de dialoguri browser-native sau alte controale non-DOM se trateaza ca `BLOCKED-TESTABILITY`, nu ca owner action accidental.

## 7. Securitate

- secretele nu se introduc in cod, documentatie sau frontend;
- Google ID token ramane numai in memoria paginii sau in mecanismul server-side aprobat de sesiune;
- `GITHUB_TOKEN` ramane Cloudflare Secret;
- cheile providerilor raman GitHub Actions Secrets;
- datele private sunt accesate prin Cloudflare Worker;
- credentialele GitHub nu ajung in browser.

## 8. Documentatie

Politica detaliata este `docs/documentation-policy.md`.

Reguli obligatorii:
- documentele interne in limba romana se redacteaza fara diacritice;
- documentatia descrie implementarea reala; planurile sunt marcate explicit;
- se actualizeaza numai documentele canonice material afectate;
- analiza ramane istoric de decizie, nu oglinda permanenta a implementarii;
- Issues si runbook-uri trebuie sa fie task-oriented, scurte si sa foloseasca linkuri in loc de duplicare;
- arhivele si documentele superseded nu intra in contextul implicit al AI;
- nu se creeaza document sau commit fara diferenta materiala de documentat.

Daca nu exista informatie pentru un camp obligatoriu, se foloseste `#####`.

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
- checkpoint PASS confirma rezultatul tehnic si permite continuarea numai in limitele mandatului deja aprobat; nu este owner authorization;
- checkpoint-ul se opreste inainte de PROD si nu poate primi `PROD GO` / `PROD_GO`;
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
-> `PROD GO` / `PROD_GO`
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
- PROD necesita propriul readiness gate si `PROD GO` / `PROD_GO` explicit pentru FRC-ul exact;
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
- AgentFlow PROD authorization (`PROD GO` / `PROD_GO`) + reference/time;
- PROD deploy evidence;
- smoke/acceptance verdict.

## 10. Versionare

Versiunea aplicatiei foloseste formatul `X.XX` conform regulii curente a proiectului.

`ARCHITECTURE.md` foloseste propria schema de versionare si politica de pastrare definite in document.

Documentele de guvernanta cu versiune proprie isi actualizeaza versiunea la fiecare modificare materiala.

Contractele JSON principale folosesc `schema_version`. Schimbarile incompatibile necesita versiune noua de contract.
