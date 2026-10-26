# Contributing

Thanks for helping. This page says how to send a change, then how to write code that passes the
checks.

Everyone here follows the [code of conduct](CODE_OF_CONDUCT.md). Found a security problem? Don't
open an issue: [SECURITY.md](SECURITY.md) says how to tell us privately.

## How to send a change

1. For anything bigger than a small fix, open an issue first and describe the problem. We'll agree
   on the shape of the change before you write code.
2. Fork the repository, create a branch, and keep the change small and focused.
3. Run `npm run check`, then open a pull request. Its template asks what changed, how you checked
   it, and for screenshots when a screen changes.

You send your contribution under the Apache License 2.0, as section 5 of [LICENSE](LICENSE)
says. You keep the copyright in your work.

## Writing code here

This note is for people and for coding agents who write UI here. It is short on purpose. Every
rule below is enforced by a tool, so you find out in seconds, not in review.

Run `npm run check` before you push. If a rule seems wrong, change the rule in the same pull
request and explain why; do not work around it.

## Which rules apply

The approved Heed v1 mockup is the acceptance specification for the web app. Its rules are in
[the design contract v2](docs/design/design-contract.md), with [motion](docs/design/motion.md),
[copy](docs/design/copy.md), [accessibility](docs/design/accessibility.md) and
[components](docs/design/components.md), and the product in [docs/product.md](docs/product.md).
Any new UI follows them. Its behaviour is checked against the mockup's job specs (J1 to J30).

The rest of this page describes the lint that still guards the **old front end** (`src/web`).
It stays in force until the switch to the new web app. Where it differs from the contract v2,
the contract v2 wins for new work.

## The one idea

**Tokens own appearance. Components own structure. Features only compose.**

- `src/web/styles/tokens.css` is the only file that defines colour, spacing, radius, type size,
  shadow and the layout metrics. Its names and values come from the design contract
  (`docs/design/design-contract.md`), so a component must never depend on a value, only on a name.
- Shared components (`components/ui`, `components/page`) own control height, type and radius.
- A feature (`routes`, and screens built later) lays things out with the page regions and shared
  components. It does not restyle them.

## Spacing

The scale is **4, 8, 12, 16, 24, 32, 48, 64** pixels, which are the Tailwind steps
**1, 2, 3, 4, 6, 8, 12, 16**. Also allowed: `0` and `px` (a 1px hairline).

| Do                                                                      | Do not                              |
| ----------------------------------------------------------------------- | ----------------------------------- |
| `gap-4`, `p-6`, `px-3`, `flex flex-col gap-3`                           | `gap-5`, `p-7`, `mt-2`, `space-y-3` |
| `px-gutter` for the page gutter                                         | `px-6 md:px-8` on a page region     |
| `w-sidebar`, `w-rail`, `h-header`                                       | `w-64`, `w-[256px]`, `h-14`         |
| `h-control-md` (control heights: `sm` 28, `md` 32, `lg` 40, `touch` 44) | `h-9`, `h-[34px]`                   |
| `size-icon-sm` (14), `size-4` (16) or `size-5` (20) for an icon         | `size-3.5`, `size-[18px]`           |

The rules are the design contract's (section 3.3), one ESLint rule per row, in
`eslint.class-rules.js`. Each message names the fix. Margins are not used at all (except `auto`):
a parent sets the gap.

Only parents set gaps. Use `flex` or `grid` with `gap-*` on the container; do not put margins on
children, because margins add up and break alignment.

## One gutter, one left edge

Every page region sits inside `px-gutter` (24px from 768px wide, 16px below). Use the page
regions from `components/page/page.tsx`: `Page`, `PageToolbar`, `PageContent`. They are why the
left edges of the header, toolbar and content are equal. `tests/e2e/layout.spec.ts` fails if a
region gets its own padding. Reading and dashboard pages cap the width on the right and stay left
aligned.

The page title is shown once, as the last breadcrumb in the shell header. `Page` adds the same
text as a hidden heading, which shows in the content on a phone below a sidebar place, where the
header has room for the way up only. Do not add a second visible title. Every route has a crumb
definition in `src/web/lib/crumbs.ts`; a new route without one fails the type check.

## Tokens

- Colour comes from semantic names: `bg-background`, `text-muted-foreground`, `border-border`,
  `bg-type-event-tint`, `text-type-event-ink`, `bg-status-warning-bg`. Raw palette colours (`bg-red-500`)
  and arbitrary colours (`text-[#fff]`) are reported.
- Status always pairs colour with an icon or a word. Colour is never the only sign (NFR-111).
- Radius is `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-xl` (3, 4, 4, 6) or
  `rounded-full`. Type is a role: `text-caption` (12), `text-dense` (13), `text-body` (14),
  `text-reading` (15, item prose), `text-row-phone` (15, phone list titles), `text-large` (16), `text-title` (20), `text-display` (24), with weights `font-normal`
  (400) and `font-bold` (700). Tailwind's `text-sm` and friends do not exist.
- Need a value that is not there? Add a semantic token to `tokens.css` (in `:root` and `.dark`,
  and in the `@theme inline` block), use it by name, and explain in the pull request why the
  existing ones do not fit. Never add a one-off value in a component.
- In hand written CSS (`index.css`, rare), colour, spacing, radius, type size and shadow must be
  `var(--token)`. Stylelint reports raw values. `tokens.css` itself is exempt.

## What else is blocked

- Arbitrary Tailwind values such as `w-[13px]`, `grid-cols-[auto_1fr]`, `text-[0.8rem]`. The
  `w-(--some-var)` form is allowed for a variable that already exists. Arbitrary variants such as
  `[&_svg]:size-4` and `data-[state=open]:flex` are allowed.
- `!important` (the `!` suffix) in feature code. Primitives in `components/ui` may use it for
  state driven overrides, as shadcn does.
- Inline `style` for spacing or colour.
- Importing `lucide-react` anywhere except `components/icons.ts`. Add the icon there.
- A second component base (`@radix-ui/*`), `vaul`, `framer-motion` and decorative animated sets.
  Use CSS transitions; if a library is needed, Motion through `LazyMotion`, after a discussion.
- Em dashes in text. Use a plain dash.

## Before you create a component

1. `npx shadcn search @shadcn` and look in `registry.json` and `src/web/components`. Name the
   components you reuse in the pull request description.
2. Compose before you invent. A new part needs a reason that composition cannot meet.
3. If it came from the shadcn CLI, normalise it in the same change (see
   [How to add a component](docs/development.md#how-to-add-a-component)). Lint tells you exactly what is off.

## Stories, previews and tests

- A shared component gets a story in `src/web/stories` that shows its states: default, disabled,
  empty, long text. Use the viewport menu for 1440, 1024 and 390 and the theme menu for light and
  dark.
- A new page template or shell region goes into `src/web/design-preview` so it has a screenshot
  target.
- New behaviour gets a unit test. A layout or shell change gets a Playwright test.
- Accept screenshot changes deliberately: run the update-snapshots workflow ([Screenshot
  baselines](docs/testing.md#screenshot-baselines)), then look at every changed image. Do not update baselines to make a failure go
  away.

## Data

The app talks to `src/web/api`: a mock over typed fixtures, or the Heed service. Add methods to
the `ContextApi` interface, implement them in both bindings, and read them through a query option
in `api/queries.ts`. Do not call `fetch` from a component.

A change goes through `useApiWrite` in `api/queries.ts`: it refreshes what the change made stale
(the `invalidations` map) and keeps the retry key when an answer is lost, so a retry is applied
once. Both bindings refuse with an `ApiError` (`api/errors.ts`); branch on its `kind`, and show
`current`, `findings` or `gate` when it carries them. What a person may do comes from
`usePermissions` (`lib/use-session.ts`); the service checks again and its answer wins. A
behaviour the mock and the service share belongs in the conformance suites in
`tests/conformance`, which run against both.

## Module boundaries

The repository holds the front end and the service (Heed) side by side. `eslint.boundaries.js`
keeps the parts apart, and `tests/lint/boundaries.test.ts` proves each rule still fails.

| Part                        | May import                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `src/domain`                | `zod/mini` and other domain files. No clock, no network, no I/O                         |
| `src/contract`              | `src/domain`                                                                            |
| `src/web`                   | `src/domain`, `src/contract`, a connector's manifest. Never the service or its packages |
| `src/server`                | `src/domain`, `src/contract`, `src/connectors`, a module's `index.ts`                   |
| `src/server/modules/<name>` | the above, plus the rest of `src/server`                                                |
| `src/cli`                   | `src/contract`, `src/domain`                                                            |
| `src/connectors`            | `src/domain` and `zod/mini`. No network, no environment                                 |

Inside a module, import freely. From outside, go through its `index.ts`: that file is the
module's whole public surface. Domain code takes `today` and other inputs as arguments, so it
stays a pure function of what it is given. If a boundary is wrong, change the rule and its test in
the same pull request and say why.

## Proposal attributes

Two paths write a proposal: the Add context and Suggest a change form, and the MCP tool
`draft_context` with which a person's AI agent drafts for them (and the assistant's
`create_draft`, through the same service function). They must not drift apart silently, so every
attribute of a proposal is decided once, in `src/domain/proposal-attributes.ts`:

- its limits and whether it is required, which the item version schema, the draft schema, the
  form's checks and the tool's input schema all read (never copy a number);
- the form fields that edit it, or why the form has none;
- how `draft_context` treats it: `derived` (Heed works it out exactly), `defaulted` (the
  documented default, which only people change), `prefilled` (the agent suggests, the person
  confirms) or `never_inferred` (people decide it), with the marks its drafts may carry, the tool
  inputs that may suggest it and the questions that may ask the person for it;
- whether it carries a provenance mark, and its words for the person.

The tool's description, its output schema and the provenance table are generated from it. When
you add or change an attribute, a form field, a tool input, a limit or a question, the parity tests
(`tests/server/proposal-attributes.test.ts` for the schemas and the tool,
`tests/unit/proposal-attributes.test.ts` for the form) fail with a sentence that says what to
decide. Decide it in the table, in the same pull request. Never widen what the tool may infer
(a defaulted or never-inferred attribute gaining a tool input or a question) without a product
decision: FR-121 says what an agent may never set.

## Language

Use everyday names in the UI. The new web app in `src/app` takes them from glossary v2 in
`src/domain/words.ts` and writes as `docs/design/copy.md` says: "context item", "suggestion",
"owner", "People". The old front end in `src/web` keeps the earlier glossary in
`src/domain/words-v1.ts` and `docs/design/voice.md` until the switch: "fact", "proposal", "owner",
and "edition" only on the Editions page. Do not show ids or database words to people: a contributor must never need to know Git,
YAML or MCP (NFR-015 in the requirements). Say what an empty state means and what to do about
it.

## Commits and pull requests

- Small, focused commits. The pull request description lists what changed, which shared
  components you reused, and any token you added.
- CI runs type check, lint, unit tests, the service tests against PostgreSQL 18, the Storybook
  build, and Playwright with axe and screenshots. All must pass.
