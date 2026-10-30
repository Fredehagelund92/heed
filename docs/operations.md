# Run and operate the service

Running the Heed service on your own computer, its configuration, health checks, scheduled jobs and metrics, and the administration API, import and export. The [Quick start](../README.md#quick-start) runs all of it in containers with `docker compose up`.

## Run the service locally

The service (Heed) runs on Node 26 with PostgreSQL 18: in containers with `docker compose up`
([Quick start](../README.md#quick-start)), or on your computer for working on it. On macOS with Homebrew:

```sh
brew install postgresql@18 && brew services start postgresql@18
cp .env.example .env.local        # adjust the database addresses if your server differs
npm run db:migrate                # creates the roles and the database, applies the schema
npm run dev:server                # http://127.0.0.1:3000, restarts on change
```

`npm run db:migrate` (`db/prepare.ts`) creates Heed's roles and the database as the local
superuser (`DATABASE_URL_BOOTSTRAP`) when they are missing, then applies new migrations and the
grants as `context_layer_owner` (`DATABASE_URL_MIGRATE`). It is safe to run again, and the container
runs it before every start. The service itself starts empty: with `SEED_DEMO=on`, which
`.env.example` and `compose.yaml` set and which is off otherwise, it also loads the demo into a
database that holds nothing yet, as long as `CUBE_MODEL_DIR` is the demo's model. It is refused when
`NODE_ENV=production`, so a real install never gets demo data by accident. `npm run seed` loads
the demo, and the variants the tests use, by hand (db/README.md).

Check it: `curl localhost:3000/health` answers while the process runs, and
`curl localhost:3000/health/ready` also asks the database and answers 503 when it cannot reach
it. Logs are JSON lines on stdout. Every line about a request carries its id (`reqId`), and the
response returns the same id as `X-Request-Id`, so a person can quote it; the service makes its
own ids and ignores one a client sends. Logs never hold a header, a body, a query string, a
credential or a person.
A history log entry written by a request carries the same id (`requestId` in the history
search and export, `heed audit --request <id>`), so an entry and its log lines can be matched;
an entry written by a scheduled job has none.

Every request under `/api` counts against a per-minute limit (FR-408): 600 for each signed-in
person and 120 for each address before sign-in, the `limits.api_rate_per_minute` setting. Over
it, the answer is 429 with `Retry-After` in seconds. The counts live in the process, so each
instance counts on its own, and an address is the connection's peer, so behind a proxy everyone
before sign-in shares one count. `/health`, `/health/ready` and `/metrics` are not limited.

The service also runs its scheduled jobs (pg-boss on the same database): `partitions.ensure` and
`retention.run` each night (UTC), `outbox.relay` every minute (a backstop for the relay, see
[The outbox](reference.md#the-outbox-and-inbox-items)), `gaps.detect` every 15 minutes, `alerts.raise` every 15 minutes (the
alert rules raise Inbox cards, see [Alerts](reference.md#alerts)), `connectors.sync` every five minutes (reads each source that is
due on its own schedule, hourly for a definition source by default, see [Definition
sources](reference.md#definition-sources)), `saved.check` every minute (checks the saved questions once what agents
get has moved, see [Saved questions](reference.md#saved-questions)), `evals.work` and `evals.retrieval` every minute, `evals.weekly` on
Mondays (see [Evaluations](evaluations.md)), and `jobs.watchdog` every five minutes. A schedule that came
due while the service was stopped runs once when it starts again. `GET /api/v1/operations` shows each job's last success and last error, the queue, connectors and
model spending. For each connector it also shows source health: the last read and its warnings,
current and missing definitions, metric domain coverage, flagged items and stale links. `POST /api/v1/operations/jobs/retention.run/run` queues a job. Both require an
administrator session; the POST also requires the session CSRF token and an allowed Origin. Problems are error log lines with an `alert` field: `job_failed` after the last
retry, `job_overdue` and `connector_stale` from the watchdog.

`GET /metrics` serves the service's numbers in the Prometheus text format to a scraper that
presents `Authorization: Bearer <CL_METRICS_TOKEN>`; without the variable the endpoint is off
(404), and a session never opens it. It counts HTTP requests and their time by route template or
API operation, and MCP requests by tool, status and agent family (FR-410), and reads at scrape time what the operations
view shows: each job's last success, overdue jobs, runs and queue, connector age, model spending
for today and the month against its cap, the live edition's age and the database pool. Labels come from closed sets (routes, operations, tools, jobs, connectors, app
families), never a path, a question, a person or an agent's own name. The MCP counter's `app_family`
label counts exactly, for operators holding the metrics token, unlike Observability, which hides counts below `privacy.min_count` (FR-614).

Configuration comes from the environment, read once at start-up by
`src/server/config/env.ts`; `.env.example` lists every variable. The service refuses to start
and names each bad variable when one is wrong. `CL_AUTH` is `oidc` (company sign-in with
OpenID Connect, the default in production; set up as docs/ai-sign-in.md says), `dev` (the
default elsewhere) or `demo`: both pick a person from `CL_DEV_PEOPLE_FILE` (default
`db/seed/people.local.yml`), and production refuses both. Requests need an explicit cookie
sign-in; the old `CL_DEV_PERSON` setting no longer signs requests in. A browser session ends after
`CL_SESSION_IDLE_HOURS` unused (12) and `CL_SESSION_MAX_DAYS` after sign-in (7).
`CL_FIXED_TODAY` pins the service's day for demo runs and tests (refused in production).
`CL_PRODUCT_NAME` (default `Heed`) is the name the app and the help pages say; `docs/rename-checklist.md` covers what it does and does not rename. `CL_SUPPORT_EMAIL` is
the address the new web app's Contact support and Report a problem write to, read when the app and
the docs site are built: Report a problem opens a mail to it in the person's own mail app, with
what they wrote and the page's address, and sends nothing through the service. Unset, an address
that goes nowhere stands in (`support@heed.example`).
`MODELS` is `mock` (scripted, the default) or `live`: live uses each role's provider and model
from the `models.*` settings and the provider's key from `.env.local` (for example
`ANTHROPIC_API_KEY` or `VERCEL_AI_GATEWAY_API_KEY`). The service refuses to start when a role's
setting names a provider or model the registry does not have, or a provider whose key is missing,
and the message names the setting. `MODEL_PROVIDER` is refused with a note on what replaced it. `CL_METRICS_TOKEN` (at least 32 characters, for example
`openssl rand -hex 32`) turns `/metrics` on. `CUBE_MODEL_DIR` names a folder of Cube model files (unset: invented demo
definitions), with `CL_DOMAIN_OVERRIDES` and `CUBE_RENAMES_FILE` beside it. `CL_SECRETS_DIR` names
the local secret store, a folder outside the repository that only the server's user may open
(mode 0700), where sources added in Administration › Sources keep their tokens; unset, no secret
is kept and a source that needs one cannot be added.

Database setup, migration rules, the bulk demo seed and isolated test databases are documented
in [db/README.md](../db/README.md).

## Administration, import and export

This part covers the administrator's settings, the tool switch and client policies, the history log's
search and export, item import, edition export, the published item schema and `heed`, the
command-line tool. Writes need the session cookie, allowed `Origin` and `x-heed-csrf`, as in
[Run the web app on the service](development.md#run-the-web-app-on-the-service).

- **Settings** (FR-809): `GET /settings` lists the current version of each limit, threshold,
  retention period, review time and model.
  `PUT /settings/{key}` takes `{ version, value, reason }`: the version you read (409 when it
  moved), a value the setting accepts (`settingSchemas` in `src/contract/admin.ts`, 422
  otherwise) and a plain-text reason. A change is a new version and a `setting.changed` history
  entry naming the administrator. The services read the current version, so it applies at once.
- **Tool switch** (FR-407): `POST /tools/{tool}` with `{ enabled, reason }` switches an MCP tool
  on or off for every client (`tool.switched_on` or `tool.switched_off`).
- **Client policies** (FR-408), API only, with no screen in the web app: `GET /clients` and
  `PUT /clients/{label}` with `displayName`,
  `toolsAllowed` (null for every switched-on tool), `ratePerMinute` (null for the client rate in
  `limits.mcp_requests_per_minute`), `maxResponseBytes`
  (1,000 to 100,000), `enabled` and `reason` add a client label or change it. Labels are never
  removed; switch one off instead.
- **Domains** (FR-801): `POST /areas` creates one with an `id` that never changes, its name, hue
  (`label`), review time in working days (`reviewDays`, 1 to 30), chat channel, owner team,
  owners and approvers, its `summary` and `description`, and a reason; it is served from the start
  (`area.created`).
  `PUT /areas/{id}/description` (FR-813) lets the domain's owners
  or an administrator write its `summary` (one line, at most 160 characters) and
  `description` (light Markdown, at most 1,500) with the `revision` from `GET /areas`; it is
  recorded as `area.changed`. Both need an `Idempotency-Key`. Who looks after the domain changes
  with `/assignments/grant` and `/assignments/revoke` (API only, with no screen in the web app).
- **Operations** (FR-810): `GET /operations` and `POST /operations/jobs/{job}/run` (API only,
  with no screen in the web app), above.
- **History log** (FR-806 to FR-808): `GET /audit` searches newest first by `action` (a full name
  such as `setting.changed`, or a prefix such as `proposal`), `actorId`, `areaId`, `subjectType`,
  `subjectId` and UTC days `from` and `to`, 50 at a time (`limit` up to 200, `before` the page's
  `next`). `GET /audit/export` writes JSON Lines (one canonical JSON entry per line) or CSV
  (`format=csv`; a cell starting with `=`, `+`, `-` or `@` is prefixed with `'`), oldest first, up
  to 10,000 entries a call (`after` the export's `next`). Both report the hash chain of the whole
  log; `GET /audit/verify` checks only that. Administrators and auditors only. Reading or
  exporting the log is not itself logged (FR-807).
- **Item import** (FR-120): `POST /imports` takes `{ content, dryRun, submit, sourceName }`. The
  content is a YAML or JSON item file: a list of items, or an object with an `items` list, up to
  5,000 items and 16 million characters. Each item is a draft in the item format; one with an `id`
  proposes a change to that accepted item, and its unchanged fields need not be repeated. Every
  entry runs the form's level 1 checks: format, vocabulary, sensitive text, the owner, and
  mentions (syntax, live targets, the limit). An exported item's `mentions` must match its
  markup, and a plain `summary` or `body` given with markup must equal its text. An entry equal
  to its live version is `unchanged` and proposes nothing. A dry run (the default) changes
  nothing. An apply needs an `Idempotency-Key`; it makes proposals only when no entry has an
  error and there are at most 500 to make (unchanged entries do not count; split a larger change),
  all in one transaction and one import batch, with the channel `import`, and submits them
  for review unless `submit: false` keeps drafts. Nothing is ever accepted by an import.
- **Edition export** (NFR-045, NFR-093): `GET /editions/{label}/export` (owners and
  administrators) returns the edition as one document (`heed.edition/1`): every served item version in the item format with its version
  number and digest, mention markup and mention rows included; the vocabulary terms with theirs;
  the domain states; and the digest the edition was sealed with. A version the audience rule hides
  from the reader, or one that names such an item, is listed under `withheld` by id and digest
  only, so the edition digest still checks. `heed verify` recomputes every
  digest offline, for written content and for the demo bulk seed alike. An export reads back as an
  import.
- **Item schema** (FR-124): `GET /schema/item` publishes the JSON Schema of the item format,
  from the same definition that checks items. It needs no sign-in and is API only.

`heed` (`npm run heed -- <command>`) talks to the service through the typed contract client and
signs in as a person from the dev people file (`--as` or `HEED_EMAIL`; `--url` or `HEED_URL`,
else http://127.0.0.1:3000). For changes it presents the origin the service allows: `--origin` or
`HEED_ORIGIN`, else the first of `CL_WEB_ORIGINS`, else the service's default.

```sh
npm run heed -- validate lessons.yaml                  # no service needed
npm run heed -- import lessons.yaml --as per_maria@example.test           # dry run
npm run heed -- import lessons.yaml --apply --as per_maria@example.test   # proposals, for review
npm run heed -- draft item.yaml --as per_maria@example.test               # one draft
npm run heed -- import-tests questions.yaml --as per_maria@example.test   # test questions, dry run
npm run heed -- export --out edition.json --as per_maria@example.test     # the live edition
npm run heed -- verify edition.json                    # recompute the digests
npm run heed -- audit --format csv --as administrator@example.test
```

`heed import-tests` sends a test question file to `POST /evals/import` (a dry run unless
`--apply`). [docs/templates](templates) has a template for each file, with three worked
examples: `items.yaml` (items on the demo data) and `test-questions.yaml` (golden set cases).

`--json` prints the result as JSON for scripts and coding agents. The exit status is 0 when done,
1 when the file has problems or the service refused, and 2 for wrong usage.
