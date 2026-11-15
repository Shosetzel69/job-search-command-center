# DEV Retrieve native protocol recovery (#520 / #644)

## Observed evidence
- Managed worker executions 87xxq and qs5f4 crash after pinned source snapshot and before visible source progress.
- Exact deployed-image probe 5k7mb: runner import, psycopg binary import and unparameterized managed Nile SELECT succeed. Alternative pure-Python implementation cannot import system libpq.
- Exact failed scope probe ftvhl: CONFIG/POLICY/PLAN succeed; COVERAGE and PARAM_BINDING return -11. Stack: psycopg binary, _cursor_base.py _select_current_result, via _maybe_prepare_gen. Coverage crash at repository line 1226, parameterized ANY(text[]).
- PR #644 @663d6fe: ephemeral native Nile CI reproduces segfault with ClientCursor too; workaround rejected.
- Managed comparison execution jscc-search-dev-8zsvq, connector operation op-mwh5np6x-a9wrslnpcfe: original pinned 3.3.6 and temporary 3.3.5 return -11; temporary 3.3.8 and 3.3.9 return 0 for both parameterized SELECT (text, timestamptz, jsonb, text[]) and Coverage ANY(text[]) using standard cursor. No database writes, image updates or provider calls.

## Selected remedy
Pin psycopg[binary] to 3.3.8 (released 2026-11-04, earlier than 3.3.9). Retain original repository connection and standard server-side parameter binding; remove rejected ClientCursor workaround. Preserve SQL, transactions, credentials, database guard and schemas. Only DEV rollout in scope; the shared dependency pin affects future builds in other environments but does not deploy them.

Official release notes describe a 3.3.7 array-fetch segfault fix (after closing a connection); they do not establish the exact identity of our observed fault.
- https://www.psycopg.org/psycopg3/docs/news.html
- https://pypi.org/project/psycopg/3.3.8/

## Evidence boundaries
Native CI uses the official ephemeral Nile image, not managed Nile. Its regression probe checks exact version and binary backend, mixed parameter round-trip including escaping and Coverage, then ephemeral run-start/history/repository writes. Managed read-only comparison is positive evidence of compatibility but does not prove deploy or functional Retrieve. Verify immutable DEV image and actual UI Retrieve, terminal evidence, scope and live progress. No TEST/PROD deployments or historical repairs.
