# ADR-002 - Randare browser dupa colectarea HTML

Data: 2026-09-06
Status: aprobat de owner in conversatia Development (#49), prin confirmarea variantei Playwright + Chromium.

## Context si problema

Collectorul HTML nu executa JavaScript. Unele surse publice incarca anunturile sau linkurile de cariere numai dupa randare.

## Optiuni analizate

1. Schimbarea User-Agent: nu executa JavaScript.
2. Chromium pentru fiecare pagina: consum inutil pentru paginile statice.
3. Chromium numai pentru pagini cu scripturi, fara JobPosting static: optiunea aprobata.

## Decizie si motivatie

Playwright Python + Chromium headless, ca fallback in collectorul web existent. Dependinta Playwright este Apache-2.0; distributia Chromium include licentele componentelor sale. Browserul necesita un download de ordinul sutelor de MB, separat de pachetul Python. Biblioteca standard nu poate executa DOM/JavaScript.

Maximum doua randari per sursa, trei procese browser concurente, 20 secunde per randare, in limita existenta de 45 secunde per sursa. HTML-ul original ramane disponibil la eroare. Aceleasi bugete se aplica tuturor surselor.

## Consecinte si riscuri

Randarea poate descoperi JSON-LD si linkuri dinamice; nu garanteaza extragerea site-urilor fara date structurate. Nu rezolva URL-uri gresite, login, CAPTCHA sau interdictii robots. Limitele pot lasa acoperire partiala. Instalarea browserului creste timpul CI si consumul runner-ului.

## Securitate

Proces copil cu mediu fara secrete provider, context nou fara sesiuni persistente. Reteaua HTTP a browserului este interceptata si servita exclusiv prin transportul cu DNS fixat, robots si limite de dimensiune. Niciun request nu foloseste continue/fetch direct din browser. Sunt blocate cererile non-GET, service workers, WebSockets, fisiere, media si descarcari. Proxy local inchis pentru eventuale cereri neinterceptate. Timeout-ul procesului inchide intregul grup de procese.

## Impact asupra componentelor existente

Module noi pentru randare, extindere transport public si collector web; campuri aditive in loguri. Instalare Playwright/Chromium in GitHub Actions; teste fara HTTP real, inclusiv fixture JavaScript randata in CI. Contractul CollectionResult, scoring, Worker si persistenta raman compatibile. ARCHITECTURE trece la v1.3, fara schimbare majora.
