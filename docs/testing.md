# Tests

What each test suite covers, how to run it, and how screenshot baselines are made. `npm run check` runs what CI runs, except the browser tests.

`npm test` runs the service's tests without a database. `npm run test:integration` runs the
tests that need PostgreSQL 18, against `TEST_DATABASE_URL` (default
`postgres://localhost:5432/postgres`, a superuser); CI runs them against a PostgreSQL 18 container.

## Tests

- **Unit (Vitest).** Fixtures against the item model, the mock API (the conformance suite), the
  command registry and hotkeys, the appearance bootstrap, typed search params.
- **Service (Vitest).** Configuration, health checks, request logs without headers or query
  strings, the API's sign-in, validation and typed errors, the generated API files, job and
  connector status rules, the operations endpoints, and the real entry point started with Node.
  `tests/integration` adds a real PostgreSQL 18, runs the conformance suite through the http
  binding, and runs the job runner under the API role: schedules, retries and the failure alert,
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
  `tests/server/evals/models.test.ts` and the assistant's tests; rate limits in the MCP conformance
  tests and, for the web API, `tests/server/rate-limit.test.ts` and
  `tests/integration/rate-limit.test.ts`. Scanning and the restore drill are in
  [Security, scanning and the restore drill](security.md).
- **Docs check (Vitest).** `tests/unit/docs.test.ts` reads every help page in `docs/help`: its
  front matter, its kind's template, every link to a page, a heading, a picture or a screen, and
  every bold control name, which must be on one of the app's screens. `tests/e2e/docs.spec.ts`
  covers the Docs area in the browser. `docs/help/README.md` says what each rule means.
- **Module boundaries (Vitest).** `tests/lint/boundaries.test.ts` lints a fixture tree that breaks
  each boundary and expects each break to be reported.
- **Guard rails (Vitest).** `tests/lint/guard-rails.test.ts` lints a deliberately wrong component
  and deliberately wrong CSS and expects each rule to report it with a clear message. If you loosen
  a rule, this fails first.
- **Layout (Playwright).** `tests/e2e/layout.spec.ts` asserts that the left edges of the header,
  toolbar and content are equal, and equal to the gutter, on every page at 1440, 1024 and 390.
- **axe (Playwright).** WCAG 2.2 AA through axe on every page, in light and dark, at the three
  widths, plus the open command palette and user menu.
- **Form kit stories (Playwright).** `tests/e2e/stories.spec.ts` opens every
  `Forms/` story of a static Storybook build in light and dark, waits for its play function (the
  keyboard interaction test) and runs axe on it.
- **Screenshots (Playwright).** The shell and every page template at the three widths in both
  appearances. They compare against baselines made in CI, so they are skipped until baselines are
  committed and on non-Linux machines. See the next section.

### Screenshot baselines

Pixels differ between operating systems, so baselines are never made on a laptop. They are Linux
images made by a manual GitHub Actions workflow, on the same `ubuntu-latest` image that CI uses.

1. Open the repository's Actions tab, choose **update-snapshots**, and run it on your branch
   (or `gh workflow run update-snapshots --ref <branch>`).
2. When it finishes, download the `screenshot-baselines` artifact and unzip it into
   `tests/e2e/__screenshots__`.
3. Look at the images, especially the ones that changed (`git diff --stat`, then open them).
   Commit them with the change that caused them. Do not regenerate baselines to make a failure
   go away.

Until the first baselines are committed, CI runs every other test and skips the screenshots with a
message that says so. With baselines committed, CI compares against them and fails on a
difference above 0.2% of pixels. `npm run test:e2e:update` rewrites baselines locally for people
who want to look at the output, but do not commit those.
