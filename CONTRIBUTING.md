# Contributing

Thanks for helping. This page says how to send a change, then how to write code that passes the
checks.

Everyone here follows the [code of conduct](CODE_OF_CONDUCT.md). Found a security problem? Don't
open an issue: [SECURITY.md](SECURITY.md) says how to tell us privately.

## How to send a change

1. For anything bigger than a small fix, open an issue first and describe the problem. We'll agree
   on the shape of the change before you write code. A small fix needs no issue.
2. Fork the repository, create a branch, and keep the change small and focused: one idea per pull
   request.
3. Run `npm run check`, then open a pull request. The [template](.github/pull_request_template.md)
   asks what changes, why, how you tested it (with screenshots when a screen changes), what you left
   out, and the issue it closes.
4. When `main` moves on and your pull request conflicts, rebase it. Files generated from code are
   regenerated, not merged, and a new migration is renumbered with `npm run db:renumber`:
   [Generated files and rebasing](docs/development.md#generated-files-and-rebasing) says how.

You send your contribution under the Apache License 2.0, as section 5 of [LICENSE](LICENSE)
says. You keep the copyright in your work.

Not sure where to start? See [Finding something to work on](#finding-something-to-work-on).

## Set up

You need Node 26 (`.nvmrc`; with nvm, run `nvm use`) and npm 11. For the service and the tests that
use a database you also need PostgreSQL 18, or Docker.

```sh
npm ci                                # exact, locked versions
npx playwright install chromium       # once, for the browser tests
```

Heed is one npm package, not a workspace. The layout is in the
[folder map](docs/development.md#folder-map); the short version:

| Folder              | What is in it                                                                     |
| ------------------- | --------------------------------------------------------------------------------- |
| `src/web`           | The web app (React). Pages in `pages`, routes in `routes`, data in `api`          |
| `src/server`        | The Heed service (Fastify, PostgreSQL 18), one folder per feature in `modules`    |
| `src/domain`        | The item model and the words, pure code shared by both sides                      |
| `src/contract`      | The API, defined once and used by the service and the app                         |
| `tests/web`         | Unit tests for the web app, and the `HeedApi` suite that both bindings must pass  |
| `tests/server`      | Unit tests for the service and the domain, without a database                     |
| `tests/integration` | The service against a real PostgreSQL 18                                          |
| `tests/e2e`         | Browser tests: the golden journeys and axe, on the mock build and in http mode    |
| `db`                | Migrations, grants and the demo data (`db/seed`)                                  |
| `docs`              | Everything written about Heed; `docs/help` is also the app's own Docs             |
| `apps/mockup`       | The clickable mockup: the living design reference the web app is changed to match |

## Run it

On the demo data (no database, nothing leaves your computer):

```sh
npm run dev           # http://localhost:5173, the web app on its mock API
```

Sign in as any demo person. The demo is an invented outdoor-gear retailer, Larchwood Outdoor.

On the real service, with a local PostgreSQL 18 and the demo loaded (`SEED_DEMO=on`; see
[Run the web app on the service](docs/development.md#run-the-web-app-on-the-service) for the
settings):

```sh
npm run db:migrate    # prepares the database and loads the demo
npm run dev:server    # the service at http://127.0.0.1:3000
npm run dev:http      # the web app at http://localhost:5173, reading the service
```

Or run all of it in containers with `docker compose up` (http://localhost:8080).

## Commands you will use

| Command                    | What it does                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `npm run check`            | Type check, lint, plain words, format check and unit tests. Run it before you push |
| `npm run lint -- --fix`    | ESLint and Stylelint, fixing what they can                                         |
| `npm run format`           | Prettier                                                                           |
| `npm test`                 | Unit and service tests that need no database                                       |
| `npm run test:integration` | The service against PostgreSQL 18 (`TEST_DATABASE_URL`)                            |
| `npm run test:e2e`         | The golden journeys and axe on the mock build                                      |
| `npm run api:generate`     | Rewrites the generated API files after you change `src/contract`                   |

[Develop Heed](docs/development.md#commands) lists every command, and [Tests](docs/testing.md)
says what each suite covers.

## Run the golden journeys

The golden journeys (`tests/e2e`, files `j1-` onward) are browser tests that walk each screen the
way a person does. They are the acceptance tests of the web app.

```sh
npm run test:e2e                      # every journey on the mock build, with axe
npx playwright test tests/e2e/j1-review-publish.spec.ts   # one journey
npm run test:e2e:golden-http          # the journeys whose screens are on the service
npm run test:e2e:seed                 # the web app on what docker compose up gives a new install
```

The http run needs a local PostgreSQL 18 and a superuser connection in `GOLDEN_DATABASE_URL`
(default: `TEST_DATABASE_URL`, then the local server); the seed run reads `E2E_DATABASE_URL`. Both
are explained in [Develop Heed](docs/development.md#run-the-web-app-on-the-service). A new screen
or state gets its own journey, and axe runs on every place at 390 and 1440 wide, in light and
dark.

## Add a migration

Migrations are forward-only SQL in `db/migrations`. Never edit or rename one that has been
applied.

1. Add `NNNN_short_name.sql`, where `NNNN` is the number after the latest file on `main`. Numbers
   run without a gap and no two files share one.
2. Run `npm run db:migrate` to apply it, then `npm run test:integration`.
   `tests/server/migration-files.test.ts` refuses a shared or skipped number.
3. If another pull request merges a migration first, rebase and renumber yours before you merge.
   CI's **Migration numbers** job fails within seconds while your number is taken on `main`.

[db/README.md](db/README.md) explains the roles, the grants and why enum additions need their own
migration.

## The first-load budget

The first load of the web app, the scripts and styles `index.html` loads, is held to **438 KB of
script and 32 KB of CSS**, gzipped. Do not raise it. Load route code on demand instead: every page
but the Inbox and Ask is a lazy route (`routes/**/*.lazy.tsx`), and so should heavy parts be.

```sh
npm run size      # builds the web app as it ships (http mode), as CI does, and checks it
```

It prints the bytes, the budget and the margin. CI counts 1.3 to 1.8 KB more script than a Mac
for the same build, so go by the margin CI prints.

## How reviews work

- A maintainer reviews every pull request. There is no fixed response time; if a week passes,
  leave a comment on the pull request.
- The one check a merge needs is **CI gate**. It passes when every job the change needs passed
  ([Validation tiers](docs/development.md#validation-tiers)). Changes to `db`, `src/server`,
  sign-in, security or dependencies run everything and get a closer read.
- Reviewers look at the same things the template asks: is the problem real, is the change small
  and tested, do the words follow the glossary, do the screens match the mockup.
- Push fixes as new commits while a review is open. The history on `main` is one commit per pull
  request, titled like `feat(web): ...`, `fix(server): ...` or `docs: ...`.
- Rebase on `main` when it moves, and regenerate generated files rather than merging them by hand.

## Using a coding agent

Agents are welcome, and the same rules and the same checks apply to what they write. Read
[Working with coding agents](docs/agents.md) first: where to read, what to run and what an agent
may and may not do. You are responsible for what you send, whoever or whatever typed it.

## Finding something to work on

Issues carry labels that say how ready they are:

- **good first issue**: small, well scoped, with acceptance criteria and a pointer to the code. No
  need to ask first; say in a comment that you are taking it.
- **help wanted**: agreed in principle, and a maintainer would welcome a pull request. Comment with
  your plan before you start if it is more than a day's work.
- **bug** and **enhancement**: what the issue templates add. An enhancement without a label above
  is still being shaped; discuss before you build.

If your idea has no issue yet, open one and make the case.

## Writing code here

This note is for people and for coding agents who write UI here. It is short on purpose. Every
rule below is enforced by a tool, so you find out in seconds, not in review.

Run `npm run check` before you push. If a rule seems wrong, change the rule in the same pull
request and explain why; do not work around it.

## Which rules apply

The approved Heed v1 mockup is the acceptance specification for the web app (`src/web`). Its rules
are in [the design contract v2](docs/design/design-contract.md), with [motion](docs/design/motion.md),
[copy](docs/design/copy.md), [accessibility](docs/design/accessibility.md) and
[components](docs/design/components.md), and the product in [docs/product.md](docs/product.md).
Its behaviour is checked against the golden journeys in `tests/e2e`.

## The one idea

**Tokens own appearance. Components own structure. Features only compose.**

- `src/web/styles/tokens.css` is the only file that defines colour, radius, shadow, motion and the
  layout metrics (design contract v2, section 2). A component depends on a name, never on a
  value.
- Shared parts (`components/ui`, the shadcn primitives, and `components/heed`) own control size,
  type and radius.
- A page (`pages`, `routes`) lays things out with them. It does not restyle them.

## The class rules

Tailwind's spacing and text scales, and weights 400 to 700, are allowed as the mockup uses them.
`eslint.class-rules.js` reports the rest, one rule each, with the fix in its message:

- an arbitrary value (`w-[13px]`) or property, except a token by its variable
  (`bg-[var(--mark-add)]`), the properties a transition names and the two keyframes of
  [motion](docs/design/motion.md);
- a raw palette colour (`bg-red-500`): use a theme colour such as `text-muted-foreground`;
- a numeric layer (`z-50`): use a named layer such as `z-dock`;
- raw times, `transition-all`, other easings, growing from nothing, keyframes of a component's
  own, and anything that overrides reduced motion (docs/design/motion.md);
- a viewport variant (`md:`) in a part that can sit in the dock: it reads its container (`@md:`),
  design contract 3.6.

Need a value that is not there? Add a token to `tokens.css`, in light and dark, use it by name,
and explain in the pull request why the existing ones do not fit. Never add a one-off value in a
component. In hand-written CSS, colour, spacing, radius, type size and shadow must be
`var(--token)`; Stylelint reports raw values, and `tokens.css` itself is exempt.

## What else is blocked

- Inline `style` for spacing or colour.
- Importing `lucide-react` anywhere except `components/icons.ts`. Add the icon there.
- A second component base (`@radix-ui/*`), `vaul`, `framer-motion` and decorative animated sets.
- A page or component that imports the mock binding (`@/api/mock`): read and write through
  `@/api` and its queries.
- Em dashes in text. Use a plain dash.

## Before you create a component

1. `npx shadcn search @shadcn` and look in `src/web/components/ui` and `src/web/components/heed`
   ([components](docs/design/components.md) lists them). Name the components you reuse in the
   pull request description.
2. Compose before you invent. A new part needs a reason that composition cannot meet.
3. If it came from the shadcn CLI, bring it onto the class rules in the same change (see
   [How to add a component](docs/development.md#how-to-add-a-component)). Lint tells you exactly
   what is off.

## Tests

- New behaviour gets a unit test: `tests/web` for the app, `tests/server` for the service.
- A change to a screen keeps the golden journeys green (`tests/e2e`), on the mock
  build and, for screens on the service, in http mode. A new screen or state gets its journey, and
  axe runs on every place at 390 and 1440 wide, in light and dark.

## Data

The app talks to `src/web/api`: one interface, `HeedApi` (`client.ts`), with a mock binding over
the demo world (`api/mock`) and an http binding to the Heed service (`http.ts`). Add a method to
`HeedApi` and `heedApiMethods`, implement it in both bindings, and read it through a query option
in `api/queries.ts`. Do not call `fetch` from a component.

A change goes through `useApiWrite` or `useWrite` in `api/queries.ts`: it refreshes what the change
made stale (the `invalidations` map), and the http binding keeps the retry key when an answer is
lost, so a retry is applied once. Both bindings refuse with an `ApiError` (`api/errors.ts`). A
behaviour the mock and the service share belongs in the conformance suite
(`tests/web/conformance/heed-api.ts`), which runs against both.

## Module boundaries

The repository holds the web app and the service (Heed) side by side. `eslint.boundaries.js`
keeps the parts apart, and `tests/lint/boundaries.test.ts` proves each rule still fails.

| Part                        | May import                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| `src/domain`                | `zod/mini` and other domain files. No clock, no network, no I/O                          |
| `src/contract`              | `src/domain`                                                                             |
| `src/web`                   | `src/domain`, `src/contract`, a connector's manifest. Never the service or its packages  |
| `src/server`                | `src/domain`, `src/contract`, `src/connectors`, a module's `index.ts`                    |
| `src/server/modules/<name>` | the above, plus the rest of `src/server`                                                 |
| `src/cli`                   | `src/contract`, `src/domain`                                                             |
| `src/connectors`            | `src/domain` and `zod/mini`. No network, no environment. A `worker.ts` may load packages |

Inside a module, import freely. From outside, go through its `index.ts`: that file is the
module's whole public surface. Domain code takes `today` and other inputs as arguments, so it
stays a pure function of what it is given. If a boundary is wrong, change the rule and its test in
the same pull request and say why.

## Proposal attributes

Two paths write a proposal: the web app's editor (New context and Suggest a change), and the MCP tool
`suggest_context` with which a person's AI agent suggests for them. They must not drift apart
silently, so every
attribute of a proposal is decided once, in `src/domain/proposal-attributes.ts`:

- its limits and whether it is required, which the item version schema, the draft schema, the
  form's checks and the tool's input schema all read (never copy a number);
- the editor's fields that edit it, or why the editor has none;
- how `suggest_context` treats it: `derived` (Heed works it out exactly), `defaulted` (the
  documented default, which only people change), `prefilled` (the agent suggests, the person
  confirms) or `never_inferred` (people decide it), with the marks its drafts may carry, the tool
  inputs that may suggest it and the questions that may ask the person for it;
- whether it carries a provenance mark, and its words for the person.

The tool's description, its output schema and the provenance table are generated from it. When
you add or change an attribute, a tool input, a limit or a question, the parity test
(`tests/server/proposal-attributes.test.ts`, for the schemas and the tool) fails with a sentence
that says what to decide. Decide it in the table, in the same pull request. Never widen what the tool may infer
(a defaulted or never-inferred attribute gaining a tool input or a question) without a product
decision: FR-121 says what an agent may never set.

## Language

Use everyday names in the UI. The web app in `src/web` takes them from glossary v2 in
`src/domain/words.ts` and writes as `docs/design/copy.md` says: "context item", "suggestion",
"owner", "People". The service's own sentences still follow the earlier glossary in
`src/domain/words-v1.ts` and `docs/design/voice.md` until they move. Do not show ids or database
words to people: a contributor must never need to know Git, YAML or MCP (NFR-015 in the
requirements). Say what an empty state means and what to do about
it.

The plain-words lint enforces this. `npm run lint:words` (also part of `npm run check`) reports a
word the glossary bans on a screen, with the word to write instead. In the web app the count of
old words is zero and stays there; in the service's sentences no file may gain any
(`plain-words.baseline.json`). `npm run lint:words -- --list` shows where they are.

## Commits and pull requests

- Small, focused commits. The pull request description follows the template: what changed and
  why, how you tested it, what is out of scope, which shared components you reused and any token
  you added. Write it for a stranger: link to files in this repository, issues and public pages
  only, and no em dashes (use a plain dash).
- CI runs type check, lint, unit tests, the service tests against PostgreSQL 18, the golden job
  specs with axe on the mock build and in http mode, the web app on the demo install, and the
  security scan. Which of them a pull request
  needs depends on what it changes ([Validation tiers](docs/development.md#validation-tiers)), and
  the **CI gate** check must pass.
