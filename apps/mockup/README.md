# Heed v1 mockup

A clickable mockup of Heed v1: every screen and state, with mock data from the Larchwood Outdoor demo
world and no backend. It is the acceptance specification: the app is changed to match it
([ACCEPTANCE.md](ACCEPTANCE.md)).

It is shadcn as shadcn ships it: base-nova on Base UI, the default neutral theme with one primary
(Heed blue), Nunito Sans, the two-blade logo, and shadcn's own blocks and examples for the layout.

The product name lives in one constant, `src/lib/brand.ts`, and the UI never says it in a
sentence: copy says "it", "agents", "your workspace" or "the checked context", so a rename or a white
label is a one-line change. The name appears only where it is the brand: the logo's label, sign-in
and the page title (`index.html` reads it through Vite). The app's address, the MCP server name, the
CLI and the Drive service account follow it. Settings and Observability lead back with "Back to app".

## Run it

The mockup is its own npm package with its own lockfile, so it never touches the app's dependencies,
lint, type check, tests or bundle budget. From the repository root:

```sh
npm --prefix apps/mockup ci   # once, and after the lockfile changes
npm run mockup:dev            # http://localhost:5192
npm run mockup:build          # type check, then the static build in apps/mockup/dist
npm run mockup:test           # unit tests
npm run mockup:e2e            # the job specs on a production build (port 5310)
```

The same and more from inside the folder:

```sh
cd apps/mockup
npm ci
npm run dev        # http://localhost:5192
npm run build      # static files in dist, open from any folder or host path
npm run preview    # serve the build
npm run typecheck
npm run lint       # oxlint, warnings fail it
npm test           # unit tests: what agents get, answers, the store, the contract, copy rules
npm run e2e        # one Playwright spec per job (J1 to J30) on the installed Chrome
```

Routes live after `#`, so the static build needs no server rewrites. Add `theme=dark` or
`theme=light` to any address to force the appearance (the theme menu does the same).

A reload starts the demo again: everything you do is kept in memory only. A scenario in an address
(`demo=week`, `demo=done`, `demo=setup`) is a fresh start, so a link lands the same way whatever was
clicked before.

The checks that keep the rules: `src/lib/copy.test.ts` reads every string people see and fails on
the product name by hand, the definitions connector's name outside its integration, and the
banned words (edition in success copy, promises of anonymity, the old card names); the fixtures
store dates as the real schema does (`src/data/contract.ts`) and the When labels are derived;
`e2e/` runs the jobs and switches to the real app with `BASE_URL`.

## Who you are

Sign-in is a demo person picker (`#/signin`). Each person sees a different Inbox:

| Person | Role | Inbox |
|---|---|---|
| Jon Abara | Owner of Sales (and Sandbox), admin | A normal week: a question not covered, a report, two saved questions that need a look, two mentions, two items due for a check, eleven suggestions, and one of his own waiting |
| Tomas Eriksen | Owner of Marketing | Jon's suggestion to review, a check due |
| Ines Duarte | Owns no domain | Nothing needs her; her suggestion waits for Jon |
| Ravi Kapoor | Admin | Nothing needs him |

"Start as a new install" signs in to an empty workspace with the setup checklist. Opening any address
directly signs you in as Jon.

## Screen map

Open `http://localhost:5192/` and append the address. Every state has its own link.

### Inbox (shadcn's Mail example, in Efferd's dashboard 2 style)

| Screen | Address |
|---|---|
| A normal week, Needs me | `#/inbox?demo=week` |
| All (with "yours, waiting on others") | `#/inbox?demo=week&tab=all` |
| Not found, its draft in the pane | `#/inbox?demo=week&card=gap-spain` |
| Not found, the draft in the review | `#/inbox/gap-spain/review?demo=week` |
| Mentioned in a comment on someone else's context item | `#/inbox?demo=week&card=m.context:itm_za26xpzv` |
| Your waiting suggestion, back in Needs you after a mention | `#/inbox?demo=week&card=wait-jon` |
| A report, the context item in the dock | `#/inbox?demo=week&card=flag-germany&dock=context.itm_0tmqp7o1&flag=flag-germany` |
| Setup, a new install | `#/inbox?demo=setup` |
| All done | `#/inbox?demo=done` |

The list is ordered by need, in groups with counts: Not found (asked and found nothing), Reported,
Saved questions (raised by an alert), Alerts (a rule with a card of its own: Conflict, More questions not found, Calls fail, Model spend, A connected tool did not sync), Mentioned you, Due for a check, then Suggestions, then (under All) Waiting on others and Done. Each
row's second line carries its evidence: how often a question found nothing, what was reported, a
suggestion's size and reach ("2 wording, 1 link - 12 questions"), and a suggestion's icon says its
main kind of change. One quiet sentence under the heading, also when nothing needs you, says what
agents asked this week, in counts only. The selected row is always scrolled into view. On a wide
list each row has a checkbox before its icon, as in Context, shown on a hover and on every row while
cards are ticked; ticked cards can be marked as read together, and are picked as in every list (see
Picking rows).

Outcomes stay on the page. A decision in the review shows what it did in place ("Published.
Agents now say ..."), with Undo and a short countdown bar, then the next suggestion opens; on a
phone the decision is a bar along the bottom edge. A suggestion you send waits visibly: a line on
the item ("Your suggestion is waiting for Jon Abara ... Withdraw") and a row under All in your
Inbox. A published item says so on its page. A report from Ask shows its outcome in that chat only
("Checked again on 16 Oct after your report: still true"). Bad answer opens the same report form,
so there is one way to say an answer is wrong. Only owners and admins see Restore in History.

Setup is write first, connect later: say what the business is about, write one context item, ask
a question about it (typed in for you), then connect an agent, then where metrics are defined. A
new workspace reaches its first grounded answer in about ten actions, and Ask answers from what the
workspace has written (an item with no Applies to is read from its own words).

What is kept about questions is one rule everywhere: from agents, only what a question was about and
how often (scopes and counts), never the words or who asked. Words are kept only when a person sends
something on purpose, a suggestion or a report, and then with their name. The Ask history is the
person's own chats, seen only by them, and says so; its empty state says what is kept.

Definitions lead with coverage: one line says how many metrics and terms have no context yet (and
can show only those), the list puts them first in each group, and their count becomes a Write action.
The read-only lock is said once, in the line about where definitions come from, not on every row.

A Not found card never hands over a blank page: it comes with a draft (from the scope agents
asked about, counts only, and a source found for it), reviewed like any suggestion: what it adds,
the claims checked against the copied sentence, Try it, then Edit the draft or Publish. Its dates
are its own (14 to 16 Oct), never "still going on".

### Review (all eight calls of the review design adopted)

Two modes. The **quick view** is the Inbox pane (and the dock): the summary, what moved, the most
important change, how many questions would get it, and one button, Review (Enter). What needs
care ("2 claims to check", an overlap, a withdrawal) shows there and on the Inbox row, before
Review. It never publishes. The Inbox's dot means not opened yet; Esc clears the selection. The **review** is where you work, inside the app with the sidebar folded to its icon
rail (Inbox stays highlighted and leads back to the list with the suggestion still selected; a click
widens the rail): the queue of waiting suggestions beside the rail (from 80rem of pane up; narrower,
it folds to a slim rail with its count, and opens on request), grouped by sender (a dot for where you are, a tick when done, a warning when it needs care,
"Publish the N you've read" at its foot: only plain changes you have read, meaning the end of the
change was on screen for 1.5 to 8 seconds by its length (a quiet bar fills meanwhile) or you pressed
Mark as read, or "Mark the N I've opened as read"; a change that needs its own look (a claim, an
overlap, a retirement, an unchecked value, a new link) stays out; it lists them before it publishes,
and its toast, at the bottom right above the decision, has Undo that puts back exactly those); the change in the middle; Try it (Draft or Published,
what agents will say before and after, then "Agents now say" once published), the Ready line,
Overlaps and the decision on the right. The Ready line never says more than was checked: a new
number or date that came without a source says "not checked against a source", and only then; once
decided, the panel shows the outcome only. J and K move through
the queue, Command and Enter publishes (its hint shows only where the key acts), Esc closes an open
note and keeps it, then goes back to the Inbox, and ? lists the keys; none of them act while you type
a note or a comment. After a decision the outcome shows in place with Undo for a moment: any letter
key moves on at once, the pointer or focus on it holds it, and with reduced motion it waits for Next.
Items crossfade in 150ms, focus moves to the change's heading after J, K or a decision, and the new
suggestion is announced. Offline the button says "Publish is off until you're back"; with
?state=failed the first try says "Couldn't publish. Nothing changed." with Try again and Return as
the only actions, and a returned note is kept. Undo puts back exactly what one decision did (a
returned note comes back as a draft). After the last decision the review says "All 12 handled" with
Undo for the last one (`?demo=last` leaves one to try it). Archiving always asks first. On a phone the decision bar says the state in
words (wrapping, never cut), "8 of 12" with previous and next, and its actions are 44px; nothing on
the review or the quick view is under 44px under a finger. Rich is the default view; a quiet Source toggle in the header shows
the stored markdown, removed lines before added ones, with only the changed words marked.

The middle says what changes in one sentence, counts the changes by kind, then shows each change in its own block under a quiet kind label (Wording,
Formatting, Link, Order, Added, Removed, Dates) with hairlines between. Marks are never colour
alone: added words are underlined, removed words struck through, formatting has a dotted underline
and names itself, a link shows its old and new address, a moved step says where it came from.
Unchanged fields fold into one line. Publishing takes the whole change: to change part of it, Edit
or Return with a note.

| State | Address |
|---|---|
| The quick view in the Inbox pane | `#/inbox?demo=week&card=sug-ines` |
| The quick view in the dock | `#/inbox?demo=week&dock=review.sug-ines` |
| Many changes from one conversation (the queue), wording and a link | `#/inbox/sug-ines/review?demo=week` |
| Formatting only: "Formatting only. The words are the same." | `#/inbox/sug-ines-format/review` |
| A changed link (never formatting only) | `#/inbox/sug-ines-link/review` |
| A moved step (never formatting only) | `#/inbox/sug-ines-order/review` |
| A long rewording, side by side, N and P to step | `#/inbox/sug-ines-long/review` |
| New dates, was and now with a timeline | `#/inbox/sug-ines-dates/review` |
| An agent's suggestion with an unverified claim: Return with a note, or Publish anyway | `#/inbox/sug-agent/review` |
| A clash with live context: Publish waits until you say how they relate | `#/inbox/sug-sofia-clash/review` |
| A retirement its proposer withdrew in the comments: Close the suggestion, or Archive anyway (asks first) | `#/inbox/sug-lars-retire/review` |
| Offline: Publish waits, with the reason at the button | `#/inbox/sug-ines-link/review?state=offline` |
| Publish fails once: "Couldn't publish. Nothing changed." with Try again | `#/inbox/sug-ines-link/review?state=failed` |

### Comments (level B of the comments design, every pick adopted)

A thread under each suggestion in the review and inside each context item's sheet, with five
reactions that each mean one thing: 👍 Agree, 👀 Looking, ✅ Done, 🤔 Not sure, 🙏 Thanks (no free
emoji). Reactions sit on the thread's heading (for the suggestion or item itself) and under each
comment; a count shows from two and the tooltip names who. Anyone signed in can comment; people edit
and delete their own. "Return with a note" keeps its button and name, and the note becomes the first
comment, marked "Returned with a note", so the answer lands in the same thread. A reply brings the
card back to "Needs you" with a quiet "New reply from…" line; nothing else notifies anyone (no
mentions, no bell, no email). Inbox rows and Ask answers have no reactions.

**Emoji** are typed, not picked from a palette: in a comment, the "Return with a note" note and
(low-key, no button) the Ask composer, ':' and two letters opens the same list as '@' (one popover,
one keyboard model: arrows, Enter or Tab, Esc; a sheet on a phone), with what was used lately and
the five reactions first, then Smileys, Gestures, Objects and Symbols, each row the emoji, its name
and its :shortcode:. About 150 common emoji (`lib/emoji.ts`), no skin tones. Enter inserts the
character itself, plain text, and ':tada:' typed out in full turns into 🎉 on its closing colon; a
':' in a time (10:30) opens nothing. Context, definitions, titles, search and filters take no list:
agents read that text, so an emoji pasted there gets a quiet note, "Emoji in context are read by
agents too", and stays if the writer means it. The five reactions stay their own bar.

Agents never read comments: the heading says "Comments are not part of what agents get", the agent
reply is built in `lib/agent-reply.ts` from published context only, and `npm test` checks that no
comment (even one that contradicts its item) reaches anything an agent gets. The box is editorcn's
Comment Box (registry `comment-box` and `static-renderer`, copied by hand, not with `shadcn add`, so
the trimmed editor stays trimmed), restyled flat: no card, hairlines between threads, a hairline stem
for replies. It loads on its own, so Tiptap stays out of the first load.

| State | Address |
|---|---|
| Empty, folded to its heading (Add a comment) | `#/inbox/sug-ines/review?demo=week` |
| One comment and one reply, two people agreeing | `#/inbox/sug-sofia-clash/review?demo=week` |
| Returned with a note, and the suggester's reply | `#/inbox/sug-lars-retire/review?demo=week` |
| The new-reply line on the Inbox card | `#/inbox?demo=week&card=sug-lars-retire` |
| A thread on an agent's suggestion (the person answers, never the agent) | `#/inbox/sug-agent/review?demo=week` |
| Many: replies, an edited comment, a deleted one, reactions on the item | `#/context/itm_norway_stop` |

### Ask (assistant-ui's thread, in the Efferd shell)

Every answer starts with its answer line: one or two plain words (Checked, Partial, Not found,
Conflict, Outdated, Not checked), always with its icon and tint, and for every state but Checked one
short sentence under it ("Only part of this is written down."). Hovering it gives the longer form;
clicking it says what it means and what to do. The words, the sentences and the longer forms are one
list, `ANSWER_LINES` in `src/lib/help-content.ts`, which Ask, the review's Try it, Help, the
docs, Observability's charts and filters, and the copy test all read.

Three Ask ideas, every pick adopted. **Asked this week** replaces the
fixed starters: the four topics agents asked about most this week, the rest opening in place under
More asked this week (`data/asked-week.ts`, from
Observability's one count), each with the state Ask gives it now, from the same function a click
asks with, and how often; counts only, never the words or who asked, and nothing asked fewer than 5
times. An owner sees the draft or suggestion waiting on a Not found topic of their domain. Under an
answer, **what to ask next** says what each would get. **Show me where it says that**: select a
sentence, and the right panel walks it back to its context item and the source line its owner
copied, marking only exact phrases of three words or more (`lib/where.ts`); a sentence with no item
says it is Ask's own wording; keys 1 to n move between sentences. **Share** opens the right panel
with a Slack message, previewed exactly as it pastes (the state line, the answer with its citation
numbers, each source with who checked it and when), or a receipt-style card; a link is drawn as
Later, since it would show the context to whoever opens it.

| Screen | Address |
|---|---|
| Empty: Asked this week, topics with their state now and a count | `#/ask` |
| Empty in a new workspace: four starters | `#/ask?demo=setup` |
| Checked | `#/ask?example=grounded` |
| Partial | `#/ask?example=partial` |
| Not found | `#/ask?example=missing` |
| Conflict | `#/ask?example=conflict` |
| Outdated | `#/ask?example=stale` |
| An answer that needs correction (the flag form open) | `#/ask?example=correction` |
| Not checked | `#/ask?example=failed` |
| A source opened in the dock | `#/ask?example=grounded&dock=context.itm_norway_stop` |
| Show me where it says that: a sentence, its item, its source line | `#/ask?example=grounded` and select a sentence |
| Share: a Slack message or a card, with the state and sources | `#/ask?example=grounded`, then Share |
| Figures off (the default): a link into Cube for the figure | `#/ask?example=grounded&figures=off` |
| Figures on: one figure line, its source, freshness and query in words | `#/ask?example=grounded&figures=on` |
| A figure that doesn't fit a context item: both, no verdict, two routes | `#/ask?example=figconflict&figures=on` |
| A question no figure can answer (no definition for the table) | `#/ask?example=nodata&figures=on` |
| The definition decides: only the warehouse on still links into Cube | `#/ask?example=grounded&figures=warehouse` |
| Ask in the dock beside another page | `#/context?dock=ask` |
| History with no chats yet | `#/ask?demo=setup` |

Every answer has the state line, source chips, a What agents get disclosure with Developer
details, and Something wrong?. Typing @ in the box scopes a question to a domain, a definition, a
context item or a market (@Orders @Norway), as chips in the box and in the question; the answer
says "Scoped to" with the same chips. Without @, a typed question is read for a metric and markets,
and a quiet "Read as" line shows under it only when that differs from its words, with Change it to
put the question back in the box with the reading as chips.

History sits on the left: New chat and search pinned on top, then the chats by day (Today,
Yesterday, Earlier), with a marker on chats an agent asked. Rename and Delete fade in on hover
(one menu on a touch screen); a deleted chat can be put back from the toast. A new chat joins Today
with its first question. History resizes and folds to a slim rail whose toggle sits where Hide
history was; the History button in the header and Option-H fold and unfold it too. On a phone it
is a sheet.

Search reads every chat's questions and answers, the open chat's latest turns too, and shows the
matching line with the match marked. A question that is already a chat, typed or picked, opens that
chat. With a chat row focused, the footer shows the keys (arrows, F2, Delete). Escape or Stop ends
an answer being written: the cut text ends in "…", is read out, names no source count, and the
Stopped notice comes into view. A finished answer offers two quiet questions to ask next. In the
dock, History and New chat sit in its header.

Figures in Ask (level B of the Ask data design, opt-in). An answer can show one figure, read
when asked from the integration the metric's definition comes from, and kept nowhere. It is one
quiet line apart from the text: what was counted, the number and how it moved, then "From Cube,
data as of today at 06:00", Definition of Orders and Show the query, which tells the query in words.
Until an admin switches figures on for that integration, the line is a link into the tool instead.
A figure never borrows the word for context an owner checked and never changes the answer's state.
When the figure and a context item disagree, both show side by side with no verdict, with Tell the
owner of the domain and Tell the data contact. A metric no definition covers gets no figure, and the
answer says why. The review flag `figures=on|off|<integration>` (also `source=<integration>`)
overrides the switches for one visit (`lib/figures.ts`, `data/figures.ts`).

No pane leaves you without a way back: the left nav folds to icons with its toggle in every page
header (Command-B), History folds to its rail, and the side panels of the context page and the editors
move under the document on narrow screens instead of disappearing.

### Context

What agents should know. A single entry is a context item.

A context item's page is the document: its title (with a quiet chip beside it only when it isn't
Live), its text and quote, then one quiet line like the quick view's (domain, owned by, checked) and
the source link, then one closed Details row (status, kind, applies to, when, don't conclude) that
opens in place. A disagreement or an overdue check sits at the top of the side pane, and on a phone
in the document above the comments; with neither, there is nothing to settle and no block shows.

| Screen | Address |
|---|---|
| Context, compact rows | `#/context` |
| A context item in the dock (arrow keys or J and K move it along) | `#/context?dock=context.itm_ra39ow6c` |
| No context yet | `#/context?demo=setup` |
| A context item's page, with History and Disagrees with | `#/context/itm_gift_store_credit` |
| New context, empty | `#/context/new` |
| New context, filled, with overlaps | `#/context/new?draft=norway` |
| A Not found draft, opened to edit | `#/context/new?gap=gap-spain` |
| Edit | `#/context/itm_s90n5xps/edit` |
| Suggest a change | `#/context/itm_s90n5xps/suggest` |
| Try it from the editor | `#/context/new?draft=norway&dock=try.editor` |
| A draft: agents don't get it until it is published | `#/context/itm_draft_black_friday` |
| Rows picked, the bar's actions (Archive, Delete, More) | `#/context`, then tick rows |
| A partial failure with Retry, and offline | `#/context?bulk=fail`, `#/context?state=offline` |

The columns are the list columns' design B, at one density (36px rows), icons and short
labels: the kind as an icon before the title (Event a lightning bolt, Warning a triangle, Rule a
ruler, Guide a route; plain words most people know, from one map in `data/world.ts`, with the
stored values event, issue, note and guide unchanged); the title alone;
**Scope** as muted text in its own 190px column; **Status** as a circle icon (dashed draft, check
live, alert needs checking, minus archived); **When** as a glyph and a short date (infinity always, arrow
ongoing, since, until, a range); and **Checked** as one dot (filled fresh up to 30 days, half
ageing up to 90, hollow overdue). Every mark gives its exact value on hover. The Context and
Checked headers sort. Under 960px, as with the quick view open, the scope steps aside; on a phone
the row folds to two lines with the status at the left, the time frame and scope under the title,
and the dot at the right. The bar
holds Filter (each value with a live count), Sort (its direction in words; Best match while
searching), Group (by domain or by metric, groups fold), search (`/`, every word must match the
start of a word, matches in bold, Down to the rows, Escape clears). Filters
that are on read as sentences under the bar ("Domain is any of Sales, Marketing") with Clear all.
Rows have a menu (Open the page, Copy link) and a checkbox, picked as in every list (see Picking
rows, under Everywhere); the peek steps with J and K; Escape closes the peek first, and opening a
peek keeps the search, filters, ticked rows and scroll. A totals row stays at the foot. On a phone a
row wraps to two lines, and Select in the bar shows the checkboxes, so a tap ticks a row.

A **draft** is an item started and never published (three are in the demo). Agents never get it,
it sorts last by Last checked, and it is the only thing that can be deleted: a published item is
archived instead, so its history stays. **Picked rows** get one bar (`components/heed/bulk-bar.tsx`,
the rules in `lib/bulk.ts`): the count, Clear, Archive (the safe default, with Undo), Delete, and More
with Change domain (only domains you own, unless you are an admin), Change kind, Add owner, Change
owner (items can have owners of their own, among people who can change them), Mark as checked (only
the items you opened, as with publishing together), Copy links and Export (Markdown or a
spreadsheet). After Select all on the page, "Select all N matching" takes the rows in folded groups
too. Owners of an item's domain and admins change it; a change acts on what it may and leaves the
rest ticked, with "2 skipped: owned by Sales" above the bar and the reasons a hover away, and a
button that can't act says why before it is pressed. Delete opens one confirmation (the bar, the
Delete or Backspace key, an item's own menu): the titles and the count, what it means, the published
items it leaves alone with Archive instead, the number to type above ten, Cancel focused, and the
only red text; then a toast with Undo for ten seconds. A partial failure says "3 of 4 archived, 1
failed" with Retry and keeps the failed row ticked; offline, the changes say so and wait, and
Export still works. Every change is written to the items' History, and a deletion to Settings,
Advanced, Deleted. On a phone the bar runs along the bottom, its buttons as icons.

**The quick view (peek)** of a context item or a definition is option 2 of the peek design, the note
and one closed Details, at 480 wide. A few bands cut by full-width hairlines: the title once and the
words; its domain, who owns it and when it was checked, and the source, in two quiet lines; for a
definition the other words as one row (the source's own names locked, the team's removable, six then
"N more", Add a synonym); then Details, closed (applies to, when, kind, status, don't conclude, the
quote; for a definition the type, values, Cube name and how much context is about it) with three
quiet links: the history and the comments on the page, and Try it with a question, which opens Ask
with the question typed in. When something needs a decision (a flag, an overlap, an overdue check, a
word that means two things) one attention line with one button says so; the choice is made on the
page. What agents get is not in the peek. The bar says only "Context" or "Definition", with previous,
next, an expand icon to the page, and close; the one action is the only footer button.

| State | Address |
|---|---|
| Plain | `#/context?dock=context.itm_norway_stop` |
| Disagrees with another (Compare) | `#/context?dock=context.itm_gift_store_credit` |
| Check overdue (Still true) | `#/context?dock=context.itm_ra39ow6c` |
| A flag from the Inbox (Not a problem) | `#/inbox?demo=week&card=flag-germany&dock=context.itm_0tmqp7o1&flag=flag-germany` |
| From a Drive document, archived | `#/context?dock=context.itm_eprlkrz2`, `#/context?dock=context.itm_kh4llvi9` |
| A synced metric with a conflicting synonym | `#/definitions?dock=def.Net%20revenue` |
| A dimension, a term, a synonym, a word that means two things | `#/definitions?dock=def.Market`, `def.Webshop`, `def.Turnover`, `def.Sales` |

### Definitions

The data glossary. Metrics and dimensions are synced from Cube and are read-only here: no editor,
no editable field, no delete, a lock beside the name, and one quiet line on their page and peek
(the domain, read-only, synced from Cube with the last sync, Open in source). A page leads with the
meaning, then that line (for a term: its domain, who wrote it and when), then one closed Details row
(other names in Cube, where it comes from, what mentions it); a disagreement shows as a note above
the meaning only when there is one. Two plain concepts are written here: a **term** is a word with
its own meaning (Peak season), and a **synonym** is another name for a metric or a dimension (GMV
for Gross sales). There is no mode to pick: a term's editor is the shared document editor with one
optional property, Another name for (ghost "Add a definition"), which opens one picker of metrics
and dimensions. Choosing one folds the meaning away and shows "Uses the meaning of Gross sales";
clearing it brings back the meaning written before, with Undo. Picked rows get the same bar as
Context: a term can be deleted (its synonyms go with it, named in the confirmation) or moved to
another domain; a synced metric or dimension is left alone, "synced from Cube".

| Screen | Address |
|---|---|
| Definitions (title-only rows, grouped by domain; ticked rows get the bar: Delete and Change domain for terms, Copy links, Export) | `#/definitions` |
| A metric in the dock: Also called as a tag box (comma, Enter or paste adds; a conflict says who has the word) | `#/definitions?dock=def.Net%20revenue` |
| A metric's read-only page | `#/definitions/Gross%20sales` |
| A dimension's read-only page (its edit address shows the same) | `#/definitions/Market/edit` |
| A term with its own meaning | `#/definitions?dock=def.Webshop` |
| A synonym: Another name for Turnover, a synonym of a synonym (conflict) | `#/definitions?dock=def.Takings` |
| A synonym in its editor: Another name for Gross sales, the meaning folded away | `#/definitions/GMV/edit` |
| A term in its editor, with its own Also called tags | `#/definitions/Webshop/edit` |
| A word used for two things (conflict), in the editor | `#/definitions/Sales/edit` |
| New term, already another name for Net revenue | `#/definitions/new?sameAs=Net%20revenue` |
| Ask in a synonym: "You asked about purchases - this is Orders" | `#/ask?example=synonym` |
| Connect Cube (from setup) | `#/definitions?setup=1` |

One data model, two ways in. A synonym is a term pointing at the definition, so the "Also called"
tag box (the main place to add one, on the definition's page, in its quick view and in a term's
editor) and the term editor's Another name for write the same entry, and a word is never entered
twice. In the box a comma, Enter or a paste ("GMV, turnover, sales value") makes tags at once;
Backspace in the empty box selects the last tag, then removes it; x removes one, with Undo; Escape
keeps every tag made; a word that already means something else stays as a struck warning tag with
who has it ("Turnover is already another name for Net revenue, added by Sofia Brandt"), and is
never saved. Cube's own other names are locked tags. A screen reader hears "Added synonym GMV".
Each type has its glyph as the Heed app draws a catalogue type, a neutral tile in lists and headers
and a plain glyph in chips and menus: sigma for a metric and split for a dimension (the Heed app's),
whole-word for a term and equals for a synonym (proposed; the Heed app has no terms).

Like the Heed app's catalogue: views with counts (All, Metrics, Dimensions, Terms; Terms counts
and lists only real terms, and Filter has "Show synonyms as rows" for an audit), a line saying
where definitions come from, grouped by domain by default. Rows follow the same system as Context:
the type tile and the name with its other names as "Also called" tags (the first three, then +N; a
search that finds a synonym shows its definition with "matches: Turnover"), the domain at wide
widths, the count
of context as a number (0 grey, a dash for dimensions), a flag only when something needs a look
(a conflict, a definition Cube changed, no description in Cube), and the source (a lock for synced
and read-only, the author's avatar for a term). Counts of context are worked out from the context
itself, across every name a definition has.

Old `#/library` addresses (and `#/settings/definitions`) redirect to these.

### Settings and Integrations (admins)

From the settings and integrations design (round 3, every pick adopted). Inside Settings the app
sidebar gives way to the settings navigation, with Back to app on top and five sections in three
groups: Workspace (General, Domains and owners), Connections (Agents and access, Integrations),
System (Advanced). No tabs anywhere; each section has its own address and a breadcrumb.
About our business uses the same document editor shell as a context item and a term
(`components/heed/document-shell.tsx`): the formatting toolbar as a fixed row under the header, the
document sheet (56rem, its title and one line on what it is, then the text) on the tinted canvas, a
soft ring on the sheet while writing, Saved in the header, and the count against the 1,200 characters
agents read with every question in the one footer bar. Its guidance ("What to put here") is a panel,
closed until opened from the More menu, under the sheet on narrower screens.

Domains and owners is a grid of square hairline cells: each domain's dot and name, two lines of what
it covers, its owners' faces and a health line ("10 items - 2 due - 19 terms") with a freshness dot;
one cell adds a domain; search shows past eight. A domain opens as its own document in the shared
editor shell: the name as the title, Owners as the people picker and quiet counts linking to Context
and Definitions filtered to it (`?domain=`, `?due=1`), then its text: what it covers and its house
rules. It saves itself. Only an empty domain can be deleted; the sandbox never can. The first
paragraph of a domain's text is its excerpt everywhere: the @ picker, the editor's Domain list, a
domain mention's card and Ask's scope line (`lib/domains.ts`).

People (not "Users": it is about people and what they own) lists everyone with their face, name and
address, a role chip (Admin or Member: v1 has only these two), the domains they own as domain chips
(owning is not a role; there is no domain member level in v1), when they were last active, and the
invited apart with Resend and Revoke. Invite people takes addresses, a role and the domains they own
from the start. A row opens the person: their role, a switch per domain they could own, what they did
lately, and Remove from the workspace, which waits until no domain has them as its only owner.
Ownership lives on the domain (`lib/people.ts`, `lib/domains.ts`), so the domain page, People, pickers,
mentions and comments always agree; a domain's owners picker can also invite someone. Admins change
roles, invite and remove; an owner who isn't an admin sees Domains and People, edits only their own
domain and adds owners to it, and every control they can't use stays visible with the reason.

Agents and access leads with one prompt (the hybrid connect design, every pick adopted). The prompt
is shown in full and copied exactly as shown: it adds the server, writes the Ask-first line into the
project's instructions file (CLAUDE.md if it exists, otherwise AGENTS.md) and says how to sign in;
it never asks for a key. Under it a live line watches for the sign-in: Not connected yet; Waiting
(checks every 3 seconds); after 2 minutes, what usually helps; at 10 minutes it stops, with Check
again; Connected, naming the agent and the person, the tools it can call and See how an agent
answers (a sheet with example answers), while the new row joins Connected agents marked
New; or declined in the browser. In the demo an agent signs in 8 seconds after a copy. Then one cell
per agent: one Claude cell with a quiet text switch between Claude Code (Copy command) and the app
(Copy address), Cursor and VS Code with their one-click install links, and ChatGPT and others. Each
agent's steps (Claude Code, the Claude app, Cursor, VS Code, Codex, ChatGPT, other agents) sit in
the "Prefer to do it by hand" fold; Steps in a cell opens it at that agent. The Connect an agent
dialog (user menu, palette, setup checklist) shows the same body (`components/connect-agent.tsx`,
`data/agents.ts`, `lib/connect.ts`). Connected agents are rows like the Integrations rows (logo,
agent, who connected it, used today) with Revoke as a quiet action that asks first. Pause sharing
and Tools and access keys are folded rows at the end. There are no tab strips or segmented controls
anywhere in Settings; the Integrations kind filter went too.

Every Settings and Integrations page is laid out like the Inbox and Efferd's dashboard 2: one
full-width square frame (24px gutter, up to 80rem), a header row per section with a hairline, tables
edge to edge with the lists' thin header band, and key-value rows as table-like bands. The parts
are shared in `components/heed/frame.tsx`.

| Screen | Address |
|---|---|
| General: About our business, in the document editor | `#/settings/general` |
| About our business, first run (empty, Start from the guide, Done) | `#/settings/general?demo=setup&setup=1` |
| Domains and owners: a grid of domain cells (arrow keys move) | `#/settings/domains` |
| A domain as its own document: owners, counts, its text and house rules | `#/settings/domains/sales` |
| The sandbox, which never reaches agents | `#/settings/domains/sandbox` |
| A new domain (Add the domain, then delete it while empty) | `#/settings/domains/new` |
| People: everyone, their role, the domains they own, last active, invited | `#/settings/people` |
| People in a new install: just you | `#/settings/people?demo=setup` |
| Agents and access: the prompt, the live line, one cell per agent, by hand folded, connected agents | `#/settings/agents` |
| Live line: waiting, after 2 minutes, connected (a New row), stopped at 10 minutes, declined | `#/settings/agents?connect=waiting`, `hint`, `connected`, `timeout`, `declined` |
| Connect an agent as a dialog, the same body | `#/inbox?open=connect` |
| Advanced, with Deleted: the drafts and terms deleted, by whom and when | `#/settings/advanced` |
| Integrations: connected tools as rows, available as hairline cells | `#/settings/integrations` |
| Cube, a definitions connector, one page with sections | `#/settings/integrations/cube` |
| Cube's Figures in Ask: endpoint, masked secret, declared host, data contact, the switch | `#/settings/integrations/cube` |
| Larchwood warehouse, a figures-only integration, and the rule for a metric in both | `#/settings/integrations/warehouse` |
| Google Drive, a context connector (service account) | `#/settings/integrations/google-drive` |
| Connect, five steps on a full page (Pick, Connect, Choose, Map, Schedule) | `#/settings/integrations/cube/connect?step=1` |
| Google Drive, step 2: share folders with the service account | `#/settings/integrations/google-drive/connect?step=2` |
| Markdown in Git, from Pick to connected | `#/settings/integrations/markdown-git/connect` |
| State: nothing connected | `#/settings/integrations?state=nothing` |
| State: syncing | `#/settings/integrations/cube?state=syncing` |
| State: sync failed | `#/settings/integrations/cube?state=failed` |
| State: needs a new key | `#/settings/integrations?state=reauth` |
| State: a sync that created suggestions | `#/settings/integrations/google-drive?state=suggestions` |
| The suggestions in the Inbox, grouped under their read | `#/inbox?demo=week&card=drive-marketplace` |
| A suggestion from a document, in the review | `#/inbox/drive-marketplace/review?demo=week` |

Connectors: Cube for definitions and figures; Larchwood warehouse for figures only; Google Drive (through a service account the admin shares folders
with) and Markdown in Git for context; dbt and Notion as Soon, all with their real logos. No number
is stored: a figure is read when someone asks, only from an integration whose "Show figures in Ask"
switch is on (off by default), and the metric's definition decides which one answers, so Orders
comes from Cube even though the warehouse has an orders table. Each figures integration names a
data contact, also shown on Definitions and on a synced definition. A sync never publishes: definitions are a read-only copy that
flags the context relying on them, and documents become suggestions in the owners' Inbox, one per
document, grouped under the read that made them. Context published from a document carries a small
Drive mark and names the document in its peek; synced definitions carry Cube's logo and a lock.
Old `#/settings/about` and `#/settings/definitions` addresses redirect.

### Observability (admins and domain owners)

From the observability design (all eight calls adopted) and round 2 of the evals design (saved
questions, option B). What agents asked and what they got, as scopes and counts only: never the
words of a question, never who asked, and a count under 5 reads "Fewer than 5". One row at the
sidebar's foot, between Help and Settings, for admins and domain owners; it swaps the sidebar to its
own menu with Back to app, as Settings does: Agents (Overview, Questions), Answers (Quality, with a
badge for what needs a look, and Feedback), System (Usage, admins only, and Alerts). Every page takes
`range=7|30|90`, and admins `domain=` and `agent=`; an owner only ever sees their own domains.
Charts are small SVG on the app's tokens (`components/obs/charts.tsx`): blue for checked context,
amber for what to look at, a hatch for Not found, a dashed line at each publish, and a
table of the numbers for screen readers.

| Screen | Address |
|---|---|
| Overview: four numbers, questions per day by answer, top topics, what found nothing, what changed | `#/observability/overview` |
| Nothing connected, too few to show, a busy workspace | `?state=empty`, `?state=quiet`, `?state=busy` on any page |
| Questions: saved views as tabs, filters read back as a sentence, sort, save a view; grouped by metric and market, the months joined | `#/observability/questions` |
| Questions, each exact scope with its month; by domain only; one month | `?group=none`, `?group=domain`, `?month=2026-09` |
| The answer panel: a replay of a topic now or before the last publish (Overview, Steps, Warnings) | `#/observability/questions?dock=topic.orders-spain` |
| Quality: the one list of saved questions, Needs a look, Changed, Same, and the trend | `#/observability/quality` |
| Quality, a check running, failed, all the same | `?quality=running`, `?quality=failed`, `?quality=same` |
| Feedback: thumbs, reports by state, agents' reports by kind | `#/observability/feedback` |
| Usage: tools, how fast, agents by kind, model spend against the caps | `#/observability/usage` |
| Alerts: eight rules in a sentence, what was raised lately | `#/observability/alerts` |
| The Inbox card an alert raised | `#/inbox?card=look-sales` |

**Topics** (all six picks of the topics design). A topic is the exact scope the real
key stores: domain, metric (or metric group), market and the month the question's dates start in
(`topicKey`, `data/observability.ts`). Questions and Overview's Top topics group them for reading
only: metric and market by default, the months joined and opened in place, or domain only, or none.
A grouped total that would give a month under 5 away by subtraction reads "13+" (the real app's
`visibleTotal`). A gap counts across a month edge: Orders in Germany, 3 calls about 30 October and 3
about 1 November, is one Not found card. Calls that could not be read are one line with a count and no
words. A topic with no metric says "No metric named", a metric group takes its metrics' domain, and
calls whose agent fields and words disagreed are flagged. No model names or decides a topic.

**Saved questions** (`data/saved-questions.ts`, the one source of every count: 12 in 4 domains, 9
same, 1 changed, 2 need a look). Owners of a domain and admins save one with Save question, under an
answer in Ask and in the answer panel's footer; a gap's draft review has "Also save this question",
on by default. After a publish, an archive, a restore, a sync or a check date passing, each is checked
again, for free: it checks what agents get, not how an agent words it. A review shows "N of N still
answer the same" with the diff in place and never blocks Publish; a draft that makes one worse reads
"A draft to check". A domain's page has the health line, which opens Quality on that domain. The
heavy tests with a model stay in Settings, Advanced, behind a key (the paired run is a disabled entry
until it has run from the command line).

**Alerts** (`data/alerts.ts`) are the only announcement: a rule raises a card in the Inbox, never an
email or a bell. Admins turn a rule off and change its threshold in the sentence; owners see the
rules that reach owners and mute them for their own domains. Add a rule is disabled with its reason.

### Everywhere

| Screen | Address |
|---|---|
| Search palette (also Cmd K, or Search in the sidebar) | `#/inbox?open=palette` |
| Connect an agent (also in the user menu) | `#/inbox?open=connect` |
| Help: the answer lines, ten words and how agents use it, searchable (`/` focuses it) | `#/help` |
| Help searched for something it doesn't cover: send it to the documentation | `#/help?q=refund` |
| The Help menu from the sidebar's foot (Get started only while setup is unfinished) | `#/inbox?menu=help`, `#/inbox?demo=setup&menu=help` |
| Keyboard shortcuts (`?` anywhere you aren't typing) | `#/inbox?open=shortcuts` |
| Report a problem: one box | `#/inbox?open=report` |
| An answer line's card: what it means and what you do | `#/ask?example=missing&statehelp=1` |
| The documentation, its own site (opens in a new tab from the app) | `#/docs`, `#/docs/connect-an-agent` |
| The plain-text index agents can read | `#/docs/llms.txt` |
| Sign-in | `#/signin` |

The user menu sits at the foot of the sidebar: Connect an agent and Sign out.

**Picking rows** works the same in every list with checkboxes (Context, Definitions, the Inbox, a
source's folders), from one hook (`hooks/use-selection.ts`, its rules in `lib/selection.ts`). A
checkbox ticks one row and makes it the anchor; Shift and a click ticks the rows from the anchor to
that one, in the order on screen (after the sort and filters, across groups), and takes the anchor's
state, so unticking a row and Shift-clicking another unticks the run. A second Shift-click redraws
the run from the same anchor. Cmd or Ctrl and a click on a row ticks it instead of opening it; a
plain click on a row opens it, or ticks it while rows are ticked; a title always opens. Shift and
Up or Down extends from the keyboard, X ticks the row the cursor is on, Cmd or Ctrl and A ticks
every row shown, Esc clears, and Delete or Backspace opens the list's delete confirmation (never
deletes by itself). On a phone, Select starts picking and a tap ticks a row. The anchor is kept by id, so it outlives a re-render and a filter
that hides it for a while. Shift and a click never highlights the rows' text. The ink bar shows the
count and the bulk actions, and a screen reader hears "3 selected" on each change and "Selection
cleared" at the end; a source's folders take the clicks but leave Esc and Cmd A to the form.

Help is option C of the help design (all twelve picks). One Help row opens a menu; the Help page
holds only what is particular to the product: the six answer lines (the line, what it means, what
you do), ten words, and four facts on how agents use what people write. Help goes to where the
words are: an answer line in Ask opens a card with what it means and what to do, each aside (About
our business, a domain) ends with "Read the guide", and `?` opens a sheet of fifteen keys. A "how do
I" goes to the documentation: its own site, opened in a new tab, eleven pages plus What's new, left
navigation, On this page, previous and next, search with Cmd K, and a plain-text index for agents.
The answer lines, words, setup steps, connect prompt and tools are each one list
(`lib/help-content.ts`, `data/agents.ts`), drawn by Help, the card, Ask's own labels and the docs, so
they cannot disagree.

One scroll region per view: the page's body (or the document canvas, under a fixed header,
toolbar and footer) owns the scrolling; a side panel scrolls only when its content is genuinely
long, and is folded on edit pages unless it has something to say (an overlap, a conflict), with a
toggle in the header. Every scrollbar is the same thin one, always visible so a list that runs on
says so, quiet but at 3:1 against the page, darker under the pointer. Documents sit on a fixed 56rem
sheet (`max-w-sheet`) that never grows with the window, with their prose at a 60ch measure
(`max-w-reading`); tables, lists and settings use the 80rem frame (`max-w-wide`): the Inbox,
Settings, and the Context and Definitions lists (all views), centred with side borders once the pane
is wider, their head and foot still sticky. A long block in a side panel (the
live preview) is clamped with Show all, never boxed. Every right-hand panel (the editors' What agents get, the
context page's panel, the review's Try it and decide, Settings help and the quick view docks) shares
one anatomy (`components/heed/panel.tsx`): a title bar with a close or fold, one scrolling body, and a
footer for what must stay in reach (Ready, the decision). In the editor, Preview and Overlaps are
groups that fold; Preview starts folded when there are overlaps, so the choices are in view. The
context page's panel folds to a rail and stays as left for the session.

When things go wrong, each state can be opened by its address: `?state=loading` keeps a list
(Inbox, Context, Definitions) or an item page (context item, definition) in its skeleton;
`?state=failed` makes the load fail with one calm line and Retry, and makes an editor's first Save or
Publish fail with "Couldn't publish. Your text is kept." and Retry in the footer; `?state=offline`
(or the browser going offline) shows one line under the header, keeps drafts "Saved on this device"
and holds Publish until the connection is back. `e2e/j8-states.spec.ts` walks all four.

Long lists inside a page never scroll on their own. History on a context item or a definition is
one line ("60 changes - last checked by Sofia Brandt, 2 Oct") that opens into compact rows grouped by
month, newest five first and "Show 10 earlier" after; a row's tooltip says what changed and a click
opens that version's read-only diff in a sheet, with Restore for owners. Comments, Related,
synonyms, context about a definition and connected agents show their first few with the same
"Show more" button. `#/context/itm_gift_card_only` has 60 versions.

Keys work everywhere they help, and each button's tooltip shows its key: J and K move through the
Inbox, the review queue and the lists, Enter opens, Esc goes back (on a phone, from a card to the
list), Command and K searches, Command and Enter publishes (or sends, or saves) in the review and
both editors. A change of card or suggestion fades in, the list in an @ picker slides in, and a
decision shows a short countdown bar; none of it moves with reduced motion.

## How it is built

| Part | From |
|---|---|
| App | Vite 8, React 19, TypeScript, Tailwind 4 |
| Components | shadcn base-nova on Base UI (`src/components/ui`, added with `npx shadcn add`) |
| Left sidebar | the sidebar-07 block, collapsible to an icon rail |
| Page header | the dashboard-01 block's site header |
| Inbox | shadcn's Mail example (v3): list with a Needs me and All filter and search, detail pane, resizable panels; styled as Efferd's dashboard 2 (a frame of flat cells divided by hairlines) |
| Shell styling | Efferd's app shell: sidebar on the page background, one bar height (`--spacing-bar`, 48px) for the header, the sidebar's logo row and user block, and every bottom bar, so their hairlines line up, and a 40px toolbar row (`--spacing-tool`) for the editors' toolbar, a fixed row under the header outside the scroller; a 14px page title; outline icon buttons. Search is a field at the top of the sidebar, a lone magnifier in the rail and on a phone's top bar; Help and Settings are quiet rows at the sidebar's foot, and Help opens a small menu (the Help page, the keys, Documentation and What's new in new tabs, Contact support, Report a problem); the theme (light, dark, system) is a small menu at the right end of every header. Titles cut off with an ellipsis show in full on hover or focus (one shared component) |
| Context and Definitions | the Heed app's list (`item-list.tsx`, `library-bar.tsx`) with Efferd's table rows: a quiet filter bar, a 36px header band, one density of compact rows in the list columns' design B (kind icon, scope column, status icon, time glyph with a short date, freshness dot), keyboard cursor, row selection and an ink selection bar |
| Ask | assistant-ui's thread at 44rem. The chat's input surfaces are soft (the rule: containers square, conversational input surfaces soft, small controls round): the question as a soft muted bubble, suggestions as soft chips, and the composer on the same input surface as the comment box (`lib/surfaces.ts`: the field border, a gentle hover step, a calm focus ring), docked under a hairline with an @ button and the keys on its control row (its editor loads on demand). An answer: the look-up as one quiet line that opens the card, the words with citation markers that show a hover card, a closed "N sources" list, good, bad and something wrong (copy and ask again on hover); no word-by-word stream, one motion as the sources settle in. "Read as" shows under a question only when it was read as something its words don't say |
| Context editor | editorcn's toolbar editor (`src/components/editor`), laid out as editorcn's Simple Document Editor template: a canvas, the toolbar, a paper sheet. Under the title the properties are a calm list, not a form (`field-controls.tsx`): a muted icon and label on the left, the value shown as what it is on the right with no border at rest, a soft fill on hover and a soft ring on focus, in three groups split by a hairline (what it is: Domain as its dot, Kind as an icon chip, Status only when it needs attention, Owner as avatar chips; when and where: Applies to as tag chips with + Add, When as one date-phrase chip; where it comes from: Source as a link chip, Don't conclude edited in place, Checked). Empty values are a muted Add placeholder; a needed one has a quiet dot. One popover each (a bottom sheet on a phone; on a phone the label sits above its value). Up and Down move between properties, Enter opens, Esc closes, typing filters, Backspace removes the last tag. Every tag is the one chip (`tag-chip.tsx`), tinted by what it names, also in the list's Scope column, Details, the quick view and mentions. The term editor uses the same controls. The header keeps to the way back, the title (cut with an ellipsis, in full on hover or focus), Saved, one Write / Try it toggle and the one primary action; Draft from text, What agents get, search on a phone and the theme sit in one More menu. The side pane (what agents get, overlaps) shows only when the item overlaps another. Markdown in and out through `@tiptap/markdown`; the context page uses the same sheet, read-only, and Definitions uses it for terms |
| Sign-in | the login-03 block's layout |
| Empty states, palette, dialogs, forms | shadcn Empty, Command, Dialog, Field |
| Dock | a shadcn resizable panel: 480 for Ask, a context or definition peek, Try it and the agent view; 720 for a review's quick view; full screen on a phone. The review itself is a full-screen page |
| Choosing between things | one shared component per job (`src/components/heed/switches.tsx`), no pill tabs or segmented tracks: another view of the same thing is a quiet icon button (ViewToggle, the review's View source); a list filter or a two-way option is words with counts and a 2px underline that slides (TextSwitch: the Inbox's Needs me and All, the Definitions views, Try it's "Answer as Draft - Published"); a decision with a few answers is outline buttons in a radio group (ChoiceGroup: how an overlap relates); a property of a document is its property menu (a term's Another name for). |
| Mentions | one '@' picker for Ask, the document editors and comments (`components/heed/mention-picker.tsx`, `lib/mention-extension.ts`, model and search in `lib/mentions.ts`): shadcn Command under the caret, a sheet on a phone, grouped Domains, Definitions, Context items, Markets and People with type icons, recent first. Each place offers its own kinds: Ask scopes with domains, definitions, context items and markets; the editors link context items, definitions and domains (a click opens the quick view, an archived or deleted target keeps the author's words in a dashed chip); comments tag people, which marks the Inbox and brings the card, or your waiting suggestion, back to Needs you, in the app only. In what get_context gives an agent a mention is only its words (`lib/agent-reply.test.ts`); following it is a separate, read-only tool, get_related (below) |
| Links (get_related) | what an agent can follow, one step at a time, at most 50 nodes, in a fixed order, never changing what an answer includes and never reading comments (`lib/links.ts`, unit-tested): the @ links in a text both ways, and the owners' relations replaces and disagrees with (kept on the items). People see the same as **Related**: in the side panel of a context item's page, in Details in its quick view, and on a definition's or term's page and quick view, each link as the mention chip with its type icon, a small label for replaces, replaced by and disagrees with, "not followed" for a retired item and "from Sales" for a definition another domain owns. Ask's look-up line says "Looked up 2 context items, followed 1 link"; opened, it shows where each link led and what it left alone ("no longer available, not followed"), and a source's card lists the links an agent can follow from it. In the review, a suggestion that adds a link says "Now links to Test account", and Try it says whether the answer would follow it. Agents and access, Tools and access keys, has get_related with its own switch, "Let agents follow links" (on in the demo); off, Ask says it didn't follow links and Related says so. Review flag `?links=on|off` |
| Mock data | `src/data`: the Larchwood Outdoor demo world |
| Motion and loading | no animation library: one token set in `src/index.css` and three tiers (instant for the keyboard and frequent actions, an explained change at 90 to 220 ms, staged work only where an agent works), all in `docs/motion.md`. Loading waits 150 ms, then shows the page's own shape for at least 300 ms, and the content fades in through React's `ViewTransition` (`Loadable`, `lib/loading.ts`); a button's spinner sits in its icon slot (`Button loading`). Overlays transition on Base UI's starting and ending styles, and open at once from the keyboard. Inbox decisions are optimistic (`useOptimistic`), with Undo for 6 s and a rollback if the save fails; rows leave and arrive through one presence pattern (`lib/presence.ts`). A dock moves the page in one frame and slides in 220 ms. Ask's staged look-up also runs in Try it, the answer panel and Quality's check. The Overview chart grows once after a wait, and a changed number gets a fading tint. **Slow network** in Help (or `?slow=1`) makes each page's first visit and every save wait, so this can be seen. `src/lib/motion.test.ts` and `e2e/j29-motion.spec.ts` (also run with reduced motion) keep the rules |

Heed's own code is small and lives in `src/components/heed` (avatars, badges, the state line,
the field diff, the context view, an Ask answer, the list parts) and `src/pages`.

### Theme

shadcn's neutral theme with these changes only (`src/index.css`):

- the primary, ring and sidebar primary are Heed blue: `#2c5dbd` light, `#7aa2f0` dark;
- muted text is `#666666` light and `#a3a3a3` dark, so it keeps 4.5:1 on the muted surface;
- input borders are `#8f8f8f` light and `#6b6b6b` dark, so fields, checkboxes and radios keep 3:1;
  the components' translucent `bg-input` fills were scaled down to match, so fields keep shadcn's
  own fill;
- Nunito Sans for all text. The wordmark is Outfit 500 outlined into the logo's SVG, so no Outfit
  font loads;
- the radius rule: containers square, conversational input surfaces soft, small controls round.
  `--radius-surface` (the soft one) is used by the comment box, the Ask composer, a question and the
  suggestion chips;
- frames are square, as Efferd's dashboard 2 draws them: one token, `--radius-frame: 0px`, used by
  the Card, Dialog, Popover, Command (the palette), Empty, Alert and Item primitives, the editor's
  frame, toolbar and code blocks, and every panel, table, callout and editor sheet in the pages.
  Small controls keep the radius scale: buttons, inputs, selects, toggles, checkboxes, switches,
  badges and chips, avatars and logo tiles, kbd, tooltips, and the menus (dropdowns, select lists,
  palette rows), which Efferd also keeps rounded.

People get a pastel avatar picked from their name (soft tint, dark initials; 32 in chat, 28 in
lists). Every Lighthouse accessibility snapshot taken (16 screens, 1440 and 390, light and dark)
scores 100.

## The Inbox and the dock

The Inbox is a middle list and a right detail pane, as in shadcn's Mail. The dock is the only other
right panel, and it **takes the detail pane's place** when it opens: Open the context item on a
flag, swaps the detail pane for the dock (and folds the sidebar to its rail), so
there are never two right panels. Closing the dock brings the detail pane back. On a phone the list,
the detail and the dock are each a full screen.
