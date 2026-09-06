# GOVERNANCE.md - Job Search Command Center

Versiune document: `v1.0`
Ultima actualizare: `2026-09-06`

## 1. Principiu

Proiectul are un singur owner. Cerintele, schimbarile de scop si deciziile arhitecturale sunt aprobate de owner inainte de implementare.

Flux formal:

`Ideas / Requirements -> decizie aprobata explicit -> Development -> implementare`

Regula pentru orice cerinta noua:

1. analiza impactului;
2. propunere de optimizare, daca este cazul;
3. confirmare explicita;
4. implementare numai dupa confirmare.

Conversatiile de idei/analiza nu produc implementari sau modificari de cod pana la aprobarea explicita pentru Development.

## 2. Surse de adevar si precedenta

Documentele de referinta obligatorii sunt:

- `ARCHITECTURE.md` - arhitectura canonica si adevar tehnic;
- `GOVERNANCE.md` - reguli de proces, decizie si control;
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
- proces, aprobare si control -> `GOVERNANCE.md`;
- comportamentul AI -> `.ai-instructions.md`.

Daca documentatia contrazice codul sau doua documente se contrazic, discrepanta se semnaleaza si se clarifica inainte de modificari functionale.

## 3. Arhitectura

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

## 4. Cod, Issues si branching

- `main` trebuie sa ramana coerent si deployable;
- nu se face push direct pe `main`;
- orice schimbare aprobata se face pe branch dedicat si se integreaza prin pull request;
- cerintele, defectele si change request-urile relevante se urmaresc prin GitHub Issues;
- codul functional nu se modifica in cadrul unei actualizari strict documentare;
- fiecare Issue ramane deschis pana la validarea criteriilor de acceptare.

## 5. Testare

Pentru logica critica se mentin teste pentru:

- geografie;
- deduplicare;
- filtrare;
- scoring;
- connectori.

CI trebuie sa valideze cel putin Python, JSON, React/Vite si Cloudflare Worker dry-run.

## 6. Securitate

- secretele nu se introduc in cod, documentatie sau frontend;
- Google ID token ramane numai in memoria paginii;
- `GITHUB_TOKEN` ramane Cloudflare Secret;
- cheile providerilor raman GitHub Actions Secrets;
- datele private sunt accesate prin Cloudflare Worker;
- credentialele GitHub nu ajung in browser.

## 7. Documentatie

Documentele interne in limba romana se redacteaza fara diacritice.

Documentatia trebuie sa fie simpla si concisa. Daca nu exista informatie pentru un camp sau o sectiune obligatorie, se foloseste `#####`.

Documentatia descrie implementarea reala. Functionalitatile planificate sunt marcate explicit ca neimplementate.

La schimbari materiale se actualizeaza documentele afectate si, daca este relevant, `CHANGELOG.md`.

Nu se creeaza commit numai pentru documentatie daca nu exista o diferenta materiala de documentat.

## 8. Versionare

Versiunea aplicatiei foloseste formatul `X.XX` conform regulii curente a proiectului.

`ARCHITECTURE.md` foloseste propria schema de versionare si politica de pastrare definite in document.

Documentele de guvernanta cu versiune proprie isi actualizeaza versiunea la fiecare modificare materiala.

Contractele JSON principale folosesc `schema_version`. Schimbarile incompatibile necesita versiune noua de contract.
