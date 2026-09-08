# Solution Roadmap

## Status
Document de planificare tehnica si functionala.

Data analizei: 2026-09-08

## Obiectiv

Roadmap-ul grupeaza backlog-ul curent in trei pachete de implementare: termen scurt, termen mediu si termen lung.

Impartirea nu urmeaza strict numerotarea issue-urilor sau etichetele P1/P2/P3 existente. Prioritizarea foloseste criteriile aplicate in analiza proiectului:

1. valoare imediata pentru utilizarea curenta;
2. corectitudinea rezultatelor;
3. reducerea costului si a rularilor inutile;
4. risc operational si securitate;
5. dependente si capacitatea de a debloca alte functionalitati;
6. efort de implementare;
7. risc de rework;
8. evitarea arhitecturii premature;
9. preferinta pentru functionalitati care nu necesita API/LLM platit.

---

# Pachet 1 - Termen scurt

## Obiectiv

Stabilizarea aplicatiei, controlul explicit al executiei si corectitudinea filtrarii.

Aplicatia trebuie sa devina predictibila inainte de extinderea functionala: salvarea configuratiei nu trebuie sa porneasca automat o cautare, filtrele geografice trebuie aplicate corect, iar utilizatorul trebuie sa poata vedea clar ce a declansat fiecare rulare si ce s-a procesat.

## Scope recomandat

| Issue | Scope in pachet |
|---|---|
| #77 | Doar `Actualizare date`: manual-only, eliminare trigger-e necerute, control rulare |
| #36 | Selectie explicita tara/regiune si persistenta corecta |
| #37 | Excluderi teritoriale si validarea conflictelor |
| #24 | E2E pentru separarea `Salveaza` de `Ruleaza` |
| #13 | Progres real al verificarii |
| #38 | Numar real de surse procesate |
| #39 | Log minim: trigger, surse, erori, durata |
| #35 | Afisarea explicita a tarii jobului |
| #21 | Testele negative de securitate esentiale |
| #33 | Verificare si inchidere daca publicarea concurenta este stabilizata |
| #17 | Validare live finala Cloudflare |
| #18 | Actualizare specificatie conform noii reguli de executie |
| #19 | Actualizare specificatie conform noii reguli de executie |

## Regula operationala tinta

```text
Modific filtre
    -> Salvez
    -> STOP

Ruleaza acum
    -> validare configuratie
    -> workflow_dispatch
    -> colectare
    -> filtrare
    -> publicare
    -> log
```

Automatizarea ramane OFF in aceasta etapa.

## Rezultat asteptat

- nicio cautare completa nu porneste ca efect secundar al salvarii configuratiei;
- nicio cautare completa nu porneste la simplu push de cod/config;
- filtrarea geografica este explicita si verificabila;
- o singura rulare poate fi activa simultan;
- trigger-ul fiecarei rulari este identificabil;
- utilizatorul poate valida rapid tara, sursele procesate si erorile;
- costul operational inutil este redus imediat.

## Efort estimat

- 25-40 ore
- echivalent extern la 50 EUR/h: 1.250-2.000 EUR

## Prioritate

Must / P0-P1.

Nu este recomandata extinderea majora a motorului pana cand acest pachet nu este stabilizat.

---

# Pachet 2 - Termen mediu

## Obiectiv

Administrare operationala completa, cresterea acoperirii multi-source si imbunatatirea calitatii matchingului.

Dupa stabilizarea executiei, investitia principala trebuie sa fie in surse mai bune, orchestrare reala si calitatea rezultatelor.

## A. Administrare operationala

| Issue | Scope in pachet |
|---|---|
| #77 | Administrare completa, Overview, Actualizare date, automatizare configurabila |
| #39 | Integrare Loguri sub Administrare |
| #40 | CRUD complet pentru registrul Surse |
| #76 | Categorii controlate pentru surse |
| #25 | Versionare contract `sources.json` si contracte asociate |
| #26 | Cleanup Source Registry si eliminare metadata legacy |

Functionalitati tinta:

- pagina `Administrare`;
- Overview operational;
- `Ruleaza acum`;
- Automation ON/OFF;
- interval configurabil;
- `next_run_at`;
- scheduler lightweight separat de full search;
- aprobare si validare surse;
- management categorii surse;
- loguri operationale integrate.

## B. Motor multi-source

| Issue | Scope in pachet |
|---|---|
| #3 | Orchestrare normalizata a connectorilor |
| #49 | Revalidare si reformulare dupa modificarile recente |
| #56 | API-uri publice si ATS boards pentru sursele aprobate |
| #60 | Connector Workday public CXS |
| #4 | Deduplicare robusta, inclusiv cross-provider |

Model tinta:

```text
Source Registry
    -> active + approved + connector available
    -> connector routing
    -> collect
    -> normalize
    -> deduplicate
    -> filters
    -> score
    -> publish
```

JobsPipe ramane separat si poate fi reevaluat ulterior; nu este necesar pentru implementarea acestui pachet.

## C. Matching si UX

| Issue | Scope in pachet |
|---|---|
| #75 | Recalibrare algoritm FIT |
| #74 | ATS Match Score v1, track paralel |
| #34 | KPI-uri interactive ca filtre locale |
| #9 | Consolidare versionare si release management |

FIT trebuie recalibrat inainte de a fi tratat ca indicator de relevanta de incredere. ATS Match ramane separat de FIT si poate evolua in paralel dupa stabilizarea surselor.

## Rezultat asteptat

- sursele pot fi administrate si aprobate din UI;
- automatizarea poate fi controlata din aplicatie;
- full search ruleaza numai cand este cerut manual sau de scheduler-ul configurat;
- Source Registry controleaza sursele executabile;
- connectorii functioneaza independent si sunt izolati la eroare;
- deduplicarea multi-source este verificabila;
- FIT devine mai discriminant si mai util;
- functionalitatile locale de UI nu genereaza requesturi provider inutile.

## Efort estimat

- 70-110 ore
- echivalent extern la 50 EUR/h: 3.500-5.500 EUR

## Prioritate

P1-P2.

Se recomanda livrare incrementala in mai multe release-uri, nu un singur release mare.

---

# Pachet 3 - Termen lung

## Obiectiv

Productizare, multi-user, persistenta avansata si functionalitati care necesita o schimbare arhitecturala mai ampla.

Aceste functionalitati sunt valide, dar nu aduc suficienta valoare pentru a justifica implementarea inainte ca varianta single-user sa fie stabila si utila.

## Scope recomandat

| Issue | Motiv pentru amanare |
|---|---|
| #44 | Multi-user modifica semnificativ arhitectura si persistenta |
| #45 | Depinde de modelul multi-user din #44 |
| #2 | Persistenta SQLite nu este necesara in MVP-ul curent |
| #15 | Documentele private necesita storage dedicat si politici de securitate |
| #27 | Arhivarea poate ramane locala pentru moment |
| #18 | Stari multi-device suplimentare devin importante odata cu multi-user |
| #77 | Nomenclatoare generice complete pot fi introduse incremental ulterior |

## Decizie arhitecturala necesara ulterior

Issue #2 indica SQLite pentru persistenta single-user cu stare tranzactionala, iar #44 propune Cloudflare D1 pentru multi-user.

Nu se recomanda implementarea ambelor in paralel. Cand acest pachet devine activ trebuie aleasa o singura directie de persistenta, in functie de arhitectura produsului la acel moment.

## Rezultat asteptat

- autentificare multi-user;
- workspace separat per utilizator;
- audit operational extins;
- stocare privata pentru documente;
- persistenta multi-device;
- administrare utilizatori;
- nomenclatoare generale mature;
- baza pentru productizare.

## Efort estimat

- 100-180+ ore
- echivalent extern la 50 EUR/h: 5.000-9.000+ EUR

## Prioritate

P3 / strategic.

Acest pachet ramane blocat pana cand primele doua pachete sunt suficient de stabile si exista nevoie reala de productizare/multi-user.

---

# Backlog cleanup necesar

Mai multe issues contin decizii care trebuie actualizate inainte de implementare literala:

| Issue | Actualizare necesara |
|---|---|
| #18 | Elimina regula conform careia salvarea configuratiei declanseaza full search |
| #19 | Elimina aceeasi regula veche din Command API flow |
| #24 | Comportamentul `save config -> run` nu mai este criteriu de succes |
| #28 | Documentatia JobsPipe/Apify trebuie aliniata cu decizia curenta de a pastra JobsPipe dezactivat |
| #49 | Trebuie reverificat dupa noile modificari de crawler/connector routing |
| #39 | Trigger-ul `config` pentru full search trebuie eliminat; tinta este `manual-ui` sau `scheduled` |
| #76 / #77 | #76 ramane MVP pentru taxonomie; managementul complet al categoriilor intra ulterior prin #77 |

Scopul cleanup-ului este reducerea rework-ului si evitarea implementarii unor criterii care nu mai reprezinta decizia curenta a proiectului.

---

# Ordine recomandata

```text
TERMEN SCURT
Stabilitate + filtre + manual run + observabilitate
        |
        v
TERMEN MEDIU
Administrare + surse + connectori + FIT/ATS
        |
        v
TERMEN LUNG
Multi-user + persistenta + documente + productizare
```

---

# Sinteza cost / valoare

| Pachet | Efort | Valoare imediata | Risc |
|---|---:|---|---|
| Termen scurt | 25-40 h | Foarte mare | Mic-mediu |
| Termen mediu | 70-110 h | Foarte mare | Mediu |
| Termen lung | 100-180+ h | Redusa acum / mare ulterior | Mare |

## Decizie recomandata

1. Se concentreaza efortul imediat pe Pachetul 1.
2. Pachetul 2 incepe cu administrarea operationala si calitatea surselor.
3. Pachetul 3 ramane amanat pana cand aplicatia single-user este stabila si exista un motiv concret pentru multi-user/persistenta avansata.
4. Functionalitatile care nu necesita LLM/API platit sunt preferate atunci cand valoarea functionala este comparabila.
5. Orice schimbare de configuratie trebuie separata conceptual si tehnic de executia full search.
