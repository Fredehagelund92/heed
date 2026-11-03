# Run Heed on Vercel and Neon

Heed can run as a Vercel project with its database on Neon: the web app as static files, the
service as one function, and PostgreSQL 18 on Neon. This page says what runs where, how to build
it, how to get the demo into a database that has no superuser, and which settings the project
needs.

This is for a hosted trial of the demo. It is not yet a public demo: anyone who can open the
deployment can pick any person, an administrator included, and change settings. Until a demo mode
locks that down, keep the deployment behind
[Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication),
so only your team gets in. To run Heed for real people, see
[Run the image in production mode](operations.md#run-the-image-in-production-mode).

## What runs where

| Part                | Where                      | What it is                                                                                                |
| ------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------- |
| The web app         | Vercel's CDN               | `dist/web`, the same build the web image serves, in http mode                                             |
| The service         | The function `api/heed.js` | `src/server/vercel.ts`, bundled into `dist/vercel/heed.mjs`. It answers `/api/v1` and `/health`           |
| The database        | Neon, PostgreSQL 18        | The function reads and writes it through Neon's connection pooler, as `context_layer_api`                 |
| The demo, as a file | Your computer, or CI       | `npm run db:snapshot`: the demo seeded on a PostgreSQL you are a superuser of, then restored as the owner |

The web app and the function share one address, so the session cookie and the check on where a
change comes from work as they do behind the web image's nginx.

The function is the same service as `src/server/main.ts`, built by the same `createService`
(`src/server/service.ts`), with these differences:

- **No scheduled jobs.** An instance is frozen between requests, so the job runner never starts.
  Retention, partitions, the weekly rollups, evaluations and the watchdog do not run. A demo that
  is reset from its snapshot does not need them. Running a job now is refused, as the runner is
  not running.
- **No outbox listener.** Instead, after each change through the API the function relays the
  outbox once, and Vercel keeps the instance up until that is done (`waitUntil`). Inbox items
  still arrive with the change that makes them.
- **No MCP server and no login server for agents.** Only `/api/v1` and `/health` reach the
  function, and it sets `HEED_LOGIN_SERVER=off` unless you set it.
- **No Cube compiler.** The function leaves Cube's native compiler out, so Sources cannot read or
  check a Cube model. With `CUBE_MODEL_DIR` unset it serves the demo's definitions.

## Build

`npm run build:vercel` (`scripts/vercel-build.ts`) does three things:

1. Builds the web app in http mode into `dist/web`, always as a production build, whatever
   `NODE_ENV` the project sets for the service.
2. Checks that the `Content-Security-Policy` in `vercel.json` lets exactly the built page's inline
   script run. The page carries one, which sets the theme before the app loads. When it changes
   (or `HEED_PRODUCT_NAME` changes it), the build stops and prints the `script-src` to put in
   `vercel.json`.
3. Bundles the service into `dist/vercel/heed.mjs`, about 8 MB. Without the bundle, Vercel would
   trace every package into the function, over its 250 MB limit. The bundle carries Heed's version
   and the picker's people (`HEED_DEV_PEOPLE_FILE`, at build time), which the service otherwise
   reads from files beside its code.

`vercel.json` sets the rest: `npm ci` to install, `dist/web` as the output, the function in
Frankfurt (`fra1`) with 60 seconds to answer, the addresses that go to the function, every other
address to the web app's `index.html`, and the web image's security headers on the web app's
files (`docker/security-headers.conf`; a test keeps the two the same). Vercel adds HSTS itself
([Encryption and TLS](https://vercel.com/docs/cdn-security/encryption#support-for-hsts)).

To see what Vercel would build without deploying, run `vercel build` in a copy of the repository
that is linked to a project. `.vercel/` is ignored by git.

## The database on Neon

Create the Neon project in the same region as the function: AWS Europe Central 1 (Frankfurt) for
`fra1`. Choose PostgreSQL 18: the migrations need it.

### Roles

Heed connects as four roles, each with its own password ([db/README.md](../db/README.md)):

1. Create `context_layer_owner` in the Neon console, and a database `heed` that it owns. It owns
   every object Heed makes and is the only role that restores the demo or applies migrations.
2. Connect as `context_layer_owner` and create the three runtime roles, each with a long random
   password of its own:

   ```sql
   create role context_layer_api login password '<password>' nosuperuser nocreaterole noinherit nobypassrls nocreatedb;
   create role context_layer_serve login password '<password>' nosuperuser nocreaterole noinherit nobypassrls nocreatedb;
   create role context_layer_readonly login password '<password>' nosuperuser nocreaterole noinherit nobypassrls nocreatedb;
   ```

   Create them with SQL rather than in the console: a role made in the console is a member of
   `neon_superuser`, which may create roles and databases and bypass row security. A runtime role
   must not. `npm run db:snapshot` refuses a runtime role that is a superuser, bypasses row
   security, may create roles or databases, or belongs to another role.

Keep the passwords in your password manager and in the project's environment variables, never in
a file in the repository.

### The demo, from a snapshot

The demo seed needs a superuser, and Neon has none. So the demo is seeded on a PostgreSQL 18 you
are a superuser of, such as a local one, and written to a file that the owner restores alone.

```sh
# 1. Seed the demo in a scratch database and write it to a file (about 3 MB, a minute or two).
DATABASE_URL_BOOTSTRAP=postgres://<superuser>@localhost:5432/postgres \
  npm run db:snapshot -- take --file heed-demo.dump --model vercel-gateway:anthropic/claude-haiku-5.5

# 2. Restore it into the empty database on Neon, as the owner, on the direct address.
DATABASE_URL_MIGRATE='postgres://context_layer_owner:<password>@<endpoint>.eu-central-1.aws.neon.tech/heed?sslmode=require' \
  npm run db:snapshot -- restore --file heed-demo.dump
```

`take` creates Heed's roles on that server when they are missing, as `npm run db:migrate` does,
and drops its scratch database when it is done. It relays the demo's outbox, so the demo's inbox
items are in the file. `--model` sets every model role but the judge to that provider and model,
so the service can start with real models: without it the file keeps the defaults (Anthropic,
which needs `ANTHROPIC_API_KEY`). `restore` refuses a database that holds anything, then applies
the grants.

Use Neon's direct address for `restore` and `reset`, never the pooled one (with `-pooler` in its
host): `pg_restore` needs a session of its own. The same goes for `npm run db:migrate`, whose
migrations take a session lock.

To put the demo back as it was, run `reset` with the same file. It drops everything the owner owns
in that database, then restores the file. It refuses a database that holds anything but the demo.

```sh
DATABASE_URL_MIGRATE='<the owner, on the direct address>' npm run db:snapshot -- reset --file heed-demo.dump
```

With Neon branches the reset can also be Neon's own: restore the file into a branch `golden`, make
the branch the function reads (`live`) its child, and reset `live` from its parent. The addresses
stay the same.

The demo story is told relative to the day it was seeded ("published today"), and its partitions
run a few months ahead. Take a new snapshot every month, and with each release that adds a
migration.

## The project's settings

Set these as the project's environment variables in Vercel. A key or password goes in only there.

| Setting                                                   | Value                                                                                                                                                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                            | `context_layer_api` on Neon's **pooled** address, with `?sslmode=require`                                                                                                                                                      |
| `DATABASE_URL_SERVE`                                      | `context_layer_serve` with its own password. Set it: the default is `DATABASE_URL` with the user changed and the password dropped. The function opens no serving pool today, as it serves no MCP server                        |
| `HEED_WEB_ORIGINS`                                        | The deployment's address, such as `https://heed-demo.vercel.app`. A change from any other address is refused, so a preview address needs its own value                                                                         |
| `MCP_RESOURCE_URL`                                        | `https://<the same address>/mcp`. The function serves no MCP server, but company sign-in's default return address is on this origin                                                                                            |
| `NODE_ENV` and `HEED_AUTH`                                | `development` and `demo` for the people picker, which production refuses; or production with company sign-in ([operations.md](operations.md#run-the-image-in-production-mode)). The web app is built for production either way |
| `MODELS`                                                  | `live` for Ask's own words from a real model. Start-up refuses until every model role's provider has its key, which `--model` on the snapshot arranges for one provider                                                        |
| `VERCEL_AI_GATEWAY_API_KEY`                               | The key of the AI Gateway, with a budget on that key. Ask still answers without the model when the budget is spent                                                                                                             |
| `HEED_FIXED_TODAY`                                        | The day the snapshot was taken, so the demo's "today" stays its own. Refused in production                                                                                                                                     |
| `LOG_LEVEL`                                               | `info` unless set                                                                                                                                                                                                              |
| `HEED_TRUSTED_PROXIES`, `HEED_LOGIN_SERVER` (set for you) | `vercel` and `off`: the function sets both unless you do                                                                                                                                                                       |

## Callers' addresses and request limits

Every request under `/api` counts against a per-minute limit, by person once signed in and by
address before ([operations.md](operations.md#run-the-service-locally)). Behind Vercel every
request reaches the function through Vercel's edge, so the address of the connection is always
the edge's. `HEED_TRUSTED_PROXIES=vercel` believes the one hop in front and counts by the last
address in `X-Forwarded-For`, which the edge writes itself: it drops whatever address a caller
sends ([Vercel's request headers](https://vercel.com/docs/headers/request-headers)). So each
visitor has a count of their own, and nobody can lock out sign-in for everyone else.

Never set `vercel` where anything but Vercel's edge connects to the service: it believes whoever
connects, so a caller could name any address and never be limited.

The counts live in each instance, and Vercel runs several at busy times, so a visitor may get
more requests through than the limit says. For a hard limit at the edge, add a rate limit rule
in Vercel's firewall.

## Connections to the database

Each instance keeps a pool of at most five connections, on Neon's pooled address. Every statement
the function sends runs inside a transaction, and every setting it makes is local to its
transaction, which the pooler supports. The pool is handed to Vercel (`attachDatabasePool`), which
closes idle connections before it freezes an instance, so a frozen instance holds none.

## Check a deployment

```sh
curl https://<address>/health/ready
```

answers `"database":"ok"` once the function reaches Neon. A `503` with "The service could not
start" means a setting is wrong: the function's log names it. To see Ask's words arrive a
sentence at a time, sign in as a person in the web app and ask a question about a metric. The
answers arrive as server-sent events; until that has been seen on a real deployment, check it on
the first one.
