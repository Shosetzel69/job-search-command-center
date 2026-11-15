# #520 — DEV Retrieve Nile-only job publication

Owner authorized retiring jobs.json route. Scope: canonical DEV GCP worker, no schema change, no historical deletion, no TEST/PROD change.

- No seed, read, process, merge, stamp, validate or publication of a jobs snapshot in admitted DEV Retrieve.
- Persist shared collection in Nile. Canonical publication is distinct active jobs touched by the run, attributed by API preferred source, not personal opportunities or distinct new jobs. jobs_published now denotes that canonical count. records_inspected is raw source records; excluded is raw minus projected postings (not raw minus distinct jobs). Per-source counters retain separate meanings.
- Keep operational status, history, completion markers, locks, catalog and state. DEV no longer reads or updates current.json; latest-run.json remains independent. Authenticated browser history and jobs remain DB-backed. DEV runtime jobs.json requests fail closed.
- Existing artifacts are not deleted. Non-DEV legacy paths unchanged. Existing connector jobs.json metadata probe is not a Nile-only acceptance requirement.
- Acceptance: CI; paired DEV deployment; real USER/ADMIN Retrieve; no jobs.json in run directory and no current.json update; canonical count agrees with Nile/search_runs; API profile jobs and terminal/progress valid. Rollback paired images, no DDL.
