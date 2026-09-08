# Package 1 - Release Checklist

Issue: #79

## CI

- [ ] Python syntax valid
- [ ] search config valid
- [ ] geography regression tests green
- [ ] Command API unit tests green
- [ ] negative security tests green
- [ ] React/Vite build green
- [ ] Worker dry-run green
- [ ] full search manual-only guard green

## Review

- [ ] JobsPipe ramane `disabled`
- [ ] full search nu contine `push`
- [ ] full search nu contine `schedule`
- [ ] `PUT /config` nu face dispatch
- [ ] `POST /commands/run` face maximum un dispatch
- [ ] run concurent este blocat 409
- [ ] target geografic gol este respins
- [ ] target implicit restaurat RO/BE/LU
- [ ] cazul Hybrid JP este exclus
- [ ] log trigger foloseste `manual-ui`
- [ ] nu exista fisiere temporare de patch

## Dupa merge

- [ ] push-ul de merge nu porneste `Full job search`
- [ ] Cloudflare deploy reusit
- [ ] `/health` reusit
- [ ] salvare criterii din UI produce 0 full-search runs
- [ ] rulare manuala din UI produce exact 1 full-search run
- [ ] logul rularii arata `manual-ui`
- [ ] datele sunt reincarcate dupa finalizare
- [ ] filtrarea geografica live este coerenta cu targetul ales

## Regula cost

Nu se executa rulari live suplimentare pentru testare exploratorie. Rularea E2E finala este unica si explicita.
