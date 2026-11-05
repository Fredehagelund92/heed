---
title: Service settings
line: The settings the service reads from its environment when it starts, with their defaults.
group: Run the service
order: 4
reviewed: 2026-11-05
---

The service reads its settings from the environment, once, when it starts. If one is wrong, it refuses to start and names each bad setting.

`.env.example` lists every setting. Copy it to `.env.local`, which `npm run dev:server` loads. Settings an admin changes while the service runs, such as limits, are in [Administer the service](administration.md#change-a-setting).

## The service

| Setting     | Default       | What it does                                                               |
| ----------- | ------------- | -------------------------------------------------------------------------- |
| `NODE_ENV`  | `development` | `development`, `test` or `production`. The service image sets `production` |
| `HOST`      | `127.0.0.1`   | The address it listens on                                                  |
| `PORT`      | `3000`        | The port it listens on                                                     |
| `LOG_LEVEL` | `info`        | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`             |

## The database

| Setting                  | What it does                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `DATABASE_URL`           | The service's own role. Required                                                           |
| `DATABASE_URL_SERVE`     | The restricted role that serves agents. Unset, it is `DATABASE_URL` with the user changed  |
| `DATABASE_URL_MIGRATE`   | The owner, for migrations and backups. The service image needs it                                                    |
| `DATABASE_URL_BOOTSTRAP` | A superuser, to create the roles and the database when they are missing, and load the demo |
| `SEED_DEMO`              | `on` loads the demo into an empty database. Refused in production                          |

## Sign-in and addresses

| Setting                | Default                                          | What it does                                                                          |
| ---------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `HEED_AUTH`            | `oidc` in production, `dev` elsewhere            | How people sign in: see [Set up company sign-in](company-sign-in.md)                  |
| `HEED_DEV_PEOPLE_FILE` | The demo's people                                | Who the `dev` and `demo` pickers offer                                                |
| `HEED_WEB_ORIGINS`     | `http://localhost:5173`, `http://localhost:4173` | The web app's origins, comma-separated. The first is the address links go to          |
| `HEED_TRUSTED_PROXIES` | None                                             | The proxies it believes: see [The proxy in front](where-to-run.md#the-proxy-in-front) |
| `MCP_RESOURCE_URL`     | `http://localhost:3000/mcp`                      | The MCP address                                                                       |
| `MCP_DEV_KEY_FILE`     | `.heed-dev-key.pem`                              | The key for dev tokens. Production refuses dev tokens                                 |

The login server's own settings are on [Sign in your own agent](ai-sign-in.md#the-login-server-settings).

## Models

| Setting                     | Default | What it does                                                  |
| --------------------------- | ------- | ------------------------------------------------------------- |
| `MODELS`                    | `mock`  | `mock` is scripted and sends nothing. `live` uses real models |
| `ANTHROPIC_API_KEY`         | None    | The key for the `anthropic` provider                          |
| `VERCEL_AI_GATEWAY_API_KEY` | None    | The key for the `vercel-gateway` provider                     |

With `live`, each role's provider and model come from the `models.*` settings, and the service refuses to start when a provider, a model or a key is missing, or the provider does not list the model.

> **Before you go live.** Questions and answers then leave your company to the named provider and the model's vendor. Real company data needs company approval of them first.

## Connectors

| Setting                        | Default | What it does                                                                                                                        |
| ------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `CUBE_MODEL_DIR`               | None    | A folder of Cube model files. Unset, the service reads two invented definitions, or in the image outside production, the demo model |
| `HEED_DOMAIN_OVERRIDES`        | None    | A JSON file: view to domain, for what the model leaves unnamed                                                                      |
| `CUBE_RENAMES_FILE`            | None    | A JSON file of renamed members, old id to new id                                                                                    |
| `CUBE_COMPILE_TIMEOUT_SECONDS` | `120`   | How long Cube's compiler may take                                                                                                   |
| `CUBE_COMPILE_MEMORY_MB`       | `1024`  | The memory Cube's compiler may use                                                                                                  |
| `HEED_SERVER_FOLDERS`          | None    | A JSON object of connector ids to folders on the server                                                                             |
| `HEED_EGRESS_PRIVATE_HOSTS`    | None    | Hosts on a private network connectors may reach over https, comma-separated                                                         |
| `HEED_SECRETS_DIR`             | None    | The folder that keeps the tokens of sources added in Integrations                                                                   |

`HEED_SERVER_FOLDERS` looks like `{"dbt-metricflow":"/srv/dbt/target"}`. Each folder is read by that connector as one of the server's own sources, and the demo definitions stop. In Docker, share the folder into the container and name its path there.

A connector that cannot read a folder stops the service at start. A folder that is not there shows as a failed read in Settings, Integrations.

> **Moving off a server folder.** Moving a project from a server folder to a source of the same definitions is not supported yet. A server source taken out of the configuration keeps its definitions, so a source added later cannot take them.

`HEED_EGRESS_PRIVATE_HOSTS` applies to files and APIs read over https, not to Git or figures. An admin in the app cannot add a host: see [Connector security](connectors/security.md#what-a-connector-may-reach).

`HEED_SECRETS_DIR` must be outside the repository, and only the server's user may open it (mode 0700). Unset, no secret is kept, and a source that needs one cannot be added.

## The product

| Setting              | Default                | What it does                                                                                  |
| -------------------- | ---------------------- | --------------------------------------------------------------------------------------------- |
| `HEED_PRODUCT_NAME`  | `Heed`                 | The name the app and the help pages say                                                       |
| `HEED_SUPPORT_EMAIL` | `support@heed.example` | Where Contact support and Report a problem write to. Read when the app and the docs are built |
| `HEED_METRICS_TOKEN` | None                   | Turns on [`/metrics`](operations.md#metrics). At least 32 characters                          |
| `HEED_FIXED_TODAY`   | None                   | Pins the service's day for demos and tests. Refused in production                             |

Report a problem opens a mail in the person's own mail app, and sends nothing through the service.
