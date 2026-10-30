# Tests

What each test suite covers and how to run it. `npm run check` runs what CI runs, except the browser tests.

`npm test` runs the service's tests without a database. `npm run test:integration` runs the
tests that need PostgreSQL 18, against `TEST_DATABASE_URL` (default
`postgres://localhost:5432/postgres`, a superuser); CI runs them against a PostgreSQL 18 container.

## Tests

- **Unit (Vitest).** The web app's own units in `tests/web`: the mock binding against the
  `HeedApi` conformance suite (`tests/web/conformance/heed-api.ts`), the http binding's mapping of
  the service's answers, the router, the theme bootstrap and the rules in `lib`. The pure domain
  in `tests/server/domain`.
- **Service (Vitest).** Configuration, health checks, request logs without headers or query
  strings, the API's sign-in, validation and typed errors, the generated API files, job and
  connector status rules, the operations endpoints, and the real entry point started with Node.
  `tests/integration` adds a real PostgreSQL 18, runs the conformance suite through the http
  binding (`tests/web/integration`), and runs the job runner under the API role: schedules, retries and the failure alert,
  retention, partitions and the watchdog.
- **Security suite (Vitest, PostgreSQL).** Generated from the contract, so a new operation is
  covered without a new test: `authorization.test.ts` sends every API operation, the operations
  endpoints, `/metrics` and MCP as every role, and checks that a refusal is 401 or 403 and changes
  nothing, that every state-changing request needs an allowed Origin and the session's CSRF token,
  and that the trace-level log of it all holds no credential and no person. `injection.test.ts`
  puts SQL, wildcards and control characters into every parameter of every reading operation and
  every MCP tool. `small-counts.test.ts` checks that a topic asked about fewer than five times
  shows on no surface a reader can reach. The anonymity canary (`canary.test.ts`) also searches a
  real `pg_dump` and `/metrics`. Prompt injection with the mock model is in
  `tests/server/evals/models.test.ts`; rate limits in the MCP conformance
  tests and, for the web API, `tests/server/rate-limit.test.ts` and
  `tests/integration/rate-limit.test.ts`. Scanning and the restore drill are in
  [Security, scanning and the restore drill](security.md).
- **Docs check (Vitest).** `tests/web/docs.test.ts` reads every page of the new app's documentation in
  `docs/help` (`docs/help/README.md`, "The docs check"): the mockup's eleven pages and What's new, their
  links, the app's own lists they include, and every bold control, which must have a row in
  `tests/e2e/docs-controls.ts`; `tests/e2e/docs-controls.spec.ts` draws each row's screen
  in the browser and finds the control on it. `npm run docs:sync` mends an include that is out of date.
- **Module boundaries (Vitest).** `tests/lint/boundaries.test.ts` lints a fixture tree that breaks
  each boundary and expects each break to be reported.
- **Guard rails (Vitest).** `tests/lint/web-guard-rails.test.ts` and `tests/lint/guard-rails.test.ts`
  lint deliberately wrong components and CSS and expect each rule to report them with a clear
  message; `tests/lint/web-class-rules.test.ts` runs the class rules against samples. If you
  loosen a rule, these fail first.
- **Golden job specs (Playwright).** `tests/e2e`: the mockup's job specs J1 to J30, the
  motion journey again under reduced motion, on a production build with the mock binding
  (`npm run test:e2e`), and those whose screens are wired in http mode against the service
  (`npm run test:e2e:golden-http`). An agent's consent page runs a real OAuth round trip in http
  mode, and `calls.spec.ts` holds the calls one Inbox load makes.
- **axe (Playwright).** WCAG 2.2 AA through axe on every place of the app, at 390 and 1440 wide,
  in light and dark (`tests/e2e/axe.spec.ts`).
- **The demo install (Playwright).** `tests/e2e-seed` signs in on what `docker compose up` gives a
  new install and checks that every main screen draws on its data, with no call refused
  (`npm run test:e2e:seed`).
