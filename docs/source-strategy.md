# Strategia surselor

Actualizare: 2026-09-05

## 1. Principiu

Strategia tinta este:

`all active sources equally`

Nu exista prioritate operationala 1-5 intre sursele conectate.

Campul `priority` ramas in unele intrari din `data/sources.json` este legacy si nu trebuie folosit pentru ordinea de colectare.

## 2. Categorii catalog

Catalogul include:

- job boards si agregatoare;
- site-uri de cariere;
- ATS publice;
- platforme remote;
- contract/B2B/freelance;
- agentii si consultanta IT;
- contractori UE si NATO;
- banking si enterprise;
- software si servicii IT.

## 3. Diferenta catalog vs connector

`data/sources.json` este catalogul vizibil in UI.

Prezenta unei surse in catalog NU inseamna ca motorul are connector operational pentru ea.

Stare curenta:

- aproximativ 129 intrari in catalog;
- connector operational implementat: JobsPipe;
- JobsPipe este momentan dezactivat prin `jobspipe_enabled=false`;
- toggle-urile individuale din pagina `Surse` sunt locale si nu controleaza inca motorul.

## 4. Reguli pentru sursele conectate

- se folosesc date publice de joburi sau API-uri autorizate;
- se prefera link direct la job;
- descrierea pozitiei se pastreaza cand providerul o furnizeaza;
- repostarile sunt marcate, nu ascunse automat;
- joburile sunt normalizate in contractul intern comun;
- o sursa nu primeste avantaj de scoring doar pentru ca provine dintr-un provider preferat;
- geo-eligibility este separata de FIT.

## 5. JobsPipe

Cand este activ:

- preview gratuit inaintea colectarii cu consum;
- polling incremental `discovered_at_gte`;
- separare geografica pentru reducerea suprapunerii;
- cursor pentru backlog;
- buget curent 14 credite/rulare;
- guard local lunar 950;
- circuit breaker la quota exhausted.

In perioada de stabilizare:

`jobspipe_enabled=false`

Prin urmare rularile nu trebuie sa consume credite JobsPipe.

## 6. Excluderi

Excluderi functionale curente in configuratia canonica:

- Star Storage si companiile grupului;
- implementari ERP care cer experienta specializata ampla;
- roluri non-IT.

Reguli de produs stabilite suplimentar:

- Monster nu trebuie folosit ca sursa operationala;
- cardurile generate de integrarea Indeed nu sunt folosite; un link Indeed poate ramane link de job daca acesta este linkul disponibil.

## 7. Gap-uri cunoscute

- `data/sources.json` contine inca metadate legacy `priority`;
- catalogul poate contine surse care nu respecta inca toate excluderile operationale, inclusiv Monster;
- activ/inactiv per sursa nu este persistat server-side;
- nu exista inca orchestrare multi-provider reala;
- deduplicarea cross-provider devine relevanta dupa conectarea mai multor provideri.

## 8. Regula pentru extindere

Fiecare provider nou se adauga printr-un connector care produce modelul intern standard. Logica de scoring nu trebuie duplicata in connector.
