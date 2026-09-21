# AgentFlow - Operating Contract

Status: **CANONICAL**  
Version: **1.0**  
Applies to: **AGENTFLOW**  
Last verified: **2026-09-21**

## 1. Purpose

AgentFlow controleaza transformarea unei cerinte aprobate in implementare verificabila, fara ca Development sa inventeze scope, arhitectura sau autorizari.

Acest document descrie operarea AgentFlow. Pentru reguli de proces si statusuri, `GOVERNANCE.md` are precedenta. Pentru promovarea DEV -> TEST -> PROD, sursa canonica este `docs/software-delivery-lifecycle.md`.

AgentFlow nu creeaza un al doilea release lifecycle.

## 2. Routing

Work item-urile noi aprobate folosesc implicit `Process: AGENTFLOW` daca owner-ul sau transferul aprobat le ruteaza astfel.

In perioada de tranzitie:

- `AGENTFLOW` - work nou sau convertit explicit;
- `LEGACY-ADAPTED` - work material inceput sub procesul anterior;
- `INHERIT-PARENT` - taskul mosteneste procesul parentului daca acesta este neechivoc.

Un work item nu schimba procesul silent. Conversia necesita decizie explicita a owner-ului.

## 3. Canonical Issue header

Pentru work AgentFlow activ, headerul curent este:

```text
Process: AGENTFLOW
Phase: <canonical phase>
Status: <canonical status>
Blocked by: <issue/gate/reason sau —>
```

Taxonomia completa `Phase` / `Status` este definita numai in `GOVERNANCE.md` sectiunea 2.8. Nu se mentine o copie separata aici.

Headerul canonic cel mai recent are precedenta fata de statusurile istorice ramase in body.

## 4. Nominal flow

```text
approved requirement
-> APPROVE_TRANSFER <ref>, daca este necesar pentru handoff
-> Architecture Gate, daca exista trigger
-> Development Analysis
-> READY_FOR_TASK_CONTRACTS
-> Agent Task Contract(s)
-> APPROVE_TASK_CONTRACT <ATC-ref>
-> implementation
-> Evidence Bundle
-> Independent Review
-> DEV verification
-> canonical DEV -> TEST -> PROD lifecycle
```

Development Analysis si Agent Task Contract sunt etape diferite. Analiza poate propune ATC-uri, dar nu autorizeaza executia lor.

## 5. Control tokens

Control tokens sunt autorizari explicite, scoped la obiectul indicat. O simpla mentionare, citare, negatie sau exemplu nu este autorizare.

| Token | Autorizeaza | Nu autorizeaza |
|---|---|---|
| `APPROVE_TRANSFER <ref>` | transferul cerintei aprobate in Development Analysis | implementare, ATC, TEST sau PROD |
| `APPROVE_TASK_CONTRACT <ATC-ref>` | implementarea exacta a ATC-ului indicat | alt ATC, schimbare de scope/arhitectura, TEST sau PROD |
| `PROD_GO` | promovarea exacta in PROD conform lifecycle-ului canonic | schimbarea candidate-ului sau alta mutatie PROD |

Reguli:

- matching-ul este explicit si scoped;
- daca referinta este ambigua, starea nu se schimba;
- aprobarile nu se propaga la gate-ul urmator;
- `continua`, `go`, `mergem`, `looks good` si formule similare nu substituie control token-ul cerut;
- aprobarile istorice raman valide pentru obiectul aprobat atunci, dar nu sunt reinterpretate retroactiv ca autorizari mai largi.

## 6. Architecture delta check

Inainte de a propune un ATC executabil, Development Analysis compara schimbarea cu `ARCHITECTURE.md` curent.

Architecture Gate este obligatoriu daca implementarea cere sau presupune material:

- datastore nou sau schimbarea mecanismului de persistenta;
- schimbarea sursei canonice ori a ownership-ului datelor;
- identity/authentication/authorization/tenancy/multiuser nou sau modificat;
- schimbarea boundary-ului dintre componente sau a unui API/contract comun stabil;
- schimbarea orchestrarii, scheduler-ului sau modelului de concurenta;
- provider/runtime/framework/serviciu cu rol arhitectural;
- schimbare materiala de security/privacy/secrets;
- schimbare materiala de cost sau exit/portability.

Cand apare un trigger:

1. taskul foloseste statusul de blocare corespunzator fazei curente;
2. `Blocked by` indica architecture gate-ul;
3. Development poate descrie delta si optiunile, dar nu decide arhitectura;
4. ATC-urile dependente raman neexecutabile pana la decizia owner-ului;
5. dupa decizie, analiza/ATC-urile afectate se revalideaza.

## 7. Development Analysis

Development Analysis este read-only fata de produs/runtime.

Output minim:

- baseline GitHub verificat;
- impact si dependinte;
- architecture delta check;
- propunere de slices implementabile;
- Proposed Agent Task Contract(s);
- riscuri si stop conditions;
- verdict canonic (`READY_FOR_TASK_CONTRACTS` sau statusul de blocare aplicabil).

Analiza nu face coding, deploy, schema mutation sau data migration.

## 8. Agent Task Contract

Un ATC trebuie sa fie suficient de mic pentru executie si review independent.

Minimum:

- reference/ID stabil;
- parent requirement/analysis;
- objective;
- scope;
- out of scope;
- dependencies;
- constraints;
- acceptance criteria/tests;
- retry limit;
- stop conditions;
- Evidence Bundle cerut.

Un ATC devine executabil numai dupa `APPROVE_TASK_CONTRACT <ATC-ref>`.

## 9. Execution and retry

Executorul implementeaza numai ATC-ul aprobat.

Retry-ul este limitat de ATC. Daca limita este depasita sau executia cere schimbare materiala de scope/arhitectura/security/privacy/cost, executia se opreste si statusul devine blocat pentru faza curenta.

Nu se foloseste oportunitatea pentru refactor/redesign in afara scope-ului.

## 10. Evidence Bundle

Evidence Bundle trebuie sa permita verificarea contractului fara reconstruirea istoricului conversatiei.

Minimum:

- exact files/components changed;
- tests/checks si rezultate;
- mapping la acceptance criteria;
- assumptions/deviations;
- known limitations/residual risks;
- candidate/PR/SHA cand exista;
- verdict pentru trecerea la review.

Evidence Bundle nu este TEST PASS si nu autorizeaza release.

## 11. Independent Review

Review-ul compara implementarea exacta cu ATC-ul aprobat si Evidence Bundle.

Review-ul nu modifica implementarea in acelasi pas.

Verdictele canonice sunt cele din `GOVERNANCE.md` (`REVIEW_PASS`, `REVIEW_FAIL`, `REVIEW_BLOCKED`). Un review pozitiv nu autorizeaza automat PROD.

## 12. Handoff to release lifecycle

Dupa AgentFlow review si DEV verification, promovarea foloseste exclusiv `docs/software-delivery-lifecycle.md`.

```text
AgentFlow
requirement -> analysis -> ATC -> implementation -> evidence -> review

Release governance
DEV -> candidate freeze -> TEST -> RELEASE -> PROD_GO -> PROD -> smoke
```

AgentFlow nu redefineste candidate identity, TEST independence, rollback sau PROD gates.

## 13. Documentation transition

Documentele operative pot declara:

`Applies to: AGENTFLOW | LEGACY-ADAPTED | BOTH`

Un document legacy nu devine `SUPERSEDED` cat timp work `LEGACY-ADAPTED` activ depinde de el.

Nu se face retrofit in masa. Markerul se adauga cand documentul este creat sau modificat material.

## 14. Required context for AgentFlow execution

Default:

1. Issue-ul/taskul curent;
2. `.ai-instructions.md`;
3. acest document;
4. fisierele de cod/config afectate;
5. numai sectiunile relevante din documentele canonice.

Nu se incarca implicit istoricul, arhivele sau toate documentele proiectului.

## 15. References

- `GOVERNANCE.md` - process modes, vocabulary, canonical Phase/Status taxonomy;
- `.ai-instructions.md` - executor guardrails;
- `docs/software-delivery-lifecycle.md` - DEV -> TEST -> PROD;
- `docs/documentation-policy.md` - context/documentation rules;
- `.github/ISSUE_TEMPLATE/executable-task.yml` - executable task metadata.
