# Analiza - GitHub App bridge pentru identitati AI

Data: 2026-09-09
Issue: #132
Status: APPROVED / IMPLEMENTATION IN PROGRESS

## Problema

GitHub Apps distincte pentru ChatGPT si Claude au fost validate prin #128 si #131, dar integrarea GitHub standard din chat nu foloseste direct credentialele acestor Apps.

## Decizie aprobata

Owner GO: 2026-09-09.

Se foloseste un Cloudflare Worker dedicat `ai-github-bridge`, separat de `command-api`.

ADR: `docs/adr/ADR-002-ai-github-bridge.md`.

## Diferente fata de analiza initiala

Analiza initiala #132 enumera un contract v1 mai larg, cu issues, files, branches, PR si checks.

Pentru MVP-ul aprobat la implementare, suprafata a fost redusa intentionat la issues:

- get issue;
- create issue;
- update issue.

Motiv: validarea identitatii operationale si a modelului de securitate trebuie facuta inainte de extinderea write-surface catre repository content si branches.

Actorul nu este primit printr-un camp `actor`; este derivat din bearer credentialul bridge. Aceasta elimina posibilitatea ca un client autentificat cu credentialul unui agent sa solicite identitatea celuilalt agent.

## Contract de securitate rezultat

- repository fix `Shosetzel69/job-search-command-center`;
- doua bearer credentials independente;
- private keys numai ca Worker secrets;
- JWT si installation token generate server-side;
- fara generic GitHub proxy;
- request body limitat la 64 KiB;
- campuri allowlisted pentru create/update issue;
- label `ai-generated` adaugat/pastrat automat;
- audit fara request body si fara credentials;
- operatiile neallowlisted sunt respinse inainte de apel GitHub.

## Dependinte

Nu se adauga biblioteci runtime noi.

Semnarea JWT foloseste Web Crypto nativ. Cheile GitHub App in format PKCS#1 sunt convertite local in PKCS#8 pentru `crypto.subtle.importKey`.

Wrangler ramane aceeasi dependinta de development deja folosita de proiect, versiunea 4.129.0.

## Testare

Testele sunt izolate si folosesc mock HTTP pentru GitHub.

Acopera:

- health public;
- auth lipsa;
- ChatGPT identity routing;
- Claude identity routing;
- repository hard allowlist;
- generic proxy blocked;
- schema update restrictionata;
- GitHub auth failure sanitizat;
- PKCS#1 private key support.

## Ce ramane dupa merge

Implementarea codului nu finalizeaza #127/#132 pana nu exista configurarea operationala:

1. creare/deploy Worker Cloudflare;
2. configurare celor patru Worker secrets;
3. smoke real ChatGPT;
4. smoke real Claude;
5. conectare tool/plugin ChatGPT la endpoint;
6. mecanism operational Claude;
7. actualizare governance finala si inchidere tichete.

## Relatia cu #125

MVP-ul nu implementeaza DEV/TEST/PROD. Bridge-ul este separat structural astfel incat mediile sa poata fi introduse ulterior. Credentialele PROD nu trebuie reutilizate pentru bridge DEV cand #125 va fi implementat.
