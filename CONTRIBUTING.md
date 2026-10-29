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

The approved Heed v1 mockup is the acceptance specification for the web app (`src/app`). Its rules
are in [the design contract v2](docs/design/design-contract.md), with [motion](docs/design/motion.md),
[copy](docs/design/copy.md), [accessibility](docs/design/accessibility.md) and
[components](docs/design/components.md), and the product in [docs/product.md](docs/product.md).
Its behaviour is checked against the mockup's job specs (J1 to J30).

## The one idea

**Tokens own appearance. Components own structure. Features only compose.**

- `src/app/styles/tokens.css` is the only file that defines colour, radius, shadow, motion and the
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

1. `npx shadcn search @shadcn` and look in `src/app/components/ui` and `src/app/components/heed`
   ([components](docs/design/components.md) lists them). Name the components you reuse in the
   pull request description.
2. Compose before you invent. A new part needs a reason that composition cannot meet.
3. If it came from the shadcn CLI, bring it onto the class rules in the same change (see
   [How to add a component](docs/development.md#how-to-add-a-component)). Lint tells you exactly
   what is off.

## Tests

- New behaviour gets a unit test: `tests/app` for the app, `tests/server` for the service.
- A change to a screen keeps the golden job specs green (`tests/e2e-app`, J1 to J30), on the mock
  build and, for screens on the service, in http mode. A new screen or state gets its journey, and
  axe runs on every place at 390 and 1440 wide, in light and dark.

## Data

The app talks to `src/app/api`: one interface, `HeedApi` (`client.ts`), with a mock binding over
the demo world (`api/mock`) and an http binding to the Heed service (`http.ts`). Add a method to
`HeedApi` and `heedApiMethods`, implement it in both bindings, and read it through a query option
in `api/queries.ts`. Do not call `fetch` from a component.

A change goes through `useApiWrite` or `useWrite` in `api/queries.ts`: it refreshes what the change
made stale (the `invalidations` map), and the http binding keeps the retry key when an answer is
lost, so a retry is applied once. Both bindings refuse with an `ApiError` (`api/errors.ts`). A
behaviour the mock and the service share belongs in the conformance suite
(`tests/app/conformance/heed-api.ts`), which runs against both.

## Module boundaries

The repository holds the web app and the service (Heed) side by side. `eslint.boundaries.js`
keeps the parts apart, and `tests/lint/boundaries.test.ts` proves each rule still fails.

| Part                        | May import                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| `src/domain`                | `zod/mini` and other domain files. No clock, no network, no I/O                          |
| `src/contract`              | `src/domain`                                                                             |
| `src/app`                   | `src/domain`, `src/contract`, a connector's manifest. Never the service or its packages  |
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
`suggest_context` with which a person's AI agent suggests for them (and the assistant's
`create_draft`, through the same service function). They must not drift apart silently, so every
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

Use everyday names in the UI. The web app in `src/app` takes them from glossary v2 in
`src/domain/words.ts` and writes as `docs/design/copy.md` says: "context item", "suggestion",
"owner", "People". The service's own sentences still follow the earlier glossary in
`src/domain/words-v1.ts` and `docs/design/voice.md` until they move. Do not show ids or database
words to people: a contributor must never need to know Git, YAML or MCP (NFR-015 in the
requirements). Say what an empty state means and what to do about
it.

## Commits and pull requests

- Small, focused commits. The pull request description lists what changed, which shared
  components you reused, and any token you added.
- CI runs type check, lint, unit tests, the service tests against PostgreSQL 18, the golden job
  specs with axe on the mock build and in http mode, the web app on the demo install, and the
  security scan. Which of them a pull request
  needs depends on what it changes ([Validation tiers](docs/development.md#validation-tiers)), and
  the **CI gate** check must pass.
