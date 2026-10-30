# Develop Heed

How the repository is laid out, how to run the front end, the commands, what CI runs, the rules and the versions. To run the whole product, see the [Quick start](../README.md#quick-start); to run and configure the service, see [Run and operate the service](operations.md).

## The two parts

The repository holds two parts. The **web app** in `src/app` is the approved mockup
(`apps/mockup`, the acceptance specification) on the repository's router, icon module, class merge
and lint. Its screens are listed with their addresses in [docs/product.md](product.md), section 5:
the Inbox and the review, Ask, Context, Definitions, Observability, Settings, Help and the docs, the
sign-in page and an agent's consent page. Its pages read their data through one typed interface,
`HeedApi` (`src/app/api/client.ts`), with TanStack Query: the mock binding answers from the
mockup's demo world, with its review flags (`?state=loading`, `?state=failed`, `?state=offline`,
`?slow=1`, `?demo=` and the rest), and the http binding talks to the service. `npm run dev` runs it
on the mock; `npm run dev:http` takes the http binding, which answers the wired methods
(`wiredMethods` in `src/app/api/http.ts`).

The **back end** is the service in `src/server`: a Fastify app with configuration, logging and a
health check, a PostgreSQL 18 database, scheduled jobs with an operations view, and the API the
app reads, described once in `src/contract` (oRPC, published as OpenAPI). See
[Run the web app on the service](#run-the-web-app-on-the-service).

### Words on screen and words in code

The screens and the help pages name things as people say them. The code, the API, the database
and the specification keep their own words. [src/domain/words.ts](../src/domain/words.ts) maps one
to the other, and [docs/design/copy.md](design/copy.md) says how to write; the service's own
sentences still follow the earlier glossary ([src/domain/words-v1.ts](../src/domain/words-v1.ts),
[docs/design/voice.md](design/voice.md)). The ones you meet most:

| On screen       | In code and the specification |
| --------------- | ----------------------------- |
| context item    | item                          |
| suggestion      | proposal                      |
| publish         | accept                        |
| archive         | retire                        |
| domain          | area                          |
| Not found       | gap, `no_match`               |
| integration     | source, connector             |
| agent           | client                        |
| what agents get | served, delivered             |

This page is for the people who build the product, so from here on it uses the code's words
where it describes code, the API or the database.

## Run it in five minutes

You need Node 26 (see `.nvmrc`; with nvm, run `nvm use`) and npm 11. In a clone of the repository
([Quick start](../README.md#quick-start)):

```sh
npm ci            # installs exact, locked versions
npm run dev       # http://localhost:5173
```

You should see the sign-in page: pick a demo person, and the Inbox opens on the demo week.
`Cmd+K` (or `Ctrl+K`) opens the search, and `?` every shortcut. The theme is in the menu at the
right end of every header.

Before you push, run everything that CI runs, except the browser tests:

```sh
npm run check     # type check, lint (ESLint and Stylelint), format check, unit tests
```

Browser tests (Playwright) need a browser once: `npx playwright install chromium`, then
`npm run test:e2e` for the golden job specs on the mock build.

To run the whole product instead, with its database and your own Cube model, see the [Quick start](../README.md#quick-start).

## What is in it

| Area        | What                                                                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App         | Vite 8 single page app, React 19, TypeScript strict mode                                                                                                                               |
| Routes      | TanStack Router, file based (`src/app/routes`), with zod search params, one to one with the mockup's addresses ([docs/product.md](product.md), section 5); old addresses redirect      |
| Data        | TanStack Query on one API boundary, `HeedApi`, with two bindings: the mock over the mockup's demo world, and the Heed service through a client typed from the API contract             |
| Shell       | Sidebar (Inbox, Ask, Context, Definitions; Help, Observability and Settings at its foot) that folds to a rail, a header with the breadcrumb and the theme menu, one right dock, search |
| Components  | shadcn/ui on Base UI (style `base-nova`), Heed's own parts in `components/heed`, a Tiptap editor, sonner toasts                                                                        |
| Styling     | Tailwind 4 with the tokens in one file, `src/app/styles/tokens.css`. Nunito Sans is self-hosted. Lucide icons come from one module                                                     |
| Guard rails | ESLint and Stylelint rules for the class rules, raw values, icons and plain words, with tests that prove they fail loudly                                                              |
| Quality     | Vitest; Playwright with the golden job specs J1 to J30 on the mock build and in http mode, axe on every place, and a smoke journey on the demo install; GitHub Actions CI              |

Agents get the published context over MCP, signed in, with a local dev token or with an access
key.

## Run the web app on the service

The API lives under `/api/v1`; its OpenAPI document is served at `/api/v1/openapi.json` and
committed as [docs/api/openapi.json](api/openapi.json). Every operation is defined once in
`src/contract`. After changing it, run `npm run api:generate`, which rewrites that document and
the web app's route table (`src/app/api/contract.json`); a test fails while either is stale.

With the service set up as in [Run the service locally](operations.md#run-the-service-locally), the demo is loaded (`SEED_DEMO=on`); start both sides. The
demo gives the weekly runs and the gaps their history ([db/README.md](../db/README.md), "Demo quality history"); on an
empty database `npm run seed -- --items-only` loads the items alone:

```sh
npm run dev:server
npm run dev:http                  # http://localhost:5173, /api/v1 forwarded to the service
```

Without a session the app opens the sign-in page: pick a demo person. Sign out in the user menu
opens it again. The dev session API does the same from a script:

```js
await fetch('/api/v1/auth/sign-in', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Heed-CSRF': 'dev-sign-in' },
  body: JSON.stringify({ email: 'per_maria@example.test' }),
})
location.reload()
```

`GET /api/v1/auth/people` lists the file's choices, with the roles each holds and their domains. `GET /api/v1/auth/session` returns the
signed-in person, current permissions and a CSRF token. Send that token as `X-Heed-CSRF` on
subsequent POST requests, including `/auth/sign-out`. Sign-in uses the literal `dev-sign-in`
header instead; all mutations also require an exact Origin in `CL_WEB_ORIGINS`. The default
allows the Vite dev and preview origins. Override it for other ports. No CORS access is granted.

Sessions last eight hours, rotate at sign-in and are invalidated by sign-out, person deactivation
or erasure. Cookies are HttpOnly and SameSite=Strict, with Secure on HTTPS. Only token hashes
are stored, in the separate `auth` schema; roles are read afresh on every request. There are no
groups and no company identity provider yet.

Administrators use `GET /api/v1/roles`, `POST /roles/grant`, `POST /roles/revoke`,
`POST /assignments/grant` and `POST /assignments/revoke` (all under `/api/v1`). Role bodies are
`{ personId, role }`; assignment bodies also include `areaId`. Global roles are `administrator`
and `auditor`; domain roles are `owner` and `approver` (the deputy role went on 16 October 2026; every deputy became an
owner of the same domain, and `deputy` is no longer accepted as a role). A domain may have several owners (giving the owner
role to one more person adds an owner beside the others) and a person may own several domains;
a domain keeps at least one owner, so the last one cannot be revoked. Changes retain their validity history and write
an attributed audit entry atomically. The people file bootstraps global roles once per person,
so restarting or signing in again never restores a revoked grant. The last active administrator cannot be revoked. Domain assignments are managed
through the API, or come from the bulk demo seed. Every signed-in person is a contributor.

People have two roles, Admin and Member; ownership lives on the domain (`PUT /areas/{areaId}/owners`
sets a domain's owners). Administrators list and change people under `/members` (`/members/{personId}/role`,
`/remove`, `/restore`); removing a person waits while a domain has them as its only owner. Invites are under
`/invites` (list, create, `/{id}/resend`, `/{id}/revoke`): an invite carries a role and owned domains,
returns a link on the web app's address, is stored only as a token hash, expires after 7 days and is
single use. An invite is accepted at the person's first OIDC sign-in, by the address the provider
has verified (`CL_AUTH=oidc`, docs/ai-sign-in.md); `npm run heed -- invite <email> --admin` invites
the first admin of a new install.

Context then shows the demo's items, read from PostgreSQL. The dev and preview servers forward
`/api/v1` to `HEED_API_URL` (default `http://127.0.0.1:3000`). Ask's chats stay in the person's
browser with either binding: the service records who writes and decides, never what a person
reads.

Both bindings pass one conformance suite (`tests/app/conformance/heed-api.ts`): the mock in
`npm test`, the http binding against PostgreSQL in `npm run test:integration`, for the methods it
wires (`wiredMethods` in `src/app/api/http.ts`), on the mockup's demo week
(`tests/app/http/demo-week.ts`): Larchwood Outdoor's context items, the terms and synonyms its
people wrote in Definitions, and the suggestions waiting for Jon Abara, sent through the service's
own API, with Lars Dahl's suggestion to archive that he took back in the comments. A method added
to the interface later answers not available on the service until its pull request wires it.

The golden job specs run in both modes. `npm run test:e2e` runs every one on the mock build;
`npm run test:e2e:golden-http` runs those whose screens are wired (the Inbox, the review, the
setup checklist, People, Context, Definitions, the editor, Related, Observability, comments with their
reactions and mentions, Settings' domains and agents, and figures in Ask so far) on an http mode
build against the service, with its own login server for an agent that signs in, and a stand-in
Cube over a seeded demo warehouse for figures (`tests/app/http/demo-figures.ts`), one at a time, each on its
own copy of the demo week seeded once into a template database; a journey that starts as a new
install (`?demo=setup`, or Observability's `?state=empty`) gets a copy of an empty workspace
instead, and `?demo=week` brings it back to the demo week; Quality's `?quality=failed` makes the
last check of the saved questions one that stopped part way; `?figures=on|off` switches Cube's
figures, and Ask's `?example=` asks the example's question in the composer. It needs a local PostgreSQL 18 and a
superuser's connection in
`GOLDEN_DATABASE_URL` (default: `TEST_DATABASE_URL`, then the local server); it serves the app
on port 4175 and the service on 3110, or on `PW_GOLDEN_WEB_PORT` and `PW_GOLDEN_API_PORT` when
another run uses those. The specs read the mock's card, item and topic ids, the queue and its counts
through `tests/e2e-app/go.ts`, which gives the service's in http mode; a step that needs a later
pull request's server work is skipped in http mode only, naming that pull request, and so is a step
of a review flag only the mock has (`?state=quiet`).
`npm run test:e2e:seed` runs the web app on what `docker compose up` gives a new install: an
http mode build against the service, on a database `npm run db:migrate` prepared with
`SEED_DEMO=on`, named by `E2E_DATABASE_URL` (default: the local development database). CI runs it
on a PostgreSQL 18 container.

## Folder map

```
src/
  domain/         the item model (zod/mini), pure and shared with the server
  contract/       the API contract (oRPC, zod/mini): every operation once, used by the service and the app
  cli/            `heed`, the command-line tool: the contract client, never the service's code
  server/         the Heed service: main.ts (composition root), app.ts, config, db, http, observability
    modules/        one folder per feature, reached only through its index.ts
      jobs/           scheduled jobs, heartbeats, the watchdog and the operations endpoints
      evals/          golden questions, answer tests through the MCP wire, judges, scorecards
      gaps/           gap detection, gaps and notes, domain dashboards and topic counts
      quality/        quality reads: score history, run comparison, feedback, upkeep
      models/         the model port: the scripted mocks, the direct Anthropic adapter and the spend ledger
      assistant/      the in-app assistant (no screen since the switch; it leaves with docs/old-help)
      admin/          settings, tool switch, client policies, history log, item import, edition export
      library, areas, vocabulary, auth (dev sessions and roles)
  app/            the web app: the mockup's shell and pages on a typed API
    api/            HeedApi (client.ts) and its method list, the query factories and what each write
                    makes stale (queries.ts), the http binding (http.ts) and the mock binding (mock/)
      mock/           the demo world: its fixtures (data/), its state, and its review flags (scenario.ts)
    routes/         one file per address (TanStack Router, file based); *.lazy.tsx for the review and the editors
    components/     the shell, shadcn primitives (ui/), Heed's parts (heed/, obs/), the editor
      icons.ts        the only module that imports the icon library
    model/          the types screens read, their words and the rules that follow from them
    lib/            hooks over the API, the router's helpers (router.ts), search param schemas (search.ts), the brand
    pages/          one file per screen
    styles/         index.css and tokens.css
    theme-bootstrap.js  inlined into <head> to apply the theme before first paint
tests/
  server/         Vitest, the service without a database, and the pure domain
  integration/    Vitest, the service against PostgreSQL 18
  lint/           tests that lint deliberately wrong code and CSS, and break the module boundaries
  app/            Vitest, the web app (src/app); its HeedApi suite (conformance/), its http run (integration/)
  e2e-app/        Playwright: the golden job specs and axe, on the mock build and in http mode (http/)
  e2e-seed/       Playwright: the web app on the demo install, as docker compose up gives it
docs/help/            the documentation, Markdown, shown at /docs and as the static docs site (npm run docs:build)
docs/old-help/        the earlier app's help pages, which only the in-app assistant still reads
db/              migrations, grants, prepare.ts (npm run db:migrate) and seed/ (npm run seed, the demo Cube model)
compose.yaml      docker compose up: PostgreSQL 18, the service and the web app, from Dockerfile and docker/
apps/mockup/      the clickable mockup, the acceptance specification: its own package (apps/mockup/README.md)
```

### Why this layout

Heed is one deployable and one npm package, not a workspace monorepo, with the web app
under `src/app`. `src/domain` holds the item model, because it
belongs to both sides. The service lives in `src/server`, next to `src/app`, with its own
`tsconfig.server.json`; its features become modules in `src/server/modules/<name>`. The root
`package.json` serves both; add the server dependencies to it. Lint keeps the parts apart: see
"Module boundaries" in `CONTRIBUTING.md`.

## Commands

| Command                                   | What it does                                                                                                                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                             | The web app at http://localhost:5173, on its mock binding.                                                                                                                                                                            |
| `npm run dev:http`                        | The web app in http mode: it reads the Heed service through `/api/v1` instead of the mock.                                                                                                                                            |
| `npm run dev:server`                      | The service at http://127.0.0.1:3000, restarted on change. Loads `.env.local` if it exists.                                                                                                                                           |
| `npm run api:generate`                    | Rewrites `docs/api/openapi.json` and `src/app/api/contract.json` from `src/contract`                                                                                                                                                  |
| `npm run heed -- <command>`               | The command-line tool: validate, import and draft items, export editions and the history log (`--help`)                                                                                                                               |
| `npm run db:migrate`                      | Gets the database ready: roles and database when missing, migrations, grants, and the demo with `SEED_DEMO=on` (see [Run the service locally](operations.md#run-the-service-locally))                                                 |
| `npm run seed`                            | Loads the demo into an empty local database by hand; `-- --items-only`, `--library golden` and `--practice` (the practice domain) are the variants the tests and the show use (see [db/README.md](../db/README.md))                   |
| `npm run eval -- --area <id>`             | Runs a domain's test questions on the live edition now, with the mock model; `--real` needs a key and `--max-cost-usd`; `--resume <run id>` makes what an incomplete run is missing                                                   |
| `npm run eval:assistant -- --as <email>`  | Runs the assistant's test cases (`--golden`: the golden set's), three tries each, mock model; `--real` needs a key and `--max-cost-usd`; `--dry-run` prices it                                                                        |
| `npm run eval:ask-words`                  | Runs the cases of Ask's words on the scripted mock model; `--real` uses `models.assistant` and needs a key and `--max-cost-usd`                                                                                                       |
| `npm run db:restore-drill`                | Backs up the local database with pg_dump, restores it into a scratch database and proves it identical (see below)                                                                                                                     |
| `npm run start:server`                    | The service without the file watcher                                                                                                                                                                                                  |
| `npm run build` / `npm run preview`       | Type check, then a production build of the web app in `dist/app` (`VITE_API_MODE=http` for the build that ships) / serve that build at http://localhost:4173                                                                          |
| `npm run size`                            | Checks the first load of `dist/app` against its budget (after a build)                                                                                                                                                                |
| `npm run typecheck`                       | `tsc` for the app, the service, and the config and test code                                                                                                                                                                          |
| `npm run lint`                            | ESLint, then Stylelint                                                                                                                                                                                                                |
| `npm run lint:words`                      | Checks the words people read against `plain-words.baseline.json`: no file may gain old words, a fall is only a note (`-- --list` prints them, `-- --update` lowers the counts); see [the voice guide](design/voice.md#the-guard-rail) |
| `npm run format` / `npm run format:check` | Prettier                                                                                                                                                                                                                              |
| `npm test`                                | Vitest: the app's units, the service's tests and the guard rail tests                                                                                                                                                                 |
| `npm run test:integration`                | Vitest: the service against PostgreSQL 18 (`TEST_DATABASE_URL`)                                                                                                                                                                       |
| `npm run test:e2e`                        | Playwright: the golden job specs (`tests/e2e-app`) against a production build on the mock binding, the motion journey also with reduced motion, and axe on every place at 390 and 1440 in light and dark                              |
| `npm run test:e2e:golden-http`            | Playwright: the golden job specs whose screens are wired, on an http mode build against the service and the demo week (needs PostgreSQL 18, `GOLDEN_DATABASE_URL`)                                                                    |
| `npm run test:e2e:seed`                   | Playwright: the web app on the demo install (needs a database `npm run db:migrate` prepared with `SEED_DEMO=on`, `E2E_DATABASE_URL`)                                                                                                  |
| `npm run check`                           | typecheck, lint, format check and unit tests                                                                                                                                                                                          |

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request, every push to `main`, every night at 03:17
UTC, and by hand (`gh workflow run CI --ref <branch>`). Its first job, **What the change needs**,
sorts the changed paths into a tier with `.github/scripts/ci-scope.sh`, and the expensive jobs
run only when the tier needs them. Its last job, **CI gate**, passes when every job passed or was
skipped on purpose, and fails on a failure, a cancel, or a job that should have run and did not.
It is the one check a branch rule needs to require. A new push to a pull request cancels the run
it replaces; runs on `main` and at night always finish.

### Validation tiers

A pull request takes the highest tier any of its files falls in.

| Tier      | Paths                                                                                                                                                                                                                                   | What runs                                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Docs      | `docs/**` and Markdown files outside `src`, `tests`, `scripts` and `apps`, except the four folders the apps read: `docs/help`, `docs/old-help`, `docs/templates` and `docs/api`                                                         | Type check, lint, plain words, format, unit tests (the docs check among them) and build                               |
| Import    | `apps/mockup/**` only                                                                                                                                                                                                                   | The mockup job                                                                                                        |
| Medium    | Anything else: the web app, the domain, the contract, the tests, scripts and configuration                                                                                                                                              | Every app job: the checks, the service tests, the golden job specs in both modes, the demo install, the Docker images |
| Sensitive | `db/**`, `src/server/**`, any path with `auth`, `sign-in`, `mcp` or `security` in it, `SECURITY.md`, `.gitleaks.toml`, `osv-scanner.toml`, `.github/**`, every `package.json` and `package-lock.json`, `.nvmrc`, `.npmrc`, Docker files | Everything, the mockup job included                                                                                   |

Every tier also runs the security scan (known vulnerabilities in dependencies, and secrets in the
history) and the held-out seal. A path no rule names counts as Medium, and an empty change runs
everything, so a gap in the rules runs more, never less. Change the rules in
`.github/scripts/ci-scope.sh`; a change there is itself Sensitive.

The golden job specs on the mock build run in two parallel parts. Every job stops after 25 minutes
at most, so a hung part fails instead of holding the run.

### On main and every night

Every push to `main`, the nightly run and a manual run take the Sensitive tier: every job,
whatever changed. The nightly run also catches a new advisory against an unchanged lockfile, and
a flaky test that a single pull request run passed by luck.

### Batching merges

CI time is spent per pull request, so fewer, well formed pull requests merge faster.

- Stack dependent pull requests: base each one on the branch before it, and merge them in order.
  Each one runs CI on its own change.
- Merge small, independent pull requests together: put them on one branch, so one run covers
  them all. Keep Docs tier changes apart from code, so they take the short path.
- Add the `full-ci` label to a pull request to run everything whatever its tier: before merging a
  batch, when a Docs or Import change could still affect the app, or to repeat a nightly failure
  on a branch. Adding any label starts a fresh run, so add labels before you push where you can.

## How to add a component

1. Look before you build. Run `npx shadcn search @shadcn` for the part you need, and check
   `src/app/components/ui` and `src/app/components/heed` ([components](design/components.md))
   for a part that already does it.
2. Add it with the CLI: `npx shadcn add <name>`. The CLI writes into `src/app/components/ui`.
3. Run `npm run lint -- --fix`. Every violation the class rules report is a real mismatch:
   replace it with a step or a token, or add a token to `tokens.css` and say why. The component is
   yours after that; the rules apply to it like any other code.
4. Icons: add the icon to `src/app/components/icons.ts` and import it from there. If the CLI
   wrote `from "lucide-react"`, change it.
5. Run `npm run check`, and `npm run test:e2e` for the golden job specs and axe.

A part you write for this product (not from shadcn) lives in `src/app/components/heed`, composes
shadcn parts, owns its layout only, and takes colour, radius and motion from tokens. Shared
variants own control height, type and radius; feature code never overrides them.

## The rules

These are enforced by lint and tests, not by good intentions. `CONTRIBUTING.md` has the detail.

- Tailwind's spacing and text scales, and weights 400 to 700, as the mockup uses them.
- No arbitrary Tailwind values outside a short list of named tokens, no raw palette colours, no
  numeric layers, no raw motion, no inline `style` for spacing or colour.
- Colour, radius, shadow, motion and the layout metrics come from `src/app/styles/tokens.css`,
  which holds the design contract's tokens ([design contract v2](design/design-contract.md),
  section 2). Every name in it is semantic.
- A part that can sit in the dock reads its container, never the viewport.
- One icon module, one component base (Base UI), one font family.

## Versions, and why

Every dependency is pinned to an exact version (`.npmrc` has `save-exact=true`), and the lock
file is committed. Read the date as 7 October 2026.

| Package                    | Version              | Why                                                                                                                      |
| -------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Node                       | 26                   | The stack decision: TypeScript on Node 26. Pinned in `.nvmrc` and `engines`.                                             |
| TypeScript                 | 6.0.3                | typescript-eslint 8.71 supports TypeScript below 6.1. TypeScript 7 is out, but the lint toolchain cannot use it yet.     |
| Vite / plugin-react        | 8.3.3 / 6.1.2        | The recommended build tool; no server coupling. 8.3.3 is the newest release (6 October 2026).                            |
| React                      | 19.3.0               | The current release (9 September 2026). Pinned exactly so an update is a decision.                                       |
| Tailwind CSS               | 4.3.3                | Semantic tokens in CSS variables; spacing is computed, so the lint rules matter.                                         |
| shadcn CLI / style         | 4.22.1 / `base-nova` | Copy-in components on Base UI.                                                                                           |
| Base UI                    | 1.8.0                | The component base shadcn defaults to.                                                                                   |
| TanStack Router / Query    | 1.170.41 / 5.104.1   | Typed search params and intent preloading; server state cache.                                                           |
| zod                        | 4.6.6                | Used as `zod/mini` in the web app and domain to keep the browser bundle small. The service uses full `zod`.              |
| Playwright / axe           | 1.63.0 / 4.13.0      | The golden job specs and the accessibility checks.                                                                       |
| Vitest / jsdom             | 5.0.3 / 30.1.2       | Unit tests.                                                                                                              |
| ESLint / typescript-eslint | 10.12.0 / 8.71.1     | With `eslint-plugin-better-tailwindcss` 4.9.0 for the class rules.                                                       |
| Fastify / pino             | 5.12.5 / 10.4.0      | The service's HTTP server and its JSON logger (the one Fastify uses).                                                    |
| pg                         | 8.23.1               | The PostgreSQL driver.                                                                                                   |
| pg-boss                    | 12.37.0              | The job queue and cron schedules, in PostgreSQL. Its schema is vendored in the baseline migration (`0001_baseline.sql`). |
| eslint-plugin-boundaries   | 7.2.0                | The module boundaries, with `eslint-import-resolver-typescript` 4.4.5 to follow the path aliases.                        |
| Stylelint                  | 17.16.0              | With `stylelint-declaration-strict-value` for hand written CSS.                                                          |
| cn                         | 0.4.0                | The class merge helper the shadcn CLI now emits. It is pre 1.0; `@/lib/utils` re-exports it, so swapping it is one line. |
| react-day-picker           | 10.0.2               | The calendar of the date fields.                                                                                         |
| diff (jsdiff)              | 8.0.4                | The word diff the review and history draw (`components/heed/bits.tsx`).                                                  |

## Known limits

- The default build uses the mock binding; `VITE_API_MODE=http` switches to the service, as the
  Docker image builds it.
- Dependency scanning (OSV-Scanner) passes with two reviewed exceptions, both in `extract-zip`,
  which the Cube compiler loads but never calls. They are listed with their reasons and an expiry
  date in `osv-scanner.toml`. Neither has a fixed version. `npm audit` shows the same findings;
  `.npmrc` turns off the audit on install, so look at it on purpose.
- axe passes on every place, but it does not replace a keyboard and screen reader review.
