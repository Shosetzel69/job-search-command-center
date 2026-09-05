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
- CFR-13: Cand utilizatorul nu este autentificat sau se deconecteaza, interfata nu afiseaza joburile, rezumatul, aplicarile, criteriile, sursele sau statusul ultimei rulari.
- CFR-14: In starea neautentificata raman vizibile numai identificarea aplicatiei, controlul Google Sign-In si butonul `Ruleaza verificarea` dezactivat.
- CFR-15: La autentificarea cu utilizatorul autorizat, continutul functional al aplicatiei devine din nou vizibil.

### Autentificare si comenzi protejate

- CFR-16: Autentificarea se face cu Google Identity Services.
- CFR-17: Numai utilizatorul Google al carui `sub` corespunde valorii `ALLOWED_GOOGLE_SUB` poate executa comenzile protejate.
- CFR-18: Butonul `Ruleaza verificarea` este gri si dezactivat cand utilizatorul nu este autentificat.
- CFR-19: Dupa autentificarea utilizatorului autorizat, butonul `Ruleaza verificarea` devine albastru si activ.
- CFR-20: In timpul unei rulari, butonul `Ruleaza verificarea` ramane dezactivat pana la finalizarea fluxului.
- CFR-21: Dupa logout, butonul `Ruleaza verificarea` revine automat la starea gri/dezactivata si continutul functional este ascuns.
- CFR-22: Utilizatorul autentificat este afisat vizual printr-un indicator verde care contine contul Google conectat.
- CFR-23: Apasarea indicatorului utilizatorului autentificat deconecteaza contul din sesiunea aplicatiei.
- CFR-24: Comanda `Ruleaza verificarea` porneste workflow-ul GitHub Actions prin Command API si nu expune credentiale GitHub in browser.
- CFR-25: Aplicatia previne pornirea unei a doua rulari daca exista deja una queued sau in progress.
- CFR-26: Dupa pornirea unei cautari din UI, aplicatia verifica periodic statusul si reincarca rezultatele dupa publicarea unei rulari noi.
- CFR-27: `Salveaza preferintele` necesita utilizator Google autorizat si persista configuratia canonica prin Command API.
- CFR-28: Salvarea configuratiei canonice declanseaza automat o noua cautare.

## Cerinte non-functionale

- CNF-01: Interfata este utilizabila pe desktop si mobil.
- CNF-02: Secretele nu sunt stocate in repository sau in frontend.
- CNF-03: Tokenul Google folosit de frontend este pastrat numai in memoria paginii si nu in `localStorage`.
- CNF-04: GitHub PAT este stocat exclusiv ca secret Cloudflare.
- CNF-05: API-ul verifica semnatura tokenului Google, issuer, audience si `ALLOWED_GOOGLE_SUB`.
- CNF-06: Arhitectura MVP ramane static-first, cu Cloudflare Worker pentru Static Assets si Command API.
- CNF-07: Fluxul initial ramane simplu si cu cost minim.
- CNF-08: Arhitectura permite introducerea ulterioara a persistentei SQLite/PostgreSQL daca apar cerinte tranzactionale sau multi-user.
- CNF-09: Ascunderea continutului dupa logout este un comportament UI; blocarea accesului direct la fisierele statice `data/*.json` necesita o masura separata de control al accesului.

## Comportament curent confirmat

- Aplicatia porneste in stare fara continut functional vizibil pana la autentificare.
- Utilizatorul autorizat este evidentiat cu verde dupa autentificare.
- Dupa login, joburile, sumarul, aplicarile, criteriile, sursele si statusul rularii devin vizibile.
- Dupa logout, continutul functional dispare imediat.
- `Ruleaza verificarea`: neautentificat = gri/dezactivat; autentificat = albastru/activ; rulare in curs = dezactivat.
- Rezultatele sunt generate de GitHub Actions si publicate automat in aplicatia Cloudflare dupa actualizarea fisierelor `data/*.json`.

Documentul complet va folosi formatul: ID, Titlu, Descriere, Categorie, Sursa, Prioritate, Criterii de acceptanta, Dependinte, Note, Versiune.
