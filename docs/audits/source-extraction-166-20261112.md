# JSCC — Raport operațional: surse ACTIVATE și FUNCȚIONALE în DEV

**Actualizare:** 12 noiembrie 2026  
**Catalog analizat:** `main@567c4246f8c9621f2df727e066b9e95f4ed7d449`, 166 ID-uri distincte  
**Mediu verificat:** JSCC DEV; datele din Git și accesibilitatea unui URL sunt exclusiv informații auxiliare.

## Definiția obligatorie: ACTIVĂ = funcțională, cu rezultate viabile persistate

O sursă se raportează **ACTIVĂ CONFIRMATĂ** numai după verificarea cumulativă a următoarelor probe pentru aceeași identitate de sursă:

1. **Configurare operațională în DEV:** `active=true` în registrul ADMIN efectiv (GCS versionat), aprobată și fără interdicții. Indicatorul din `data/sources.json` nu este suficient.
2. **Retrieve real în DEV:** sursa este executată de jobul canonic `jscc-search-dev`, cu outcome și `run_id` verificabile.
3. **Joburi viabile:** minimum un job real, actual, nu pagină generică/cookie banner/repostare expirată; conține cel puțin titlu, angajator, URL direct valid, descriere utilă și proveniența sursei. Valorile lipsă nu se inventează.
4. **Persistență verificată în Nile:** existența jobului canonic cu ID stabil, sursă, plus corelare credibilă cu rularea recentă; un contor `published_jobs` agregat nu dovedește un job al acestei surse.
5. **Vizibilitate în aplicația DEV:** același job există în `/me/jobs` sau în interfața JSCC, iar detaliile sunt utilizabile. O înregistrare istorică, necorelată cu colectarea curentă, nu e suficientă.

**Regulă de raportare:** pentru fiecare sursă, dacă măcar una dintre probe lipsește, verdictul este **NECONFIRMATĂ**, niciodată ACTIVĂ. *NECONFIRMATĂ* nu înseamnă demonstrat inactivă. Pentru o dezactivare explicită, verdictul este **NU — restricție explicită**, fără a încerca activarea.

## Dovezi disponibile și limite

**Rulare reală:** `run-852fd378-e22b-4fed-aa44-b2de5619584c`, 11 noiembrie 2026, `main@567c424...`, DEV. Sunt raportate 135 surse evaluate, 99 `success`, 9 `success_empty`, 26 erori, 1 blocaj; 6.600 înregistrări colectate, 6.490 excluse, 110 joburi publicate. Cifrele de outcome se referă la colectare, **nu** la 99 surse active confirmate.

**Persistența este demonstrată la nivel de sistem:** revizia E2E #520, comentariul [6808976088](https://github.com/Shosetzel69/job-search-command-center/issues/520#issuecomment-6808976088), a verificat statusul în Nile, accesul `/me/jobs` și conexiunea cu jobul Cloud Run. Totuși, acestea nu echivalează cu 166 de verificări de conținut, sursă și persistență.

**Dovadă individuală parțială:** pentru **Worldpay / Global Payments**, evaluatorul a identificat patru joburi ale acestei surse în `/me/jobs`, cu înregistrări Nile. Corelarea la rularea indicată este inferată din istoricul limitat la 10 rulări, iar calitatea câmpurilor/URL-urilor nu a fost auditată individual. Prin urmare, nici această sursă nu primește încă verdictul strict ACTIVĂ CONFIRMATĂ.

**Situația verificabilă a celor 166 de surse:** **0 cu toate cele 5 probe documentate complet**, **1 cu dovadă individuală parțială de stocare și afișare**, restul fără dovada completă. Aceasta descrie gradul de **certificare**, nu numărul real de surse care ar putea funcționa.

**Probe tehnice efectuate:** 166 verificări de URL/rută principală, verificări suplimentare pentru 165 surse și 441 de verificări auxiliare. Nu le folosim pentru a afirma că o sursă este activă.

**Restricție de acces:** fără sesiune ADMIN autentificată, `/sources` răspunde HTTP 401; nu am citit registrul operațional integral și nu am făcut nicio activare. Nu am rulat un nou Retrieve, nu am interogat independent fiecare job în Nile, nu am modificat TEST/PROD.

## Inventar individual complet, fără împărțire în categorii

Coloana **Flag Git** este păstrată numai pentru diagnostic. Coloana **ACTIVĂ în DEV?** este verdictul efectiv cerut, bazat pe toate cele cinci condiții.

| # | Sursă | Metodă existentă | Probă tehnică publică (NU dovadă de activare) | Flag Git | ACTIVĂ în DEV? | Dovadă operațională / lipsă |
|---:|---|---|---|---|---|---|
| 1 | LinkedIn Jobs (src-db8da20e) | deferred_provider | ROBOTS_BLOCK (HTTP ?) | True | **NU — restricție explicită** | Se respectă decizia; fără activare |
| 2 | Indeed (src-19586b7c) | deferred_provider | ACCESS_BLOCK (HTTP 403) | True | **NU — restricție explicită** | Se respectă decizia; fără activare |
| 3 | eJobs (src-151ed5ae) | public ejobs | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 4 | Hipo (src-a41721bd) | public hipo | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 5 | Jobicy (src-f9b6441c) | jobicy | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 6 | EURES (src-c2f412ff) | public eures | HTTP_NON_200 (HTTP 404) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 7 | EU Careers / EPSO (src-60eb92d7) | public eu_careers | HTTP_NON_200 (HTTP 404) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 8 | EuroBrussels (src-de6c7ccb) | public eurobrussels | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 9 | eFinancialCareers (src-01389b06) | public rendered_links | HTTP_NON_200 (HTTP 202) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 10 | Hays Romania (src-6d75d5ec) | public linked_jobs | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 11 | Jobgether (src-c449712a) | public jobgether | PUBLIC_JSON (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 12 | Himalayas (src-eaa0bf03) | public himalayas | PUBLIC_JSON (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 13 | Working Nomads (src-c5c33d14) | public workingnomads | PUBLIC_JSON (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 14 | Remote OK (src-711652ce) | public remoteok | JSON_PARSE_UNVERIFIED (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 15 | We Work Remotely (src-33faa076) | public rss | PUBLIC_XML (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 16 | Remote.co (src-6f69f067) | public rendered_heading_list | ACCESS_BLOCK (HTTP 403) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 17 | NoDesk (src-8dc57863) | public rss | PUBLIC_XML (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 18 | EU Remote Jobs (src-b428d48a) | public eu_remote | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 19 | Remote in Europe (src-5c60a3ef) | public rss | HTTP_NON_200 (HTTP 404) | False | **NU — restricție explicită** | Se respectă decizia; fără activare |
| 20 | Landing.Jobs (src-5b267066) | public landingjobs | ROBOTS_BLOCK (HTTP ?) | False | **NECONFIRMATĂ** | Validare/aprobare tehnică lipsă; date persistate neverificate |
| 21 | Wellfound (src-19fdc576) | public linked_jobs | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 22 | Flexa (src-98e6fa9a) | public heading_list | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 23 | No Fluff Jobs (src-418d4402) | public linked_jobs | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 24 | Just Join IT (src-08e07524) | public linked_jobs | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 25 | awork.ro (src-29c7e716) | public awork | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 26 | Remotive (src-22e89880) | public remotive | observed JSON items: 13 | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 27 | JustRemote (src-95b41cd3) | public heading_list | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 28 | Jobspresso (src-bc23a227) | public rss | PUBLIC_XML (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 29 | DailyRemote (src-847cc7fb) | public dailyremote | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 30 | PowerToFly (src-051631b2) | public rendered_links | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 31 | Dynamite Jobs (src-27876fc7) | public heading_list | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 32 | Torre (src-e2c72147) | public rendered_links | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 33 | Welcome to the Jungle (src-37fe892c) | public rendered_links | HTML_NO_JOB_MARKERS (HTTP 200) | False | **NU — restricție explicită** | Se respectă decizia; fără activare |
| 34 | Techjobs.be (src-de78b466) | public heading_list | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 35 | FlexJobs (src-5ba28ea2) | public rendered_heading_list | ACCESS_BLOCK (HTTP 403) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 36 | Glassdoor Jobs (src-b9e381e5) | web | ACCESS_BLOCK (HTTP 403) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 37 | Monster (src-362eebc4) | web | HTML_JOB_MARKERS (HTTP 200) | True | **NU — restricție explicită** | Se respectă decizia; fără activare |
| 38 | Pangian (src-20bba196) | public pangian_rss | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 39 | SkipTheDrive (src-7abce359) | public linked_jobs | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 40 | RemoteHunt (src-a83077eb) | web | HTML_JOB_MARKERS (HTTP 200) | False | **NU — restricție explicită** | Se respectă decizia; fără activare |
| 41 | Freelancermap (src-6351e67a) | public linked_jobs | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 42 | Malt (src-b1f34459) | web | ACCESS_BLOCK (HTTP 403) | False | **NU — restricție explicită** | Se respectă decizia; fără activare |
| 43 | Toptal (src-d7caf4d7) | ATS lever | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 44 | Crossover (src-b87e0b6b) | public heading_list | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 45 | Upwork (src-05d0980c) | public linked_jobs | ACCESS_BLOCK (HTTP 403) | False | **NECONFIRMATĂ** | Validare/aprobare tehnică lipsă; date persistate neverificate |
| 46 | Arc.dev (src-633a9d75) | public arc | HTML_JOB_MARKERS (HTTP 200) | False | **NU — restricție explicită** | Se respectă decizia; fără activare |
| 47 | PeoplePerHour (src-cd888ac5) | public linked_jobs | HTTP_NON_200 (HTTP 202) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 48 | Freelancer.com (src-198c2c6d) | public freelancer_api | JSON_PARSE_UNVERIFIED (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 49 | Hubstaff Talent (src-5da9090f) | public rendered_links | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 50 | Altia (src-063f4045) | public bizneo | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 51 | European Dynamics (src-30f49eb9) | ATS workable | observed JSON items: 190 | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 52 | Almaviva de Belgique (src-130c8619) | ATS recruitee | observed JSON items: 4 | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 53 | Vector Synergy (src-43f89b7e) | public rendered_heading_list | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 54 | NATO Careers (src-0ed4ecb9) | public nato_taleo | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 55 | Cronos Europa (src-f8ab232c) | ATS breezyhr | NETWORK_ERROR (HTTP ?) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 56 | Serco Europe (src-35952461) | public rendered_links | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 57 | CGI (src-66c9abf9) | web | NETWORK_ERROR (HTTP ?) | False | **NU — restricție explicită** | Se respectă decizia; fără activare |
| 58 | Sopra Steria (src-f6ec92c2) | ATS smartrecruiters | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 59 | Netcompany / Intrasoft (src-81c52270) | ATS smartrecruiters | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 60 | Thales (src-4f115b25) | ATS workday | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 61 | ING Careers (src-cd35311d) | ATS workday | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 62 | Deutsche Bank (src-db53eef5) | ATS workday | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 63 | Societe Generale (src-b5d2ea7a) | public socgen | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 64 | Allianz Careers (src-2d0a1ece) | ATS phenom | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NU — restricție explicită** | Se respectă decizia; fără activare |
| 65 | Worldline (src-81d05cc7) | public worldline | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 66 | Worldpay / Global Payments (src-9c62386c) | public rendered_links | ACCESS_BLOCK (HTTP 403) | True | **NECONFIRMATĂ integral** | 4 joburi atribuite sursei găsite în Nile și /me/jobs; viabilitate și legare exactă la run nevalidate |
| 67 | Vodafone / VOIS (src-c55d92f1) | ATS eightfold_public | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 68 | Airbus (src-13cf91f6) | ATS workday | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 69 | GlobalLogic (src-673ff124) | ATS smartrecruiters | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 70 | Luxoft (src-388b210e) | public linked_jobs | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 71 | Mantu (src-0d30c544) | public linked_jobs | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 72 | NTT (src-86b7291f) | ATS phenom | HTML_JOB_MARKERS (HTTP 200) | True | **NU — restricție explicită** | Se respectă decizia; fără activare |
| 73 | NTT DATA Romania (src-c92fb5b2) | ATS workday | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 74 | Cegeka (src-93fac926) | public linked_jobs | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 75 | Computacenter (src-97ae3205) | public linked_jobs | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 76 | SoftServe (src-ab8eef5d) | public softserve | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 77 | EPAM (src-1acffa09) | public epam | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 78 | Eviden (src-3f1d18c1) | public eviden | HTML_JOB_MARKERS (HTTP 200) | False | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 79 | DXC Technology (src-86c16192) | ATS workday | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 80 | HARMAN (src-80728c0f) | public rendered_links | NETWORK_ERROR (HTTP ?) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 81 | Endava (src-200ac72c) | ATS smartrecruiters | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 82 | Accenture (src-06a35de2) | ATS workday | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 83 | Atos (src-883880eb) | public atos | NETWORK_ERROR (HTTP ?) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 84 | Orange Romania (src-068757e6) | ATS softgarden | PUBLIC_JSON (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 85 | Bosch Romania (src-20cc8a94) | ATS smartrecruiters | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 86 | Xebia CEE (src-33dc53dd) | ATS greenhouse | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 87 | Prohuman (src-ffbd0efc) | public prohuman | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 88 | Fortive (src-880cb59e) | ATS eightfold | HTML_JOB_MARKERS (HTTP 200) | True | **NU — restricție explicită** | Se respectă decizia; fără activare |
| 89 | Saphetor (src-ca19ca22) | ATS bamboohr | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 90 | Camunda (src-e227c07e) | ATS ashby | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 91 | ClickHouse (src-45ded4bd) | ATS ashby | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 92 | GitHub (src-36303de5) | public linked_jobs | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 93 | Snyk (src-fa93d750) | ATS ashby | observed JSON items: 38 | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 94 | Datadog (src-f0431472) | ATS greenhouse | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 95 | Stripe (src-69b52ced) | public linked_jobs | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 96 | Kong (src-b0569593) | ATS ashby | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 97 | LocalStack (src-4e049a8b) | ATS ashby | observed JSON items: 10 | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 98 | Contentsquare (src-5e1bffb7) | ATS lever | NETWORK_ERROR (HTTP ?) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 99 | Storyblok (src-59fe329e) | ATS greenhouse | observed JSON items: 0 | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 100 | Ashby (src-b9c3e8da) | deferred_provider | HTTP_NON_200 (HTTP 404) | True | **NU — restricție explicită** | Se respectă decizia; fără activare |
| 101 | Workable (src-a4b24087) | deferred_provider | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NU — restricție explicită** | Se respectă decizia; fără activare |
| 102 | Greenhouse (src-cb17e9a4) | deferred_provider | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NU — restricție explicită** | Se respectă decizia; fără activare |
| 103 | Lever (src-9a1da502) | deferred_provider | HTML_JOB_MARKERS (HTTP 200) | True | **NU — restricție explicită** | Se respectă decizia; fără activare |
| 104 | Workday (src-a17e037a) | deferred_provider | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NU — restricție explicită** | Se respectă decizia; fără activare |
| 105 | SmartRecruiters (src-4366cf98) | deferred_provider | HTML_JOB_MARKERS (HTTP 200) | True | **NU — restricție explicită** | Se respectă decizia; fără activare |
| 106 | Recruitee (src-5b8df11a) | deferred_provider | HTML_JOB_MARKERS (HTTP 200) | False | **NU — restricție explicită** | Se respectă decizia; fără activare |
| 107 | BambooHR (src-c1f00061) | deferred_provider | HTML_NO_JOB_MARKERS (HTTP 200) | False | **NU — restricție explicită** | Se respectă decizia; fără activare |
| 108 | Eightfold (src-2671485b) | deferred_provider | HTML_NO_JOB_MARKERS (HTTP 200) | False | **NU — restricție explicită** | Se respectă decizia; fără activare |
| 109 | UpcoMinds (src-6dfcf5c6) | public jobs4it | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 110 | Infoplus Technologies UK (src-9adf56b2) | ATS smartrecruiters | NETWORK_ERROR (HTTP ?) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 111 | RED Global (src-022e1882) | public linked_jobs | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 112 | Salt (src-1b80f6e3) | public linked_jobs | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 113 | Avance Consulting (src-635a05cb) | ATS smartrecruiters | NETWORK_ERROR (HTTP ?) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 114 | Hirexa Solutions (src-9cdef20d) | public hirexa | NETWORK_ERROR (HTTP ?); alternate timeout | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 115 | Infinity Quest (src-07fe3d5c) | ATS smartrecruiters | HTTP_NON_200 (HTTP 445) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 116 | Square One Resources (src-ea3cff6e) | public squareone | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 117 | Source Group International (src-3827c764) | public linked_jobs | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 118 | Montreal Associates (src-45ccbce5) | public montreal_associates | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 119 | Brains Consulting (src-04910401) | public brains | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 120 | Head Hunting IT (src-68781255) | web | HTML_NO_JOB_MARKERS (HTTP 200) | False | **NU — restricție explicită** | Se respectă decizia; fără activare |
| 121 | Next Ventures (src-5e2000e7) | public nextventures | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 122 | Lawrence Harvey (src-52730da8) | public rendered_links | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 123 | Proactive.IT (src-caa85833) | public wordpress_archive | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 124 | W Talent (src-63ad859c) | public rendered_heading_list | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 125 | KEYES / NRB (src-de00bad8) | public linked_jobs | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 126 | Trasys International (src-3720e0c9) | public trasys_keyes | HTML_NO_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 127 | Thaleria (src-627fe4ae) | public linked_jobs | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 128 | Talan Belgium / Luxembourg (src-c5b4586f) | ATS smartrecruiters | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 129 | Fujitsu Belgium (src-c636b92c) | public linked_jobs | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 130 | ARHS / Accenture (src-e1e59857) | ATS smartrecruiters | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 131 | JobsPipe (src-1241f7ac) | jobspipe | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 132 | Qualco Group / Quento (src-4b6330f5) | ATS workable | observed JSON items: 56 | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 133 | Canonical (src-4724bf9f) | ATS greenhouse | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 134 | GitLab (src-fb4f14d1) | ATS greenhouse | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 135 | Grafana Labs (src-7be5cc38) | ATS greenhouse | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 136 | Elastic (src-c8ce901c) | ATS greenhouse | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 137 | Remote (src-bd4fb3e3) | ATS greenhouse | observed JSON items: 0 | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 138 | Sourcegraph (src-818ecf63) | ATS greenhouse | observed JSON items: 7 | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 139 | Automattic (src-855fba5f) | ATS greenhouse | observed JSON items: 9 | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 140 | DoiT (src-38c11faf) | ATS greenhouse | observed JSON items: 41 | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 141 | Mattermost (src-8d5cd524) | ATS greenhouse | observed JSON items: 11 | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 142 | Upbound (src-fd07d196) | ATS greenhouse | observed JSON items: 5 | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 143 | Customer.io (src-e8a4554c) | ATS greenhouse | observed JSON items: 26 | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 144 | Supabase (src-06bae35b) | ATS ashby | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 145 | Docker (src-dbaee4ee) | ATS ashby | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 146 | Zapier (src-ed7d70a9) | ATS ashby | observed JSON items: 9 | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 147 | Deel (src-ba278b1c) | ATS ashby | observed JSON items: 0 | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 148 | TestGorilla (src-a8e0afc3) | ATS ashby | observed JSON items: 2 | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 149 | Temporal (src-7a8d7942) | ATS ashby | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 150 | Linear (src-60e31d42) | ATS ashby | observed JSON items: 33 | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 151 | Qdrant (src-f77b6753) | ATS ashby | observed JSON items: 6 | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 152 | GitBook (src-8bc49e85) | ATS ashby | observed JSON items: 3 | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 153 | Chili Piper (src-99176fc7) | ATS ashby | observed JSON items: 2 | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 154 | Close (src-4e8ed3b9) | ATS ashby | observed JSON items: 6 | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 155 | Oyster (src-2d3201b0) | ATS ashby | observed JSON items: 17 | False | **NECONFIRMATĂ** | Validare/aprobare tehnică lipsă; date persistate neverificate |
| 156 | Whereby (src-f170987b) | ATS lever | observed JSON items: 0 | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 157 | Slite (src-2df3bb49) | ATS bamboohr | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 158 | Cal.com (src-e09c9b8a) | ATS breezyhr | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 159 | SafetyWing (src-bb5710c0) | ATS pinpoint | HTTP_NON_200 (HTTP 404) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 160 | Traefik Labs (src-d4663776) | traefik | HTML_JOB_MARKERS (HTTP 200) | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 161 | Float (src-13b8f0de) | ATS workable | observed JSON items: 0 | True | **NECONFIRMATĂ** | Nu există dovadă E2E individuală: rezultat viabil + Nile + /me/jobs |
| 162 | OSF Digital (src-zoho-osf-digital) | ATS zoho_recruit | HTML_NO_JOB_MARKERS (HTTP 200) | False | **NECONFIRMATĂ** | Stare ADMIN live și date persistate neverificate |
| 163 | HR Plus (src-zoho-hr-plus) | ATS zoho_recruit | HTML_NO_JOB_MARKERS (HTTP 200) | False | **NECONFIRMATĂ** | Stare ADMIN live și date persistate neverificate |
| 164 | MADIFF (src-zoho-madiffpl) | ATS zoho_recruit | HTML_NO_JOB_MARKERS (HTTP 200) | False | **NECONFIRMATĂ** | Stare ADMIN live și date persistate neverificate |
| 165 | Matritel (src-zoho-matritel) | ATS zoho_recruit | HTML_NO_JOB_MARKERS (HTTP 200) | False | **NECONFIRMATĂ** | Stare ADMIN live și date persistate neverificate |
| 166 | MyEmployment (src-zoho-myemployment) | ATS zoho_recruit | HTML_NO_JOB_MARKERS (HTTP 200) | False | **NECONFIRMATĂ** | Stare ADMIN live și date persistate neverificate |

## Ce lipsește pentru a declara surse ACTIVE

1. Obține registrul operațional actual (ADMIN DEV, generație GCS) pentru toate cele 166 ID-uri. Respectă toate dezactivările și deciziile existente; nu activa providerii excluși.
2. Pentru fiecare sursă permisă, execută Retrieve real, urmărește `run_id`, `source_id`, `records`, `outcome` și validează joburi concrete, inclusiv detaliile și linkurile.
3. Corelează joburile acelei surse cu înregistrările Nile și cu `/me/jobs` în DEV; respinge artefactele care par joburi, dar sunt meniuri, bannere sau anunțuri expirate.
4. Activează prin tranzițiile ADMIN numai sursele eligibile care au trecut probele, apoi repetă testul E2E și actualizează verdictul individual.
5. Numără ca **ACTIVE** doar sursele care trec toate cele cinci probe. Cele cu `success_empty`, `records>0` doar în memoria collectorului sau `HTTP 200` nu intră în total.

**Verdict final al acestui raport:** `166/166 SCREENED; 0/166 ACTIVE IN DEV FULLY ATTESTED; 1 SOURCE HAS PARTIAL PER-SOURCE NILE/UI EVIDENCE; OPERATIONAL ACTIVATION AND PER-SOURCE E2E INCOMPLETE`.

*Documentul raportează strict dovezile existente, fără a confunda catalogul Git, planificarea Retrieve, succesul colectării sau indicatorii agregați de publicare cu statutul activ operațional.*
