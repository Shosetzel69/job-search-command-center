# Mod de lucru

## 1. Flux cerinte

Fluxul formal este:

`Ideas / Requirements -> Analiza -> cerinta/decizie aprobata explicit -> Development -> implementare`

Reguli:

1. `Ideas / Requirements` este exclusiv pentru colectare, explorare si maturizare de idei. Nu se scrie si nu se modifica cod.
2. Cand o idee este suficient de matura, se transfera in `Analiza` printr-un sumar scurt.
3. `Analiza` clarifica formal functionalitatea, impactul, scope-ul, alternativele si cerintele. Nu se implementeaza cod.
4. Owner-ul aproba explicit intrarea in `Development`.
5. Numai in `Development` se face design tehnic, implementare, testare si integrare.

Nu exista trecere directa din `Ideas / Requirements` in `Development`.

Pentru orice cerinta noua:

1. se analizeaza impactul;
2. se propune optimizare daca este cazul;
3. se asteapta confirmarea owner-ului;
4. se implementeaza numai dupa transferul explicit in Development.

## 2. Schimbari de cod si documentatie

1. Cerintele si defectele relevante se urmaresc prin GitHub Issues.
2. Nu se face push/write direct pe `main`.
3. Orice schimbare aprobata foloseste branch dedicat si pull request.
4. Inainte de orice write prin GitHub API se verifica existenta branch-ului tinta si baseline-ul/SHA-ul sau.
5. Operatiile de continut trebuie sa specifice explicit branch-ul; lipsa/invaliditatea branch-ului opreste operatia, fara fallback pe default branch.
6. Dupa write se verifica branch-ul tinta si absenta unei modificari neintentionate pe `main`.
7. `main` trebuie sa ramana coerent si deployable.
8. Frontend/Worker se valideaza prin GitHub Actions.
9. Secretele si datele personale nu se adauga in repository.

Regula completa este in `GOVERNANCE.md` -> `Branch Target Safety Rule`.

## 3. Lucru cu Issues

- orice Issue/PR generat de AI foloseste label-ul `ai-generated`;
- la actualizarea unui Issue existent, titlul si label-urile se pastreaza implicit;
- titlul sau label-urile se modifica numai la cererea sau aprobarea explicita a owner-ului;
- schimbarea body-ului, inchiderea sau redeschiderea Issue-ului nu autorizeaza implicit schimbarea titlului/label-urilor;
- Issue-ul ramane deschis pana la validarea criteriilor de acceptare.

## 4. Acces AI la GitHub

`ai-github-bridge` este infrastructura separata pentru operatii GitHub allowlisted sub identitati GitHub App dedicate.

Remote MCP Claude este operational:

`Claude Web -> OAuth 2.1 -> ai-github-bridge /mcp -> jobsearch-claude-agent[bot] -> GitHub API`

Tools curente: `read_file`, `get_issue`, `create_issue`, `update_issue`.

Nu exista write pe files/branches/PR prin Remote MCP in scope-ul curent. Pentru detalii tehnice: `ARCHITECTURE.md` si `docs/ai-github-bridge.md`.

## 5. Documentatie

- documentele in limba romana se scriu fara diacritice;
- documentatia trebuie sa fie simpla si concisa;
- daca nu exista informatie pentru un camp sau o sectiune obligatorie, se foloseste `#####`;
- documentatia descrie implementarea reala, nu doar intentia;
- unde E2E nu este confirmat, se marcheaza explicit `de confirmat`;
- modificarile de functionalitate trebuie reflectate in cerinte, functionalitati si arhitectura dupa caz;
- documentatia este revizuita periodic, la fiecare 2 ore, prin taskul programat ChatGPT `Actualizare documentatie proiect`;
- taskul de review poate identifica discrepante si propune modificari, dar orice modificare urmeaza regulile de aprobare, versionare, branch si pull request ale proiectului;
- daca nu exista modificari materiale, nu se creeaza commit doar pentru documentatie.

## 6. Contracte si versiuni

- contractele JSON principale folosesc `schema_version`;
- schimbarile incompatibile necesita versiune noua de contract;
- versiunea aplicatiei foloseste format `X.XX`;
- documentele cu versiune proprie isi actualizeaza versiunea la fiecare modificare materiala;
- changelog-ul se actualizeaza la schimbari semnificative.

## 7. Securitate

- Google token ramane numai in memoria paginii;
- `GITHUB_TOKEN` ramane Cloudflare Secret;
- cheile providerilor raman GitHub Actions Secrets;
- datele `/data/*` raman protejate Worker-first;
- GitHub App private keys, bridge tokens, OAuth tokens si `MCP_OWNER_ACCESS_CODE` nu se copiaza in repository, documentatie sau prompturi;
- niciun secret nu se copiaza in frontend, JSON publicabil sau documentatie.

## 8. Environment automation (Phase 3)

Comenzi canonice:

```text
npm run env:validate -- --env dev|test|prod --source-sha <full-sha>
npm run env:bootstrap -- --env dev|test|prod --source-sha <full-sha> --dry-run
npm run env:bootstrap-all -- --source-sha <full-sha> --dry-run
npm run env:deploy -- --env dev|test|prod --source-sha <full-sha> --dry-run
npm run env:status -- --source-sha <full-sha> --dry-run
npm run env:isolation-test -- --source-sha <full-sha> --dry-run
npm run test:environment
```

In Phase 3, bootstrap/deploy/status/isolation ruleaza numai dry-run. PROD necesita suplimentar `--owner-gate APPROVED`; aceasta confirmare nu autorizeaza cutover-ul PROD, care ramane gate separat in Phase 6/7.

Lipsa `--env`, un ref mutabil in loc de SHA complet, un target runtime gresit sau credential/config lipsa produce FAIL. `bootstrap-all` nu include PROD.
