# Internals

The published docs are written for people who want to do something. What they leave out lives here: requirement ids, design reasons, source paths and how things came to be. None of these pages is on the docs site, and they are free to name all of that.

When a reader page changes, change the matching page here in the same pull request, and keep ids out of the reader page (the [reader check](../../apps/docs/README.md#ready-for-readers) fails on them).

## Where things went

| Reader page                                                                                    | Its internals                                      | Requirements                                                                          |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [MCP and API reference](../reference.md) and [its pages](../reference/)                        | [The MCP tools and the HTTP API in detail](api.md) | FR-121, FR-138, FR-326, FR-331, FR-332, FR-338, FR-341 to FR-350, CON-517             |
| [Sign in your own agent](../ai-sign-in.md) and [Set up company sign-in](../company-sign-in.md) | [Agent and company sign-in](sign-in.md)            | FR-401 to FR-406, FR-408, FR-410 to FR-414, FR-416 to FR-418, FR-420, FR-421, NFR-022 |
| [Connectors](../connectors.md)                                                                 | [The contract](connector-contract.md)              | CON-101 to CON-119, CON-201 to CON-214, CON-601 to CON-612                            |
| [The Cube connector](../connectors/cube.md)                                                    | [The Cube connector: internals](cube-connector.md) | CON-501 to CON-517, FR-716                                                            |
| [Connector security](../connectors/security.md)                                                | [Security and egress](connector-security.md)       | CON-102, CON-105 to CON-107, CON-113, CON-114, CON-612                                |
| [Build a connector](../connectors/authoring.md)                                                | [Below](#build-a-connector)                        | CON-102, CON-106, CON-108, CON-113, CON-117, CON-201                                  |
| [Run and operate the service](../operations.md), [Service settings](../configuration.md)       | [Below](#run-and-operate-the-service)              | FR-408, FR-410, FR-614, NFR-047                                                       |
| [Administer the service](../administration.md)                                                 | [Below](#administer-the-service)                   | FR-120, FR-124, FR-407, FR-408, FR-801, FR-806 to FR-810, FR-813, NFR-045, NFR-093    |
| [Self-host Heed on one computer](../self-hosting.md), [Where to run Heed](../where-to-run.md)  | [Below](#self-hosting)                             | NFR-044, NFR-045                                                                      |
| [Security, scanning and the restore drill](../security.md)                                     | [Below](#scanning-and-the-restore-drill)           | NFR-044, NFR-045                                                                      |
| [Run the demo on Vercel and Neon](../vercel.md)                                                | [Below](#the-demo-on-vercel)                       |                                                                                       |

## Build a connector

The rules in the guide's contract section are the invariants I-1 to I-8 ([the table](connector-contract.md#invariants)):

| Invariant | In the guide               | Requirements              |
| --------- | -------------------------- | ------------------------- |
| I-1       | Definitions stay canonical | CON-201, CON-207          |
| I-2       | Definitions only flag      | CON-209 to CON-214        |
| I-3       | Content sources only draft | CON-603, CON-604, CON-606 |
| I-4       | Secrets stay in the store  | CON-105, CON-114          |
| I-5       | Domains are explicit       | CON-206, CON-602          |
| I-6       | Read only                  | CON-102, CON-106, CON-113 |
| I-7       | Your output is untrusted   | CON-107, CON-608          |
| I-8       | No vendor in the core      | CON-101, CON-103          |

- The ref prefix belongs to the tool (CON-117), and `mergeDimensions` decides how terms are proposed (CON-201). The kit is CON-108.
- Paths the guide reaches through links: the definition schema is `runtimeDefinitionSchema` in `src/domain/connector-runtime.ts`, the core's codes are `sourceWarningCodes` in `src/contract/operations.ts`, the helpers are in `src/domain/definition-helpers.ts`, and the kit's fakes are `tests/server/connectors/git-server.ts`, `drive-server.ts` and `object-server.ts`.
- To run only the connector tests by path: `npx vitest run --project server tests/server/connectors`.
- Cube and the static list pass `{ keepEmpty: true }` to `meaningMark`: their marks were first computed that way, and stay as they were.
- A shared input nested at each use grows without limit, which is why a mark takes an input's digest: a file an admin commits must not stall a read.
- The guide stays reader-ready, so it names files through links only. Keep it that way: an agent reads the link addresses, and `llms-full.txt` turns them into whole addresses.

## Run and operate the service

- The service reads its configuration in `src/server/config/env.ts`. `npm run db:migrate` is `db/prepare.ts`: it makes the roles and the database as `DATABASE_URL_BOOTSTRAP`, then applies migrations and grants as `context_layer_owner`. The container runs it before every start. `npm run seed` loads the demo and the variants the tests use by hand ([db/README.md](../../db/README.md)).
- `HEED_DEV_PEOPLE_FILE` defaults to `db/seed/people.local.yml`. `CL_DEV_PERSON` no longer signs requests in. `MODEL_PROVIDER` is refused, with a note on what replaced it. `HEED_WEB_READ_LOOPBACK` is for the end-to-end tests only.
- `HEED_PRODUCT_NAME` and what it does not rename: [the rename checklist](../rename-checklist.md).
- Request limits are FR-408. The web image's nginx forwards each caller's address and drops one a caller sends, and `compose.yaml` trusts it. nginx overwrites `X-Forwarded-For` with its own peer's address, so it gives per-caller limits only where it is the first proxy.
- Jobs: `observability.rollup` runs at 02:45, `partitions.ensure` at 03:00, `observability.snapshot` at 03:15 (the monthly snapshot of the withdrawn Summary) and `retention.run` at 03:30, all UTC. Jobs fail with retries and alerts (NFR-047). Job behaviour is in [the API page](api.md#observability) and [the evaluations page](../evaluations.md).
- `/metrics`: the MCP counter's `app_family` label comes from FR-410's fixed list, and counts exactly for operators, where Observability hides counts under `privacy.min_count` (FR-614).
- `settingSchemas` in `src/contract/admin.ts` says what each setting accepts.
- The CI job "Docker images: build, and boot the service in production mode" does the production steps against a stand-in provider (`tests/image/production-boot.sh`): it signs a person in through the web image, makes an access key and calls the MCP server with it.
- The site's commands avoid source paths: `npm run keys:create`, `npm run db:migrate` and `npm run db:restore-drill` are `src/server/create-keys.ts`, `db/prepare.ts` and `src/server/run-restore-drill.ts`, and the service image has npm and `package.json`.

## Settings named CL_ before 0.1.0

Before Heed 0.1.0 each setting that now starts with `HEED_` started with `CL_` instead, and the rest of its name is the same. Heed 0.1 still reads an old name when the new one is unset (or empty). The release after 0.1 reads the new names only. `src/domain/renamed-settings.ts` pairs each with its new name, and [the reader page](../operations.md#settings-that-started-with-cl_) says what to do.

The old names: `CL_AUTH`, `CL_DEV_PEOPLE_FILE`, `CL_DOMAIN_OVERRIDES`, `CL_FIXED_TODAY`, `CL_LOGIN_SERVER`, `CL_MCP_STATE_KEY_FILE`, `CL_METRICS_TOKEN`, `CL_OAUTH_CONNECTION_DAYS`, `CL_OAUTH_CONSENT_URL`, `CL_OAUTH_DYNAMIC_REGISTRATION`, `CL_OAUTH_ISSUER`, `CL_OAUTH_PREVIOUS_KEY_FILES`, `CL_OAUTH_REFRESH_IDLE_HOURS`, `CL_OAUTH_SIGNING_KEY_FILE`, `CL_OIDC_ADMIN_GROUPS`, `CL_OIDC_CLIENT_ID`, `CL_OIDC_CLIENT_SECRET_FILE`, `CL_OIDC_GROUPS_CLAIM`, `CL_OIDC_ISSUER`, `CL_OIDC_MEMBER_GROUPS`, `CL_OIDC_NAME`, `CL_OIDC_REDIRECT_URL`, `CL_OIDC_SCOPES`, `CL_PRODUCT_NAME`, `CL_SECRETS_DIR`, `CL_SESSION_IDLE_HOURS`, `CL_SESSION_MAX_DAYS`, `CL_SUPPORT_EMAIL`, `CL_TRUSTED_PROXIES`, `CL_WEB_ORIGINS`, `CL_WEB_READ_LOOPBACK`.

## Administer the service

- Settings are FR-809, the tool switch FR-407, client policies FR-408, domains FR-801 (with `PUT /areas/{id}/description`, FR-813), operations FR-810, and the history log FR-806 to FR-808.
- `POST /imports` is FR-120: the content is a list of items, or an object with an `items` list, up to 16 million characters. An exported item's `mentions` must match its markup, and a plain `summary` or `body` given with markup must equal its text. Applied proposals carry the channel `import`, in one transaction and one import batch.
- `GET /editions/{label}/export` is NFR-045 and NFR-093. It returns `heed.edition/1`, with mention markup and mention rows, and a version the audience rule hides is listed under `withheld`.
- `GET /schema/item` is FR-124, from the same definition that checks items.
- CSV exports prefix a cell starting with `=`, `+`, `-` or `@` with `'`. The audit search takes `limit` up to 200 and `before`, and the export takes `after`.
- For writes, see [Run the web app on the service](../development.md#run-the-web-app-on-the-service).

## Self-hosting

- `compose.yaml` names the project `heed` whatever the folder is called, so the volumes are `heed_db`, `heed_keys` and `heed_no-model`. Both containers run as unprivileged users (`node`, `nginx`), each with a health check, and the base images are pinned by digest.
- The keys in the volume are `oauth-key.pem` (signs agents' access), `mcp-state.key` (seals an agent's draft questions) and `mcp-dev-key.pem` (signs local MCP tokens).
- `db/prepare.ts` makes the roles a dump does not carry. Migration rules are in [db/README.md](../../db/README.md): forward only, and an applied migration is never changed.
- `scripts/check-web-image.ts` checks the web image in CI, including the one inline theme script allowed by its hash, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin` and a `Permissions-Policy` that turns off the camera, microphone and location. The app's first load is about a third of its raw size on the wire. HSTS over plain http would pin every other local app on `localhost` to https.
- A demo whose library loads but whose present does not (the Norway story, which fills the Inbox and Observability) logs at a later start that the present is missing.

## Scanning and the restore drill

- `.github/workflows/security.yml` runs from the CI workflow, and the CI gate needs it. It covers `package-lock.json`, `apps/mockup/package-lock.json` and `apps/docs/package-lock.json`, with exceptions in `osv-scanner.toml`, and `.gitleaks.toml` (the default rules plus one made-up key the content checks must recognise).
- Run the scans locally:

  ```sh
  npm audit signatures
  osv-scanner scan source --lockfile package-lock.json --lockfile apps/mockup/package-lock.json --lockfile apps/docs/package-lock.json --config osv-scanner.toml
  gitleaks git --config .gitleaks.toml .
  ```

- The restore drill is NFR-044 and NFR-045. Edition digests recompute with `edition_content_digest` and in TypeScript from the restored rows, and the hash chain verifies with `audit_verify()` and with the drill's own copy of the rule, ending on the source's last hash. `tests/integration/restore-drill.test.ts` shows that a changed row, version, edition digest or history entry is each reported.

## The demo on Vercel

- The function is `api/heed.js`, which loads `dist/vercel/heed.mjs`, built from `src/server/vercel.ts` by `scripts/vercel-build.ts`. It is the same service as `src/server/main.ts`, built by the same `createService` (`src/server/service.ts`).
- It has no outbox listener: after each change through the API it relays the outbox once, and Vercel keeps the instance up until that is done (`waitUntil`). Running a job now is refused, as the runner is not running.
- The build always builds the web app as a production build, whatever `NODE_ENV` the project sets. The bundle is about 8 MB, carries the version and the picker's people (`HEED_DEV_PEOPLE_FILE`, at build time), and keeps Vercel from tracing every package into the function.
- `vercel.json` carries the web image's security headers (`docker/security-headers.conf`; a test keeps the two the same). Vercel adds HSTS itself.
- `take` makes the roles when they are missing, and relays the demo's outbox so the inbox items are in the file. `restore` refuses a schema other than `public`, or a table, sequence, function or type in `public`, not counting what an extension made. Migrations take a session lock, which is why they need the direct address.
- The function opens no serving pool today, as it serves no MCP server. The default for `DATABASE_URL_SERVE` is `DATABASE_URL` with the user changed and the password dropped. Every statement runs inside a transaction, and every setting is local to its transaction, which the pooler supports. The pool is handed to Vercel with `attachDatabasePool`.
- Ask's words as server-sent events still have to be seen on a real deployment.
