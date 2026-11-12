# JSCC source extraction audit, DEV, 2026-11-12

Catalog baseline: main 567c4246f8c9621f2df727e066b9e95f4ed7d449. All 166 distinct sources examined sequentially without grouping. This is a route screening, NOT successful job retrieval or source activation.

Primary URL probes: 166. Secondary-route results: 165 sources. Alternative requests checked: 441.

Source governance: a source marked active in Git may differ from live DEV GCS registry; no authenticated ADMIN source-mutation interface is available in the connected DEV sandbox. No activation has been executed. OSF was previously seen operationally active in #585 UI despite Git baseline inactive.

Explicit exclusions, credential-disabled routes, deferred provider roots, aliases, pending validation, robots.txt denial and access controls were respected. No PROD/TEST changes.

Evidence note: HTTP 200, HTML links, and JSON item counts are not proof of real job records, detail completeness or Nile/UI persistence.

| # | Source | Method | Public probe evidence | Git active | Required action |
|---:|---|---|---|---|---|
| 1 | LinkedIn Jobs (src-db8da20e) | deferred_provider | ROBOTS_BLOCK (HTTP ?) | True | Keep deferred |
| 2 | Indeed (src-19586b7c) | deferred_provider | ACCESS_BLOCK (HTTP 403) | True | Keep deferred |
| 3 | eJobs (src-151ed5ae) | public ejobs | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 4 | Hipo (src-a41721bd) | public hipo | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 5 | Jobicy (src-f9b6441c) | jobicy | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 6 | EURES (src-c2f412ff) | public eures | HTTP_NON_200 (HTTP 404) | True | Active in Git; DEV unknown |
| 7 | EU Careers / EPSO (src-60eb92d7) | public eu_careers | HTTP_NON_200 (HTTP 404) | True | Active in Git; DEV unknown |
| 8 | EuroBrussels (src-de6c7ccb) | public eurobrussels | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 9 | eFinancialCareers (src-01389b06) | public rendered_links | HTTP_NON_200 (HTTP 202) | True | Active in Git; DEV unknown |
| 10 | Hays Romania (src-6d75d5ec) | public linked_jobs | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 11 | Jobgether (src-c449712a) | public jobgether | PUBLIC_JSON (HTTP 200) | True | Active in Git; DEV unknown |
| 12 | Himalayas (src-eaa0bf03) | public himalayas | PUBLIC_JSON (HTTP 200) | True | Active in Git; DEV unknown |
| 13 | Working Nomads (src-c5c33d14) | public workingnomads | PUBLIC_JSON (HTTP 200) | True | Active in Git; DEV unknown |
| 14 | Remote OK (src-711652ce) | public remoteok | JSON_PARSE_UNVERIFIED (HTTP 200) | True | Active in Git; DEV unknown |
| 15 | We Work Remotely (src-33faa076) | public rss | PUBLIC_XML (HTTP 200) | True | Active in Git; DEV unknown |
| 16 | Remote.co (src-6f69f067) | public rendered_heading_list | ACCESS_BLOCK (HTTP 403) | True | Active in Git; DEV unknown |
| 17 | NoDesk (src-8dc57863) | public rss | PUBLIC_XML (HTTP 200) | True | Active in Git; DEV unknown |
| 18 | EU Remote Jobs (src-b428d48a) | public eu_remote | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 19 | Remote in Europe (src-5c60a3ef) | public rss | HTTP_NON_200 (HTTP 404) | False | Keep alias disabled |
| 20 | Landing.Jobs (src-5b267066) | public landingjobs | ROBOTS_BLOCK (HTTP ?) | False | Validate first; not active |
| 21 | Wellfound (src-19fdc576) | public linked_jobs | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 22 | Flexa (src-98e6fa9a) | public heading_list | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 23 | No Fluff Jobs (src-418d4402) | public linked_jobs | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 24 | Just Join IT (src-08e07524) | public linked_jobs | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 25 | awork.ro (src-29c7e716) | public awork | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 26 | Remotive (src-22e89880) | public remotive | observed JSON items: 13 | True | Active in Git; DEV unknown |
| 27 | JustRemote (src-95b41cd3) | public heading_list | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 28 | Jobspresso (src-bc23a227) | public rss | PUBLIC_XML (HTTP 200) | True | Active in Git; DEV unknown |
| 29 | DailyRemote (src-847cc7fb) | public dailyremote | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 30 | PowerToFly (src-051631b2) | public rendered_links | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 31 | Dynamite Jobs (src-27876fc7) | public heading_list | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 32 | Torre (src-e2c72147) | public rendered_links | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 33 | Welcome to the Jungle (src-37fe892c) | public rendered_links | HTML_NO_JOB_MARKERS (HTTP 200) | False | Keep policy disabled |
| 34 | Techjobs.be (src-de78b466) | public heading_list | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 35 | FlexJobs (src-5ba28ea2) | public rendered_heading_list | ACCESS_BLOCK (HTTP 403) | True | Active in Git; DEV unknown |
| 36 | Glassdoor Jobs (src-b9e381e5) | web | ACCESS_BLOCK (HTTP 403) | True | Active in Git; DEV unknown |
| 37 | Monster (src-362eebc4) | web | HTML_JOB_MARKERS (HTTP 200) | True | Keep policy disabled |
| 38 | Pangian (src-20bba196) | public pangian_rss | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 39 | SkipTheDrive (src-7abce359) | public linked_jobs | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 40 | RemoteHunt (src-a83077eb) | web | HTML_JOB_MARKERS (HTTP 200) | False | Keep alias disabled |
| 41 | Freelancermap (src-6351e67a) | public linked_jobs | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 42 | Malt (src-b1f34459) | web | ACCESS_BLOCK (HTTP 403) | False | Keep policy disabled |
| 43 | Toptal (src-d7caf4d7) | ATS lever | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 44 | Crossover (src-b87e0b6b) | public heading_list | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 45 | Upwork (src-05d0980c) | public linked_jobs | ACCESS_BLOCK (HTTP 403) | False | Validate first; not active |
| 46 | Arc.dev (src-633a9d75) | public arc | HTML_JOB_MARKERS (HTTP 200) | False | Keep policy disabled |
| 47 | PeoplePerHour (src-cd888ac5) | public linked_jobs | HTTP_NON_200 (HTTP 202) | True | Active in Git; DEV unknown |
| 48 | Freelancer.com (src-198c2c6d) | public freelancer_api | JSON_PARSE_UNVERIFIED (HTTP 200) | True | Active in Git; DEV unknown |
| 49 | Hubstaff Talent (src-5da9090f) | public rendered_links | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 50 | Altia (src-063f4045) | public bizneo | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 51 | European Dynamics (src-30f49eb9) | ATS workable | observed JSON items: 190 | True | Active in Git; DEV unknown |
| 52 | Almaviva de Belgique (src-130c8619) | ATS recruitee | observed JSON items: 4 | True | Active in Git; DEV unknown |
| 53 | Vector Synergy (src-43f89b7e) | public rendered_heading_list | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 54 | NATO Careers (src-0ed4ecb9) | public nato_taleo | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 55 | Cronos Europa (src-f8ab232c) | ATS breezyhr | NETWORK_ERROR (HTTP ?) | True | Active in Git; DEV unknown |
| 56 | Serco Europe (src-35952461) | public rendered_links | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 57 | CGI (src-66c9abf9) | web | NETWORK_ERROR (HTTP ?) | False | Keep policy disabled |
| 58 | Sopra Steria (src-f6ec92c2) | ATS smartrecruiters | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 59 | Netcompany / Intrasoft (src-81c52270) | ATS smartrecruiters | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 60 | Thales (src-4f115b25) | ATS workday | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 61 | ING Careers (src-cd35311d) | ATS workday | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 62 | Deutsche Bank (src-db53eef5) | ATS workday | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 63 | Societe Generale (src-b5d2ea7a) | public socgen | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 64 | Allianz Careers (src-2d0a1ece) | ATS phenom | HTML_NO_JOB_MARKERS (HTTP 200) | True | Keep disabled route |
| 65 | Worldline (src-81d05cc7) | public worldline | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 66 | Worldpay / Global Payments (src-9c62386c) | public rendered_links | ACCESS_BLOCK (HTTP 403) | True | Active in Git; DEV unknown |
| 67 | Vodafone / VOIS (src-c55d92f1) | ATS eightfold_public | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 68 | Airbus (src-13cf91f6) | ATS workday | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 69 | GlobalLogic (src-673ff124) | ATS smartrecruiters | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 70 | Luxoft (src-388b210e) | public linked_jobs | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 71 | Mantu (src-0d30c544) | public linked_jobs | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 72 | NTT (src-86b7291f) | ATS phenom | HTML_JOB_MARKERS (HTTP 200) | True | Keep disabled route |
| 73 | NTT DATA Romania (src-c92fb5b2) | ATS workday | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 74 | Cegeka (src-93fac926) | public linked_jobs | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 75 | Computacenter (src-97ae3205) | public linked_jobs | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 76 | SoftServe (src-ab8eef5d) | public softserve | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 77 | EPAM (src-1acffa09) | public epam | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 78 | Eviden (src-3f1d18c1) | public eviden | HTML_JOB_MARKERS (HTTP 200) | False | Candidate for ADMIN activation; DEV unknown |
| 79 | DXC Technology (src-86c16192) | ATS workday | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 80 | HARMAN (src-80728c0f) | public rendered_links | NETWORK_ERROR (HTTP ?) | True | Active in Git; DEV unknown |
| 81 | Endava (src-200ac72c) | ATS smartrecruiters | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 82 | Accenture (src-06a35de2) | ATS workday | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 83 | Atos (src-883880eb) | public atos | NETWORK_ERROR (HTTP ?) | True | Active in Git; DEV unknown |
| 84 | Orange Romania (src-068757e6) | ATS softgarden | PUBLIC_JSON (HTTP 200) | True | Active in Git; DEV unknown |
| 85 | Bosch Romania (src-20cc8a94) | ATS smartrecruiters | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 86 | Xebia CEE (src-33dc53dd) | ATS greenhouse | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 87 | Prohuman (src-ffbd0efc) | public prohuman | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 88 | Fortive (src-880cb59e) | ATS eightfold | HTML_JOB_MARKERS (HTTP 200) | True | Keep disabled route |
| 89 | Saphetor (src-ca19ca22) | ATS bamboohr | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 90 | Camunda (src-e227c07e) | ATS ashby | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 91 | ClickHouse (src-45ded4bd) | ATS ashby | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 92 | GitHub (src-36303de5) | public linked_jobs | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 93 | Snyk (src-fa93d750) | ATS ashby | observed JSON items: 38 | True | Active in Git; DEV unknown |
| 94 | Datadog (src-f0431472) | ATS greenhouse | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 95 | Stripe (src-69b52ced) | public linked_jobs | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 96 | Kong (src-b0569593) | ATS ashby | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 97 | LocalStack (src-4e049a8b) | ATS ashby | observed JSON items: 10 | True | Active in Git; DEV unknown |
| 98 | Contentsquare (src-5e1bffb7) | ATS lever | NETWORK_ERROR (HTTP ?) | True | Active in Git; DEV unknown |
| 99 | Storyblok (src-59fe329e) | ATS greenhouse | observed JSON items: 0 | True | Active in Git; DEV unknown |
| 100 | Ashby (src-b9c3e8da) | deferred_provider | HTTP_NON_200 (HTTP 404) | True | Keep deferred |
| 101 | Workable (src-a4b24087) | deferred_provider | HTML_NO_JOB_MARKERS (HTTP 200) | True | Keep deferred |
| 102 | Greenhouse (src-cb17e9a4) | deferred_provider | HTML_NO_JOB_MARKERS (HTTP 200) | True | Keep deferred |
| 103 | Lever (src-9a1da502) | deferred_provider | HTML_JOB_MARKERS (HTTP 200) | True | Keep deferred |
| 104 | Workday (src-a17e037a) | deferred_provider | HTML_NO_JOB_MARKERS (HTTP 200) | True | Keep deferred |
| 105 | SmartRecruiters (src-4366cf98) | deferred_provider | HTML_JOB_MARKERS (HTTP 200) | True | Keep deferred |
| 106 | Recruitee (src-5b8df11a) | deferred_provider | HTML_JOB_MARKERS (HTTP 200) | False | Keep deferred |
| 107 | BambooHR (src-c1f00061) | deferred_provider | HTML_NO_JOB_MARKERS (HTTP 200) | False | Keep deferred |
| 108 | Eightfold (src-2671485b) | deferred_provider | HTML_NO_JOB_MARKERS (HTTP 200) | False | Keep deferred |
| 109 | UpcoMinds (src-6dfcf5c6) | public jobs4it | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 110 | Infoplus Technologies UK (src-9adf56b2) | ATS smartrecruiters | NETWORK_ERROR (HTTP ?) | True | Active in Git; DEV unknown |
| 111 | RED Global (src-022e1882) | public linked_jobs | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 112 | Salt (src-1b80f6e3) | public linked_jobs | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 113 | Avance Consulting (src-635a05cb) | ATS smartrecruiters | NETWORK_ERROR (HTTP ?) | True | Active in Git; DEV unknown |
| 114 | Hirexa Solutions (src-9cdef20d) | public hirexa | NETWORK_ERROR (HTTP ?); alternate timeout | True | Active in Git; DEV unknown |
| 115 | Infinity Quest (src-07fe3d5c) | ATS smartrecruiters | HTTP_NON_200 (HTTP 445) | True | Active in Git; DEV unknown |
| 116 | Square One Resources (src-ea3cff6e) | public squareone | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 117 | Source Group International (src-3827c764) | public linked_jobs | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 118 | Montreal Associates (src-45ccbce5) | public montreal_associates | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 119 | Brains Consulting (src-04910401) | public brains | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 120 | Head Hunting IT (src-68781255) | web | HTML_NO_JOB_MARKERS (HTTP 200) | False | Keep policy disabled |
| 121 | Next Ventures (src-5e2000e7) | public nextventures | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 122 | Lawrence Harvey (src-52730da8) | public rendered_links | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 123 | Proactive.IT (src-caa85833) | public wordpress_archive | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 124 | W Talent (src-63ad859c) | public rendered_heading_list | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 125 | KEYES / NRB (src-de00bad8) | public linked_jobs | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 126 | Trasys International (src-3720e0c9) | public trasys_keyes | HTML_NO_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 127 | Thaleria (src-627fe4ae) | public linked_jobs | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 128 | Talan Belgium / Luxembourg (src-c5b4586f) | ATS smartrecruiters | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 129 | Fujitsu Belgium (src-c636b92c) | public linked_jobs | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 130 | ARHS / Accenture (src-e1e59857) | ATS smartrecruiters | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 131 | JobsPipe (src-1241f7ac) | jobspipe | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 132 | Qualco Group / Quento (src-4b6330f5) | ATS workable | observed JSON items: 56 | True | Active in Git; DEV unknown |
| 133 | Canonical (src-4724bf9f) | ATS greenhouse | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 134 | GitLab (src-fb4f14d1) | ATS greenhouse | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 135 | Grafana Labs (src-7be5cc38) | ATS greenhouse | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 136 | Elastic (src-c8ce901c) | ATS greenhouse | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 137 | Remote (src-bd4fb3e3) | ATS greenhouse | observed JSON items: 0 | True | Active in Git; DEV unknown |
| 138 | Sourcegraph (src-818ecf63) | ATS greenhouse | observed JSON items: 7 | True | Active in Git; DEV unknown |
| 139 | Automattic (src-855fba5f) | ATS greenhouse | observed JSON items: 9 | True | Active in Git; DEV unknown |
| 140 | DoiT (src-38c11faf) | ATS greenhouse | observed JSON items: 41 | True | Active in Git; DEV unknown |
| 141 | Mattermost (src-8d5cd524) | ATS greenhouse | observed JSON items: 11 | True | Active in Git; DEV unknown |
| 142 | Upbound (src-fd07d196) | ATS greenhouse | observed JSON items: 5 | True | Active in Git; DEV unknown |
| 143 | Customer.io (src-e8a4554c) | ATS greenhouse | observed JSON items: 26 | True | Active in Git; DEV unknown |
| 144 | Supabase (src-06bae35b) | ATS ashby | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 145 | Docker (src-dbaee4ee) | ATS ashby | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 146 | Zapier (src-ed7d70a9) | ATS ashby | observed JSON items: 9 | True | Active in Git; DEV unknown |
| 147 | Deel (src-ba278b1c) | ATS ashby | observed JSON items: 0 | True | Active in Git; DEV unknown |
| 148 | TestGorilla (src-a8e0afc3) | ATS ashby | observed JSON items: 2 | True | Active in Git; DEV unknown |
| 149 | Temporal (src-7a8d7942) | ATS ashby | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 150 | Linear (src-60e31d42) | ATS ashby | observed JSON items: 33 | True | Active in Git; DEV unknown |
| 151 | Qdrant (src-f77b6753) | ATS ashby | observed JSON items: 6 | True | Active in Git; DEV unknown |
| 152 | GitBook (src-8bc49e85) | ATS ashby | observed JSON items: 3 | True | Active in Git; DEV unknown |
| 153 | Chili Piper (src-99176fc7) | ATS ashby | observed JSON items: 2 | True | Active in Git; DEV unknown |
| 154 | Close (src-4e8ed3b9) | ATS ashby | observed JSON items: 6 | True | Active in Git; DEV unknown |
| 155 | Oyster (src-2d3201b0) | ATS ashby | observed JSON items: 17 | False | Validate first; not active |
| 156 | Whereby (src-f170987b) | ATS lever | observed JSON items: 0 | True | Active in Git; DEV unknown |
| 157 | Slite (src-2df3bb49) | ATS bamboohr | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 158 | Cal.com (src-e09c9b8a) | ATS breezyhr | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 159 | SafetyWing (src-bb5710c0) | ATS pinpoint | HTTP_NON_200 (HTTP 404) | True | Active in Git; DEV unknown |
| 160 | Traefik Labs (src-d4663776) | traefik | HTML_JOB_MARKERS (HTTP 200) | True | Active in Git; DEV unknown |
| 161 | Float (src-13b8f0de) | ATS workable | observed JSON items: 0 | True | Active in Git; DEV unknown |
| 162 | OSF Digital (src-zoho-osf-digital) | ATS zoho_recruit | HTML_NO_JOB_MARKERS (HTTP 200) | False | ADMIN validate / approve / activate |
| 163 | HR Plus (src-zoho-hr-plus) | ATS zoho_recruit | HTML_NO_JOB_MARKERS (HTTP 200) | False | ADMIN validate / approve / activate |
| 164 | MADIFF (src-zoho-madiffpl) | ATS zoho_recruit | HTML_NO_JOB_MARKERS (HTTP 200) | False | ADMIN validate / approve / activate |
| 165 | Matritel (src-zoho-matritel) | ATS zoho_recruit | HTML_NO_JOB_MARKERS (HTTP 200) | False | ADMIN validate / approve / activate |
| 166 | MyEmployment (src-zoho-myemployment) | ATS zoho_recruit | HTML_NO_JOB_MARKERS (HTTP 200) | False | ADMIN validate / approve / activate |

## Important validated findings

- Git catalog contains 166 sources; 147 active flags, 19 inactive flags. These are NOT operational activation readbacks.
- 135 records are eligible and already marked active in Git; Eviden is validated and approved but inactive there. Do not assume absence of an older disable decision.
- JobsPipe is active in Git but the runtime mode was deliberately disabled; do not turn on JobsPipe without separate explicit decision.
- Six policy exclusions include legacy Monster active=true; these stay excluded even if a public page responds.
- Provider root URLs for LinkedIn, Indeed and ATS platforms can be deferred; company-specific ATS boards remain distinct.
- OSF and four other Zoho public boards have viable public landing pages but need live ADMIN state, detailed extraction and appropriate approval before new activation.
- The direct GET to EURES API returned 404, but actual connector uses POST, so this is not a conclusive collector failure.
- Several feeds exceeded the initial bounded response sample, so parsed counts are unknown rather than zero.
- No full Retrieve, publication or source mutation was executed.

## Activation completion gates

1. Read authenticated ADMIN DEV operational registry and explicit disable decisions for all 166 IDs.
2. Validate actual normalized job rows and job detail pages on permitted routes; repair each failed route.
3. Apply existing ADMIN lifecycle transitions only for validated non-blocked sources and preserve GCS generation protection.
4. Run canonical DEV Retrieve and attest each source attempt, positive job records where available, Nile persistence and UI publication.
5. Confirm actual active source registry readback.

**Verdict: ROUTE_SCREENING_166_OF_166_COMPLETE / ACTIVATION_NOT_EXECUTED / EXTRACTION_E2E_UNVERIFIED.**
