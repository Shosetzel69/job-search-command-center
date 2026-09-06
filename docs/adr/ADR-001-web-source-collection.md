# ADR-001 - Colectarea surselor web

Data: 2026-09-06
Status: aprobat prin confirmarea owner-ului pentru colectarea web din #49; implementare in curs.

## Context si problema

Sursele din catalog trebuie cautate efectiv, inclusiv fara API dedicat. PR #50 a introdus orchestrarea, dar a lasat 128 surse web neinterogate.

## Optiuni

1. Cate un scraper dedicat pentru fiecare site: acoperire precisa, mentenanta ridicata.
2. Collector web comun pentru pagini publice structurate, cu rutare catre adaptere dedicate unde exista: reutilizare, limitari explicite pentru site-uri dinamice.
3. Browser automatizat pentru fiecare sursa: dependinte, resurse si mentenanta suplimentare; nu se introduce in aceasta schimbare.

## Decizie si motivatie

Optiunea 2. Se foloseste contractul CollectionResult existent. Collectorul parcurge pagini de cariere, linkuri de anunturi si paginare; extrage JobPosting JSON-LD. Nu transforma simpla accesibilitate a paginii in succes de colectare. Extensiile ulterioare pot adauga extractori HTML/ATS specifici.

## Reguli de colectare si securitate

- GET public, fara autentificare, cookie-uri sau secrete; nu ocoleste CAPTCHA/robots/login.
- robots.txt verificat pentru fiecare origine, inclusiv redirect-uri.
- DNS public verificat si conexiune fixata pe IP-ul validat; respinge IP-uri private/loopback/link-local, credentiale in URL si porturi nestandard.
- Linkuri interne si legaturi de cariere/ATS descoperite explicit; redirect-uri validate la fiecare hop.
- Limite egale pentru fiecare sursa: pagini, dimensiune raspuns, durata si pauza intre cereri. Executie concurenta limitata pentru respectarea timeout-ului Actions.
- Pastreaza titlul, compania, descrierea, data, teritoriul si URL-ul anuntului; nu inventeaza data sau eligibilitatea geografica.
- Loguri separate pentru extracted/no_extractable_jobs/blocked/error/partial. O sursa cu pagini ramase neparcurse nu este declarata exhaustiv verificata.

## Consecinte si riscuri

Site-urile JavaScript, paginile fara date structurate si unele ATS necesita extractori suplimentari. Zero anunturi extrase nu dovedeste zero pozitii disponibile. Acoperirea partiala este vizibila in Loguri, inclusiv numarul paginilor si URL-urile incercate. Datele extrase raman externe, neexecutabile, iar descrierile sunt text simplu.

## Impact

Collector nou, orchestrare, teste, UI de surse/Loguri si documentatie. GitHub Actions, Worker, autentificarea, persistenta si scoring-ul isi pastreaza responsabilitatile. ARCHITECTURE trece de la v1.1 la v1.2, fara schimbare majora.
