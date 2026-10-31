# Working with coding agents

This page is for people who use a coding agent (Claude Code, Codex, Cursor or another) to change Heed, and for the agents themselves. The rules are the same as for any contributor. The checks run on the change, not on who or what typed it.

## Read these first

In this order, and only as far as the task needs:

1. [README](../README.md): what Heed is and how to run it.
2. [CONTRIBUTING](../CONTRIBUTING.md): the commands, the class rules, the module boundaries, the budget and how reviews work.
3. [Develop Heed](development.md): the folder map and every command.
4. For a screen: [Product](product.md), the [design contract](design/design-contract.md), [copy](design/copy.md) and [components](design/components.md). The [mockup](../apps/mockup/README.md) is the living design reference; the web app is changed to match it, never the other way round.
5. For the service: [db/README.md](../db/README.md), [Run and operate the service](operations.md) and [the API reference](reference.md).

## The loop

1. Start from an issue, or open one and agree on the shape of the change first.
2. Reproduce a bug before you fix it, as close to how a person meets it as you can: in the browser for a screen, through the API for the service.
3. Make the smallest change that solves it. Compose the shared parts in `src/web/components` before you invent one.
4. Run `npm run check`. For a screen, also run the golden journeys (`npm run test:e2e`) and look at the result in light and dark, at 1440 and 390 wide.
5. Open a pull request with the template filled in. Write it for a stranger.

## Rules of the repository

- **Do not push to `main`.** Work on a branch and open a pull request. A maintainer merges.
- **Exact versions.** Dependencies are pinned (`save-exact` in `.npmrc`). Do not add a range, and do not add a dependency a change does not need.
- **Never edit what is generated.** `docs/api/openapi.json` and `src/web/api/contract.json` come from `npm run api:generate`. A test fails while they are stale. Regenerate after you rebase.
- **Migrations are forward-only.** Add one with the next number after `main`'s latest; never edit an applied one. See [Add a migration](../CONTRIBUTING.md#add-a-migration).
- **Tokens own appearance.** No arbitrary values, raw colours, numeric layers or inline spacing. Add a token and say why. Lint reports each break with the fix.
- **Plain words on screen.** Use the glossary in `src/domain/words.ts`. `npm run lint:words` fails on a banned word.
- **No em dashes.** Use a plain dash, in code, docs and commit messages.
- **Demo data is invented.** Every name, number and company in examples and tests is made up (the demo is Larchwood Outdoor). No real keys, passwords or personal data, ever.
- **Stay inside the budget.** The first load is held to 431 KB of script and 32 KB of CSS. Load route code on demand rather than raising it.
- **Keep the sealed test cases sealed.** The held-out cases for answer tests are encrypted. A change to them goes in a pull request of its own, with nothing under `src/`.
- **Do not weaken a check to make it pass.** If a rule is wrong, change the rule in the same pull request and say why.
- **Do not change the licence** (Apache-2.0).

## What an agent may do

- Read anything in the repository, run the commands in CONTRIBUTING, and start the app on the demo data.
- Change code, tests and docs on a branch, and open a pull request.
- Fix a lint error, a failing test or a flaky test you meet along the way, if the fix is small. If it is not, open an issue.
- Drive the app in a browser and attach screenshots to the pull request.

## What an agent should not do without a person saying so

- Merge, force-push, or delete branches that are not its own.
- Change access, sign-in, the security rules or dependencies. These take the Sensitive tier in CI and need a closer read.
- Raise the budget, loosen a lint rule, skip a test or edit a migration that is already applied.
- Create issues in bulk, post on behalf of a person, or send content to an outside service.
- Decide a product question. If a choice changes what gets built, say so in the pull request or issue and let a maintainer decide.

## The pull request

Fill in every part of the [template](../.github/pull_request_template.md): what changes, why, how it was tested, screenshots for a screen, and what is out of scope. Link only to files in this repository, issues and public pages. State plainly what you ran and what you did not.
