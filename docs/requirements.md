# Cerinte - sumar

Actualizare: 2026-09-05

## Cerinte functionale

### Cautare si rezultate

- CFR-01: Sistemul colecteaza roluri din sursele active.
- CFR-02: Sistemul cauta roluri publicate in ultimele 24 de ore; daca furnizorul nu livreaza un timestamp verificabil, rezultatul nu este exclus automat atunci cand interogarea sursei este deja limitata la ultima zi.
- CFR-03: Sistemul normalizeaza si deduplica rezultatele.
- CFR-04: Sistemul marcheaza repostarile si le pastreaza vizibile.
- CFR-05: Sistemul calculeaza fitul si prezinta argumentele pro si riscurile.
- CFR-06: Fiecare rezultat are link direct la pagina disponibila pentru job; un rezultat nu este exclus doar pentru ca linkul disponibil este catre Indeed.
- CFR-07: Detaliile jobului includ descrierea pozitiei atunci cand sursa o furnizeaza.
- CFR-08: Fiecare excludere are justificare.

### Interfata si configurare

- CFR-09: Utilizatorul autentificat poate vizualiza joburile noi, rolurile de evaluat, aplicarile, criteriile si sursele.
- CFR-10: Utilizatorul poate gestiona criteriile de cautare si excluderile din interfata.
- CFR-11: Utilizatorul poate gestiona sursele din interfata.
- CFR-12: Utilizatorul pastreaza istoricul aplicarilor.
- CFR-13: Cand utilizatorul nu este autentificat sau se deconecteaza, interfata nu afiseaza joburile, rezumatul, aplicarile, criteriile, sursele, statusul ultimei rulari sau butonul `Ruleaza verificarea`.
- CFR-14: In starea neautentificata raman vizibile numai identificarea aplicatiei si controlul Google Sign-In.
- CFR-15: La autentificarea cu utilizatorul autorizat, continutul functional al aplicatiei, datele protejate si butonul `Ruleaza verificarea` devin vizibile.

### Autentificare, date si comenzi protejate

- CFR-16: Autentificarea se face cu Google Identity Services.
- CFR-17: Numai utilizatorul Google al carui `sub` corespunde valorii `ALLOWED_GOOGLE_SUB` poate accesa datele protejate si executa comenzile protejate.
- CFR-18: Fisierele publicate `data/jobs.json`, `data/run-status.json`, `data/search-config.json`, `data/sources.json` si `data/applications.json` sunt rutate prin Cloudflare Worker si necesita un token Google valid al utilizatorului autorizat.
- CFR-19: Accesul direct la un URL `data/*.json` fara autentificare este refuzat.
- CFR-20: Frontend-ul trimite tokenul Google numai pentru cererile same-origin catre datele protejate; tokenul nu este stocat in `localStorage`.
- CFR-21: La logout, datele incarcate sunt eliminate din starea clientului si continutul functional este ascuns.
- CFR-22: Butonul `Ruleaza verificarea` nu este afisat cand utilizatorul nu este autentificat.
- CFR-23: Dupa autentificarea utilizatorului autorizat, butonul `Ruleaza verificarea` este afisat albastru si activ.
- CFR-24: In timpul unei rulari, butonul `Ruleaza verificarea` ramane dezactivat pana la finalizarea fluxului.
- CFR-25: Dupa logout, butonul `Ruleaza verificarea` este ascuns imediat.
- CFR-26: Utilizatorul autentificat este afisat vizual printr-un indicator verde care contine contul Google conectat.
- CFR-27: Apasarea indicatorului utilizatorului autentificat deconecteaza contul din sesiunea aplicatiei.
- CFR-28: Comanda `Ruleaza verificarea` porneste workflow-ul GitHub Actions prin Command API si nu expune credentiale GitHub in browser.
- CFR-29: Aplicatia previne pornirea unei a doua rulari daca exista deja una queued sau in progress.
- CFR-30: Dupa pornirea unei cautari din UI, aplicatia verifica periodic statusul autentificat si reincarca rezultatele dupa publicarea unei rulari noi.
- CFR-31: `Salveaza preferintele` necesita utilizator Google autorizat si persista configuratia canonica prin Command API.
- CFR-32: Salvarea configuratiei canonice declanseaza automat o noua cautare.

## Cerinte non-functionale

- CNF-01: Interfata este utilizabila pe desktop si mobil.
- CNF-02: Secretele nu sunt stocate in repository sau in frontend.
- CNF-03: Tokenul Google folosit de frontend este pastrat numai in memoria paginii si nu in `localStorage`.
- CNF-04: GitHub PAT este stocat exclusiv ca secret Cloudflare.
- CNF-05: API-ul verifica semnatura tokenului Google, issuer, audience si `ALLOWED_GOOGLE_SUB`.
- CNF-06: Arhitectura MVP ramane static-first, cu Cloudflare Worker pentru Static Assets, control acces la date si Command API.
- CNF-07: Fisierele de date protejate sunt livrate cu `cache-control: no-store`.
- CNF-08: Fluxul initial ramane simplu si cu cost minim.
- CNF-09: Arhitectura permite introducerea ulterioara a persistentei SQLite/PostgreSQL daca apar cerinte tranzactionale sau multi-user.

## Comportament curent confirmat

- Aplicatia porneste in stare fara continut functional vizibil pana la autentificare.
- Fara token Google valid, accesul direct la fisierele `data/*.json` protejate este refuzat de Cloudflare Worker.
- Dupa login, frontend-ul reincarca datele protejate folosind tokenul Google tinut numai in memoria paginii.
- Utilizatorul autorizat este evidentiat cu verde dupa autentificare.
- Dupa login, butonul `Ruleaza verificarea` este vizibil si activ; in timpul rularii este dezactivat.
- Dupa logout, continutul functional dispare, datele clientului sunt golite si butonul `Ruleaza verificarea` este ascuns.
- Rezultatele sunt generate de GitHub Actions si publicate automat in Cloudflare, dar accesul la continutul `data/*.json` este controlat de Worker.

Documentul complet va folosi formatul: ID, Titlu, Descriere, Categorie, Sursa, Prioritate, Criterii de acceptanta, Dependinte, Note, Versiune.
