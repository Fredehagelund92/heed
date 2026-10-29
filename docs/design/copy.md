# Copy: wording and vocabulary

Part of the [design contract](design-contract.md). It says how every word people read is written: screens, toasts, errors, help pages, the documentation, the agent's one-line reply, demo text and release notes. It comes from the approved mockup, whose copy rules are checks, not habits.

It replaces [the earlier voice guide](voice.md) for the web app. The voice guide stays for the service's own sentences until they move. [`src/domain/words.ts`](../../src/domain/words.ts) holds the names of this page in code (glossary v2). The earlier list stays in `src/domain/words-v1.ts` for the service.

## Who we write for

People in finance, marketing, operations and management. Many read English as a second language. They know their business and their numbers. They should never need to know data or AI words.

## 1. Neutral wording

Heed is open source and any company can run it. The words do not belong to one company.

1. **The product name lives in one constant.** `PRODUCT` in the mockup (`lib/brand.ts`); `productName` in the app. A sentence never contains it. Copy says "it", "agents", "your workspace" or "the checked context". Wrong: "Heed checks it before agents read it." Right: "It is checked before agents read it."
2. **Where the name does appear:** the logo's label, sign-in and the page title. Technical names that follow it (the address, the MCP server's name, the command line, the Drive service account) are built from the constant.
3. **Inside a command or an address the name may appear.** A sentence around it may not.
4. **A connected tool is named only on its own integration.** Cube is named on the Cube integration page, not in generic copy. Generic copy says "where metrics are defined" or "your definitions source". Agents (Claude Code, Cursor and others) are named in the connect steps, as data, and never inside the review's own sentences.
5. **No company names, no internal repository names and no employer words** in any text. The only demo world is Larchwood Outdoor.
6. **"Back to app"**, not "Back to" plus a workspace name, leads out of Settings and Observability.
7. **The workspace's name** is a setting an admin sets in General. It appears where a shared answer says where it came from.

## 2. Plain English

1. **Short words.** Say "use", not "utilise". Say "start", not "initiate".
2. **A label is one or two words.** Checked, Not found, Publish, Archive.
3. **A state line is a sentence of eight words or fewer.** "Only part of this is written down."
4. **A hint is fourteen words or fewer.** The four kind hints are examples.
5. **No contractions in labels, state lines or hints.** In a longer message a plain contraction (don't, can't, isn't, couldn't) is fine. Write "not" in full where it carries the weight: "This cannot be undone."
6. **No idioms.** No "on the same page", "ballpark", "in the loop", "heads up", "reach out".
7. **Answer first.** The first words say what happened or what to do. The reason comes after, or goes to Help.
8. **One idea per sentence.** About fifteen words, never over twenty-five. Keep the small words (the, a, that) that make a sentence easy to read.
9. **Say it positively.** Say what is true and what to do. One negative sentence at most, and only where it carries weight.
10. **One name per thing.** Take it from the glossary (below and in [the product page](../product.md)). Never a synonym for variety.
11. **Human values.** "23 Oct 2026", "12 to 19 May 2026", "3 context items", a person's name, a domain's name. No ISO dates, ids, edition labels, field keys or zero counts on a contributor's screen. Dates and numbers go through `Intl` with the browser's locale; the style stays as shown.
12. **Calm and honest, never cute.** No jokes, no exclamation marks, no "Oops", no praise. No "Sorry" except for an outage we caused.
13. **Say what is kept.** Never promise anonymity. Say what is stored: scopes and counts, or a name with the words a person sent.
14. **People decide, software proposes.** "An agent suggested this. The owner of Sales publishes it."
15. **No em dash anywhere.** Use a plain dash, a full stop or a comma.
16. **Screen readers.** Every icon-only control has a name. A state change is said in words ("3 selected", "Added synonym GMV").

Do and do not:

| Do                                                  | Do not                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| "Published. Agents now say ..."                     | "The suggestion was successfully accepted into the live edition." |
| "Nothing is written about this yet."                | "no_match: no governed item applies to that exact scope."         |
| "Couldn't publish. Nothing changed." with Try again | "An error occurred."                                              |
| "Your suggestion is waiting for Jon Abara."         | "Your proposal was submitted to the domain for review."           |
| "2 skipped: owned by Sales"                         | "2 items could not be processed due to insufficient permissions." |
| "Fewer than 5"                                      | "0" or a number that gives a hidden part away                     |
| "Looked up 2 context items, followed 1 link"        | "Executed graph traversal over 2 nodes."                          |

## 3. The vocabularies

Each list below is one source in the code (a map or a constant), drawn by every place that shows it. A new word goes into the list first, in a reviewed pull request.

### Answer lines

The six states of an answer. One or two words, an icon and a tint, one short sentence under every line but Checked.

| State key | Label           | Sentence                           | Long form (tooltip, Help) |
| --------- | --------------- | ---------------------------------- | ------------------------- |
| grounded  | **Checked**     | (none)                             | Based on checked context  |
| partial   | **Partial**     | Only part of this is written down. | Covers part of it         |
| missing   | **Not found**   | Nothing is written about this yet. | Nothing written down      |
| conflict  | **Conflict**    | Two items say different things.    | Context disagrees         |
| stale     | **Outdated**    | Some of this may be old.           | May be out of date        |
| failed    | **Not checked** | The check did not run.             | Could not check           |

A draft answer says "Based on this draft". The long forms are the only place the older labels may still appear.

### Kinds

Event (lightning), Warning (triangle), Rule (ruler), Guide (route). Stored as `event`, `issue`, `note`, `guide`. Hints, each fourteen words or fewer:

- Event: Something that happened on a date, like a stop or a new rule.
- Warning: A limit or problem agents should know, like late or missing data.
- Rule: A fixed way to read the numbers, like a definition or a house rule.
- Guide: What to check before you explain a change.

### Item statuses and freshness

Draft, Live, Needs checking, Archived. Freshness is a dot. The tooltip gives the exact value.

### Inbox cards and groups

| Card kind    | Group label         | Row evidence                                       |
| ------------ | ------------------- | -------------------------------------------------- |
| `gap`        | **Not found**       | How often a question found nothing                 |
| `flag`       | **Reported**        | What was reported                                  |
| `look`       | **Saved questions** | How many need a look                               |
| mention      | **Mentioned you**   | Who, and where                                     |
| `check`      | **Due for a check** | The check date that passed                         |
| `suggestion` | **Suggestion**      | Size and reach, "2 wording, 1 link - 12 questions" |

Under All: **Waiting on others** and **Done**. Never "Gap" or "Flag" as a card name.

### Review

Change kinds: **Wording**, **Formatting**, **Link**, **Order**, **Added**, **Removed**, **Dates**. Decisions: **Publish**, **Edit**, **Return with a note**, **Archive**, **Close the suggestion**. Group actions: **Publish the N you've read**, **Mark as read**. Outcomes stay on the page: "Published. Agents now say ...", with Undo. A failed try says "Couldn't publish. Nothing changed." with Try again; offline the button says "Publish is off until you're back".

### Saved question results

**Same**, **Changed**, **Needs a look**. "Couldn't check" is a failure of the run, not a result. Action: **Save question**. Line in a review: "N of N still answer the same".

### Roles and people

**Admin** and **Member**. A page is **People**, never Users. Owning is shown as domain chips, not as a role. Actions: Invite people, Resend, Revoke, Remove from the workspace.

### Reactions

**Agree**, **Looking**, **Done**, **Not sure**, **Thanks** (👍 👀 ✅ 🤔 🙏). No free emoji as a reaction.

### Agents and access

The live line: **Not connected yet**, **Waiting for your agent to connect...**, **Still waiting**, **Connected: <agent>, <person>**, **Stopped checking after 10 minutes**, **The connection was declined in the browser**. Actions: Copy, Check again, Revoke.

### Integrations

States: Connected, Syncing, Sync failed, Needs a new key, Not connected, Soon. Actions: Connect, Read again, Test connection. The switch **Show figures in Ask** is off by default.

### Alerts

Eight rules, each one sentence: Not found, A saved question needs a look, Conflict, More questions not found, Calls fail, Model spend, A connected tool did not sync, A check is due. A rule raises an Inbox card. It never sends an email. Not found, A saved question needs a look and A check is due raise the Inbox's own cards; the other five raise an **Alert** card, in the Alerts group, with one action: **Open the topic**, **Open Overview**, **Open Usage** or **Open the integration**.

### Privacy words

"Fewer than 5" for a hidden count. "13+" for a total that would give a month away. "Comments are not part of what agents get." "Emoji in context are read by agents too."

## 4. Banned words and what to write

Checked by the copy test and by lint (`heed/plain-words`, the glossary in `words.ts`). The list starts at zero for the new app.

| Do not write                                                                                                                                     | Write                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| fact, for one entry                                                                                                                              | context item                                                                |
| the product's name inside a sentence                                                                                                             | it, agents, your workspace, the checked context                             |
| Cube (or any tool) in generic copy                                                                                                               | your definitions source; the name only on its integration                   |
| edition, in success copy                                                                                                                         | what agents get now (edition: Settings, Advanced, and the agent reply only) |
| anonymous, "nobody sees who"                                                                                                                     | say what is kept: scopes and counts                                         |
| Gap, Flag, as card names                                                                                                                         | Not found, Reported                                                         |
| a draft called "checked context"                                                                                                                 | Based on this draft                                                         |
| Based on checked context, Covers part of it, Nothing written down, Context disagrees, May be out of date, Couldn't check, Not covered, as labels | Checked, Partial, Not found, Conflict, Outdated, Not checked                |
| Something happened, A problem with the data, Good to know, How to look into it, Caveat                                                           | Event, Warning, Rule, Guide, Don't conclude                                 |
| Example, as a kind                                                                                                                               | (no longer offered)                                                         |
| Users                                                                                                                                            | People                                                                      |
| administrator, auditor, approver, steward                                                                                                        | Admin, Member, owner                                                        |
| AI app, client                                                                                                                                   | agent                                                                       |
| Try a question                                                                                                                                   | Try it                                                                      |
| proposal, accept, retire                                                                                                                         | suggestion, publish, archive                                                |
| Back to <workspace name>                                                                                                                         | Back to app                                                                 |
| "gap" for a person, "agent" for a person                                                                                                         | the support team, someone on our team                                       |
| an em dash                                                                                                                                       | a plain dash, a comma or a full stop                                        |

The code keeps its own words (item, area, retire, edition, scope, proposal). Only what people read changes. [`words.ts`](../../src/domain/words.ts) maps one to the other.

## 5. The checks

- **Copy test.** `src/lib/copy.test.ts` in the mockup reads every string a person can read (string literals, template text and JSX text, through the TypeScript syntax tree) and fails on a hand-written product name, a definitions tool named outside its integration, the banned words, any answer label that is not one of the six, any kind label that is not one of the four, a hint over fourteen words, a state sentence over eight, and a contraction in an answer label, its sentence or its long form. The same test checks the connect steps and the live line in every state: the name only inside commands and the address, never an em dash. The app ports it as lint rules on `src/app` (`heed/plain-words` with glossary v2 and `brand/no-product-name`, `tests/lint/app-words.test.ts`) and as checks of the vocabularies in `words.ts` (`tests/unit/words.test.ts`). The checks of the connect steps read the app's own data, so they come with it.
- **Plain-words lint.** `heed/plain-words` with the glossary reports old words. `brand/no-product-name` reports a hand-written name. A baseline ratchet applies to the service's sentences only.
- **Review.** A reviewer reads the strings of a pull request aloud. If it needs a second reading, it is rewritten.

## 6. Demo text

Demo text uses the Larchwood Outdoor world only ([the demo world](demo-world.md)): invented people, events and `.example` addresses, real countries. Demo text has no causal words and no percent sign, and follows the banned-word list above. "Context item", "term" and "member" are allowed in demo text, because they are product words in v2.
