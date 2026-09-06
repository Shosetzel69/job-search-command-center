# GOVERNANCE.md — Job Aggregator App

Reguli de guvernanță pentru dezvoltarea acestui proiect cu asistență AI (ChatGPT).

## 1. Roluri și niveluri de decizie

Proiect single-owner — nu există separare PM/Architect/Dev ca persoane diferite, dar separarea de **tip de decizie** rămâne utilă:

- **Decizii de scop/cerințe** (ce face aplicația, ce funcționalități intră/ies): aprobate doar de tine, niciodată direct printr-un prompt ad-hoc către ChatGPT.
- **Decizii de arhitectură** (schemă DB, alegere librării, structură module): tot tu decizi, dar ChatGPT poate propune — nu se aplică o propunere fără citire/înțelegere explicită.
- **Implementare** (scriere cod, teste, refactor izolat): ChatGPT propune și scrie, tu validezi prin review înainte de merge.

## 2. Arhitectura și contextul pentru AI

- `ARCHITECTURE.md` în rădăcina repo-ului: structura proiectului (module: search, matching, users, companies, connectors, notifications), fluxul de date, dependențele majore. Se atașează/lipește la începutul oricărei sesiuni noi de lucru cu ChatGPT, ca să nu-ți rescrie module funcționale din lipsă de context.
- `.ai-instructions.md`: reguli explicite pentru ChatGPT — stil de cod, ce foldere/module nu are voie să atingă fără discuție (ex: schema DB, auth), convenții de denumire.
- **Architecture Decision Records (ADR):** orice schimbare arhitecturală majoră (schimbare DB, alt manager de stare, schimbare API) primește un fișier `docs/adr/ADR-00X-titlu.md` cu: context, opțiuni considerate, decizie, consecințe. Înlocuiește/completează `DECISIONS.md` pentru deciziile de anvergură mare.

## 3. Reguli pe module

**Connectors (Indeed, Jobicy, JobsPipe, Monster)**
- Fiecare conector nou se testează izolat, cu date reale, înainte de a intra în pipeline-ul de normalizare.

**Matching / prioritizare**
- Logica de scoring (relevanță, eligibilitate geografică) trebuie explicată explicit de ChatGPT, nu doar livrată ca cod.

**Notifications (email)**
- Minim un ciclu complet end-to-end verificat manual înainte de activarea trimiterii automate.

## 4. Securitate

- Cheile API și connection string-ul PostgreSQL nu se pun niciodată în prompt — doar referințe la variabile de mediu.
- REST API intern: verificare manuală că niciun endpoint nu rămâne fără autentificare, în special cel folosit de MCP server.
- Endpoint-ul `search_jobs()` expus prin MCP: read-only, fără acces la date ale altor utilizatori.

## 5. Testare

- Abordare TDD ușoară cu AI: pentru logică critică (matching, dedupe), ceri întâi testele de la ChatGPT pe baza cerinței, apoi codul care le trece — reduce riscul ca AI să scrie cod ce "pare" corect dar nu respectă cerința reală.
- Acoperire minimă recomandată pe logica de business critică (matching/dedupe/eligibilitate geografică): 80%.
- Fiecare conector: test cu ≥1 pagină reală de rezultate + 1 caz de eroare (sursă indisponibilă / format schimbat).
- Modul de dedupe: test explicit cu 2 postări identice din surse diferite.
- Static analysis (ESLint/Prettier sau echivalent) integrat, ca stil de cod să rămână unitar indiferent cine (tu/ChatGPT) a scris fragmentul.

## 6. Trasabilitate

- `DECISIONS.md`: deciziile mici/de zi cu zi — ce s-a cerut lui ChatGPT, ce a propus, ce s-a schimbat manual și de ce.
- `docs/adr/`: deciziile arhitecturale mari (vezi secțiunea 2).
- Commit messages cu prefix `ai:` pentru cod generat integral de ChatGPT.

## 7. Limite de autonomie

| Poate face ChatGPT singur | Necesită aprobare umană |
|---|---|
| Cod pentru conectori | Migrare schemă DB |
| Teste unitare/integration | Logică ce trimite email-uri reale |
| Funcții de normalizare | Modificări la autentificare/users |
| Draft documentație | Schimbări la ce e expus prin MCP |
| Refactor izolat, funcție/modul | Schimbare arhitecturală (necesită ADR) |

## 8. Redactare documente

- Toate documentele de proiect (cerințe, specificații, decizii arhitecturale) trăiesc în repo, în `docs/`, nu în chat-uri sau fișiere locale separate.
- Format standard: Markdown, versionat în nume sau header (`requirements.md` cu header `v0.2 — 03.09.2026`), nu fișiere multiple gen `requirements_final_v2.md`.
- Fiecare document nou/major generat cu ajutorul ChatGPT primește o trecere de review uman înainte de commit — verifici coerența cu ce există deja, nu doar corectitudinea gramaticală.
- Limba: draft-uri interne în română (cum lucrezi tu), dar denumirile tehnice (nume module, endpoint-uri, câmpuri DB) rămân în engleză pentru consistență cu codul.

## 9. Actualizarea cerințelor în GitHub

- Documentul de cerințe (`docs/requirements.md`) este sursa unică de adevăr — nu cerințe „verbale" doar în discuții cu ChatGPT.
- Orice modificare de cerințe se face printr-un PR dedicat, cu titlu clar (`req: adaugă suport pentru sursa X`), nu direct pe main.
- Fiecare versiune de cerințe capătă un tag/secțiune de changelog în capul documentului: ce s-a adăugat/eliminat/schimbat și de ce.
- Cerințele generate sau reformulate de ChatGPT (ex: clarificare scop, edge-case-uri) se marchează explicit în PR description, ca să știi ulterior ce a venit din discuție cu AI vs. decizie proprie inițială.

## 10. Managementul schimbărilor (Change Request)

- Orice schimbare de scop (nu bugfix, ci adăugare/eliminare funcționalitate) pornește de la un Issue nou, cu label `change-request`, înainte de a cere lui ChatGPT implementarea.
- Format minim pentru un CR: **Problemă → Impact (scope/timp/module afectate) → Soluție propusă → Decizie**.
- Impactul se evaluează explicit pe module (ex: schimbarea schemei DB afectează connectors + matching), nu doar pe fișierul modificat direct.
- Schimbările cu impact pe securitate sau pe date (schema DB, autentificare) necesită aprobare explicită înainte de merge, indiferent cât de mică pare modificarea.

## 11. Documentarea implementărilor

- Fiecare feature implementată primește un `CHANGELOG.md` entry: ce s-a implementat, în ce PR/commit, dacă a fost generat integral/parțial de ChatGPT.
- Comentariul de închidere al Issue-ului rezumă: soluția aleasă, orice compromis făcut, ce rămâne de făcut (dacă e cazul) — util când revii peste luni la un modul.
- Pentru module critice (connectors, matching, notifications), se documentează separat și logica de business (nu doar codul) în `docs/`, ca să nu depinzi doar de comentariile din cod generate de AI.
- Actualizarea documentației face parte din definiția de "gata" — un PR nu se consideră complet dacă funcționalitatea nouă nu are corespondent în `docs/` sau `CHANGELOG.md`.

## 12. Lucrul cu tichete GitHub (Issues) și branching

**Branch-uri:**
- `main`: cod stabil, testat, gata de deploy — fără push direct.
- `develop`: integrare/testare înainte de main.
- `feature/ISSUE-ID-nume-scurt`, `fix/ISSUE-ID-nume-scurt`, `refactor/ISSUE-ID-nume-scurt` (acesta din urmă mai ales pentru rescrieri propuse de ChatGPT).

**Issues:**
- Un Issue per feature/bug/change-request — nu grupezi mai multe lucruri nelegate într-un singur tichet.
- Labels minime: `feature`, `bug`, `change-request`, `ai-generated` (cod produs integral de ChatGPT → semnal de review mai atent), `needs-review`.
- Fiecare Issue are un "definition of done" explicit în descriere (ex: „conector Monster funcțional + test cu date reale + fără chei hardcodate").
- Commit-urile referențiază Issue-ul (`refs #12` / `closes #12`) — trasabilitate: cerință → issue → commit → cod.
- Issue-urile rămân deschise până verifici tu manual criteriul de done, nu se închid automat doar pentru că ChatGPT a spus „gata, funcționează".

**Pull Requests — checklist minim înainte de merge:**
- [ ] Cod verificat manual (nu doar rulat) — AI poate halucina sau introduce vulnerabilități.
- [ ] Teste automate trec.
- [ ] Documentația aferentă (`docs/`, `CHANGELOG.md`) actualizată.
- [ ] Fără chei API/secrete introduse accidental în cod.
- [ ] Nu încalcă `ARCHITECTURE.md` fără un ADR asociat.

## 13. Versionare

- Semantic Versioning (`X.Y.Z`): **X** = breaking changes/schimbări mari de arhitectură, **Y** = funcționalități noi fără a strica ce există, **Z** = bugfix-uri/ajustări mici.
- Fiecare release pe `main` primește un Git tag corespunzător versiunii.
- Documentația versionată în `docs/`, sincron cu tag-urile de release.

## 14. Revizuire

- La fiecare milestone (ex: primul conector funcțional, dashboard web funcțional), revizuire rapidă: erori repetate generate de ChatGPT → regulă nouă adăugată aici.
