---
title: Run and operate the service
line: Run the service, check it is healthy, run it in production, and read its jobs, limits and metrics.
group: Run the service
order: 3
reviewed: 2026-11-05
---

Start the service, check it is healthy, and run it in production. To compare the ways to run it, see [Where to run Heed](where-to-run.md). In containers on one computer, see [Self-host Heed on one computer](self-hosting.md).

## Run the service locally

The service needs Node 26 and PostgreSQL 18. On macOS with Homebrew:

```sh
brew install postgresql@18 && brew services start postgresql@18
cp .env.example .env.local        # adjust the database addresses if your server differs
npm run db:migrate                # creates the roles and the database, applies the schema
npm run dev:server                # http://127.0.0.1:3000, restarts on change
```

`npm run db:migrate` is safe to run again.

The service starts empty. To load the demo, set `SEED_DEMO=on`, as `.env.example` does. It loads into a database that holds nothing yet, as long as `CUBE_MODEL_DIR` is the demo's model. Production refuses it, so a real install never gets demo data by accident.

## Check that it runs

```sh
curl localhost:3000/health         # answers while the process runs
curl localhost:3000/health/ready   # also asks the database: 503 when it cannot reach it
```

Both name the version that runs.

Logs are JSON lines on stdout. Each line about a request carries its id (`reqId`), and the response returns the same id as `X-Request-Id`, so a person can quote it. A history log entry written by that request carries the id too.

Logs never hold a header, a body, a query string, a credential or a person.

## Run the image in production mode

The service image starts in production mode unless told otherwise. People sign in with your company's provider, and the people picker, dev tokens and the demo are refused. With no sign-in set up, it refuses to start and names the missing settings.

`compose.yaml` sets `NODE_ENV=development`, the one setting the demo needs. That turns on the people picker, where anyone can sign in as anyone, an admin included.

To run the image in production mode, beside a PostgreSQL 18 database:

1. **Set up sign-in.** Follow [Set up company sign-in](company-sign-in.md).
2. **Make the keys, once.** They go in the volume that keeps them, and a key that exists is kept:

   ```sh
   docker run --rm -v heed-keys:/var/lib/heed <image> npm run keys:create
   ```

3. **Set the addresses.** The login server for agents needs https in production:

   ```sh
   MCP_RESOURCE_URL=https://heed.example.com/mcp
   HEED_WEB_ORIGINS=https://heed.example.com
   ```

4. **Put a TLS proxy in front.** It sends `/api/v1/`, `/mcp`, `/oauth/` and `/.well-known/oauth-*` to the service directly, and only the rest to the web image, with the public host.
5. **Name that proxy** in `HEED_TRUSTED_PROXIES`: see [The proxy in front](where-to-run.md#the-proxy-in-front).

See [Service settings](configuration.md) for every other setting, and the [database guide](../db/README.md) for the roles.

## Request limits

Every request under `/api` counts against a limit each minute, the setting `limits.api_rate_per_minute`.

| Who                        | Limit a minute |
| -------------------------- | -------------- |
| A signed-in person         | 600            |
| An address, before sign-in | 120            |

Over a limit, the answer is 429 with `Retry-After` in seconds. Each instance counts on its own. `/health`, `/health/ready` and `/metrics` are not limited.

The address is the one that connected, unless that is a proxy named in `HEED_TRUSTED_PROXIES`. Then it is the address the proxy forwards. Unset, the service believes no forwarded address.

## Scheduled jobs

The service runs its own jobs on the same database. A job that came due while the service was stopped runs once when it starts again.

| Job                      | When (UTC)       | What it does                                                   |
| ------------------------ | ---------------- | -------------------------------------------------------------- |
| `observability.rollup`   | Each night       | Keeps the weekly counts, which are kept without limit          |
| `partitions.ensure`      | Each night       | Makes the database partitions coming up                        |
| `observability.snapshot` | Each night       | Keeps the last whole month's counts                            |
| `retention.run`          | Each night       | Clears what has passed its retention period                    |
| `outbox.relay`           | Every minute     | Delivers events the relay has not delivered yet                |
| `saved.check`            | Every minute     | Checks saved questions once what agents get has moved          |
| `evals.work`             | Every minute     | Works through queued evaluations                               |
| `evals.retrieval`        | Every minute     | Runs the free retrieval checks                                 |
| `evals.weekly`           | Mondays          | Runs the weekly evaluation                                     |
| `connectors.sync`        | Every 5 minutes  | Reads each source that is due, on its own schedule             |
| `jobs.watchdog`          | Every 5 minutes  | Raises an alert for a job that is late or a source out of date |
| `gaps.detect`            | Every 15 minutes | Turns questions that found nothing into Not found cards        |
| `alerts.raise`           | Every 15 minutes | Runs the alert rules, which raise Inbox cards                  |

`GET /api/v1/operations` shows each job's last success and last error, the queue, the sources and model spending, for an admin session. To run a job now:

```text
POST /api/v1/operations/jobs/retention.run/run
```

Problems are error log lines with an `alert` field: `job_failed` after the last retry, and `job_overdue` and `connector_stale` from the watchdog.

## Metrics

`GET /metrics` serves the service's numbers in the Prometheus text format. Turn it on with a token of at least 32 characters. Without one, the address answers 404.

```sh
HEED_METRICS_TOKEN=$(openssl rand -hex 32)
curl -H "Authorization: Bearer $HEED_METRICS_TOKEN" localhost:3000/metrics
```

It counts HTTP requests by route, MCP requests by tool, status and agent family, and what the operations view shows: jobs, queues, source age, model spending and the database pool.

Labels come from fixed lists, never a path, a question, a person or an agent's own name. Counts here are exact for whoever holds the token, unlike Observability, which hides small counts.

## Settings that started with CL_

Every setting that now starts with `HEED_` used to start with `CL_`, and the rest of its name is the same.

This version still reads an old name when the new one is unset or empty, and a new name that is set always wins. Each process that reads an old name prints one warning at start, with the old settings in use and their new names, never their values.

The next version reads the new names only, so rename them in `.env.local`, in your own compose file and wherever else the service runs.
