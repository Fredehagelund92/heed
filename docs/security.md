# Security, scanning and the restore drill

How dependencies and commits are scanned, and how a backup is proved restorable. To report a security problem, see [SECURITY.md](../SECURITY.md).

## Security, scanning and the restore drill

**Scanning.** `.github/workflows/security.yml` runs from the CI workflow on every pull request,
on `main` and every night, whatever changed, because a new advisory can fail an unchanged
lockfile. The CI gate needs it. It checks the registry signature of every
installed package (`npm audit signatures`), every locked dependency against the OSV database
(OSV-Scanner, with the reviewed exceptions in `osv-scanner.toml`), and every commit for secrets
(gitleaks, with `.gitleaks.toml`: the default rules, plus one made-up key the content checks must
recognise). Run them locally with `npm audit signatures`, `osv-scanner scan source --lockfile
package-lock.json --config osv-scanner.toml` and `gitleaks git --config .gitleaks.toml .`.

**The restore drill** (NFR-044, NFR-045). `npm run db:restore-drill` backs up the database in
`DATABASE_URL_MIGRATE` (or `--source <url>`; the owner or a superuser) with `pg_dump`, restores it
into a new scratch database with `pg_restore` in one transaction, and proves the copy is the same
database: every table's rows and every sequence equal the snapshot the dump was taken from; every
sealed edition's digest recomputes to the stored one, both with `edition_content_digest` and in
TypeScript from the restored rows; every item and vocabulary version served by an edition
recomputes to its content digest; and the history log's hash chain verifies with
`audit_verify()` and with the drill's own copy of the rule, ending on the source's last hash. It
prints the times and a verdict (`--json` for the full report), drops the scratch copy unless
`--keep`, and exits 1 on any difference. It needs `pg_dump` and `pg_restore` from PostgreSQL 18 on
`PATH`. `tests/integration/restore-drill.test.ts` runs it through the script and shows that a
changed row, version, edition digest or history entry is each reported.
