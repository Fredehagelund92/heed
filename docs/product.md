# Heed v1: the product

This page says what Heed v1 is: the job, the people, the promise, every screen with its address, the six answer states, the kinds, the roles, the privacy rules and the words. It is short on purpose. The details of each rule are in the [design contract](design/design-contract.md), the [copy rules](design/copy.md) and the [requirements](requirements.md).

|                      |                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status               | v1 spec, written from the approved mockup                                                                                                                                       |
| Date                 | 2026-10-25                                                                                                                                                                      |
| Acceptance reference | The Heed v1 mockup at commit `080cbc3` (section 14)                                                                                                                             |
| Written for          | Everyone who builds, reviews or runs Heed: contributors, coding agents, and the people who pick Heed up for their own company                                                   |
| Order of authority   | The mockup first. Then this page and the design contract, which are written from it. Then the requirements, which are changed to match both. Where they differ, the mockup wins |

## 1. The job

Company data shows what happened to a number. It rarely shows why. A market closed, a tool changed how it counts, a partner's data came late. People know this. An AI agent cannot see it, so it guesses.

Heed is a library of checked context that agents read before they answer. People write down what the numbers do not show. The owner of each domain checks it and publishes it. Agents get only what an owner published, each item with its source and its check date. When nothing is written down, the agent is told that too.

One sentence for the product: **agents read checked context before they answer.**

## 2. Who it is for

| Who                  | What they do in Heed                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A member             | Writes context and sends suggestions. Asks questions in Ask. Comments. Sees what is waiting on them.                                                             |
| An owner of a domain | A member who owns one or more domains. Reviews and publishes the context of those domains. Checks it again when its check date passes. Saves questions to watch. |
| An admin             | Runs the workspace: people, domains, agents, integrations, limits. Can do everything an owner can do, in every domain.                                           |
| An agent             | Software outside Heed (for example a coding agent or a chat app) that connects over MCP and calls the six tools (section 10). It reads. It may also suggest.     |

The data team that runs Heed is the first reader of this page. The people it serves are in finance, marketing, operations and management. Many of them read English as a second language. They know their business. They should never need to know data or AI words. [Copy rules](design/copy.md) says how Heed speaks to them.

## 3. The promise

1. **Agents read only what an owner published.** A draft, a suggestion or a comment never reaches an agent.
2. **Every item has a source and a check date.** An item whose check date has passed is marked, and agents are told it may be old.
3. **Nothing written down is said as nothing written down.** An agent never fills a gap with a guess that sounds sure.
4. **People decide, software proposes.** An agent or an integration can suggest. Only a person publishes.
5. **Heed stores no numbers.** It reads a figure when someone asks, only if an admin switched figures on for that integration, and keeps it nowhere.
6. **Heed keeps no record of what people asked an agent.** It keeps only what a question was about and how often (section 9).

## 4. How it works

1. **Write.** Someone writes a context item, or an agent or an integration sends a suggestion.
2. **Review.** The owner of the domain sees the suggestion in the Inbox. The review shows exactly what changes, whether the claims match the source, whether it clashes with live context, and what agents would say before and after. The owner publishes it, edits it, or returns it with a note.
3. **Agents read.** An agent calls `get_context` with a question. It gets an answer line (one of six states), the items that apply, and one sentence to pass on.
4. **Gaps come back.** A question that found nothing, again and again, becomes a Not found card in the owner's Inbox, with a draft ready to review.
5. **Checks stay fresh.** Every item has a check date. When it passes, the owner gets a Due for a check card. Saved questions are checked again after every change, for free, so a publish that makes an answer worse is seen at once.

## 5. The screens and their addresses

The mockup writes an address after `#` (`#/inbox?demo=week`). The app uses the same paths and the same search names without the `#`. The mapping is one to one. Scenario flags such as `demo`, `state`, `example`, `figures`, `links`, `connect`, `quality`, `bulk`, `decide` and `slow` only set up a demo or a fault for tests. They are not part of the product and never reach a production build.

The sidebar has four places: **Inbox**, **Ask**, **Context**, **Definitions**. At its foot: **Help**, **Observability** (admins and owners) and **Settings** (admins; owners see Domains and People). A search field sits at the top of the sidebar. The user menu holds Connect an agent and Sign out. The theme menu is at the right end of every header.

### Inbox

| Screen                                                  | Address                                                 |
| ------------------------------------------------------- | ------------------------------------------------------- |
| Needs me                                                | `/inbox`                                                |
| All, with "yours, waiting on others" and Done           | `/inbox?tab=all`                                        |
| A card selected, its quick view in the pane             | `/inbox?card=<id>`                                      |
| The full-screen review of a card                        | `/inbox/<id>/review`                                    |
| A card's context item in the dock                       | `/inbox?card=<id>&dock=context.<item>`                  |
| Setup checklist on a new install                        | `/inbox`, shown while setup is unfinished               |
| Connect an agent as a dialog, search, shortcuts, report | `/inbox?open=connect`, `palette`, `shortcuts`, `report` |

The Inbox is a list in the middle and a detail pane on the right. The dock takes the detail pane's place, so there are never two right panels. The list is ordered by need, in groups with counts: Not found, Reported, Saved questions, Alerts, Mentioned you, Due for a check, then Suggestions. Under All it adds Waiting on others and Done. One quiet sentence under the heading says what agents asked this week, in counts only.

### Review

| Screen                           | Address                   |
| -------------------------------- | ------------------------- |
| The review, a queue by sender    | `/inbox/<id>/review`      |
| The quick view in the Inbox pane | `/inbox?card=<id>`        |
| The quick view in the dock       | `/inbox?dock=review.<id>` |

The quick view never publishes. The review is a full-screen page inside the app, with the sidebar folded to its rail. Section 6 of the [design contract](design/design-contract.md) has its anatomy. In the review, a comment can hang on a line of the text or a field; anyone who reads the suggestion resolves or reopens the thread, and open threads never hold Publish.

### Ask

| Screen                              | Address                                     |
| ----------------------------------- | ------------------------------------------- |
| Ask, empty, with Asked this week    | `/ask`                                      |
| A source in the dock                | `/ask?dock=context.<item>`                  |
| Ask in the dock beside another page | `<page>?dock=ask`                           |
| History                             | the left side of `/ask`; a sheet on a phone |

The empty Ask shows Asked this week. Until agents have asked anything, it offers up to four first questions instead, made from what the workspace has written: the scopes of its published context items, then its metrics. A workspace with nothing written yet gets no first questions, only the empty page's words. Under a finished answer, Ask next offers what agents asked most this week, each with the state it would get.

Ask also answers questions about the context's own records, such as "give me context created in the last 24 hours" or "who owns Sales?" (FR-718). The list is closed, and no model reads or writes them: what was created, what changed, what is due for a check, what is archived, who owns a domain (or a metric's domain) and which have no owner, how many context items or definitions there are, and what agents asked this week that found nothing. Each is counted from what the Context list shows the person asking, never a draft and never what one person did. A records answer has no answer line: a **Records** chip, the sentence "Counted from the workspace's records.", one plain sentence, and at most five rows that open in the right panel, or a small table of counts, with Context keeping the full list. Nothing found is an answer too: "Nothing was created in the last 24 hours.", with the period in UTC and when the latest one was. It ends "Agents did not read this answer. It says nothing about what they get." A question about one person's work ("what did Maria write this week?") is refused, with what Ask can say instead.

### Context

| Screen                        | Address                        |
| ----------------------------- | ------------------------------ |
| The list                      | `/context`                     |
| A context item in the dock    | `/context?dock=context.<item>` |
| A context item's page         | `/context/<item>`              |
| New context                   | `/context/new`                 |
| A draft from a Not found card | `/context/new?gap=<id>`        |
| Edit                          | `/context/<item>/edit`         |
| Suggest a change              | `/context/<item>/suggest`      |
| Try it from the editor        | `/context/new?dock=try.editor` |

### Definitions

| Screen                                      | Address                        |
| ------------------------------------------- | ------------------------------ |
| The list                                    | `/definitions`                 |
| A definition in the dock                    | `/definitions?dock=def.<name>` |
| A definition's page                         | `/definitions/<name>`          |
| A definition's editor (terms and synonyms)  | `/definitions/<name>/edit`     |
| New term                                    | `/definitions/new`             |
| Connect the definitions source (from setup) | `/definitions?setup=1`         |

### Settings (admins)

Inside Settings, the app sidebar gives way to the settings menu, with Back to app on top. Five sections in three groups: Workspace (General, Domains and owners), Connections (Agents and access, Integrations), System (Advanced).

| Screen                               | Address                                      |
| ------------------------------------ | -------------------------------------------- |
| General (About our business)         | `/settings/general`                          |
| Domains and owners                   | `/settings/domains`                          |
| A domain as its own document         | `/settings/domains/<domain>`                 |
| People                               | `/settings/people`                           |
| Agents and access                    | `/settings/agents`                           |
| Integrations                         | `/settings/integrations`                     |
| One integration                      | `/settings/integrations/<id>`                |
| Connect an integration, five steps   | `/settings/integrations/<id>/connect?step=1` |
| Advanced (limits, editions, Deleted) | `/settings/advanced`                         |

### Observability (admins and domain owners)

Inside Observability the sidebar gives way to its own menu, with Back to app on top: At a glance (Summary, the first page), Agents (Overview, Questions), Answers (Quality, Feedback), System (Usage for admins, Alerts). Summary reads a fixed calendar period, `period=month|quarter` (the last whole month by default), and lists its monthly snapshots, each a digest that prints on one A4 sheet or saves as a PDF; every other page takes `range=7|30|90`. Admins also take `domain=` and `agent=`. An owner sees only their own domains.

| Screen                                   | Address                                    |
| ---------------------------------------- | ------------------------------------------ |
| Summary, the last whole month or quarter | `/observability/summary`                   |
| A monthly snapshot's digest, to print    | `/observability/summary/<id>`              |
| Overview                                 | `/observability/overview`                  |
| Questions, grouped by topic              | `/observability/questions`                 |
| The answer panel, a replay of a topic    | `/observability/questions?dock=topic.<id>` |
| Quality, the saved questions             | `/observability/quality`                   |
| Feedback                                 | `/observability/feedback`                  |
| Usage (admins)                           | `/observability/usage`                     |
| Alerts                                   | `/observability/alerts`                    |

### Help, documentation and sign-in

| Screen                                           | Address                 |
| ------------------------------------------------ | ----------------------- |
| Help: answer lines, ten words, how agents use it | `/help`                 |
| The documentation, its own site                  | `/docs`, `/docs/<page>` |
| The plain-text index for agents                  | `/docs/llms.txt`        |
| Sign-in                                          | `/signin`               |
| An agent's consent page: allow or deny           | `/connect/approve`      |

The consent page is where the login server sends a person whose agent asked to connect (`?request=` names the sign-in): they sign in there if they have not, read which agent asks and what it may do, and allow or deny it. The mockup does not draw it; it keeps the earlier app's page in this design.

The Help menu in the sidebar's foot opens a small menu: the Help page, the keys, the documentation and What's new in new tabs, Contact support, Report a problem. Old addresses `/library`, `/settings/about` and `/settings/definitions` redirect to Context, General and Definitions.

## 6. The six answer states

Every answer to a question that was looked up, for an agent and for a person, starts with one answer line. The words are fixed. Each shows with its icon and its tint, never as colour alone. Under every line but Checked there is one short sentence. The long form is for a tooltip, Help and the answer line's card.

| Label           | The sentence under it              | What it means                                                                               | What to do                                      |
| --------------- | ---------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Checked**     | (none)                             | Context applies, and its owner published it with a source and a check date.                 | Nothing.                                        |
| **Partial**     | Only part of this is written down. | Context covers part of the question, or the dates were assumed. The answer says which part. | Write the missing part, or tell the owner.      |
| **Not found**   | Nothing is written about this yet. | Nobody has written anything down for this. It does not mean there is no explanation.        | Write context, or tell the owner.               |
| **Conflict**    | Two items say different things.    | Two items that apply say different things. Agents give both and say so.                     | An owner keeps one, narrows one, or keeps both. |
| **Outdated**    | Some of this may be old.           | An item's check date has passed, or a definition it relies on changed.                      | The owner checks it: Still true, or Edit.       |
| **Not checked** | The check did not run.             | The check could not run just now. It is not the same as Not found.                          | Ask again in a minute.                          |

In the code the states are `grounded`, `partial`, `missing`, `conflict`, `stale` and `failed`. A draft answer says "Based on this draft" and is never called Checked. The labels, sentences and long forms live in one list that Ask, Try it, Help, the docs, the charts and the copy test all read.

A question that names nothing the context is about, no metric and no market, is not looked up, so it gets no answer line. Agents get `need_more_detail` and its reason. Ask says "Nothing was looked up", gives the reason in plain words, names the kinds of question it answers today with two questions from the workspace to try, and says it also answers questions about the records. Not found is only for a question that was looked up and found nothing: it says nobody wrote anything down, which a question that was never looked up cannot show.

An answer from the records (section 5, Ask) is not an answer about context, so it has no answer line either: it starts with the Records chip and says where it was counted from.

## 7. The kinds

A context item has one of four kinds. A kind shows as an icon only (neutral colour, a label in its tooltip and in Details).

| Kind        | Icon      | Stored as | What it is                                                          |
| ----------- | --------- | --------- | ------------------------------------------------------------------- |
| **Event**   | Lightning | `event`   | Something that happened on a date, like a stop or a new rule.       |
| **Warning** | Triangle  | `issue`   | A limit or problem agents should know, like late or missing data.   |
| **Rule**    | Ruler     | `note`    | A fixed way to read the numbers, like a definition or a house rule. |
| **Guide**   | Route     | `guide`   | What to check before you explain a change.                          |

The stored values are the earlier names. Screens, help and agents use the labels. The earlier fifth kind, Example, is no longer offered.

## 8. Statuses and freshness

A context item has one of four statuses, each a circle icon with a word on hover:

| Status             | Icon          | Meaning                                                                             |
| ------------------ | ------------- | ----------------------------------------------------------------------------------- |
| **Draft**          | Dashed circle | Started and never published. Agents never get it. Only drafts can be deleted.       |
| **Live**           | Check         | Published. Agents get it.                                                           |
| **Needs checking** | Alert         | Published, and its check date has passed. Agents get it and are told it may be old. |
| **Archived**       | Minus         | Retired. Agents no longer get it. Its history stays.                                |

**Freshness** is one dot in the Checked column: filled up to 30 days since the last check, half full up to 90 days, hollow after that. A suggestion shows its state in words (waiting, published, returned, withdrawn).

## 9. Privacy

One rule everywhere: **from agents, Heed keeps only what a question was about and how often (scopes and counts). It never keeps the words, and it never keeps who asked.**

1. **Scopes and counts only.** A question an agent asked becomes a topic: domain, metric, market and the month its dates start in. Nothing else about it is stored.
2. **Fewer than 5.** A count under 5 reads "Fewer than 5". No total is shown when a hidden part could be worked out by subtraction (it reads "13+").
3. **Words are kept only when a person sends them on purpose, and then with their name.** That means a suggestion, a named report, a saved question and a comment.
4. **Ask chats are the person's own.** They stay in the person's browser and are seen only by them. Ask says so, and its empty state says what is kept.
5. **Agents never read comments, reports or saved questions.** An agent's answer is built from published context only.
6. **Report a problem** sends the page address and the reporter's name, never an agent's words.
7. **Figures are read when asked and kept nowhere.** No person's identity is passed to the data source.
8. **No tracking.** Heed sends nothing to anyone about how it is used. To learn which questions about the records people use, Ask counts which of its seven was asked each week, by its fixed name only: never the words, never who asked.
9. **No promise of anonymity.** Copy says what is kept, not that nobody can see.

## 10. What agents get

Six tools. Each is described in one list in the code (`AGENT_TOOLS`), which Settings, Help and the docs read.

| Tool              | What it does                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `get_context`     | The context that applies to a question, with the answer line and one sentence to relay.          |
| `find_context`    | A word search over names, titles and summaries.                                                  |
| `read_context`    | One context item in full: text, source, check date and the don't conclude line.                  |
| `report`          | Tell the owner something is missing, wrong or unclear, after the person says yes.                |
| `suggest_context` | Send a suggestion to the owner, after the person says yes. It waits in the owner's Inbox.        |
| `get_related`     | Follow a link between items, definitions and domains, one step at a time. It has its own switch. |

The default reply holds the answer state, one sentence to relay (`say`), what was asked, the items that apply, a reply id and the edition. Where two items disagree, the reply says so. A mention in an item is only its words in `get_context`. Following it is a separate, read-only tool, `get_related`, at most 50 nodes, in a fixed order. It never changes what an answer includes.

The earlier tool ids (`get_facts`, `find_facts`, `search_facts`, `read_item`, `report_gap`, `give_feedback`, `draft_context`) stay for one release as deprecated ids: each answers with its old arguments and its old reply, and a note that names the tool to use.

## 11. Roles

There are two roles.

| Role       | Can                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| **Admin**  | Everything: people, roles, domains, agents, integrations, limits, Usage, alert rules. Publishes in every domain. |
| **Member** | Signs in, writes context, sends suggestions, asks, comments. Becomes an owner when a domain assigns them.        |

**Owner is not a role.** Ownership belongs to the domain, and a domain can have several owners. An owner (who is not an admin) publishes, checks and archives context in their own domain, adds owners to it, saves questions for it, mutes alerts for it, and sees Domains, People and the Observability pages for it. Every control a person cannot use stays visible, with the reason.

Removing a person from the workspace waits until no domain has them as its only owner. Anyone signed in can comment. People edit and delete their own comments.

An earlier model had more roles (auditor, approver) and risk levels. v1 has neither: every item uses the same three checks.

## 12. Integrations

Integrations connect Heed to where metrics are defined and where documents live. Connect one in five steps: Pick, Connect, Choose, Map, Schedule.

| Integration     | For                  | Notes                                                                                         |
| --------------- | -------------------- | --------------------------------------------------------------------------------------------- |
| Cube            | Definitions, figures | Metrics and dimensions are a read-only copy. A figure is read on request when figures are on. |
| Google Drive    | Context              | Through a service account an admin shares folders with. Documents become suggestions.         |
| Markdown in Git | Context              | Documents become suggestions.                                                                 |
| dbt, Notion     | Context, definitions | Shown as Soon.                                                                                |

**A sync never publishes.** Definitions are a read-only copy that flags the context relying on them. Documents become suggestions in the owners' Inbox, one per document, grouped under the read that made them. Figures are not an integration of their own: a definitions tool that can read them has a second, labelled connection for them, with its own data endpoint and token, because the metric's definition decides which integration answers, and a tool no definition comes from could answer nothing. **Try a figure** reads one figure with the saved settings before anyone asks. Every figures connection names a data contact. "Show figures in Ask" is off by default.

## 13. The first day

A new workspace reaches its first answer from what the team wrote in about ten actions. Setup is write first, connect later:

1. Say what the business is about (About our business, with the guide).
2. Write one context item.
3. Ask a question about it in Ask (it is typed in for you). See Checked, with the item and its owner.
4. Connect an agent with the prompt.
5. Connect where metrics are defined.
6. Invite the people who own other domains, with their role and domains.

Ask answers from what the workspace has written. An item with no Applies to is read from its own words.

## 14. The acceptance reference

**The Heed v1 mockup is the acceptance specification** until the real application switches over to it. It is a complete clickable build of this page, with mock data from the Larchwood Outdoor demo world and no backend.

|                      |                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Mockup               | Repository `heed-v1-design`, folder `mockup/`                                                                                |
| Commit               | `080cbc3` ("README: topics, roll-ups and the month in the key")                                                              |
| Acceptance checks    | Its job specs `mockup/e2e/j1-*` to `j30-*` (Playwright), its unit tests, and its README as the screen map                    |
| When it stops ruling | When the switch pull request lands and the mockup's code is the web app. Its specs then run against the real service as well |

If the mockup and the real app differ, the real app changes. If the mockup and a document differ, the document changes. A change to the mockup needs a new reference commit, recorded here.

The job specs, one line each:

| Job | What it proves                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| J1  | An owner reviews a suggestion and publishes it in three steps.                                                                                   |
| J2  | A member who owns no domain suggests a change and sees it waiting.                                                                               |
| J3  | Someone asks, gets an answer that says how sure it is, and reports a wrong part. Answers arrive and can be stopped.                              |
| J4  | A Not found card comes with a draft, reviewed and published like any suggestion.                                                                 |
| J5  | An owner answers a report and the card is done.                                                                                                  |
| J6  | A read from a connected document arrives as a suggestion and is published.                                                                       |
| J7  | A new workspace reaches its first answer, write first, in about ten actions.                                                                     |
| J8  | Loading, a failed load, offline, and a Publish that fails and works on Retry.                                                                    |
| J9  | Domains are documents; an empty one can be deleted, one with context cannot.                                                                     |
| J10 | People: invites with roles and domains; the last owner cannot leave; owners add owners to their own domain.                                      |
| J11 | Figures in Ask: off by default, one figure with source and freshness when on, the definition decides.                                            |
| J12 | Connect an agent: prompt, live line, hint after 2 minutes, stop at 10, Check again.                                                              |
| J13 | The review's keys never act while you type; Esc order; the key hint shows only where the key acts.                                               |
| J14 | Deciding with no connection: Publish waits and says why; a failed try changes nothing; a returned note is kept.                                  |
| J15 | "Publish the ones you've read": opening is not reading; Undo puts all of them back.                                                              |
| J16 | What needs care is said before anyone publishes; archiving always asks first.                                                                    |
| J17 | The review on a phone: the bar says the state and place; targets are 44 px.                                                                      |
| J18 | After a decision: a key skips the wait, the pointer holds it, reduced motion waits for Next.                                                     |
| J19 | The Source review: the Fields table and the Text diff, only the changed words marked; N and P; Preview; the gate in both views.                  |
| J20 | Synonyms as tags: a word with another meaning says who has it and is never saved.                                                                |
| J21 | Following links (`get_related`): Related, relations, the switch in Settings.                                                                     |
| J22 | Help: one menu, the keys, the Help page, the documentation, the answer line's card, Report a problem.                                            |
| J23 | Focus moves after J, K and a decision; the last decision says everything is handled, with Undo.                                                  |
| J24 | Picking several rows works the same in every list (Shift range, Cmd toggle, X, Cmd A, Esc).                                                      |
| J25 | Bulk actions from one bar: Archive with Undo, Delete for drafts only, skips with reasons, Retry.                                                 |
| J26 | Emoji where people talk (`:` and two letters), the five reactions; none in context text.                                                         |
| J27 | Observability: its menu, range and domain, Overview, Questions, Quality, Feedback, Usage, Alerts.                                                |
| J28 | Ask ideas: Share with state and sources, Show me where it says that, Asked this week.                                                            |
| J29 | Motion and loading: decisions do not wait, loading waits 150 ms and takes the page's shape, nothing moves unasked. Also run with reduced motion. |
| J30 | Topics: an exact scope with its month; a month under 5 is never given away; a gap counts across a month edge.                                    |
| J33 | Threads on the source: C or + comments on a line or a field; reply, react, resolve, reopen; the rail counts them live.                           |

The first plan for the web app named J1 to J29. J30 (topics) was added after that, so the full set is J1 to J33.

## 15. The glossary

One name for each thing, in every screen, help page, agent reply and demo text. The full rules are in [Copy](design/copy.md). The code keeps its own words (item, area, retire, edition, scope); [`src/domain/words.ts`](../src/domain/words.ts) maps one to the other.

| On screen             | Means                                                                                                                                              | Code and specification       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **Context**           | The area of the app and the whole body of what agents read.                                                                                        | the library                  |
| **Context item**      | One entry: an event, a warning, a rule or a guide, with a source and a check date.                                                                 | item, fact                   |
| **Definition**        | A metric, a dimension or a term, and what it means here. Metrics and dimensions are read-only copies from the definitions source.                  | catalogue entry              |
| **Term**              | A word with its own meaning, written here (Peak season).                                                                                           | person-written definition    |
| **Synonym**           | Another name for a metric or a dimension (GMV for Gross sales). Agents read it as that definition. One word has one meaning in the workspace.      | alias                        |
| **Domain**            | An area of the business, such as Sales. Every context item belongs to one. A domain is a document with owners and house rules.                     | area                         |
| **Owner**             | A person who publishes and checks a domain's context. Ownership belongs to the domain, not to a role.                                              | steward                      |
| **Admin**, **Member** | The two roles (section 11).                                                                                                                        | administrator                |
| **Suggestion**        | A change sent to an owner, from the editor or by an agent. Nothing changes until the owner publishes it.                                           | proposal                     |
| **Publish**           | An owner makes context available to agents.                                                                                                        | accept                       |
| **Archive**           | Take a published item out of what agents get, keeping its history.                                                                                 | retire                       |
| **Inbox**             | What needs the person, ordered by need.                                                                                                            | notifications, queue         |
| **Card**              | One row in the Inbox: Not found, Reported, Saved questions, Alert, Mentioned you, Due for a check, or a Suggestion.                                | inbox item                   |
| **Not found**         | A question agents asked several times and found nothing written for. Its card brings a draft. Also an answer state.                                | gap                          |
| **Reported**          | Someone said a context item is wrong or unclear.                                                                                                   | flag                         |
| **Due for a check**   | A context item whose check date has passed.                                                                                                        | review due                   |
| **Saved question**    | A question an owner or admin keeps, and Heed checks again after every change. Result: Same, Changed or Needs a look.                               | saved view, test question    |
| **Try it**            | What agents would say for a question, on a draft or on live context, without asking an AI.                                                         |                              |
| **Ask**               | The page where a person asks and sees the same answer line an agent gets.                                                                          | assistant                    |
| **Records**           | What the workspace keeps about its context: when items were created, changed, checked or archived, and who owns each domain. Ask counts from them. | library index                |
| **Topic**             | The exact scope agents asked about: domain, metric, market and the month. Grouped for reading only.                                                | topic                        |
| **Edition**           | A sealed snapshot of what agents get. Shown only in Settings, Advanced, and in the agent reply. Never in success copy.                             | edition                      |
| **Don't conclude**    | A line on an item that stops an agent from reading a cause into it.                                                                                | caveat, what not to conclude |
| **Integration**       | A connected tool: where definitions live, where documents live, where figures come from.                                                           | source, connector            |
| **Agent**             | Software outside Heed that reads context over MCP. Never a person.                                                                                 | AI app, client               |
| **What agents get**   | The text an agent receives for an item or a question.                                                                                              | served, delivered            |

Words that no screen uses: fact (for an item), gap, flag, approver, auditor, steward, caveat, AI app, Users (write People), anonymous, "Based on checked context" and the other old answer labels (kept only as the long form).

## 16. Not in v1

- Email or chat notifications and digests. The Inbox is the only announcement.
- Several workspaces in one install, and translations into other languages.
- A public status page.
- Four Ask ideas that the mockup does not draw: What it doesn't say, Rule these out first, Keep watching this answer, and a Coverage map.
