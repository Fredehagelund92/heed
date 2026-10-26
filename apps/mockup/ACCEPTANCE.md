# Acceptance specification

The mockup is the acceptance specification; the real app is changed to match it. Where the app, its
design contract, its requirements, its help pages or its README differ from the mockup, the mockup
wins and the other is updated: tokens, wording, kinds, answer states, roles, flows, widths and
motion. Its screens, its copy and its job specs below are what the app is checked against, and the
job specs become the app's golden tests: they run against the mockup today and against the app later
with `BASE_URL` set and nothing else.

## Source

Imported from the Heed v1 design repository, folder `mockup/`, at commit
`080cbc39233dc44097162e175fbf789441f06fea`. The code is a verbatim copy, except that a few code
comments that named the design process were reworded, and the package is named `heed-mockup`. The
README and `docs/motion.md` come from the same commit, with their paths made relative to this
folder and the same rewording.

## Job specs

One Playwright spec per job in `e2e/` (J3 has two). Each job is a flow a person does, as a test.

| Job | Spec | What it checks |
| --- | --- | --- |
| J1 | `j1-review-publish.spec.ts` | An owner reviews a suggestion and publishes it, in three steps from the Inbox |
| J2 | `j2-suggest.spec.ts` | Someone who owns no domain suggests a change and sees it waiting |
| J3 | `j3-ask-report.spec.ts` | Someone asks, gets an answer that says how sure it is, and reports a wrong part |
| J3 | `j3-ask-motion.spec.ts` | How an answer arrives: written over a second or two, stoppable, at once with reduced motion |
| J4 | `j4-not-found.spec.ts` | What agents couldn't answer comes as a draft, reviewed and published |
| J5 | `j5-report.spec.ts` | An owner answers a report, and the card is done |
| J6 | `j6-sync.spec.ts` | A read from a connected document arrives as a suggestion and is published |
| J7 | `j7-setup.spec.ts` | A new workspace reaches its first grounded answer in about ten actions |
| J8 | `j8-states.spec.ts` | Loading, a failed load with Retry, offline, and a failed Publish that keeps the text |
| J9 | `j9-domains.spec.ts` | Domains: added from the grid, deleted only while empty, their words in the editor |
| J10 | `j10-people.spec.ts` | People: invites, the last owner can't leave, what an owner who isn't an admin may do |
| J11 | `j11-figures.spec.ts` | Figures in Ask: off by default, switched on for Cube, the definition decides |
| J12 | `j12-connect.spec.ts` | Connect an agent: the prompt, the check every 3 seconds, help at 2 minutes, stop at 10 |
| J13 | `j13-review-keys.spec.ts` | The review's keys never act while you type; Esc, `?` and the Command-Enter hint |
| J14 | `j14-review-send.spec.ts` | Deciding without a connection: nothing is published, Try again works |
| J15 | `j15-review-bulk.spec.ts` | "Publish the ones you've read": what counts as read, bulk publish and Undo |
| J16 | `j16-review-care.spec.ts` | What needs care is said before anyone publishes; archiving always asks first |
| J17 | `j17-review-phone.spec.ts` | The review on a phone: the decision bar in words, nothing to press under 44px |
| J18 | `j18-review-motion.spec.ts` | After a decision: the short wait, holding it, reduced motion, toasts kept clear |
| J19 | `j19-review-source.spec.ts` | The Source view: removed lines before added ones, only the changed words marked |
| J20 | `j20-synonyms.spec.ts` | Synonyms as tags: made at once, a clash is said and never saved, Backspace and Escape |
| J21 | `j21-links.spec.ts` | Following links (`get_related`): Related, what Ask followed, the switch in Settings |
| J22 | `j22-help.spec.ts` | Help: the menu, `?` from anywhere, the Help page, the documentation, Report a problem |
| J23 | `j23-review-round3.spec.ts` | Focus after a decision, the announcement, everything handled with Undo |
| J24 | `j24-multi-select.spec.ts` | Picking several rows the same way in every list with checkboxes |
| J25 | `j25-bulk-actions.spec.ts` | Bulk actions from one bar: Archive with Undo, deleting drafts, skipped items, Retry |
| J26 | `j26-emoji.spec.ts` | Emoji where people talk to each other, with the same picker as mentions |
| J27 | `j27-observability.spec.ts` | Observability: what agents asked and what they got |
| J28 | `j28-ask-ideas.spec.ts` | The three Ask ideas: an answer travels with its sources, where it says that, asked this week |
| J29 | `j29-motion.spec.ts` | Motion and loading (`docs/motion.md`), also run with reduced motion |
| J30 | `j30-topics.spec.ts` | Topics as the real key has them: exact scope and month, no month under 5 given away |

## How to run them

The specs run on the installed Google Chrome against a production build that Playwright builds and
serves on port 5310. The `reduced-motion` project runs J29 again with reduced motion.

```sh
npm --prefix apps/mockup ci     # from the repository root, once
npm run mockup:e2e              # every spec, both projects

cd apps/mockup
npx playwright test e2e/j1-review-publish.spec.ts   # one job
npx playwright test --project reduced-motion        # J29 with reduced motion only
BASE_URL=http://localhost:5173/ npx playwright test # the same specs against another build
```

CI runs them in the `Mockup: typecheck, lint, tests, build, e2e` job (`.github/workflows/mockup.yml`)
after the type check, oxlint, the unit tests and the production build.
