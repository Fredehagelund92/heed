## What changes

<!-- What can someone do now, or what is fixed? One or two plain sentences. -->

## Why

<!-- The problem this solves, and for whom. Link the issue: "Closes #123". For anything bigger than a small fix, the issue is where we agreed on the shape of the change. -->

## How it was tested

<!-- The commands you ran and what you looked at by hand. Say which API the web app ran on: the mock (`npm run dev`) or the service (`npm run dev:http`). -->

- [ ] `npm run check` passes
- [ ] New behaviour has a test
- [ ] A screen change keeps the golden journeys green (`npm run test:e2e`, and `npm run test:e2e:golden-http` for a screen on the service)

### Screenshots

<!-- Required when a screen changes: light and dark, at 1440 and 390 wide. Delete this heading for a change nobody sees. -->

## Out of scope

<!-- What this change deliberately leaves alone, and anything you saw on the way that deserves its own issue. -->

## Before you send it

- [ ] The words people read follow `docs/design/copy.md` and the names in `src/domain/words.ts` (the service's own sentences: `docs/design/voice.md` and `src/domain/words-v1.ts`)
- [ ] The description makes sense to a stranger: it links only to files in this repository, issues and public pages
- [ ] No real access keys, passwords or personal data, in the code or in the examples
- [ ] Shared components you reused, and any token you added, are named here: <!-- e.g. Button, Sheet; token `--mark-add` -->
- [ ] A new migration takes the number after the latest on `main`, and generated files (`npm run api:generate`) are up to date
- [ ] The first load stays within its budget (`npm run size`; see CONTRIBUTING)

<!-- Contributions are licensed under Apache-2.0, as LICENSE says. -->
