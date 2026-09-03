# Backend

Backendul va fi un monolit modular cu un singur API HTTPS intern.

## Module planificate

- `connectors` - colectare si normalizare per sursa;
- `jobs` - validare, deduplicare si stocare;
- `matching` - reguli de selectie si evaluare fit;
- `applications` - istoricul aplicarilor si status;
- `notifications` - notificari si rapoarte;
- `exports` - Google Sheets si backup.

## Persistenta

SQLite pentru MVP, accesat printr-un repository layer. PostgreSQL este rezervat pentru faza multi-user sau replicare.

Limbajul si frameworkul backendului nu sunt inca decise. Nu se adauga cod fictiv pana la aceasta decizie.
