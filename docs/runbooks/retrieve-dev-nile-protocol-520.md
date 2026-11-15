# DEV Retrieve native protocol recovery (#520 / #644)

## Observed evidence
- Managed worker executions 87xxq and qs5f4 crash after pinned source snapshot and before visible source progress.
- Exact deployed-image probe 5k7mb: runner import, psycopg binary import and unparameterized managed Nile SELECT succeed. Alternative pure-Python implementation cannot import system libpq.
- Exact failed scope probe ftvhl: CONFIG/POLICY/PLAN succeed; COVERAGE and PARAM_BINDING return -11. Stack: psycopg binary, _cursor_base.py _select_current_result, via _maybe_prepare_gen. Coverage crash at repository line 1226, parameterized ANY(text[]).

## Candidate remedy
Psycopg ClientCursor performs driver-managed client-side binding and uses the simple query protocol. Disabling prepared statements alone does not eliminate the extended query protocol used for server-side parameters. Retain pinned 3.3.6, credentials, transaction boundaries, placeholders, database guard and schemas. Apply the connection factory consistently to DEV cloud repository operations only. No SQL string interpolation, no retries following ambiguous writes, no TEST/PROD changes.

References:
- https://www.psycopg.org/psycopg3/docs/advanced/cursors.html
- https://www.psycopg.org/psycopg3/docs/advanced/prepare.html
- https://www.postgresql.org/docs/current/protocol-overview.html
- https://thenile.cc/docs/postgres/postgres-compatibility

## Evidence boundaries
Native CI uses the official ephemeral Nile image, not managed Nile. The read-only protocol probe must also pass in the actual immutable DEV Search image against managed Nile before release acceptance. The actual UI Retrieve must complete with correct run identity and progress; a successful container or compatibility probe is not functional acceptance. Specific upstream cause (protocol response versus driver internals) remains unverified.
