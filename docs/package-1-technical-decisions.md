# Package 1 - Technical Decisions

## TD-01 Full search manual-only

In Package 1, `.github/workflows/job-search-full.yml` accepta numai `workflow_dispatch`.

Motiv: salvarea configuratiei, commit-urile si cron-ul nu trebuie sa produca rulari grele necerute.

## TD-02 Save si Run sunt separate

`PUT /config` persista configuratia si se opreste.

`POST /commands/run` valideaza criteriile curente, le persista daca este necesar si lanseaza exact un workflow cu `run_trigger=manual-ui`.

## TD-03 Geografie fail-safe

O cautare trebuie sa aiba cel putin o tara sau regiune tinta. Listele tinta goale nu inseamna `Worldwide`.

`Worldwide` ramane un atribut al unui job Remote, nu o valoare implicita produsa de configuratie absenta.

## TD-04 Unknown non-Remote fail closed

Pentru Hybrid/Onsite, o geografie necunoscuta nu este presupusa eligibila intr-o cautare geografica targetata.

## TD-05 Scheduler amanat

`scheduled` este pastrat ca valoare de contract pentru compatibilitate viitoare, dar automatizarea este OFF si nu exista schedule activ in Package 1.

## TD-06 Cost control

CI foloseste teste unitare/integration fara crawling live. Full search live este rezervat validarii E2E finale si trebuie pornit explicit.
