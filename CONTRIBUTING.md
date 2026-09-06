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
2. Nu se face push direct pe `main`.
3. Orice schimbare aprobata foloseste branch dedicat si pull request.
4. `main` trebuie sa ramana coerent si deployable.
5. Frontend/Worker se valideaza prin GitHub Actions.
6. Secretele si datele personale nu se adauga in repository.

## 3. Documentatie

- documentele in limba romana se scriu fara diacritice;
- documentatia trebuie sa fie simpla si concisa;
- daca nu exista informatie pentru un camp sau o sectiune obligatorie, se foloseste `#####`;
- documentatia descrie implementarea reala, nu doar intentia;
- unde E2E nu este confirmat, se marcheaza explicit `de confirmat`;
- modificarile de functionalitate trebuie reflectate in cerinte, functionalitati si arhitectura dupa caz;
- documentatia este revizuita periodic, la fiecare 2 ore, prin taskul programat ChatGPT `Actualizare documentatie proiect`;
- taskul de review poate identifica discrepante si propune modificari, dar orice modificare urmeaza regulile de aprobare, versionare, branch si pull request ale proiectului;
- daca nu exista modificari materiale, nu se creeaza commit doar pentru documentatie.

## 4. Contracte si versiuni

- contractele JSON principale folosesc `schema_version`;
- schimbarile incompatibile necesita versiune noua de contract;
- versiunea aplicatiei foloseste format `X.XX`;
- documentele cu versiune proprie isi actualizeaza versiunea la fiecare modificare materiala;
- changelog-ul se actualizeaza la schimbari semnificative.

## 5. Securitate

- Google token ramane numai in memoria paginii;
- `GITHUB_TOKEN` ramane Cloudflare Secret;
- cheile providerilor raman GitHub Actions Secrets;
- datele `/data/*` raman protejate Worker-first;
- niciun secret nu se copiaza in frontend, JSON publicabil sau documentatie.
