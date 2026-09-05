# Cerinte - sumar

Actualizare: 2026-09-05

## Regula de lucru pentru cerinte

Pentru orice cerinta noua se aplica obligatoriu fluxul:
1. analiza impactului;
2. propunere de optimizare, daca este cazul;
3. confirmarea utilizatorului;
4. implementare numai dupa confirmare.

Documentatia proiectului este revizuita periodic si sincronizata cu implementarea reala.

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
- CFR-43: Colectarea JobsPipe foloseste `discovered_at_gte` si stare persistenta per interogare pentru a solicita incremental joburile noi sau backlog-ul neprocesat.
- CFR-44: Inaintea unei interogari JobsPipe platite, sistemul foloseste preview-ul gratuit `blur_company_data=true` pentru estimarea volumului.
- CFR-45: Interogarile JobsPipe sunt impartite in seturi fara suprapunere geografica intre geografiile prioritare si restul Europei remote eligibile.
- CFR-46: Daca volumul depaseste bugetul unei rulari, sistemul pastreaza cursorul si continua backlog-ul ulterior.
- CFR-47: Rezultatele deja colectate sunt pastrate pana la depasirea ferestrei maxime de 5 zile sau conform regulilor de filtrare.
- CFR-48: Sistemul pastreaza un buget maxim configurabil de credite JobsPipe per rulare si un prag lunar local.
- CFR-49: Cand `jobspipe_enabled=false`, workflow-ul nu executa cereri JobsPipe si pastreaza setul de rezultate deja publicat.

### Interfata si configurare

- CFR-10: Utilizatorul autentificat poate vizualiza joburile noi, rolurile de evaluat, aplicarile, criteriile si sursele.
- CFR-11: Utilizatorul poate gestiona criteriile de cautare si excluderile din interfata.
- CFR-12: Utilizatorul poate gestiona sursele din interfata; pana la persistenta server-side, starea individuala a surselor ramane locala.
- CFR-13: Utilizatorul pastreaza istoricul aplicarilor.
- CFR-14: Cand utilizatorul nu este autentificat, continutul functional privat nu este afisat.
- CFR-15: In starea neautentificata raman vizibile identificarea aplicatiei, controlul Google Sign-In si eventualele erori de autentificare.
- CFR-16: Dupa validarea utilizatorului Google autorizat, aplicatia afiseaza header-ul, profilul si starea de incarcare a datelor protejate.
- CFR-17: Lista de joburi are filtru de vechime cu optiunile `24h`, `36h`, `48h`, `5 zile`.
- CFR-18: Fereastra implicita de afisare este `24h`; configuratia poate salva 24, 36, 48 sau 120 ore.
- CFR-19: Lista de joburi are multiselectie pentru `Remote`, `Hibrid`, `Onsite`, `N/A`.
- CFR-20: Toate cele patru moduri sunt selectate implicit.
- CFR-21: Filtrul de vechime, modul de lucru, cautarea text, Fit ridicat si B2B se aplica cumulativ.
- CFR-22: Sortarea dupa FIT permite crescator si descrescator; implicit este descrescator.
- CFR-23: Filtrul simplu Remote separat este eliminat.
- CFR-24: Rezumatul listei se actualizeaza conform filtrelor curente.
- CFR-25: Toate vizualizarile sunt aliniate la partea de sus a ecranului.
- CFR-50: In `Criterii de selectie` exista checkbox-ul `Activeaza JobsPipe`, sincronizat cu `jobspipe_enabled`.
- CFR-51: JobsPipe este dezactivat implicit in perioada de stabilizare; modificarea devine efectiva dupa `Salveaza preferintele`.
- CFR-56: Header-ul foloseste un widget de profil discret cu avatar/text si dropdown pentru logout, fara fundal verde plin.
- CFR-57: Albastrul este rezervat actiunii primare `Ruleaza verificarea`; verdele este folosit numai pentru indicatori de stare activa/succes.
- CFR-58: Fundalul general este slate/gri foarte deschis; cardurile si containerele sunt albe, cu border discret si shadow fin.
- CFR-59: Continutul principal are latime maxima de 1400 px si este centrat pe monitoare late.
- CFR-60: Zona de filtre are doua randuri: cautarea pe primul rand, filtrele rapide si `Reseteaza filtrele` pe al doilea.
- CFR-61: KPI-urile sunt afisate numai in `Joburi noi`.
- CFR-62: Randurile tabelului sunt compacte si afiseaza la hover actiuni rapide pentru arhivare, aplicare si detalii.
- CFR-63: Badge-urile numerice din sidebar folosesc contrast ridicat cu text alb.
- CFR-64: `Criterii de selectie` foloseste o grila echilibrata cu o coloana pe ecrane mici si doua coloane de la breakpoint-ul mediu.
- CFR-65: `Reseteaza filtrele` restaureaza cautarea goala, toate modurile de lucru, filtrul Toate, vechimea implicita si FIT descrescator.
- CFR-66: Arhivarea rapida este locala in MVP si elimina jobul din listele curente fara a modifica sursa canonica server-side.

### Autentificare, date si comenzi protejate

- CFR-26: Autentificarea se face cu Google Identity Services.
- CFR-27: Numai utilizatorul Google al carui `sub` corespunde `ALLOWED_GOOGLE_SUB` poate accesa datele si comenzile protejate.
- CFR-28: `data/jobs.json`, `data/run-status.json`, `data/search-config.json`, `data/sources.json` si `data/applications.json` sunt rutate prin Worker si necesita token Google valid.
- CFR-29: Accesul direct la `data/*.json` fara autentificare este refuzat.
- CFR-30: Tokenul Google este trimis numai same-origin si este pastrat numai in memoria paginii.
- CFR-31: La logout, datele incarcate sunt eliminate din starea clientului.
- CFR-32: `Ruleaza verificarea` nu este afisat cand utilizatorul nu este autentificat.
- CFR-33: Dupa autentificarea autorizata, `Ruleaza verificarea` este afisat albastru si activ.
- CFR-34: In timpul unei rulari, butonul ramane dezactivat pana la finalizarea fluxului.
- CFR-35: Dupa logout, continutul privat si butonul de rulare dispar imediat.
- CFR-36: Utilizatorul autentificat este reprezentat prin widget de profil neutru; statusul activ este separat vizual.
- CFR-37: Dropdown-ul profilului permite deconectarea explicita.
- CFR-38: `Ruleaza verificarea` porneste workflow-ul prin Command API fara credentiale GitHub in browser.
- CFR-39: Aplicatia previne pornirea unei a doua rulari daca exista deja una queued/in progress.
- CFR-40: Dupa pornirea cautarii, aplicatia verifica periodic statusul si reincarca rezultatele dupa publicare.
- CFR-41: `Salveaza preferintele` necesita utilizator autorizat si persista configuratia prin Command API.
- CFR-42: Salvarea configuratiei canonice declanseaza automat o noua cautare.
- CFR-52: La initializarea paginii, frontend-ul nu solicita `data/*.json` inainte de validarea sesiunii Google.
- CFR-53: Dupa validarea Google, sesiunea este considerata autentificata independent de rezultatul incarcarii datelor.
- CFR-54: Lista, contoarele, rezumatul si statusul rularii provin din aceeasi incarcare valida; o eroare nu poate lasa valori stale.
- CFR-55: Daca incarcarea datelor protejate esueaza dupa login valid, utilizatorul ramane autentificat, vede eroarea explicita si poate reincerca incarcarea.
- CFR-67: Numai esecul validarii `/auth/session` impiedica stabilirea sesiunii autentificate; erorile ulterioare de date sunt tratate separat.
- CFR-68: Erorile de autentificare si incarcare sunt vizibile si nu sunt ascunse de starea signed-out/private-content.

## Cerinte non-functionale

- CNF-01: Interfata este utilizabila pe desktop si mobil.
- CNF-02: Secretele nu sunt stocate in repository sau frontend.
- CNF-03: Tokenul Google nu este stocat in `localStorage`.
- CNF-04: GitHub PAT este stocat exclusiv ca secret Cloudflare.
- CNF-05: API-ul verifica semnatura tokenului Google, issuer, audience si `ALLOWED_GOOGLE_SUB`.
- CNF-06: Arhitectura MVP ramane static-first, cu Cloudflare Worker pentru Static Assets, access control si Command API.
- CNF-07: Fisierele protejate sunt livrate cu `cache-control: no-store`.
- CNF-08: Fluxul ramane cu cost minim.
- CNF-09: Arhitectura permite introducerea SQLite/PostgreSQL daca apar cerinte tranzactionale sau multi-user.
- CNF-10: Filtrele locale nu declanseaza GitHub Actions si actualizeaza lista instant.
- CNF-11: Strategia JobsPipe foloseste prag local de siguranta pentru quota.
- CNF-12: `data/search-state.json` nu este publicat in bundle-ul static.
- CNF-13: `jobspipe_enabled=false` garanteaza zero consum JobsPipe pana la reactivare.
- CNF-14: Fluxul de autentificare si date este explicit; nu se folosesc interceptari globale de `fetch` sau monkey-patching intre scripturi.
- CNF-15: Frontend-ul este implementat cu React functional components si Tailwind CSS, compilat cu Vite inainte de publicare.
- CNF-16: Bundle-ul public contine numai artefactele construite ale frontend-ului; codul JSX brut nu este servit ca runtime.
- CNF-17: Build-ul React si Worker-ul sunt validate in GitHub Actions inainte de integrarea modificarilor majore de UI.

## Comportament curent tinta dupa release-ul UI React

- Pagina porneste fara cereri la `data/*.json` pana la autentificare.
- Loginul Google valid stabileste sesiunea imediat; incarcarea datelor este un pas separat.
- Daca datele esueaza, profilul ramane vizibil, contoarele raman curate si exista `Reincearca incarcarea`.
- Dupa incarcarea valida, lista, contoarele si KPI-urile sunt sincronizate.
- Logout-ul goleste imediat datele din memorie.
- KPI-urile apar numai in `Joburi noi`.
- Filtrele sunt structurate pe doua randuri si includ reset explicit.
- Tabelul este compact si are actiuni la hover.
- Criteriile sunt afisate in grila responsive pe doua coloane.
- JobsPipe ramane dezactivat prin `jobspipe_enabled=false` in perioada de stabilizare.

Documentul complet va folosi formatul: ID, Titlu, Descriere, Categorie, Sursa, Prioritate, Criterii de acceptanta, Dependinte, Note, Versiune.
