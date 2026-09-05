# Mod de lucru

## 1. Cerinte

Pentru orice cerinta noua:

1. se analizeaza impactul;
2. se propune optimizare daca este cazul;
3. se asteapta confirmarea utilizatorului;
4. se implementeaza numai dupa confirmare.

## 2. Schimbari de cod

1. Cerintele si defectele relevante se urmaresc prin GitHub Issues.
2. Schimbarile majore folosesc branch dedicat.
3. Integrarea se face prin pull request cand impactul este semnificativ.
4. `main` trebuie sa ramana coerent si deployable.
5. Frontend/Worker se valideaza prin GitHub Actions.
6. Secretele si datele personale nu se adauga in repository.

## 3. Documentatie

- documentele in limba romana se scriu fara diacritice;
- documentatia trebuie sa fie simpla si concisa;
- documentatia descrie implementarea reala, nu doar intentia;
- unde E2E nu este confirmat, se marcheaza explicit `de confirmat`;
- modificarile de functionalitate trebuie reflectate in cerinte, functionalitati si arhitectura dupa caz;
- documentatia este revizuita automat periodic la fiecare 2 ore;
- daca nu exista modificari materiale, nu se creeaza commit doar pentru documentatie.

## 4. Contracte si versiuni

- contractele JSON principale folosesc `schema_version`;
- schimbarile incompatibile necesita versiune noua de contract;
- versiunea aplicatiei foloseste format X.XX;
- changelog-ul se actualizeaza la schimbari semnificative.

## 5. Securitate

- Google token ramane numai in memoria paginii;
- GitHub PAT ramane Cloudflare Secret;
- cheile providerilor raman GitHub Actions Secrets;
- datele `/data/*` raman protejate Worker-first;
- niciun secret nu se copiaza in frontend, JSON publicabil sau documentatie.
