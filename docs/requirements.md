# Cerinte - sumar

Actualizare: 2026-09-05

## Regula de lucru pentru cerinte

Pentru orice cerinta noua se aplica obligatoriu fluxul:
1. analiza impactului;
2. propunere de optimizare, daca este cazul;
3. confirmarea utilizatorului;
4. implementare numai dupa confirmare.

## Cerinte functionale

### Cautare si rezultate

- CFR-01: Sistemul colecteaza roluri din sursele active.
- CFR-02: Motorul colecteaza rezultate pentru o fereastra maxima de 5 zile, independent de filtrul de vechime ales in interfata.
- CFR-03: Daca furnizorul nu livreaza un timestamp verificabil, rezultatul nu este exclus automat atunci cand interogarea sursei limiteaza deja vechimea maxima.
- CFR-04: Sistemul normalizeaza si deduplica rezultatele.
- CFR-05: Sistemul marcheaza repostarile si le pastreaza vizibile.
- CFR-06: Sistemul calculeaza fitul si prezinta argumentele pro si riscurile.
- CFR-07: Fiecare rezultat are link direct la pagina disponibila pentru job; un rezultat nu este exclus doar pentru ca linkul disponibil este catre Indeed.
- CFR-08: Detaliile jobului includ descrierea pozitiei atunci cand sursa o furnizeaza.
- CFR-09: Fiecare excludere are justificare.
- CFR-43: Colectarea JobsPipe foloseste `discovered_at_gte` si stare persistenta per interogare pentru a solicita in mod incremental numai joburile noi sau backlog-ul neprocesat.
- CFR-44: Inaintea unei interogari JobsPipe platite, sistemul foloseste preview-ul gratuit `blur_company_data=true` pentru a determina daca exista rezultate noi si pentru a estima volumul.
- CFR-45: Interogarile JobsPipe sunt impartite in doua seturi fara suprapunere geografica: geografiile prioritare si rolurile remote din restul tarilor europene eligibile.
- CFR-46: Daca volumul depaseste bugetul unei rulari, sistemul pastreaza cursorul JobsPipe si continua backlog-ul in rularile urmatoare fara a avansa watermark-ul inainte de epuizarea paginarii.
- CFR-47: Rezultatele deja colectate sunt pastrate intre rulari si eliminate numai dupa depasirea ferestrei maxime de 5 zile sau conform regulilor de filtrare.
- CFR-48: Sistemul pastreaza un buget maxim configurabil de credite JobsPipe per rulare si un prag lunar local pentru evitarea epuizarii necontrolate a cotei.
- CFR-49: Cand `jobspipe_enabled=false`, workflow-ul nu executa nicio cerere catre JobsPipe si pastreaza setul de rezultate deja publicat.

### Interfata si configurare

- CFR-10: Utilizatorul autentificat poate vizualiza joburile noi, rolurile de evaluat, aplicarile, criteriile si sursele.
- CFR-11: Utilizatorul poate gestiona criteriile de cautare si excluderile din interfata.
- CFR-12: Utilizatorul poate gestiona sursele din interfata.
- CFR-13: Utilizatorul pastreaza istoricul aplicarilor.
- CFR-14: Cand utilizatorul nu este autentificat sau se deconecteaza, interfata nu afiseaza joburile, rezumatul, aplicarile, criteriile, sursele, statusul ultimei rulari sau butonul `Ruleaza verificarea`.
- CFR-15: In starea neautentificata raman vizibile numai identificarea aplicatiei si controlul Google Sign-In.
- CFR-16: La autentificarea cu utilizatorul autorizat, continutul functional al aplicatiei, datele protejate si butonul `Ruleaza verificarea` devin vizibile.
- CFR-17: Lista de joburi are filtru de vechime cu optiunile `24h`, `36h`, `48h`, `5 zile`; selectia filtreaza imediat lista fara o noua rulare.
- CFR-18: Fereastra implicita de afisare este `24h`; configuratia poate salva ca valoare implicita una dintre valorile 24, 36, 48 sau 120 ore.
- CFR-19: Lista de joburi are multiselectie pentru modul de lucru: `Remote`, `Hibrid`, `Onsite`, `N/A`.
- CFR-20: Toate cele patru moduri de lucru sunt selectate implicit, iar debifarea unuia elimina imediat categoria respectiva din lista.
- CFR-21: Filtrul de vechime, filtrul de mod de lucru, cautarea text, filtrul Fit ridicat si filtrul B2B se aplica cumulativ.
- CFR-22: Sortarea dupa FIT permite `crescator` si `descrescator`; valoarea implicita este `descrescator`.
- CFR-23: Filtrul simplu `Remote` din toolbar este eliminat pentru a evita suprapunerea cu multiselectia modului de lucru.
- CFR-24: Rezumatul listei se actualizeaza conform filtrului de vechime si modului de lucru selectat.
- CFR-25: Toate vizualizarile aplicatiei sunt aliniate la partea de sus a ecranului.
- CFR-50: In `Criterii de selectie` exista checkbox-ul `Activeaza JobsPipe`, sincronizat cu `jobspipe_enabled` din configuratia canonica.
- CFR-51: Checkbox-ul JobsPipe este dezactivat implicit in perioada de stabilizare; modificarea devine efectiva numai dupa `Salveaza preferintele` si necesita utilizator autentificat/autorizat.

### Autentificare, date si comenzi protejate

- CFR-26: Autentificarea se face cu Google Identity Services.
- CFR-27: Numai utilizatorul Google al carui `sub` corespunde valorii `ALLOWED_GOOGLE_SUB` poate accesa datele protejate si executa comenzile protejate.
- CFR-28: Fisierele publicate `data/jobs.json`, `data/run-status.json`, `data/search-config.json`, `data/sources.json` si `data/applications.json` sunt rutate prin Cloudflare Worker si necesita un token Google valid al utilizatorului autorizat.
- CFR-29: Accesul direct la un URL `data/*.json` fara autentificare este refuzat.
- CFR-30: Frontend-ul trimite tokenul Google numai pentru cererile same-origin catre datele protejate; tokenul nu este stocat in `localStorage`.
- CFR-31: La logout, datele incarcate sunt eliminate din starea clientului si continutul functional este ascuns.
- CFR-32: Butonul `Ruleaza verificarea` nu este afisat cand utilizatorul nu este autentificat.
- CFR-33: Dupa autentificarea utilizatorului autorizat, butonul `Ruleaza verificarea` este afisat albastru si activ.
- CFR-34: In timpul unei rulari, butonul `Ruleaza verificarea` ramane dezactivat pana la finalizarea fluxului.
- CFR-35: Dupa logout, butonul `Ruleaza verificarea` este ascuns imediat.
- CFR-36: Utilizatorul autentificat este afisat vizual printr-un indicator verde care contine contul Google conectat.
- CFR-37: Apasarea indicatorului utilizatorului autentificat deconecteaza contul din sesiunea aplicatiei.
- CFR-38: Comanda `Ruleaza verificarea` porneste workflow-ul GitHub Actions prin Command API si nu expune credentiale GitHub in browser.
- CFR-39: Aplicatia previne pornirea unei a doua rulari daca exista deja una queued sau in progress.
- CFR-40: Dupa pornirea unei cautari din UI, aplicatia verifica periodic statusul autentificat si reincarca rezultatele dupa publicarea unei rulari noi.
- CFR-41: `Salveaza preferintele` necesita utilizator Google autorizat si persista configuratia canonica prin Command API.
- CFR-42: Salvarea configuratiei canonice declanseaza automat o noua cautare.

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
- CNF-10: Schimbarea filtrelor locale nu declanseaza GitHub Actions si trebuie sa actualizeze lista instant din setul deja colectat.
- CNF-11: Strategia JobsPipe trebuie sa ramana compatibila cu limita Free de 1.000 joburi/luna si sa foloseasca un prag local de siguranta configurabil.
- CNF-12: Starea interna de sincronizare JobsPipe nu este publicata in pachetul static Cloudflare.
- CNF-13: Dezactivarea JobsPipe din configuratia canonica trebuie sa garanteze zero consum de credite JobsPipe pentru rularile ulterioare pana la reactivare.

## Comportament curent confirmat

- Aplicatia porneste in stare fara continut functional vizibil pana la autentificare.
- Fara token Google valid, accesul direct la fisierele `data/*.json` protejate este refuzat de Cloudflare Worker.
- Dupa login, frontend-ul reincarca datele protejate folosind tokenul Google tinut numai in memoria paginii.
- Utilizatorul autorizat este evidentiat cu verde dupa autentificare.
- Dupa login, butonul `Ruleaza verificarea` este vizibil si activ; in timpul rularii este dezactivat.
- Dupa logout, continutul functional dispare, datele clientului sunt golite si butonul `Ruleaza verificarea` este ascuns.
- Motorul colecteaza pana la 5 zile; filtrul UI selecteaza local 24h, 36h, 48h sau 5 zile.
- Modurile de lucru pot fi filtrate cumulativ prin Remote / Hibrid / Onsite / N/A.
- FIT este descrescator implicit si poate fi comutat crescator.
- JobsPipe foloseste preview gratuit, polling incremental, paginare cu cursor si buget local de credite; valoarea curenta este 14 credite/rulare si prag lunar 950 cand providerul este activ.
- JobsPipe este momentan dezactivat prin `jobspipe_enabled=false` pentru perioada de stabilizare; checkbox-ul din `Criterii de selectie` permite reactivarea ulterioara controlata.
- Starea incrementala este pastrata in `data/search-state.json`, dar acest fisier nu este copiat in bundle-ul static Cloudflare.
- Rezultatele sunt generate de GitHub Actions si publicate automat in Cloudflare, dar accesul la continutul `data/*.json` este controlat de Worker.

Documentul complet va folosi formatul: ID, Titlu, Descriere, Categorie, Sursa, Prioritate, Criterii de acceptanta, Dependinte, Note, Versiune.
