---
title: Run the demo on Vercel and Neon
line: The web app as static files, the service as one function, and PostgreSQL 18 on Neon.
group: Run the service
order: 8
reviewed: 2026-11-05
---

Run the demo as a Vercel project with its database on Neon. To run it for your own team, see [Where to run Heed](where-to-run.md) instead.

> **Keep it behind a login.** This is a hosted trial, not a public demo. Anyone who can open the deployment can pick any person, an admin included, and change settings. Keep it behind [Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication), so only your team gets in.

## What runs where

| Part                | Where                | What it is                                                                    |
| ------------------- | -------------------- | ----------------------------------------------------------------------------- |
| The web app         | Vercel's CDN         | The same build the web image serves                                           |
| The service         | One Vercel function  | The same service, answering `/api/v1` and `/health`                           |
| The database        | Neon, PostgreSQL 18  | Reached through Neon's connection pooler, as `context_layer_api`              |
| The demo, as a file | Your computer, or CI | The demo seeded on a PostgreSQL you are a superuser of, then restored on Neon |

The web app and the function share one address, so the session cookie works as it does behind the web image.

## What the function leaves out

- **Scheduled jobs.** An instance is frozen between requests, so jobs never run. A demo reset from its snapshot does not need them.
- **The MCP server and the login server for agents.** Only `/api/v1` and `/health` reach the function.
- **The Cube compiler.** Integrations cannot read or check a Cube model. With `CUBE_MODEL_DIR` unset, it serves the demo's definitions.

Inbox items still arrive with the change that makes them.

## Build

`npm run build:vercel` builds the web app and bundles the service into one file. `vercel.json` sets the rest, with the function in Frankfurt (`fra1`) and 60 seconds to answer.

The build also checks the page's inline script against the `Content-Security-Policy` in `vercel.json`. When they differ, it stops and prints the `script-src` to put there.

To see what Vercel would build without deploying, run `vercel build` in a copy of the repository that is linked to a project.

## The database on Neon

Create the Neon project in the same region as the function: AWS Europe Central 1 (Frankfurt) for `fra1`. Choose PostgreSQL 18, which the migrations need.

### Roles

1. In the Neon console, create `context_layer_owner`, and a database `heed` that it owns.
2. Connect as `context_layer_owner` and create the three runtime roles, each with a long random password of its own:

   ```sql
   create role context_layer_api login password '<password>' nosuperuser nocreaterole noinherit nobypassrls nocreatedb;
   create role context_layer_serve login password '<password>' nosuperuser nocreaterole noinherit nobypassrls nocreatedb;
   create role context_layer_readonly login password '<password>' nosuperuser nocreaterole noinherit nobypassrls nocreatedb;
   ```

Use SQL rather than the console for these. A role made in the console is a member of `neon_superuser`, and `npm run db:snapshot` refuses a runtime role with that much power.

Keep the passwords in your password manager and in the project's settings, never in a file in the repository.

### The demo, from a snapshot

The demo seed needs a superuser, and Neon has none. So seed it on a PostgreSQL 18 you are a superuser of, such as a local one, and restore the file as the owner.

```sh
# 1. Seed the demo in a scratch database and write it to a file (about 3 MB, a minute or two).
DATABASE_URL_BOOTSTRAP=postgres://<superuser>@localhost:5432/postgres \
  npm run db:snapshot -- take --file heed-demo.dump --model vercel-gateway:anthropic/claude-haiku-5.5

# 2. Restore it into the empty database on Neon, as the owner, on the direct address.
DATABASE_URL_MIGRATE='postgres://context_layer_owner:<password>@<endpoint>.eu-central-1.aws.neon.tech/heed?sslmode=require' \
  npm run db:snapshot -- restore --file heed-demo.dump
```

- `--model` sets every model role but the judge to that provider and model, so the service can start with real models. Without it, the file keeps the defaults, which need `ANTHROPIC_API_KEY`.
- `restore` refuses a database that already holds anything.
- Use Neon's direct address for `restore`, `reset` and `npm run db:migrate`, never the pooled one, with `-pooler` in its host. They need a session of their own.

### Reset the demo

This drops everything the owner owns in that database, including anything you added beside the demo, and restores the file. It refuses a database that holds anything but the demo.

```sh
DATABASE_URL_MIGRATE='<the owner, on the direct address>' npm run db:snapshot -- reset --file heed-demo.dump
```

With Neon branches, the reset can be Neon's own: restore the file into a branch `golden`, make the branch the function reads (`live`) its child, and reset `live` from its parent. The addresses stay the same.

The demo's story is told relative to the day it was seeded, and its partitions run a few months ahead. Take a new snapshot every month, and with each release that adds a migration.

## The project's settings

Set these as the project's environment variables in Vercel. A key or password goes in only there.

| Setting                     | Value                                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`              | `context_layer_api` on Neon's **pooled** address, with `?sslmode=require`                                            |
| `DATABASE_URL_SERVE`        | `context_layer_serve` with its own password                                                                          |
| `HEED_WEB_ORIGINS`          | The deployment's address, such as `https://heed-demo.vercel.app`. A preview address needs its own value              |
| `MCP_RESOURCE_URL`          | `https://<the same address>/mcp`. No MCP server runs, but company sign-in's default return address is on this origin |
| `NODE_ENV` and `HEED_AUTH`  | `development` and `demo` for the people picker. Or production with [company sign-in](company-sign-in.md)             |
| `MODELS`                    | `live` for Ask's own words from a real model. Start-up refuses until each role's provider has its key                |
| `VERCEL_AI_GATEWAY_API_KEY` | The key of the AI Gateway, with a budget on that key. Ask still answers without the model when the budget is spent   |
| `HEED_FIXED_TODAY`          | The day the snapshot was taken, so the demo's today stays its own. Refused in production                             |
| `LOG_LEVEL`                 | `info` unless set                                                                                                    |

The function sets `HEED_TRUSTED_PROXIES=vercel` and `HEED_LOGIN_SERVER=off` unless you do.

A preview address needs its own `HEED_WEB_ORIGINS`, because a change from any other address is refused.

## Callers' addresses and request limits

Every request reaches the function through Vercel's edge. `HEED_TRUSTED_PROXIES=vercel` believes that one hop and counts by the address the edge writes in `X-Forwarded-For`. So each visitor has a count of their own, and nobody can lock out sign-in for everyone else.

- Setting it to an empty value overrides the default, and every caller then shares one count.
- Never set `vercel` where anything but Vercel's edge connects. It believes whoever connects, so a caller could name any address and never be limited.
- The counts live in each instance, so a visitor may get more through at busy times. For a hard limit, add a rate limit rule in Vercel's firewall.

## Connections to the database

Each instance keeps at most five connections, on Neon's pooled address. Vercel closes idle ones before it freezes an instance, so a frozen instance holds none.

## Check a deployment

```sh
curl https://<address>/health/ready
```

It answers `"database":"ok"` once the function reaches Neon. A `503` with "The service could not start" means a setting is wrong, and the function's log names it.

To see Ask's words arrive a sentence at a time, sign in as a person and ask a question about a metric.
