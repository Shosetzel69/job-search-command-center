# GOVERNANCE.md - Job Search Command Center

## 1. Principiu

Proiectul are un singur owner. Cerintele, schimbarile de scop si deciziile arhitecturale sunt aprobate de owner inainte de implementare.

Regula pentru orice cerinta noua:

1. analiza impactului;
2. propunere de optimizare, daca este cazul;
3. confirmare explicita;
4. implementare numai dupa confirmare.

## 2. Surse de adevar

- `ARCHITECTURE.md` - arhitectura canonica;
- `docs/requirements.md` - cerinte;
- `docs/functionalitati.md` - comportament implementat;
- `docs/data-contract.md` - contracte de date;
- `docs/command-api.md` - Command API si autentificare;
- `docs/source-strategy.md` - surse si connectori;
- `CONTRIBUTING.md` - mod de lucru;
- `CHANGELOG.md` - istoric schimbari relevante.

`README.md` este doar overview.

Daca documentatia contrazice codul, contradictia se semnaleaza si se clarifica inainte de modificari functionale.

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

## 4. Cod si branching

- `main` trebuie sa ramana coerent si deployable;
- schimbarile majore folosesc branch dedicat si pull request;
- bugfix-urile sau modificarile mici pot folosi flux simplificat daca nu schimba arhitectura;
- codul functional nu se modifica in cadrul unei actualizari strict documentare;
- fiecare issue ramane deschis pana la validarea criteriilor de acceptare.

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

Documentatia descrie implementarea reala. Functionalitatile planificate sunt marcate explicit ca neimplementate.

La schimbari materiale se actualizeaza documentele afectate si, daca este relevant, `CHANGELOG.md`.

Nu se creeaza commit numai pentru documentatie daca nu exista o diferenta materiala de documentat.

## 8. Versionare

Versiunea aplicatiei foloseste formatul `X.XX` conform regulii curente a proiectului.

Contractele JSON principale folosesc `schema_version`. Schimbarile incompatibile necesita versiune noua de contract.
