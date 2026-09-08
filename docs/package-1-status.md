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
- UI afiseaza deja tara in liste si detalii si foloseste logurile/counterele existente.

## De validat in PR / release

- CI complet Python + Node + React/Vite + Worker;
- review diff;
- revalidare #33 pentru publish concurent;
- deploy Cloudflare dupa merge;
- `/health` live pentru #17;
- E2E #24: `Save -> 0 run`, `Run -> exact 1 run`;
- confirmare log `trigger=manual-ui`;
- confirmare live ca joburile non-target nu mai apar dupa urmatoarea rulare manuala.

## Guard operational

Nu se ruleaza full search pentru validari intermediare. O singura rulare live este permisa numai la E2E final si trebuie pornita explicit.
