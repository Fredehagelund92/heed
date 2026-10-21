# Product name: inventory and rename checklist

The product is called Heed today, and the name may change. This page says where the name appears,
which of those places follow one setting, and what a full rename still has to change by hand. It
was made on 16 October 2026 from every occurrence of "Heed" in `src`, `docs`, `README.md` and the
design notes.

## The setting

One setting holds the name people and agents read: `CL_PRODUCT_NAME`, default `Heed`
(`src/domain/brand.ts`).

- The service reads it once at start (`src/server/brand.ts`), so the assistant's instructions,
  the MCP tools' descriptions and the server instructions stay byte-stable between requests. A
  value that is not a usable name stops the start (`src/server/config/env.ts`).
- The web build reads the same variable (`envPrefix` in `vite.config.ts`, `src/web/lib/brand.ts`),
  and so does the page title in `src/web/index.html`. Set it for both.
- The help pages write `{{product}}` where a sentence names the product; the Docs loader puts the
  name in (`withProductName`, `src/web/lib/docs.ts`), front matter and pictures included. A
  heading never holds the token: its words are its address.

The checks:

- The docs check (`tests/unit/docs.test.ts`) fails when a help page or picture names the product
  by hand, or a heading holds the token.
- `tests/server/brand.test.ts` checks the setting: the default, a name that stops the start, and
  the token. It also sets another name and checks that the service's help pages, the
  assistant's instructions and turn context, and the MCP instructions and tools say it, and never
  the old name.
- The lint rule `brand/no-product-name` (`eslint.product-name.js`, proved in
  `tests/lint/product-name.test.ts`) reports a string, template text or JSX text in the app, the
  domain, the contract, the service or the CLI that names the product by hand. The technical names below carry
  an `eslint-disable-next-line` comment with their reason.
- `tests/unit/brand-renamed.test.tsx` sets another name and checks that the sign-in page, the
  logo, the page title, the lines an agent is given, the help pages and their pictures say it,
  and never the old name.

## How each occurrence was classified

| Class                         | Rule                                                                                                                      | What to do                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) Labels that need no name  | A navigation or action label, or a sentence where the name is filler: the reader already knows which product they are in. | Rewrite without it: "Back to Heed" is "Back", "Add Heed to your agent" is "Add to your agent", "Last week in Heed" is "Last week", "Heed reads" is "Reads", "Ask Heed first" is "Ask first". |
| (b) Sentences that name it    | The sentence reads wrongly without the name: "Sign in to Heed", "What is Heed", an agent told what the server holds.      | The name comes from the setting: `productName` in the app and the service, `{{product}}` in a help page, a `product` fact for the scripted assistant (`src/domain/assistant-meta.ts`).       |
| (c) Technical identifiers     | A name a machine, a file or a stored record depends on.                                                                   | Leave as they are. Listed below as the plan for a real rename.                                                                                                                               |
| (d) Historical or quoted text | Records of what was said or decided.                                                                                      | Unchanged.                                                                                                                                                                                   |

Counts when this was made: 586 lines in 155 files in `src/web` (177 of them strings a person can
read; the rest code names and comments), 252 lines in `src/server` (144 strings), 34 strings in
`src/domain`, `src/contract` and `src/cli`, and 161 in the 11 help pages.

Comments and code names (`HeedDomainIcon`, `heedIcon`, `HeedClient`) are not text anyone reads in
the product, so they keep the name; renaming them is cosmetic and can follow at any time.

## (c) Technical identifiers: the plan for a real rename

Do these in the order below, one pull request each. The risk is what breaks if the step is done
alone or done wrong.

| Order | Item                                                                                                                                                                                                                                                                                                                                                            | Where                                                                                                                           | Risk                                                                                                                                                                                                 |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Brand assets: the lockup, symbol and mark (`src/web/public/heed-*.svg`, the favicons, the wordmark path in `components/app-shell/logo.tsx`, `docs/design/logo.md`).                                                                                                                                                                                             | `src/web/public`, `src/web/components/app-shell/logo.tsx`                                                                       | Low. Design work, not code: the wordmark is drawn, not typed, so the setting cannot change it. Keep the file names until step 6.                                                                     |
| 2     | Code names: `Heed*Icon`, `heedIcon`, `heedMarks`, `HEED_STROKE`, the `.heed-point` classes, the `heed-ink` and `heed-ux` story names, `HeedClient`, `HeedSetup`, `askHeedFirst`, `whatHeedReads`, `auditByHeed`, the lint rule `heed/plain-words`.                                                                                                              | `src/web`, `src/cli`, `scripts`                                                                                                 | Low. A rename refactor the type check proves. The design contract's glyph table (6.11) names the marks `heed-*`, so it changes in the same pull request.                                             |
| 3     | Test ids and data attributes: `data-heed-ask`, `data-heed-markup`, `data-slot="ask-heed-first"`, `home-new-to-heed`, `lucide-heed-*` classes, `window.heedMock`.                                                                                                                                                                                                | `src/web`, `tests/e2e`, `tests/unit`, stories                                                                                   | Low. Tests find elements by them; change the attribute and every test that reads it together.                                                                                                        |
| 4     | Docs slugs: `what-is-heed`, `tell-heed-about-your-business` and the picture `images/heed-loop.svg`.                                                                                                                                                                                                                                                             | `docs/help`, `src/web/lib/help.ts`, links in the app and on GitHub                                                              | Medium. A slug is an address people bookmark and paste: keep a redirect from the old `/docs/<slug>` for a while.                                                                                     |
| 5     | Environment variables: `HEED_URL`, `HEED_ORIGIN`, `HEED_EMAIL`, `HEED_KEY`, `HEED_API_URL`, `HEED_CONNECTORS`, `HEED_INSTALL` and `VITE_HEED_INSTALL`, `HEED_HELDOUT_KEY`, `HEED_HELDOUT_KEY_FILE`, `HEED_DEMO_PORT`, `HEED_DEMO_WEB_PORT`, and the compose file's `HEED_PORT` and `HEED_WEB_PORT`.                                                             | `src/cli`, `scripts`, `vite.config.ts`, `.env.example`, `compose.yaml`, CI                                                      | Medium. Read the old name as a fallback for one release, and say so in the release note, or every local `.env` breaks silently.                                                                      |
| 6     | Local files and folders: the show's home `~/.heed-demo`, `~/.heed/held-out.key`, the container's `/var/lib/heed`, `.heed-dev-key.pem`, `.heed-mcp-state.key`, `.heed-oauth-key.pem`, the served `/heed-version.json` and the public `heed-*.svg` files.                                                                                                         | `scripts/demo.ts`, `src/server/config/env.ts`, `vite.config.ts`, `Dockerfile`, `.gitignore`                                     | High for keys: a new default path means a new signing or state key, which signs everyone out and voids sealed questions. Move the file or keep the old default. The show's folder needs a move step. |
| 7     | Storage keys and cookies: `heed_session`, `heed_oauth_browser`, the `heed.context.<person>.<draft>` drafts and `heed:lists` in the browser.                                                                                                                                                                                                                     | `src/server/modules/auth`, `src/server/modules/oauth`, `src/web`                                                                | High. A new cookie name signs everyone out; a new storage key loses unsaved drafts. Read both names for a release, then drop the old.                                                                |
| 8     | HTTP headers: `x-heed-csrf`, `x-heed-api`, `x-heed-markup`, `X-Heed-Tool-Digest`.                                                                                                                                                                                                                                                                               | `src/server/http`, `src/server/mcp`, `src/web/api/http-api.ts`, `src/cli/client.ts`                                             | High. The web app, the CLI and the service must agree: accept both names on the service first, then switch the clients, then drop the old.                                                           |
| 9     | Metrics and logs: the `heed_*` metric names, the logger's name `heed`, job and queue names (`heed-jobs`, `heed-relay`, `heed-serve`, `heed-eval-runner`), the read user agent `Heed/1.0`.                                                                                                                                                                       | `src/server/observability`, `src/server/http/metrics.ts`, `src/server/modules/*`                                                | Medium. Dashboards and alerts query metric names: rename them in the dashboards in the same change. Old series stop, so history splits at the rename.                                                |
| 10    | Database and stored records: the role and database names (`heed`, `heed_demo`, `heed_try_it`), advisory lock and setting keys (`heed.migrations`, `heed.local_roles`, `heed.roles`, `heed.areas`, `heed.sources.add`, `heed.dev_people`, `heed.bulk_seed`), `heed.edition/1` in exports, the app family `heed` and the seal label `heed-assistant-evidence-v1`. | `db/migrations`, `src/server/db`, `src/domain/edition-export.ts`, `src/domain/app-family.ts`, `scripts/demo.ts`, `compose.yaml` | Highest. Records already written carry these names, and a seal label is part of a signature. Rename by migration only, and keep reading the old values; never edit an applied migration.             |
| 11    | The MCP server id and registration name `heed`, the protected resource name, and the `heed` CLI command (`npm run heed`).                                                                                                                                                                                                                                       | `src/server/mcp/gateway.ts`, `src/cli`, `package.json`, connection guides                                                       | Highest for people: every agent that registered the server by its id, and every `CLAUDE.md` line that names its tools, must be added again. Announce it, and keep the old id answering for a while.  |
| 12    | Repository, package and host names: the repository's name, `context-layer`, test hosts such as `heed.example.test` and `heed.invalid`.                                                                                                                                                                                                                          | `package.json`, tests, `src/web/lib/docs.ts`                                                                                    | Low for test hosts; the repository name is outside this plan.                                                                                                                                        |

Developer documentation (`README.md`, `docs/demo.md`, `docs/ai-sign-in.md`,
`docs/connectors*`, `docs/requirements.md`, `docs/domain/core.md`, `docs/templates`) talks about
the product by name and names the identifiers above; it changes with the step that changes what
it describes, and its prose with a search and replace at the rename.

## (d) Historical and quoted text

Left as written, since it records what happened:

- the captain's quotes and decisions in comments and design notes, such as the Home lab's
  "Last week in Heed" in `src/web/components/home/home-pulse.tsx` and `src/web/lib/home-pulse.ts`;
- `docs/requirements.md` and the decisions recorded in `docs/design/design-contract.md`;
- applied database migrations in `db/migrations`;
- the API description generated into `docs/api/openapi.json` (generated: it follows the code).

## When the name changes

1. Set `CL_PRODUCT_NAME` where the service runs and where the web app is built, and rebuild.
2. Run `npm test`: the brand tests confirm the help pages, their pictures and the page title say
   the new name and never the old one. Screens and agent text that still write the name by hand
   (class (b) strings not yet moved to `productName`) need a search for the old name.
3. Replace the brand assets (step 1 above), then work down the table as far as the rename goes.
