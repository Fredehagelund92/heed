# Copy: wording and vocabulary

Part of the [design contract](design-contract.md). It says how every word people read is written: screens, toasts, errors, help pages, the documentation, the agent's one-line reply, demo text and release notes. Its copy rules are checks, not habits.

It replaces [the earlier voice guide](voice.md) for the web app. The voice guide stays for the service's own sentences until they move. [`src/domain/words.ts`](../../src/domain/words.ts) holds the names of this page in code (glossary v2). The earlier list stays in `src/domain/words-v1.ts` for the service.

## The voice

Five rules sit on top of the rules below. They say how Heed sounds. The 16 rules in section 2 say how a sentence is built, and these five decide the cases those leave open.

1. **Say it as you would to a colleague at the next desk.** Use the everyday word. If a product word is needed, explain it once, in the same line, with an example from the business. The exact technical term comes second and smaller.
2. **One word for one thing, and one thing for one word.** Take the word from the glossary. Never a second word for variety. Never the same word for a second thing.
3. **Say what happens.** A button names the result. An error says three things: what went wrong, what is safe, what to do next.
4. **One idea, one whole sentence.** Under 20 words, active, with a subject. Written whole, never glued from parts in code.
5. **Calm and kind, and always true.** A normal state is not a failure. No blame, no red for something that passes in a minute. Never promise what the app does not do.

Ten examples from the app, before and after:

| #   | Rule | Before                                                                                                                                                  | After                                                                                              |
| --- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | 1    | "Any agent that speaks MCP"                                                                                                                             | "Any other agent that can connect by address (MCP)"                                                |
| 2   | 1    | "Claim check ... Same? Check"                                                                                                                           | "Compared with the source ... Not sure. Compare them."                                             |
| 3   | 2    | "Scope" (column), "Applies to" (editor)                                                                                                                 | "Applies to" in both                                                                               |
| 4   | 2    | "Retry" (4 places), "Try again" (20 places)                                                                                                             | "Try again"                                                                                        |
| 5   | 3    | "Return"                                                                                                                                                | "Send back with a note"                                                                            |
| 6   | 3    | "Couldn't publish the names"                                                                                                                            | "Couldn't publish them. Nothing changed. Try again."                                               |
| 7   | 4    | "Could not not a conflict."                                                                                                                             | "Couldn't remove the Conflict mark. Nothing changed. Try again."                                   |
| 8   | 4    | "hidden: under 5, or it would give one under 5 away"                                                                                                    | "Hidden, to protect small counts."                                                                 |
| 9   | 5    | "The look-up failed"                                                                                                                                    | "Ask could not look this up just now. Ask again in a minute."                                      |
| 10  | 5    | "Nobody has written down anything about Orders in Spain in October 2026. That doesn't mean there's no explanation, only that none is written down yet." | "Nothing is written about Orders in Spain in October 2026 yet. There may still be an explanation." |

Three smaller rules follow from them:

- **Ask calls itself Ask.** Never "I", "the model", "the check", "the look-up" or the product's name. An agent says "I", because a person is talking with it. The service says "we" only for an outage it caused.
- **"Not" in full, and one negative at most.** "That doesn't mean there's no explanation, only that none is written down" has three.
- **A date has its year, and comes from the reader's locale.**

### Words that must stay for the engineer

An engineer needs the exact term to search a log, match a setting or follow a guide. A sales person must not have to read it. Show **the plain line first, the exact term second and smaller**, in one of three shapes:

1. **Two lines.** The plain line is the label and the exact term sits under it, or beside it, in small mono: "Get the context for a question" with `get_context`.
2. **Brackets on first use.** "As a spreadsheet (CSV)", "choose OAuth (sign in through the browser)".
3. **A fold.** "Developer details" in Ask, "Connection details" on a tool's figures, "For engineers" in Advanced.

A word that is only for engineers does not stay on a screen for everyone: dev server, thread, queue, ledger, facet, backing off, allow list, "the service", "Enter URL". Model ids, milliseconds and similar terms may stay on an admin page, with the unit spelled out once.

## Who we write for

People in finance, marketing, operations and management. Many read English as a second language. They know their business and their numbers. They should never need to know data or AI words.

## 1. Neutral wording

Heed is open source and any company can run it. The words do not belong to one company.

1. **The product name lives in one constant.** `PRODUCT` in the web app (`lib/brand.ts`); `productName` in the service. A sentence never contains it. Copy says "it", "agents", "your workspace" or "the checked context". Wrong: "Heed checks it before agents read it." Right: "It is checked before agents read it."
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

| Do                                                                        | Do not                                                            |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| "Published. Agents now say ..."                                           | "The suggestion was successfully accepted into the live edition." |
| "Nothing is written about this yet."                                      | "no_match: no governed item applies to that exact scope."         |
| "Couldn't publish. <the server's reason> Nothing changed." with Try again | "An error occurred."                                              |
| "Your suggestion is waiting for Jon Abara."                               | "Your proposal was submitted to the domain for review."           |
| "2 skipped: owned by Sales"                                               | "2 items could not be processed due to insufficient permissions." |
| "Fewer than 5"                                                            | "0" or a number that gives a hidden part away                     |
| "Looked up 2 context items, followed 1 link"                              | "Executed graph traversal over 2 nodes."                          |

## 3. The vocabularies

Each list below is one source in the code (a map or a constant), drawn by every place that shows it. A new word goes into the list first, in a reviewed pull request.

### Answer lines

The six states of an answer. One or two words, an icon and a tint, one short sentence under every line but Checked. In the Ask chat the badge stands alone and its sentence opens in its card.

| State key | Label           | Sentence                           | Long form (tooltip, Help) |
| --------- | --------------- | ---------------------------------- | ------------------------- |
| grounded  | **Checked**     | (none)                             | Based on checked context  |
| partial   | **Partial**     | Only part of this is written down. | Covers part of it         |
| missing   | **Not found**   | Nothing is written about this yet. | Nothing written down      |
| conflict  | **Conflict**    | Two items say different things.    | Context disagrees         |
| stale     | **Outdated**    | Some of this may be old.           | May be out of date        |
| failed    | **Not checked** | The check did not run.             | Could not check           |

A draft answer says "Based on this draft". The long forms are the only place the older labels may still appear.

A question that was not looked up (it names no metric and no market) has no state, so none of the six: Ask's line says **Nothing was looked up**, then the reason. Never Not found, which says nothing is written down.

A question about what a metric is or means, answered by its definition and nothing written about it, shows its state as a neutral mark in Ask: **Definition**, in the neutral tint with the Definitions icon. It is not one of the six: for context the answer is Not found, and agents get Not found. Its card says "Definition: Cube's own words.", then "Cube defines it this way, and agents get the same words. Nothing else is written about it here yet, so for context the answer is Not found.", then "If people need more than the definition, such as what to rule out or when it changed, write context.", and links to the definition. The tool's name there is data, read from the definition. Under the definition, its source is named as "From Cube, Discount cost", and one quiet line says "Nothing else is written about Discount cost yet."

An answer from the records (what was created, what is due, who owns a domain) has no state either. Its chip says **Records**, in the neutral tint with a table icon, and the line under it says "Counted from the workspace's records." The answer is one sentence from a template ("Nothing was created in the last 24 hours."), and it ends "Agents did not read this answer. It says nothing about what they get." A question about one person's work gets "Ask does not answer questions about one person's work."

An analysis of the records is a records answer: the Records chip, the same line under it, and one sentence from a template. Its rows come in up to four sections, each headed by what it counts with its denominator: "No context written: 13 of 22 metrics". A ranking says its rule in words: "Look first at Orders in Spain: agents found nothing there most often." Its last lines say what the read cannot see and that agents did not read it: "Not seen: a definition your source does not hold, or a word people use that Heed cannot read." A count never stands alone, and never a quality word such as "good" or "healthy" without the count behind it.

Every answer ends in the same footer, written by code, each line only when it has something to say: what a count is out of ("Out of 21 live context items."), what the read could not see ("Not seen: drafts and suggestions, which are not context yet."), and what in it may be out of date ("Returns changed definition on 28 April 2026: its check date has passed."), whatever the answer's state. What agents asked says its days too: "This week here is 16 to 22 Oct 2026, as Observability counts it."

A count of what agents asked says what the reader's own Observability says: a floor as a floor ("13+"), a topic the question names that shows no count as "Fewer than 5", and a hidden count as "Hidden", never 0. When a model and the date reader read a question's dates apart, the answer says so: "The dates could also mean 1 to 30 Nov 2025."

When Ask cannot answer the question asked, it says so in a fixed sentence (FR-720). A limit sentence comes first, and what is written follows it. A cannot sentence stands alone: nothing was looked up, so it has no state.

| Exit             | Sentence                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `limit:advice`   | What to do is not written down. Here is what is.                                                                       |
| `limit:forecast` | What happens next is not written down. Here is what is.                                                                |
| `limit:outside`  | Ask knows only what is written here, not what others do. Here is what is.                                              |
| `limit:numbers`  | Heed keeps no numbers, so Ask cannot work this out. Here is what is written.                                           |
| `limit:partly`   | Ask could read only part of this question. Here is what is written about what it names.                                |
| `limit:general`  | Nothing is written about Poland in particular. Here is what is written in general.                                     |
| `cannot:numbers` | Heed keeps no numbers, so Ask cannot work this out. An agent with your data tool can, and it reads this context first. |
| `cannot:source`  | Definitions live in your source tool, so Ask cannot change one.                                                        |
| `cannot:write`   | Ask does not write context. You can start it here.                                                                     |
| `cannot:person`  | Ask does not answer questions about one person's work.                                                                 |
| `cannot:not_yet` | Ask cannot work this out yet.                                                                                          |
| Plan not used    | Ask could not read this question just now, so nothing was looked up.                                                   |

A period a records read keeps no history for is said, never dropped: "This is how it stands today, not in 2025: the records keep no count by date." What the records keep about what an answer found stands in fixed sentences under its words: "Jon Abara and Sofia Brandt own Sales.", "Returns changed definition on 28 April 2026: check date 2 Oct 2026, due for a check, last checked 20 Oct 2026."

When nothing was read under a limit, the sentence ends at its first part ("What happens next is not written down."): there is nothing to go on to. `limit:partly` is said by code, when no model read a question that is not plainly a read; `limit:general` when a name has nothing of its own and what was read applies to everything. A plan never chooses either.

A due row says why it is due: **Check date 18 Sep 2026**, **Definition changed** or **Source missing**, and never a date the item has not reached.

Ask does not advise: no "should", "recommend" or "I suggest" in its own voice. A cited item may say so, and Ask may quote it.

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
| returned     | **Returned to you** | Who returned it: "Returned by Jon Abara"           |
| `check`      | **Due for a check** | The check date that passed                         |
| `suggestion` | **Suggestion**      | Size and reach, "2 wording, 1 link - 12 questions" |

Under All: **Waiting on others** and **Done**. Never "Gap" or "Flag" as a card name.

### Review

Change kinds: **Wording**, **Formatting**, **Link**, **Order**, **Added**, **Removed**, **Dates**. Decisions: **Publish**, **Edit**, **Return with a note**, **Archive**, **Don't archive** (closes it with a reason), **Close the suggestion**. A returned suggestion's sender: **Edit and send again**. Group actions: **Publish the N you've read**, **Mark as read**. Outcomes stay on the page: "Published. Agents now say ...", with Undo. A failed try says "Couldn't publish." with the server's reason when it gave one, then "Nothing changed.", and Try again repeats the same action (a returned note is sent as it reads now, not as it was); offline the button says "Publish is off until you're back".

### The quick view's answers

The answers in a suggestion's quick view (the Inbox pane and the dock) carry one of four labels, from `ANSWER_SIDES` in `src/web/model/inbox-pane.ts`: **Agents say today** over what agents answer now, and over the answer after the decision **After you publish**, **If you publish as it is** for a suggestion that clashes with live context, or **After you archive** for a suggestion to archive. Each side starts with its answer line. Over the question of a Not found card: **Agents asked about**, then the scope, never their words. A count says how often, and is left out when there is none.

### Saved question results

**Same**, **Changed**, **Needs a look**. "Couldn't check" is a failure of the run, not a result. Action: **Save question**. Line in a review: "N of N still answer the same".

### Roles and people

**Admin** and **Member**. A page is **People**, never Users. Owning is shown as domain chips, not as a role. Actions: Invite people, Make a new link, Revoke, Remove from the workspace.

### Reactions

**Agree**, **Looking**, **Done**, **Not sure**, **Thanks** (👍 👀 ✅ 🤔 🙏). No free emoji as a reaction.

### Agents and access

The live line: **Not connected yet**, **Waiting for your agent to connect...**, **Still waiting**, **Connected: <agent>, <person>**, **Stopped checking after 10 minutes**, **The connection was declined in the browser**. Actions: Copy, Check again, Revoke.

### Integrations

States: Healthy, Failed, Needs a new key, Paused. Actions: Connect, Read again, Test connection. The switch **Show figures in Ask** is off by default.

### Alerts

Eight rules, each one sentence: Not found, A saved question needs a look, Conflict, More questions not found, Calls fail, Model spend, A connected tool did not sync, A check is due. A rule raises an Inbox card. It never sends an email. Not found, A saved question needs a look and A check is due raise the Inbox's own cards; the other five raise an **Alert** card, in the Alerts group, with one action: **Open the topic**, **Open Overview**, **Open Usage** or **Open the integration**.

### Privacy words

"Fewer than 5" for a hidden count. "13+" for a total that would give a month away. "Comments are not part of what agents get." "Emoji in context are read by agents too."

## 4. Banned words and what to write

Checked by the copy test and by lint (`heed/plain-words`, the glossary in `words.ts`). The list starts at zero for the web app.

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

- **Copy test.** `tests/web/lib/copy.test.ts` reads every string a person can read (string literals, template text and JSX text, through the TypeScript syntax tree) and fails on a hand-written product name, a definitions tool named outside its integration, the banned words, any answer label that is not one of the six, any kind label that is not one of the four, a hint over fourteen words, a state sentence over eight, and a contraction in an answer label, its sentence or its long form. The same test checks the connect steps and the live line in every state: the name only inside commands and the address, never an em dash. The same rules are also lint rules on `src/web` (`heed/plain-words` with glossary v2 and `brand/no-product-name`, `tests/lint/web-words.test.ts`) and as checks of the vocabularies in `words.ts` (`tests/server/domain/words.test.ts`). The checks of the connect steps read the app's own data, so they come with it.
- **Plain-words lint.** `heed/plain-words` with the glossary reports old words. `brand/no-product-name` reports a hand-written name. A baseline ratchet holds the old words in the service's sentences (`plain-words.baseline.json`); the web app has none.
- **Copy ratchets.** `npm run lint:words` also holds what people read outside the web app (`src/domain`, the contract, the connectors' forms, the demo's fixtures and the message of every service error) to glossary v2, reads the text the lint skips (a `switch` body, a toast's action, a one-word "Publishing…"), and runs six rules for the voice (`eslint.copy-rules.js`): `whole-sentences` (no label lower-cased into a sentence, no "a" before a value, no plural made with "s", no word cut in two), `sentence-length` (over 25 words fails, over 20 is a note), `one-word-one-thing` (Retry, sync, thread, "Needs checking", clash, "a read", lower-case gap and flag, and engineer words off their pages), `errors-say-three-things` (an error with a message, an error toast with a next step), `no-fixed-locale` and `no-demo-in-shared-code`. Each counts against `copy-checks.baseline.json`: a rise fails, a fall is a note, and `npm run lint:words -- --update` lowers it. New text starts clean.
- **Reading report.** `npm run copy:report` gives, for the files a branch changes, the reading level (LIX), the sentences over 20 words and the glossary terms new to a file. CI writes it to the job summary of a pull request. It is a note and never a gate.
- **Review.** A reviewer reads the strings of a pull request aloud. If it needs a second reading, it is rewritten.

## 6. Demo text

Demo text uses the Larchwood Outdoor world only ([the demo world](demo-world.md)): invented people, events and `.example` addresses, real countries. Demo text has no causal words and no percent sign, and follows the banned-word list above. "Context item", "term" and "member" are allowed in demo text, because they are product words in v2.
