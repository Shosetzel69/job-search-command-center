# Package 1 - Review Notes

## Focus review

1. `job-search-full.yml` trebuie sa ramana manual-only.
2. `PUT /config` nu trebuie sa aiba side effect de dispatch.
3. `POST /commands/run` trebuie sa blocheze concurenta inainte de persistare/dispatch.
4. Configuratia geografica efectiva trebuie validata dupa aplicarea patch-ului, nu doar payload-ul partial.
5. Runner-ul trebuie sa excluda Hybrid/Onsite in afara targetului si sa nu accepte geografie necunoscuta ca eligibila.
6. `RUN_TRIGGER` trebuie sa aiba precedenta fata de `GITHUB_EVENT_NAME` in log.
7. JobsPipe trebuie sa ramana dezactivat.
8. CI nu trebuie sa execute crawling live.

## Riscuri urmarite

- reintroducerea accidentala a trigger-ului `push`;
- interpretarea listelor tinta goale ca worldwide;
- persistarea configuratiei invalide;
- dublu dispatch la click repetat;
- log cu trigger brut `workflow_dispatch` in loc de `manual-ui`;
- regresie React din modificarea butonului `Ruleaza verificarea`.
