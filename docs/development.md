# Develop Heed

How the repository is laid out, how to run the front end, the commands, what CI runs, the rules and the versions. To run the whole product, see the [Quick start](../README.md#quick-start); to run and configure the service, see [Run and operate the service](operations.md).

## The two parts

The repository holds two parts. The **front end** is a React app with the design contract's
tokens and guard rails. It has these screens:

- **Home**, the **library** with each fact's page, and the **Catalogue** of metrics.
- **Proposals**, with the To review list, each proposal's status, and its review: the field
  changes, the checks, the decision bar and the owner's edits.
- **Editions**, for owners and admins, with a banner for everyone while agents are stopped from
  getting facts.
- **Health**, where owners see what needs them first: test questions, runs, gaps, facts and each
  domain. The old Workbench, Quality, Areas and owners' Gaps addresses lead there.
- **Gaps**, for everyone else: the topics nobody has written a fact for, with weekly counts, notes
  and Start a draft.
- **The assistant**, from a launcher in the corner of every page, with Ask and Try a question:
  what an agent gets for a metric, a market and dates, without asking any AI.
- **Settings**, from the user menu: profile, appearance, and connecting an agent.
- **Administration**, where an admin runs domains, people and roles, limits, which agents can
  connect and their tools, imports and operations, and an auditor reads the history log.
- **Docs**, the help pages, at `/docs`.

The sidebar shows each person only the places that are theirs. Other routes are stubs.

The **new web app** in `src/app` is the approved mockup (`apps/mockup`, the acceptance
specification) on the repository's router, icon module, class merge and lint. It is built beside
the front end until it replaces it. Its pages read their data through one typed interface,
`HeedApi` (`src/app/api/client.ts`), with TanStack Query: the mock binding answers from the
mockup's demo world, with its review flags (`?state=loading`, `?state=failed`, `?state=offline`,
`?slow=1`, `?demo=` and the rest), and the http binding talks to the service. Run it with
`npm run dev:app` on the mock; `VITE_API_MODE=http npm run dev:app` takes the http binding, which
answers the session, the library list, the definitions and search everywhere so far; each other
screen is wired by its own change. `npm run dev`, `docker compose up` and the Docker image still
serve the front end in `src/web`.

The **back end** is the service in `src/server`: a Fastify app with configuration, logging and a
health check, a PostgreSQL 18 database, scheduled jobs with an operations view, and the API the
app reads, described once in `src/contract` (oRPC, published as OpenAPI). The front end runs on
mock data by default, or on the service with `npm run dev:http` (see
[Run the front end on the service](#run-the-front-end-on-the-service)).

### Words on screen and words in code

The screens, the help pages and the assistant name things as people say them. The code, the API,
the database and the specification keep their own words. [src/domain/words-v1.ts](../src/domain/words-v1.ts)
maps one to the other for the old front end, and [docs/design/voice.md](design/voice.md) says how
to write; the new web app uses glossary v2 in [src/domain/words.ts](../src/domain/words.ts) and
[docs/design/copy.md](design/copy.md). The ones you meet most in the old front end:

| On screen             | In code and the specification |
| --------------------- | ----------------------------- |
| fact                  | item, context item            |
| admin                 | administrator                 |
| archive               | retire                        |
| what agents get today | the live edition              |
| where it applies      | scope                         |
| agent                 | AI app, client                |
| check date            | review date                   |

This page is for the people who build the product, so from here on it uses the code's words
where it describes code, the API or the database.

## Run it in five minutes

You need Node 26 (see `.nvmrc`; with nvm, run `nvm use`) and npm 11. In a clone of the repository
([Quick start](../README.md#quick-start)):

```sh
npm ci            # installs exact, locked versions
npm run dev       # http://localhost:5173
```

You should see the shell: a sidebar, a header with a breadcrumb, and Home. Press
`g` then `l` for the library, `j` and `k` to move through it, `Enter` to open a fact,
`Cmd+K` (or `Ctrl+K`) for the quick switcher and `?` for every shortcut. Appearance is in the user
menu at the bottom of the sidebar. In development the design preview is at `/design-preview`; it
also switches the mock API between the library's states (first run, slow, failed).

Before you push, run everything that CI runs, except the browser tests:

```sh
npm run check     # type check, lint (ESLint and Stylelint), format check, unit tests
```

Browser tests (Playwright) need a browser once: `npx playwright install chromium`, then
`npm run test:e2e`. Screenshot tests run only once CI baselines exist; see [Screenshot baselines](testing.md#screenshot-baselines).

To run the whole product instead, with its database and your own Cube model, see the [Quick start](../README.md#quick-start).

## What is in it

| Area        | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App         | Vite 8 single page app, React 19, TypeScript strict mode                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Routes      | TanStack Router, file based, with typed search params: Home, Context library, Catalogue, Item, Proposals, Proposal, Try it, Gaps (gaps, topic counts, a gap's panel), Health (with each domain and what it is), Editions (rollback, the stop switch), Settings (profile and appearance, Connect your AI), Administration (domains, About our business, people and roles, limits with their history, MCP and gateway with the clients, tools and the traffic by client and tool, item import, the history log, operations), Docs (the help pages in `docs/help`, at `/docs`), the agent consent page, Signed out; the old Evals and releases, Workbench, Quality, Areas, MCP and gateway and Connect your AI addresses, and the Settings sections Administration took over, lead to where they went, and an owner's Gaps address to Health. The ones not yet built are stubs. |
| Data        | TanStack Query on one API boundary with two bindings: the mock (typed fixtures from a seeded generator for 1,500 context items) and the Heed service, through a client typed from the API contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Shell       | Sidebar (256px, a 48px rail below 1280px, a sheet on phones), 48px header (56px on phones), breadcrumb, command palette and hotkeys driven by one command registry, appearance in the user menu with a no-flash bootstrap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Components  | shadcn/ui on Base UI (style `base-nova`): sidebar, breadcrumb, button, input, command, dropdown menu, popover, tooltip, dialog, sheet, tabs, badge, skeleton, empty, kbd, avatar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Styling     | Tailwind 4 with semantic tokens in one file, `src/web/styles/tokens.css`. Nunito Sans and Geist Mono are self-hosted. Lucide icons come from one module.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Guard rails | ESLint and Stylelint rules that block arbitrary Tailwind values, off-scale spacing, raw colours and inline spacing, with tests that prove they fail loudly                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Quality     | Vitest, Storybook with a 1440, 1024 and 390 viewport matrix in light and dark, Playwright with axe, layout and screenshot tests, GitHub Actions CI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Not in it, on purpose: the remaining stub screens and company sign-in (local dev
sessions are available; without one, the app shows a signed-out page). Agents get the accepted
facts over MCP, signed in or with a local access key.

## Run the front end on the service

The API lives under `/api/v1`; its OpenAPI document is served at `/api/v1/openapi.json` and
committed as [docs/api/openapi.json](api/openapi.json). Every operation is defined once in
`src/contract`. After changing it, run `npm run api:generate`, which rewrites that document and
the browser client's route table (`src/web/api/contract.json`); a test fails while either is
stale.

With the service set up as in [Run the service locally](operations.md#run-the-service-locally), the demo is loaded (`SEED_DEMO=on`); start both sides. The
demo gives Quality, Gaps and Health their history ([db/README.md](../db/README.md), "Demo quality history"); on an
empty database `npm run seed -- --items-only` loads the items alone:

```sh
npm run dev:server
npm run dev:http                  # http://localhost:5173, /api/v1 forwarded to the service
```

For the scripted five-minute Norway show, side by side with Claude Code, use its own commands
instead: `npm run demo` and the daily `npm run demo:check` ([docs/demo.md](demo.md)).

Without a session the app opens the sign-in page: choose a demo person in Sign in as (the list is
grouped by role, each person with their domains) and Continue (Enter on the chosen person does the same). Switch demo person in the user menu opens it again. The
dev session API does the same from a script:

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

The library then shows the same 1,500 items as the mock, read from PostgreSQL. The dev and preview
servers forward `/api/v1` to `HEED_API_URL` (default `http://127.0.0.1:3000`). Favourites and
recently opened items stay in the browser with either binding: the service records who writes and
decides, never what a person reads.

Both bindings pass one conformance suite (`tests/conformance/context-api.ts`): the mock in
`npm test`, the http binding against PostgreSQL in `npm run test:integration`. The new web app's
two bindings do the same with `tests/app/conformance/heed-api.ts`, the http one for the methods it
wires so far (`wiredMethods` in `src/app/api/http.ts`), on the mockup's demo week
(`tests/app/http/demo-week.ts`): Larchwood Outdoor's context items, the terms and synonyms its
people wrote in Definitions, and the suggestions waiting for Jon Abara, sent through the service's
own API. Reads whose screens a later pull request wires
answer what the service holds for them today, which is nothing, so the shell and the Inbox draw;
their writes are not available yet.

The golden job specs run in both modes. `npm run test:e2e:app` runs every one on the mock build;
`npm run test:e2e:golden-http` runs those whose screens are wired (the Inbox, the review and the
setup checklist so far) on an http mode build against the service, one at a time, each on its own
copy of the demo week seeded once into a template database; a journey that starts as a new
install (`?demo=setup`) gets a copy of an empty workspace instead. It needs a local PostgreSQL 18 and a superuser's
connection in `GOLDEN_DATABASE_URL` (default: `TEST_DATABASE_URL`, then the local server). The
specs read the mock's card ids, the queue and its counts through `tests/e2e-app/go.ts`, which
gives the service's in http mode; a step that needs a later pull request's server work is
skipped in http mode only, naming that pull request.
`npm run test:e2e:api` runs a Playwright smoke test of an http mode build against the service; it
needs a migrated, seeded database named by `E2E_DATABASE_URL` (default: the local development
database), and CI runs it on a PostgreSQL 18 container. Its service signs in the people in
`tests/e2e-api/people.yml`: the demo identities and an administrator for each parallel spec that
needs one, so the specs never share one person's request limit.

## Folder map

```
src/
  domain/         the item model (zod/mini), pure and shared with the server
  contract/       the API contract (oRPC, zod/mini): every operation once, used by the service and the web
  cli/            `heed`, the command-line tool: the contract client, never the service's code
  server/         the Heed service: main.ts (composition root), app.ts, config, db, http, observability
    modules/        one folder per feature, reached only through its index.ts
      jobs/           scheduled jobs, heartbeats, the watchdog and the operations endpoints
      evals/          golden questions, answer tests through the MCP wire, judges, scorecards
      gaps/           gap detection, gaps and notes, domain dashboards and topic counts
      quality/        the Workbench's quality reads: score history, run comparison, feedback, upkeep, Fix next
      models/         the model port: the scripted mocks, the direct Anthropic adapter and the spend ledger
      assistant/      the assistant: tools over the same services, the citation check, budgets, streaming
      admin/          settings, tool switch, client policies, history log, item import, edition export
      library, areas, vocabulary, auth (dev sessions and roles)
  app/            the new web app, until it replaces web: the mockup's shell and pages on a typed API
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
  web/            the front end, and nothing else
    routes/         one file per route (TanStack Router, file based)
    components/
      ui/             shadcn components (regenerated by the CLI, normalised to the scale)
      app-shell/      sidebar, header, breadcrumbs, command palette, appearance menu
      page/           page regions and the stub page
      form/           form kit: dates, validity range, markdown field, confirm dialog, error summary
      docs/           the Docs area: its home, a help page and their parts
      icons.ts        the only module that imports the icon library
    hooks/          autosave, pending indicator, zod form
    lib/            command registry, navigation list, appearance, search param schemas, form errors, markdown renderers (item text, assistant answers and help pages), the help pages' library
    api/            the API boundary (ContextApi), mock implementation, query options
    mocks/          seeded fixtures: people, areas, vocabulary, 1,500 items
    design-preview/ one example per page template, and the tokens (dev only)
    styles/         index.css and tokens.css
    stories/        Storybook stories
    theme-bootstrap.js  inlined into <head> to apply the saved appearance before first paint
tests/
  unit/           Vitest, front end
  server/         Vitest, the service without a database
  integration/    Vitest, the service against PostgreSQL 18
  lint/           tests that lint deliberately wrong code and CSS, and break the module boundaries
  e2e/            Playwright: layout, shell, axe, screenshots
  e2e-api/        Playwright: the front end in http mode against the service
  app/            Vitest, the new web app (src/app); its HeedApi suite (conformance/), its http run (integration/)
  e2e-app/        Playwright: the new web app's golden job specs and axe, on its mock build and in http mode (http/)
  conformance/    the ContextApi suite that both API bindings pass
docs/help/        the help pages, Markdown with SVG pictures, shown at /docs and on GitHub (its README)
db/              migrations, grants, prepare.ts (npm run db:migrate) and seed/ (npm run seed, the demo Cube model)
compose.yaml      docker compose up: PostgreSQL 18, the service and the web app, from Dockerfile and docker/
registry.json     the Heed registry for shadcn (built output in registry/r)
apps/mockup/      the clickable mockup, the acceptance specification: its own package (apps/mockup/README.md)
```

### Why this layout

Heed is one deployable and one npm package, not a workspace monorepo, with the front end
under `src/web`. `src/domain` holds the item model, because it
belongs to both sides. The service lives in `src/server`, next to `src/web`, with its own
`tsconfig.server.json`; its features become modules in `src/server/modules/<name>`. The root
`package.json` serves both; add the server dependencies to it. Lint keeps the parts apart: see
"Module boundaries" in `CONTRIBUTING.md`.

## Commands

| Command                                         | What it does                                                                                                                                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                   | Dev server at http://localhost:5173. `VITE_DEVTOOLS=true npm run dev` adds the Query and Router devtools.                                                                                                                             |
| `npm run dev:http`                              | The dev server in http mode: the app reads the Heed service through `/api/v1` instead of the mock.                                                                                                                                    |
| `npm run dev:app`                               | The new web app (`src/app`) at http://localhost:5174, on its mock binding.                                                                                                                                                            |
| `npm run dev:server`                            | The service at http://127.0.0.1:3000, restarted on change. Loads `.env.local` if it exists.                                                                                                                                           |
| `npm run api:generate`                          | Rewrites `docs/api/openapi.json` and `src/web/api/contract.json` from `src/contract`                                                                                                                                                  |
| `npm run heed -- <command>`                     | The command-line tool: validate, import and draft items, export editions and the history log (`--help`)                                                                                                                               |
| `npm run db:migrate`                            | Gets the database ready: roles and database when missing, migrations, grants, and the demo with `SEED_DEMO=on` (see [Run the service locally](operations.md#run-the-service-locally))                                                 |
| `npm run seed`                                  | Loads the demo into an empty local database by hand; `-- --items-only`, `--library golden\|norway` and `--practice` (the practice domain) are the variants the tests and the show use (see [db/README.md](../db/README.md))           |
| `npm run demo` / `demo:check`                   | The Norway show on its own database and ports, and its daily headless check (see [docs/demo.md](demo.md))                                                                                                                             |
| `npm run eval -- --area <id>`                   | Runs a domain's test questions on the live edition now, with the mock model; `--real` needs a key and `--max-cost-usd`; `--resume <run id>` makes what an incomplete run is missing                                                   |
| `npm run eval:assistant -- --as <email>`        | Runs the assistant's test cases (`--golden`: the golden set's), three tries each, mock model; `--real` needs a key and `--max-cost-usd`; `--dry-run` prices it                                                                        |
| `npm run db:restore-drill`                      | Backs up the local database with pg_dump, restores it into a scratch database and proves it identical (see below)                                                                                                                     |
| `npm run start:server`                          | The service without the file watcher                                                                                                                                                                                                  |
| `npm run build`                                 | Type check, then a production build in `dist/web`                                                                                                                                                                                     |
| `npm run build:app` / `npm run preview:app`     | Type check, then a production build of the new web app in `dist/app` / serve that build at http://localhost:4174                                                                                                                      |
| `npm run size`                                  | Checks the first load against its budget (after a build)                                                                                                                                                                              |
| `npm run typecheck`                             | `tsc` for the app, the service, and the config and test code                                                                                                                                                                          |
| `npm run lint`                                  | ESLint, then Stylelint                                                                                                                                                                                                                |
| `npm run lint:words`                            | Checks the words people read against `plain-words.baseline.json`: no file may gain old words, a fall is only a note (`-- --list` prints them, `-- --update` lowers the counts); see [the voice guide](design/voice.md#the-guard-rail) |
| `npm run format` / `npm run format:check`       | Prettier                                                                                                                                                                                                                              |
| `npm test`                                      | Vitest: unit tests, the service's tests and the guard rail tests                                                                                                                                                                      |
| `npm run test:integration`                      | Vitest: the service against PostgreSQL 18 (`TEST_DATABASE_URL`)                                                                                                                                                                       |
| `npm run storybook` / `npm run build-storybook` | Storybook at http://localhost:6006 / a static build                                                                                                                                                                                   |
| `npm run test:e2e`                              | Playwright against a production build made for tests (layout, shell, axe; screenshots only if baselines exist, on Linux)                                                                                                              |
| `npm run test:e2e:app`                          | Playwright: the new web app's golden job specs (`tests/e2e-app`) against its production build, the motion journey also with reduced motion, and axe on every place at 390 and 1440 in light and dark                                  |
| `npm run test:e2e:api`                          | Playwright against an http mode build and the service (needs a seeded database, `E2E_DATABASE_URL`)                                                                                                                                   |
| `npm run test:e2e:golden-http`                  | Playwright: the golden job specs whose screens are wired, on an http mode build against the service and the demo week (needs PostgreSQL 18, `GOLDEN_DATABASE_URL`)                                                                    |
| `npm run registry:build` / `registry:validate`  | Build or validate `registry.json`                                                                                                                                                                                                     |
| `npm run check`                                 | typecheck, lint, format check and unit tests                                                                                                                                                                                          |

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

| Tier      | Paths                                                                                                                                                                                                                                   | What runs                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Docs      | `docs/**` and Markdown files outside `src`, `tests`, `scripts` and `apps`, except the three folders the app reads: `docs/help`, `docs/templates` and `docs/api`                                                                         | Type check, lint, plain words, format, unit tests (the docs check among them), registry and build                            |
| Import    | `apps/mockup/**` only                                                                                                                                                                                                                   | The mockup job                                                                                                               |
| Medium    | Anything else: the front end, the domain, the contract, the tests, scripts and configuration                                                                                                                                            | Every app job: the checks, the service tests, the library on the real API, Storybook, Playwright, the new app's golden specs |
| Sensitive | `db/**`, `src/server/**`, any path with `auth`, `sign-in`, `mcp` or `security` in it, `SECURITY.md`, `.gitleaks.toml`, `osv-scanner.toml`, `.github/**`, every `package.json` and `package-lock.json`, `.nvmrc`, `.npmrc`, Docker files | Everything, the mockup job included                                                                                          |

Every tier also runs the security scan (known vulnerabilities in dependencies, and secrets in the
history) and the held-out seal. A path no rule names counts as Medium, and an empty change runs
everything, so a gap in the rules runs more, never less. Change the rules in
`.github/scripts/ci-scope.sh`; a change there is itself Sensitive.

The browser tests run in eleven parallel parts: seven for the pages, three for the Storybook
tests, and one for the screenshot tests. Every job stops after 25 minutes at most, so a hung part
fails instead of holding the run.

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
   `registry.json` and `src/web/components` for a product component that already does it.
2. Add it with the CLI: `npx shadcn add <name>`. The CLI writes into `src/web/components/ui`.
3. Run `npm run lint -- --fix`. shadcn output uses half steps (`gap-1.5`), arbitrary values and
   raw sizes. Every violation is a real mismatch with the scale: replace it with a step or a
   token, or add a token to `tokens.css` and say why. The component is yours after that; the
   rules apply to it like any other code.
4. Icons: add the icon to `src/web/components/icons.ts` and import it from there. If the CLI
   wrote `from "lucide-react"`, change it.
5. Add a story in `src/web/stories` that shows the states (default, disabled, long text, empty).
6. If it is a new kind of page or region, add it to the design preview and the screenshot tests.
7. Run `npm run check`, and `npm run test:e2e` for the layout, shell and axe tests. If the look
   changed, refresh the screenshot baselines (see [Screenshot baselines](testing.md#screenshot-baselines)).

A component you write for this product (not from shadcn) lives in `src/web/components`, composes
shadcn parts, owns its layout only, and takes colour, spacing and type from tokens. Shared variants
own control height, type and radius; feature code never overrides them.

## The rules

These are enforced by lint and tests, not by good intentions. `CONTRIBUTING.md` has the detail.

- Spacing is 4, 8, 12, 16, 24, 32, 48 and 64 (Tailwind steps 1, 2, 3, 4, 6, 8, 12, 16).
  `p-7` and margins are reported, with the fix. Layout sizes come from tokens: `w-sidebar`, `w-rail`,
  `h-header`, `px-gutter`, `h-control-md`.
- No arbitrary Tailwind values (`w-[13px]`, `text-[#fff]`), no raw palette colours, no
  `!important`, no inline `style` for spacing or colour.
- Colour, radius, type size and shadow come from `tokens.css`, which holds the design contract's
  tokens (`docs/design/design-contract.md`, section 6). Every name in it is semantic.
- One page gutter. The header, toolbar and content all use `px-gutter`; the page title is shown
  once, in the breadcrumb.
- One icon module, one component base (Base UI), one font family and one mono family.
- Only parents set gaps. Children do not carry margins.

## Versions, and why

Every dependency is pinned to an exact version (`.npmrc` has `save-exact=true`), and the lock
file is committed. Read the date as 7 October 2026.

| Package                       | Version              | Why                                                                                                                               |
| ----------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Node                          | 26                   | The stack decision: TypeScript on Node 26. Pinned in `.nvmrc` and `engines`.                                                      |
| TypeScript                    | 6.0.3                | typescript-eslint 8.71 supports TypeScript below 6.1. TypeScript 7 is out, but the lint toolchain cannot use it yet.              |
| Vite / plugin-react           | 8.3.3 / 6.1.2        | The recommended build tool; no server coupling. 8.3.3 is the newest release (6 October 2026).                                     |
| React                         | 19.3.0               | The current release (9 September 2026). Pinned exactly so an update is a decision.                                                |
| Tailwind CSS                  | 4.3.3                | Semantic tokens in CSS variables; spacing is computed, so the lint rules matter.                                                  |
| shadcn CLI / style            | 4.22.1 / `base-nova` | Copy-in components on Base UI.                                                                                                    |
| Base UI                       | 1.8.0                | The component base shadcn defaults to.                                                                                            |
| TanStack Router / Query       | 1.170.41 / 5.104.1   | Typed search params and intent preloading; server state cache.                                                                    |
| zod                           | 4.6.6                | Used as `zod/mini` in the front end and domain to keep the browser bundle small. The service uses full `zod`.                     |
| Storybook                     | 10.6.1               | Component states as the review surface.                                                                                           |
| Playwright / axe              | 1.63.0 / 4.13.0      | Layout, accessibility and screenshot tests.                                                                                       |
| Vitest / jsdom                | 5.0.3 / 30.1.2       | Unit tests.                                                                                                                       |
| ESLint / typescript-eslint    | 10.12.0 / 8.71.1     | With `eslint-plugin-better-tailwindcss` 4.9.0 for the class rules.                                                                |
| Fastify / pino                | 5.12.5 / 10.4.0      | The service's HTTP server and its JSON logger (the one Fastify uses).                                                             |
| pg                            | 8.23.1               | The PostgreSQL driver.                                                                                                            |
| pg-boss                       | 12.37.0              | The job queue and cron schedules, in PostgreSQL. Its schema is vendored in the baseline migration (`0001_baseline.sql`).          |
| eslint-plugin-boundaries      | 7.2.0                | The module boundaries, with `eslint-import-resolver-typescript` 4.4.5 to follow the path aliases.                                 |
| Stylelint                     | 17.16.0              | With `stylelint-declaration-strict-value` for hand written CSS.                                                                   |
| cn                            | 0.4.0                | The class merge helper the shadcn CLI now emits. It is pre 1.0; `@/lib/utils` re-exports it, so swapping it is one line.          |
| React Hook Form / resolvers   | 7.89.0 / 5.9.1       | The form library of the design contract (7.1, "Field, Form"); the resolver checks a `zod/mini` schema. Used through `useZodForm`. |
| react-day-picker              | 10.0.2               | The calendar of `DateField` and `ValidityRange` (contract 7.1), set to UTC days.                                                  |
| storybook-addon-pseudo-states | 10.6.1               | Draws hover, focus-visible and pressed in the state grid of a story without a pointer (contract 7, "the state set").              |
| diff (jsdiff)                 | 8.0.4                | The word diff of the review screen (`lib/field-diff.ts`): it compares words and keeps an @ mention whole.                         |

## Known limits

- The default build still uses the mock API; `VITE_API_MODE=http` switches to the service. The
  library reads accepted context. Dev sign-in, sessions, role administration, proposal writes and
  review use the real API; company sign-in is not built yet.
- The `@heed` entry in `components.json` points at `registry/r` on the `main` branch of this
  repository.
- The design preview route is development only. It exists in `npm run dev` and in the build
  Playwright uses (`VITE_DESIGN_PREVIEW=true`); in a normal production build it is a 404.
- Dependency scanning (OSV-Scanner) passes with two reviewed exceptions, both in `extract-zip`,
  which the Cube compiler loads but never calls. They are listed with their reasons and an expiry
  date in `osv-scanner.toml`. Neither has a fixed version. `npm audit` shows the same findings;
  `.npmrc` turns off the audit on install, so look at it on purpose.
- Several pages are only as accessible as the stubs. axe passes, but it does not replace a
  keyboard and screen reader review of the real screens.
