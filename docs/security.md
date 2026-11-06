---
title: Security, scanning and the restore drill
line: What is scanned, how a backup is proved restorable, and where to report a security problem.
group: Run the service
order: 7
reviewed: 2026-11-05
---

What is scanned on every change, and how to prove a backup restores. To report a security problem, see the [security policy](../SECURITY.md).

## What is scanned

The scans run on every pull request, on `main` and every night, whatever changed, because a new advisory can fail an unchanged lockfile. A change cannot merge until they pass.

| Scan        | What it checks                                                                 |
| ----------- | ------------------------------------------------------------------------------ |
| Signatures  | The registry signature of every installed package, with `npm audit signatures` |
| OSV-Scanner | Every locked dependency against the OSV database, with reviewed exceptions     |
| gitleaks    | Every commit, for secrets                                                      |

## The restore drill

The drill proves a backup restores, without touching your database:

```sh
npm run db:restore-drill
```

It needs `pg_dump` and `pg_restore` from PostgreSQL 18 on `PATH`. In containers, run it inside the service: see [Self-host Heed on one computer](self-hosting.md#prove-the-backup-restores-the-restore-drill).

1. It backs up the database with `pg_dump`.
2. It restores that into a new scratch database, in one transaction.
3. It proves the copy is the same (below).
4. It prints the times and a verdict, and drops the copy.

The copy has to match on all of these:

- every table's rows and every sequence;
- every sealed edition's digest;
- the content digest of every item and vocabulary version an edition serves;
- the history log's hash chain.

| Option           | What it does                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `--source <url>` | Backs up this database, as the owner or a superuser. By default it is `DATABASE_URL_MIGRATE` |
| `--json`         | Prints the full report                                                                       |
| `--keep`         | Keeps the scratch copy                                                                       |

It exits with 1 on any difference.
