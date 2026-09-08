# Package 1 - Implementation Status

Data: 2026-09-08
Issue coordonator: #79
Roadmap: `docs/solution-roadmap.md`
Plan: `docs/package-1-implementation-plan.md`

## Implementat pe branch

- full search numai prin `workflow_dispatch`;
- eliminate trigger-ele `push` si `schedule` din workflow-ul greu;
- trigger canonic `manual-ui`;
- separare `PUT /config` de `POST /commands/run`;
- `Ruleaza verificarea` trimite criteriile curente din UI;
- target geografic gol este respins server-side si in runner;
- restaurat targetul canonic `RO`, `BE`, `LU`;
- regression test pentru job Hybrid in JP in afara targetului;
- geografie necunoscuta non-Remote nu este presupusa eligibila;
- trigger-ul este persistat in `run-status.json` si `run-history.json`;
- teste unitare Command API pentru geografie;
- teste negative pentru protected data fara bearer si origin nepermis;
- CI verifica explicit ca full search ramane manual-only;
- UI afiseaza deja tara in liste si detalii si foloseste logurile/counterele existente;
- `ARCHITECTURE.md` actualizat la v1.4; v1.3 arhivat conform guvernantei;
- `CHANGELOG.md` actualizat in `[Unreleased]`.

## Validare finalizata in PR

- GitHub CI complet green pe head-ul Pachetului 1;
- 105 teste Python green;
- teste Command API Node green;
- React/Vite production build green;
- Cloudflare Worker `wrangler deploy --dry-run` green;
- guard CI confirma ca full search nu are `push` sau `schedule`.

## Blocker extern de release

Issue #81: `Workers Builds: job-search-command-api` din Cloudflare Git integration este red.

Bisection:
- `a9ed0c0` -> Cloudflare SUCCESS;
- `09b73c2` -> Cloudflare FAILURE;
- diferenta dintre cele doua commit-uri este exclusiv `docs/package-1-implementation-plan.md`.

Prin urmare, nu exista in acest moment dovada ca esecul Cloudflare este produs de codul Pachetului 1. Este necesar logul Cloudflare Build Details pentru cauza concreta.

## De validat in release

- rezolvare #81 si Cloudflare Workers Build green;
- revalidare #33 pentru publish concurent;
- deploy Cloudflare dupa merge;
- `/health` live pentru #17;
- E2E #24: `Save -> 0 run`, `Run -> exact 1 run`;
- confirmare log `trigger=manual-ui`;
- confirmare live ca joburile non-target nu mai apar dupa urmatoarea rulare manuala.

## Guard operational

Nu se ruleaza full search pentru validari intermediare. O singura rulare live este permisa numai la E2E final si trebuie pornita explicit.
