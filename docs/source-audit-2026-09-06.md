# Raport complet surse - remediere #56

Data audit: `2026-09-06`
Rulare de referinta: `github-20260906T155445Z`
Total catalog: **130 surse**

Acest document pastreaza categoriile observate in rularea de referinta. Ele nu reprezinta starea live dupa implementare. Starea noua se confirma numai printr-o rulare E2E dupa merge.

Legenda:

- `API` - adapter public dedicat implementat;
- `ATS` - job board concret rutat prin API ATS public;
- `WEB` - ramane pe collectorul HTTP/JSON-LD + browser fallback permis;
- `DEFERRED` - radacina generica nu este tratata drept feed global;
- `RESTRICTED` - exista restrictie de acces/parteneriat care impiedica integrarea publica;
- `FIXED BEFORE #56` - URL-ul din catalog fusese deja corectat dupa rularea de referinta;
- `UNCHANGED` - #56 nu schimba ruta.

## 1. Colectare partiala - 14

| # | Sursa | Dupa #56 | Link/ruta modificata |
|---:|---|---|---|
| 1 | eJobs | WEB / UNCHANGED | — |
| 2 | Hipo | WEB / UNCHANGED | — |
| 3 | NoDesk | WEB / UNCHANGED | — |
| 4 | Flexa | WEB / UNCHANGED | — |
| 5 | No Fluff Jobs | WEB / UNCHANGED | — |
| 6 | Just Join IT | WEB / UNCHANGED | — |
| 7 | JustRemote | WEB / UNCHANGED | — |
| 8 | Techjobs.be | WEB / UNCHANGED | — |
| 9 | Sopra Steria | WEB / UNCHANGED | — |
| 10 | Luxoft | WEB / UNCHANGED | — |
| 11 | Computacenter | WEB / UNCHANGED | — |
| 12 | Stripe | WEB / UNCHANGED | — |
| 13 | RED Global | WEB / UNCHANGED | — |
| 14 | Lawrence Harvey | WEB / UNCHANGED | — |

## 2. Acces blocat - 39

| # | Sursa | Dupa #56 | Link/ruta modificata |
|---:|---|---|---|
| 1 | LinkedIn Jobs | DEFERRED | —; JobsPipe ramane dezactivat |
| 2 | Indeed | DEFERRED | —; nu se folosesc carduri Indeed |
| 3 | eFinancialCareers | WEB / UNCHANGED | — |
| 4 | Jobgether | **API** | operational: <https://jobgether.com/api/v1/jobs> |
| 5 | Himalayas | **API** | operational: <https://himalayas.app/jobs/api/search> |
| 6 | We Work Remotely | RESTRICTED / WEB neschimbat | API-ul oficial necesita acces/token de partener; nu este activat |
| 7 | Remote in Europe | WEB / UNCHANGED | — |
| 8 | Landing.Jobs | WEB / UNCHANGED | — |
| 9 | Wellfound | WEB / UNCHANGED | —; fara bypass bot challenge |
| 10 | awork.ro | WEB / UNCHANGED | — |
| 11 | Jobspresso | WEB / UNCHANGED | — |
| 12 | DailyRemote | WEB / UNCHANGED | — |
| 13 | Welcome to the Jungle | WEB / UNCHANGED | — |
| 14 | Glassdoor Jobs | RESTRICTED | —; API de partener neactivat |
| 15 | SkipTheDrive | WEB / UNCHANGED | — |
| 16 | RemoteHunt | WEB / UNCHANGED | — |
| 17 | Malt | WEB / UNCHANGED | — |
| 18 | Toptal | WEB / UNCHANGED | — |
| 19 | Upwork | RESTRICTED | —; API oficial necesita aprobare/credentiale |
| 20 | Arc.dev | WEB / UNCHANGED | — |
| 21 | PeoplePerHour | WEB / UNCHANGED | — |
| 22 | Hubstaff Talent | WEB / UNCHANGED | —; fara bypass bot challenge |
| 23 | European Dynamics | WEB / UNCHANGED | — |
| 24 | Worldline | WEB / UNCHANGED | — |
| 25 | Vodafone / VOIS | WEB / UNCHANGED | —; fara bypass bot challenge |
| 26 | SoftServe | WEB / UNCHANGED | — |
| 27 | EPAM | WEB / UNCHANGED | — |
| 28 | Eviden | WEB / UNCHANGED | — |
| 29 | Endava | **ATS SmartRecruiters** | catalog ramane <https://careers.endava.com/>; operational: <https://careers.smartrecruiters.com/Endava> |
| 30 | Accenture | WEB / UNCHANGED | — |
| 31 | Bosch Romania | **ATS SmartRecruiters** | catalog ramane <https://www.bosch.ro/cariere/>; operational: <https://careers.smartrecruiters.com/RobertBosch> |
| 32 | Fortive | WEB / UNCHANGED | — |
| 33 | Workable | DEFERRED | radacina generica <https://jobs.workable.com/> nu este feed global |
| 34 | SmartRecruiters | DEFERRED | radacina generica ramane amanata; numai board-uri concrete folosesc API |
| 35 | Salt | WEB / UNCHANGED | — |
| 36 | Next Ventures | WEB / UNCHANGED | — |
| 37 | Proactive.IT | WEB / UNCHANGED | — |
| 38 | KEYES / NRB | **WEB route nou** | catalog ramane <https://www.nrb.be/careers>; operational: <https://nrbcareers.com/find-my-job> |
| 39 | Fujitsu Belgium | WEB / UNCHANGED | — |

## 3. Pagini accesibile, fara joburi extractibile - 50

| # | Sursa | Dupa #56 | Link/ruta modificata |
|---:|---|---|---|
| 1 | EURES | **RESTRICTED** | fara API/scraping automat in lipsa statutului EURES Partner |
| 2 | EU Careers / EPSO | WEB / UNCHANGED | — |
| 3 | EuroBrussels | WEB / UNCHANGED | — |
| 4 | Working Nomads | **API** | operational: <https://www.workingnomads.com/api/exposed_jobs/> |
| 5 | Remote OK | **API** | operational: <https://remoteok.com/api> |
| 6 | Remotive | **API** | operational: <https://remotive.com/api/remote-jobs>; cooldown 6h, feed public intarziat |
| 7 | PowerToFly | WEB / UNCHANGED | — |
| 8 | Monster | WEB / UNCHANGED | —; zonele non-job raman excluse |
| 9 | Freelancermap | WEB / UNCHANGED | — |
| 10 | Crossover | WEB / UNCHANGED | — |
| 11 | Freelancer.com | WEB / UNCHANGED | API oficial necesita autentificare; nu este activat |
| 12 | Vector Synergy | WEB / UNCHANGED | — |
| 13 | NATO Careers | WEB / UNCHANGED | —; fara bypass robots |
| 14 | Serco Europe | WEB / UNCHANGED | — |
| 15 | CGI | WEB / UNCHANGED | — |
| 16 | Netcompany / Intrasoft | **ATS SmartRecruiters** | operational: <https://careers.smartrecruiters.com/Netcompany1> |
| 17 | Thales | **ATS SmartRecruiters** | operational: <https://careers.smartrecruiters.com/Thales> |
| 18 | ING Careers | WEB / UNCHANGED | Workday public global nu este disponibil; fara endpoint intern nedocumentat |
| 19 | Deutsche Bank | WEB / UNCHANGED | Workday public global nu este disponibil; fara endpoint intern nedocumentat |
| 20 | Societe Generale | WEB / UNCHANGED | — |
| 21 | Allianz Careers | WEB / UNCHANGED | — |
| 22 | Airbus | WEB / UNCHANGED | — |
| 23 | GlobalLogic | **ATS SmartRecruiters** | operational: <https://careers.smartrecruiters.com/GlobalLogic4> |
| 24 | Mantu | WEB / UNCHANGED | — |
| 25 | NTT | WEB / UNCHANGED | — |
| 26 | NTT DATA Romania | WEB / UNCHANGED | — |
| 27 | DXC Technology | WEB / UNCHANGED | — |
| 28 | Atos | WEB / UNCHANGED | — |
| 29 | Orange Romania | WEB / UNCHANGED | — |
| 30 | Xebia CEE | **ATS Greenhouse** | operational: <https://job-boards.greenhouse.io/xebiacee> |
| 31 | Saphetor | WEB / UNCHANGED | — |
| 32 | Camunda | **ATS Ashby** | operational: <https://jobs.ashbyhq.com/camunda> |
| 33 | ClickHouse | **ATS Greenhouse** | operational: <https://job-boards.greenhouse.io/clickhouse> |
| 34 | GitHub | WEB / UNCHANGED | — |
| 35 | Snyk | **ATS Greenhouse** | operational: <https://job-boards.greenhouse.io/snyk> |
| 36 | Datadog | **ATS Greenhouse** | operational: <https://job-boards.greenhouse.io/datadog> |
| 37 | Kong | **ATS Ashby** | operational: <https://jobs.ashbyhq.com/kong> |
| 38 | LocalStack | **ATS Ashby** | operational: <https://jobs.ashbyhq.com/localstack> |
| 39 | Greenhouse | DEFERRED | radacina generica ramane amanata; board-urile concrete folosesc API |
| 40 | Lever | DEFERRED | adapter dedicat amanat din cauza datei de publicare neclare |
| 41 | Workday | DEFERRED | radacina generica nu este feed global public |
| 42 | Recruitee | WEB / UNCHANGED | API public tranzitoriu; token obligatoriu din 2027, neactivat in #56 |
| 43 | BambooHR | RESTRICTED / WEB neschimbat | API ATS necesita acces la tenant |
| 44 | Eightfold | WEB / UNCHANGED | — |
| 45 | Infoplus Technologies UK | WEB / UNCHANGED | — |
| 46 | Source Group International | WEB / UNCHANGED | — |
| 47 | Brains Consulting | WEB / UNCHANGED | — |
| 48 | Head Hunting IT | WEB / UNCHANGED | — |
| 49 | W Talent | WEB / UNCHANGED | — |
| 50 | ARHS / Accenture | **ATS SmartRecruiters** | operational: <https://careers.smartrecruiters.com/ARHS> |

## 4. Erori tehnice - 25

| # | Sursa | Dupa #56 | Link/ruta modificata |
|---:|---|---|---|
| 1 | Hays Romania | **FIXED BEFORE #56 / WEB** | audit: <https://www.hays.ro/en/jobs> -> catalog curent: <https://www.hays.ro/cauta-locuri-de-munca> |
| 2 | Remote.co | WEB / UNCHANGED | — |
| 3 | EU Remote Jobs | WEB / UNCHANGED | — |
| 4 | Dynamite Jobs | WEB / UNCHANGED | API oficial identificat, dar este pentru contul autentificat al clientului |
| 5 | Torre | RESTRICTED / WEB neschimbat | API de job search este private beta; neactivat |
| 6 | FlexJobs | WEB / UNCHANGED | — |
| 7 | Pangian | WEB / UNCHANGED | URL necesita reevaluare; fara ruta publica confirmata in #56 |
| 8 | Almaviva de Belgique | **FIXED BEFORE #56 / WEB** | audit: <https://www.almaviva.it/en_GB/Careers> -> catalog curent: <https://www.almaviva.it/en_GB/Work-with-us/Open-positions> |
| 9 | Cronos Europa | WEB / UNCHANGED | DNS/URL ramane de reevaluat |
| 10 | Worldpay / Global Payments | WEB / UNCHANGED | — |
| 11 | Cegeka | **FIXED BEFORE #56 / WEB** | audit: <https://www.cegeka.com/en/careers> -> catalog curent: <https://www.cegeka.com/en/ro/jobs/all-jobs> |
| 12 | HARMAN | WEB / UNCHANGED | problema TLS ramane la transport/runtime, nu la ruta publica |
| 13 | Prohuman | **FIXED BEFORE #56 / WEB** | audit: <https://www.prohuman.ro/jobs> -> catalog curent: <https://www.prohuman.ro/locuri-de-munca> |
| 14 | Contentsquare | **WEB route Lever** | catalog: <https://careers.contentsquare.com/>; operational: <https://jobs.lever.co/contentsquare/> |
| 15 | Storyblok | **FIXED BEFORE #56 / WEB** | audit: <https://www.storyblok.com/join-us> -> catalog curent: <https://www.storyblok.com/jobs> |
| 16 | Ashby | DEFERRED | radacina generica ramane amanata; board-urile concrete folosesc API Ashby |
| 17 | UpcoMinds | **FIXED BEFORE #56 / WEB** | audit: <https://upcominds.com/careers/> -> catalog curent: <https://www.jobs4it.gr/> |
| 18 | Avance Consulting | WEB / UNCHANGED | — |
| 19 | Hirexa Solutions | WEB / UNCHANGED | — |
| 20 | Infinity Quest | **ATS SmartRecruiters** | catalog ramane <https://www.i-q.net/>; operational: <https://careers.smartrecruiters.com/InfinityQuest> |
| 21 | Square One Resources | WEB / UNCHANGED | catalog curent: <https://www.squareoneresources.com/jobs/> |
| 22 | Montreal Associates | WEB / UNCHANGED | URL necesita reevaluare; fara ruta publica confirmata in #56 |
| 23 | Trasys International | **WEB route NRB Careers** | catalog legacy: <https://careers.nrb.be/>; operational: <https://nrbcareers.com/find-my-job> |
| 24 | Thaleria | **FIXED BEFORE #56 / WEB** | audit: <https://www.thaleria.com/careers> -> catalog curent: <https://www.thaleria.com/careers/open-positions> |
| 25 | Talan Belgium / Luxembourg | **ATS SmartRecruiters** | audit: <https://www.talan.com/global/en/careers/>; catalog curent: <https://www.talan.com/global/en/join-us/our-job-offers>; operational: <https://careers.smartrecruiters.com/Talan> |

## 5. Surse cu conector API in rularea de referinta - 2

| # | Sursa | Dupa #56 | Link/ruta modificata |
|---:|---|---|---|
| 1 | Jobicy | API existent | <https://jobicy.com/api/v2/remote-jobs?count=200> |
| 2 | JobsPipe | DEFERRED/DISABLED | <https://jobspipe.dev/>; `jobspipe_mode=disabled` ramane neschimbat |

## 6. Rezumat modificari #56

### API-uri publice noi

1. Jobgether
2. Himalayas
3. Working Nomads
4. Remote OK
5. Remotive

### Board-uri SmartRecruiters rutate

1. Netcompany / Intrasoft
2. Thales
3. GlobalLogic
4. Endava
5. Bosch Romania
6. Infinity Quest
7. Talan Belgium / Luxembourg
8. ARHS / Accenture

### Board-uri Greenhouse rutate

1. Xebia CEE
2. ClickHouse
3. Snyk
4. Datadog

### Board-uri Ashby rutate

1. Camunda
2. Kong
3. LocalStack

### Rute web corectate operational

1. Contentsquare -> Lever public board
2. KEYES / NRB -> NRB Careers
3. Trasys International -> NRB Careers

### URL-uri din catalog deja corectate intre audit si #56

1. Hays Romania
2. Almaviva de Belgique
3. Cegeka
4. Prohuman
5. Storyblok
6. UpcoMinds
7. Thaleria
8. Talan Belgium / Luxembourg

## 7. Ce NU face #56

- nu activeaza JobsPipe;
- nu ocoleste robots, CAPTCHA, login sau blocaje HTTP;
- nu foloseste API LinkedIn/Indeed drept job-search public;
- nu automatizeaza EURES fara autorizare EURES Partner;
- nu foloseste endpointuri interne Workday sau alte endpointuri nedocumentate;
- nu adauga Lever API dedicat fara o data de publicare fiabila;
- nu declara sursele `UNCHANGED` ca reparate; starea lor reala ramane de masurat in urmatoarea rulare.

## 8. Verificare dupa merge

Urmatoarea rulare trebuie comparata cu baseline-ul:

```text
14 partial
39 blocked
50 no_extractable_jobs
25 technical errors
2 API connector entries
```

Tinta #56 nu este zero erori pentru toate cele 130. Tinta este eliminarea erorilor care provin din alegerea metodei gresite de colectare si raportarea corecta a surselor care raman restrictionate, deferred sau web-only.
