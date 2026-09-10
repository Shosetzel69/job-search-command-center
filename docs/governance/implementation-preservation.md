# Implementation Preservation Guardrails

Status: PROPOSED FOR MERGE
Data: 2026-09-10

Scop: prevenirea driftului de implementare si arhitectura intre interventiile ChatGPT/Claude.

Reguli introduse in `GOVERNANCE.md` si `.ai-instructions.md`:

- GitHub-state-before-action: starea curenta din GitHub se verifica inainte de analiza tehnica, implementare, review sau fix;
- conversatiile, memoria AI si copiile locale sunt context, nu sursa de adevar tehnic;
- Implementation Preservation Rule: o cerinta functionala nu autorizeaza schimbarea mecanismului de implementare daca schimbarea nu este ceruta explicit;
- No Opportunistic Refactoring: bugfix/feature nu autorizeaza refactorizare sau redesign in afara scope-ului;
- Deploy Immutability Rule: PROD se face din commitul/artefactul rezultat din PR-ul aprobat, fara patch-uri locale sau modificari intermediare.

Documentul este sumar de transfer/review; regulile normative raman in `GOVERNANCE.md` si `.ai-instructions.md`.
