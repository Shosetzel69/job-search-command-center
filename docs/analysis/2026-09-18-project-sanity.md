# Analiza - Automated Project Sanity

Data: 2026-09-18
Issue: #211
Status: APPROVED / DEVELOPMENT

## Problema

JSCC este lucrat in mai multe chaturi si thread-uri paralele. Contextul unei conversatii poate ramane in urma fata de starea GitHub si poate produce decizii bazate pe candidate SHA, defecte, QA sau deploy-uri deja depasite.

## Decizie implementata

Se introduce un snapshot GitHub-native, read-only, generat automat din evidence-ul deja produs de lifecycle.

Nu se introduce o a doua sursa manuala de adevar.

Generatorul:
- identifica release PR-ul activ dupa contractul de titlu `[Release N Wave M]`;
- foloseste head SHA-ul PR-ului ca candidate identity;
- citeste issue-urile referentiate de release PR;
- citeste artifacts canonice de promovare pentru acelasi SHA;
- produce JSON + Markdown;
- fail-closed daca exista ambiguitate.

Snapshot-ul este publicat ca GitHub Actions artifact, nu in runtime-ul aplicatiei si nu prin modificarea automata a `main`.

## Impact

Nu modifica:
- frontend;
- Command API;
- search engine;
- baze de date;
- runtime data;
- DEV / TEST / PROD;
- LEGACY.

Impactul este limitat la engineering/governance:
- un script Node fara dependinte noi;
- un workflow GitHub read-only;
- reguli AI de session-start sanity;
- documentatie.

## Diferenta fata de ideea initiala

Ticketul sugera `docs/current-project-state.md`. Implementarea evita un fisier de stare auto-scris in `main`, deoarece ar crea commit-uri/PR-uri de zgomot si ar duplica starea operationala.

In schimb, snapshot-ul este derivat la cerere/eveniment din evidence-ul GitHub deja canonic si publicat ca artifact efemer.

## Limitare intentionata

Snapshot-ul poate spune care este starea proiectului, dar nu poate sti singur daca un anumit chat contine informatie unica. Verdictul final `SAFE TO DELETE` ramane o comparatie intre snapshot si continutul chatului.

## Testare

CI foloseste mocks; nu face apeluri HTTP reale.

Validarea live se face numai prin workflow-ul read-only dupa integrare.
