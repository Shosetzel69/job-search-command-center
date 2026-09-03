# Arhitectura

## Flux

ChatGPT Site -> API HTTPS -> Backend modular monolith -> SQLite / integrari

## Decizii

- frontend MVP: ChatGPT Sites;
- backend: monolit modular;
- API: un singur punct intern de acces;
- conector separat pentru fiecare tip de sursa;
- baza de date MVP: SQLite;
- repository layer pentru migrare ulterioara;
- PostgreSQL doar pentru multi-user sau replicare;
- Google nu este sursa de agregare a joburilor.

## Integrari planificate

- Sign in with Google;
- Gmail pentru notificari;
- Google Sheets pentru export;
- Google Drive pentru backup;
- Google Calendar optional, faza 2.

## Hosting

NAS Synology DS213j poate fi folosit cel mult pentru storage sau backup. Nu este hostul principal al backendului.
