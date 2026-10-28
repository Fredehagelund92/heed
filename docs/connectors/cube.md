# The Cube connector

The Cube connector is the first definition source (CON-501). It reads Cube model files, from the
server's own folder or from a Git repository an administrator adds, and gives Heed the public
members of the model as definitions. It is written to the [connector contract](../connectors.md),
interface 3.0: a manifest and a runtime in `src/connectors/cube/`, with a worker for its compiler
([its page](../../src/connectors/cube/README.md)). The rules it follows to reach a repository and
keep its token are in [Security and egress](security.md).

## The minimal Cube setup

What a Cube project needs for Heed to read it:

1. A folder of **YAML** Cube model files Heed can read: the server's folder, or a folder of a Git
   repository at a branch, tag or commit, with a read-only token (CON-502). JavaScript, Python
   and Jinja templates are skipped with `unsupported_file`, and a symbolic link, which is never
   followed, with `unreadable_file`.
2. It compiles with the pinned Cube compiler, **1.7.39** (`@cubejs-backend/schema-compiler`).
3. At least one **public view** (or public cube). Heed lists public members only.
4. Recommended: `title` and `description` on each public member, and `meta.domain:
<heed_domain_id>` on each view, with a member's own `meta.domain` to override it. The value
   must equal a Heed domain id exactly.
5. Optional: `meta.synonyms` on a member, a list of the other names people use for it
   (`[geo, market]`). A term proposed for the member takes them as other names, each for one
   term only.
6. Optional: `access_policy` with groups (used once CON-508 lands) and `meta.ai_context` (read
   later as a baseline, CON-513).
7. Never needed for a read: a running Cube server, a database, warehouse credentials or SQL
   access. A read never queries data and never stores SQL or a calculation. Figures in Ask are
   apart from it and off by default ([figures in Ask](#figures-in-ask)).

## A Cube model in a Git repository

An administrator adds one in Sources with:

| Field                   | Meaning                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Repository              | The https address of the repository (plain http only to this machine), without credentials.                              |
| Branch, tag or commit   | What Heed reads. A tag or commit holds still; a branch moves with each change.                                           |
| Model folder            | The folder of model files in the repository; empty for the top.                                                          |
| Read-only token         | A secret, in the secret store. Empty for a public repository.                                                            |
| User name for the token | Sent with the token; `x-access-token` when empty. Most hosts accept any.                                                 |
| Model folder address    | The folder in the host's web view, for links to each model file (as `sources.cube_model_url` is for the server's model). |
| Domain names            | The model's `meta.domain` value to the Heed domain it means (CON-206), for a model whose names differ from Heed's ids.   |

Each read fetches the one commit the ref names into a folder of its own (`ctx.git`), reads its
model folder as the server's folder is read, and removes it. The read's version and cursor are
the commit. A folder that leads out of the checkout is `folder_missing`. How Heed reaches the
repository, which addresses it refuses and how the token travels are in
[Security and egress](security.md#git). **Test connection** reaches the repository and counts the
model files, then reads the model once and keeps nothing; a repository it cannot reach fails with
the reason's code, as a read does.

Each source has its own schedule (CON-115): every hour unless an administrator sets another, at
most every 15 minutes, and at least every six hours, which is when a source goes out of date. A
failure that clears by itself (a host that could not be reached) is tried again after a minute,
then two, four and so on; any other failure waits a whole period.

The domain names apply before a domain is checked: a view whose `meta.domain` is `paid_media`
with the line `paid_media → area_paid_media` has the domain `area_paid_media`. A name without a
line stays as the model says it.

## Configuration of the server's model

Whoever runs the server sets three environment variables; Sources shows them read only. The
same Cube connector reads the folder: the core hands it to the runtime as `ctx.folder`, and
applies the domain names and the renames below to what it read.

| Variable              | Setting         | Meaning                                                                                   |
| --------------------- | --------------- | ----------------------------------------------------------------------------------------- |
| `CUBE_MODEL_DIR`      | Model folder    | The folder Heed reads. Unset, the server reads the demo source.                           |
| `CL_DOMAIN_OVERRIDES` | Domain names    | A JSON file outside the model folder: view to domain, for views the model names none for. |
| `CUBE_RENAMES_FILE`   | Renamed members | A JSON file: old id to new id.                                                            |

An administrator sets one versioned setting on the source's page, `sources.cube_model_url` (Model
folder address), described under "Links to model files". An old link to it on Limits opens it
there.

## Run a local refresh

After the database setup and migrations in [Run the service locally](../operations.md#run-the-service-locally):

```sh
# Uses invented demo definitions when CUBE_MODEL_DIR is unset.
npm run connectors:sync

# Reads this folder without modifying it. No Cube server or data warehouse is needed.
CUBE_MODEL_DIR=/path/to/cube/model npm run connectors:sync
```

The command reads `.env.local`, including `DATABASE_URL`. It prints the snapshot id, status,
number of definitions, metric domain coverage (`cube`, `override`, `none`), the items it flagged
and unflagged, and how many stale-link and domain notices it sent. A failed read is recorded and
exits with status 1. The service runs the same refresh in the `connectors.sync` job (each source
on its own schedule, hourly for Cube unless an administrator sets another); an administrator starts one at any time with
Read again on the source's page in Sources (`POST /api/v1/sources/{id}/read`, or
`POST /api/v1/operations/jobs/connectors.sync/run` for every source), and `GET /api/v1/operations` shows each
source's health (last read and its warnings, current and missing definitions, domain coverage,
flagged items and stale links), its views, its renames, its recent reads and, for a source this
server reads, its server settings. Sources and Operations show the same answer.

`CL_DOMAIN_OVERRIDES` optionally names a JSON file outside the model directory:

```json
{ "sales_analytics": "finance", "campaign_analytics": "paid_media" }
```

`CUBE_RENAMES_FILE` optionally names a JSON file of renamed members, old id to new id:

```json
{ "cube:growth_analytics.revenue": "cube:expansion_analytics.revenue" }
```

A rename is used only when the old member is gone from the model and the new one is in it; any
other entry is reported (`invalid_rename`). Items that reference the old member are flagged
`source_missing` with the new id named, and mentions of it show the new id.

Keys of the domain overrides are exact public view or cube names. Values must match `[a-z][a-z0-9_]{1,39}`. A member's
valid `meta.domain` takes precedence over its container's metadata. An invalid member value is
reported (`invalid_domain`) and the member falls back to a valid container domain. Local
configuration fills members that still have no source domain; valid Cube metadata wins. Invalid override values are reported too.
`area_hint` is a suggestion, including for dimensions; only metrics enter domain coverage.
This never creates domains or changes an accepted vocabulary term, proposal or edition.

## Links to model files

A read records the model file that defines each member's public view or cube, relative to the
model folder (`payments.yml`, `views/sales.yml`). The file is not part of the change mark: moving a
member to another file flags nothing. `GET /catalogue/{kind}/{id}` returns it as `modelFile.path`.

The administrator setting `sources.cube_model_url`, on the Cube source's page in Sources, is the
address of the model folder in the Git host's web view, for example `https://github.com/acme/analytics/blob/main/model`. It is off (null)
after the migration. When it is set and the read named a file, `modelFile.url` is the folder
address followed by the file's path, each segment encoded, and the Source tab of the metric or
dimension and the views on the source's page link to it. Otherwise `url` is null and the tab shows no link. The
service never calls the Git host: it only builds the address. Change the setting with
`PUT /settings/sources.cube_model_url` (an https address without credentials, query or fragment,
or null). The bulk seed turns it on for the demo model, which is in this repository.

## The demo model

`db/seed/cube` is an invented Cube model for the demo: seven public views over private cubes, one
per metric group plus `segments` for the dimensions, with titles, descriptions and `meta.domain`.
`operations` and `segments` have no domain on purpose, so a read warns about them (CON-516).
`Return on ad spend` takes its domain from its member. The bulk seed stores its read (see
`db/README.md`); point `CUBE_MODEL_DIR` at it to keep reading it, as `.env.example` does. After a
change to the model, run `tests/server/connectors/demo-model.test.ts` and copy the new read into
`src/web/mocks/cube-model.ts`.

## Compilation and stored data

The offline compiler is pinned to **1.7.39**.
It resolves view aliases and includes. Only public cubes/views and their public measures and
dimensions are listed. Access-policy group lists and per-group visibility are parked:
`visible_groups` is always null. No identity or data-query client is configured.

Each refresh compiles in the connector's worker (`ctx.worker`, T1): a child process with a
timeout and a V8 heap cap, 120 seconds and 1,024 MB, or what the server sets in
`CUBE_COMPILE_TIMEOUT_SECONDS` and `CUBE_COMPILE_MEMORY_MB` for a larger model (a model of 10,000
members takes about 45 seconds); a read may then take that long and a minute more to fetch. Node
denies network access, filesystem writes and starting other programs, and lets the worker read
only the service's source and dependencies and the project's package file. The runtime reads
the model files itself (through `ctx.git`, or `ctx.folder` for the server's folder) and hands
them to the worker over IPC, so the worker reads no model folder, and never the repository's
other files, the secret store, a home folder or another process's environment, since a model
from Git may be written by people who are not Heed's administrators. The compiler needs read
access, its native addon (which the operating system loads) and its own transpiler threads. On
Linux Cube asks at import which C library the machine runs (`getconf`, `ldd`); the service finds
that out before the process starts and the worker answers Cube itself
(`src/connectors/cube/libc.ts`), so it starts no program. The process receives no application
secrets from the environment.
This is failure isolation, not a sandbox for arbitrary executable model code. JavaScript,
Python and Jinja templates are skipped with `unsupported_file`, and a symbolic link, a file over
2 MB, input past 20 MB in all or a file that is not text with `unreadable_file`; only YAML is
passed to Cube. A model folder of more than 1,000 files fails the read (`too_many_records`).
Empty or unreadable model folders fail rather than deleting definitions, and a failed read names
why first, then each file it left out.

The pin also keeps change marks stable. A mark hashes the whole compiled member, so a compiler
upgrade changes every mark even when the model did not change: 1.8.1 changes every mark of the
fixture and of a real model tried with it, and the next read would flag every item that references
Cube.
Upgrading (1.8 drops the `extract-zip` dependency that `osv-scanner.toml` excuses) therefore needs
a mark built from a stable projection of the compiled member first.

A process is required because Cube 1.7.39's native logger aborts on a second load in successive
Node worker threads. Each compile has a fresh native runtime; a crash or timeout cannot abort
the Heed process. Raw compiler diagnostics are discarded because they can contain SQL.

Change marks hash canonical raw member nodes plus compiled member meaning, resolved alias
sources, source relation, type, description and public visibility (CON-505). The domain is not
part of the mark: a changed domain informs the owner and never flags an item. SQL and
functions are hashed in memory only; functions are never invoked by the reader. Formatting
and comments do not affect marks. Only ids, labels, a description copy of at most 500 characters,
value types, domain hints, other names (`meta.synonyms`, at most 20 of at most 200 characters
each), the own name of a member a view joins with `prefix: true` and hashes cross back to the
service.

Refreshes serialize per connector in PostgreSQL. Snapshot creation and definition updates
commit together. Marks are recorded on first sight, change or reappearance. A complete read
marks absent definitions missing without deleting their ids. A partial read updates members
it could read and preserves all unseen members. A failed read retains every previous mark and
status, and changes no flag or link status (CON-213, CON-214). Accepted vocabulary and editions
are never changed by a refresh.
`changesSince` reports changes after a successful snapshot and current missing definitions;
it is not a historical replay API.

## Figures in Ask

Off by default (FR-716, CON-612). An admin sets it up on Cube's page in Integrations: **Set up
figures** takes the data endpoint, the address of Cube's REST API `/v1/load`
(`https://cube.example.com/cubejs-api/v1/load`), and a read-only token for it, kept in the secret
store and sent only to that address's origin; then **Show figures in Ask** switches it on, once a
data contact is named. On the API it is `PUT /api/v1/figures/{id}`.

When someone asks in Ask, Heed reads one figure from Cube, apart from the answer and within 4
seconds, and keeps it nowhere:

1. The metric's definition decides which integration answers: the source that holds its ref under
   `cube:`. A metric no integration defines, or more than one does, gets no figure.
2. The query is a fixed template, never words a person or a model wrote: the view's measure, the
   view's one time dimension with the question's days (none, or more than one, and there is no
   figure), and an `equals` filter on the view's member each market term names, with the market's
   name and its other names as the values. Two GETs of `/v1/load`, the days and the days just
   before, and, once in ten minutes, `/v1/meta` for how the measure is worked out (`aggType`), so
   the query in words can say "added up".
3. The value is written as the model says: `format: currency` with `meta.currency` (`EUR`) for
   money, `format: percent` for a share. "Data as of" is Cube's `lastRefreshTime`.

No person's identity is passed to Cube: the token is the integration's own. A wrong or expired
token, a host that can't be reached and a query past its time say so in Ask, never what Cube said.
The demo model gives Orders a day (`orders.order_day`) and Marketing a market and a day for this,
and the tests read figures from a stand-in Cube over a seeded demo warehouse
(`tests/server/connectors/cube-server.ts`, `demo-warehouse.ts`).

## Validation

The conformance kit runs against the connector (`tests/server/connectors/conformance.test.ts`):
its manifest and README, its form, its check, its reads with the same marks each time, a partial
read when a file is not YAML, no calculation in a definition, and its token in nothing it
returns. `tests/server/connectors/cube.test.ts` reads the server's folder: the model-folder test
reads the demo model's files with every domain taken out, as a model looks before its data team
names domains. It checks every view in every file, the same members as with domains, a
missing-domain warning for each view, no calculation in the read and a folder left as it was. A
test of your own model's views and counts belongs outside the repository, next to your settings.
`tests/server/connectors/git.test.ts` reads a model from a real Git host on the machine (`git
http-backend` behind a server that wants a token): branches, tags and commits, the domain names,
every failure code, links checked out as plain files, and the token in git's environment only.
`tests/integration/cube-sources.test.ts` adds a Cube model in Git through the API with a schedule
of its own, reads it through the sources' job, backs off after a host that could not be reached,
and proves a read never publishes, decides or suggests anything.
