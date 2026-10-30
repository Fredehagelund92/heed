# Context Layer: Requirements Specification

| | |
| --- | --- |
| Status | Draft 0.3 for review. A status column and the requirements of Heed v1 were added on 2026-10-25 |
| Date | 2026-10-14 |
| Product | Context Layer (working name) |
| Who reads it | Owners, managers, engineers, and anyone who wants to know what this product is for |

## Overview for non-technical readers

**What is it?** The Context Layer is a shared place for business context. AI (artificial intelligence) agents read it before they answer a question about company data. An AI agent is a program that uses a language model to answer questions and to use tools.

**What problem does it solve?** Company data shows numbers. It does not always show why a number looks strange. A market could have closed. A tool could have changed how it counts. People know these facts. The facts live in chats, documents and memories. AI agents cannot see them. So an agent can give a confident answer that misses the real reason.

**How does it work?**

1. Anyone in the company can propose a fact. A short form or a built-in assistant helps. The proposal says what happened, where it applies, from which date to which date, and how we know.
2. An owner reviews the proposal. An owner is a named person who owns the answers for one domain. Only accepted facts are used.
3. The system tests each change before it is accepted. It checks that the change does not make answers worse.
4. Agents ask the system for context before they answer. The system returns the facts that apply, with the source of each fact. It also says clearly when it found nothing. An item can mention a metric, a market, a domain or another item. A mention helps an agent find related items. It never changes which facts the system returns.
5. The system counts the questions that had no context. It never records who asked.

**Where does it run?** The first build runs on a local computer. It needs no cloud account of the company. It calls the language model provider directly. It takes people, groups and domains from Cube Core, the tool that holds the metric definitions. Running it for the whole organisation is a later stage, called the hosting stage.

**Main benefits:**

- Agents answer with the facts that people already know.
- Context lives in one place, not in many chats and files.
- People without technical skills can add context.
- The data platform team stays in control. Only accepted context is used, and every change is tested.
- The system shows where context is missing, without tracking people.
- The system reads the organisation's existing definitions. It does not copy them.

**Main risks:**

- Review needs steady time from owners. Without it, context becomes old or never arrives.
- Wrong context can mislead agents. Review, tests, review dates and a stop switch reduce this risk.
- Some agents might not ask for context. The system measures this and tells agents to ask.
- Outside standards are still changing. Connectors keep these changes away from the core system.

**What we need from the organisation:**

- At least one named owner for each domain; several may share it.
- An agreed review time, and a named person to approve high-risk context.
- A computer to run the first build on. People sign in, and get their groups, through Cube Core.
- A domain entry on each view in Cube, added by the data platform team.
- Later, at the hosting stage: a place to host the service for everyone.
- Read access to the tool that holds the metric definitions.
- A few hours from owners and experts to start each domain.

**Decisions needed.** Section 14 lists them with simple options. The main ones are these. Who proposes changes? Who reviews them? Which company supplies the language models? Do we test the form with three people first? Questions about hosting, such as reach from the internet, wait for the hosting stage.

## How to read this document

- Section 1 explains the product with an example. Section 2 explains the words.
- Sections 5 to 9 hold the numbered requirements. Section 10 describes the design. Section 11 is the plan.
- Section 14 lists open questions. Section 16 says where the facts of one deployment are kept. Section 17 gives the reasons for the main design choices.

**Requirement words.** *Must* means required. *Should* means recommended: skip it only with a written reason. *May* means optional. No other verbs state a requirement.

**Priority.** *First build* means the smallest complete system that a domain can start to use. It runs on a local computer and needs no cloud account of the company. *Hosting stage* means after the first build, when the service moves to a hosting platform for the whole organisation (section 11.7). *Later* means after the first build. The design of the first build leaves room for everything marked Later or Hosting stage.

**Numbers and tags.** Each requirement has an ID, which is a number that never changes. FR is a functional requirement: what the system does. NFR is a quality requirement. CON is a connector requirement. OSR is an open-source readiness requirement. A tag such as [OQ-1] points to an open question in section 14. The requirement is written for the recommended answer.

## Status of each requirement (Heed v1)

The approved Heed v1 mockup decides the product (see [the product page](product.md) and [the design contract](design/design-contract.md)). Each requirement table has a **Status** column that says how the requirement stands against the mockup. No id is renumbered or removed. A new id continues the range of its table.

| Status | Meaning |
| --- | --- |
| Kept | The requirement stands as written. |
| Changed | The requirement stands in intent, and the text below is amended to the mockup. Where the text still uses an earlier name (fact, proposal, Try a question, the assistant panel, the old tool ids), read it with the glossary of [the product page](product.md#15-the-glossary). The list below says what changes. |
| Withdrawn | The mockup does not have it. It is not built. |
| New | Added for the mockup. |

Where two requirements disagree, the changed one, the new one and the mockup win over the older text.

**Changed or withdrawn, and why.**

| Ids | Status | What changes |
| --- | --- | --- |
| FR-104, FR-105, FR-108, FR-119 | Changed | The properties list and the Tiptap document editor replace the six-question form, the live preview and the slash menu. What agents get is clamped, with Show all. |
| FR-106, FR-205, FR-207, FR-325 (the high-risk part), FR-511 to FR-515, FR-524 | Withdrawn or Changed | No risk levels on screen and no high-risk approver. Every item uses levels 1 to 3, and one accept by an owner or an admin publishes it. No answer test runs on a suggestion. A saved-question check never blocks Publish (FR-526). The clash gate (FR-225) is the one block besides a failed check. FR-106 and FR-207 are withdrawn. The rest are changed. |
| FR-114 | Changed | A person's waiting suggestions show under All in the Inbox, and as a line on the item, not on a status page. |
| FR-128, FR-136 | Changed | The Context list (design B) and Definitions replace the library browse and the catalogue page. |
| FR-133, FR-222 | Changed | Comments exist on suggestions and on context items. Anyone signed in can comment. Comments may mention people and carry five reactions. Agents never read comments. |
| FR-202, FR-206, FR-208, FR-209, FR-223 | Changed (FR-202 kept) | The Inbox is ordered by need. The review is a full-screen page. Owners publish their own context in one step (FR-137). "Publish the N you've read" replaces bulk decide. |
| FR-211 | Withdrawn | Claim and hand over. |
| FR-113, FR-115, FR-212, FR-221 | Withdrawn | Posts and reminders in a chat tool. The Inbox is the only announcement. |
| FR-215, FR-217 | Changed | Editions are shown in Settings, Advanced. |
| FR-302 to FR-306, FR-308, FR-309, FR-338, FR-341, FR-342, FR-344, FR-407 | Changed | Six tools: `get_context`, `find_context`, `read_context`, `report`, `suggest_context`, `get_related`. The earlier ids stay as aliases for one release. The default reply is short and carries the answer state. |
| FR-307, FR-339, FR-340, FR-348 | Withdrawn | `improve_question`, `domain_overview`, `what_changed` and `search_help` leave the tool list. |
| FR-121, FR-332 | Changed | `suggest_context` is on, with the scope granted at consent. After the person says yes, it sends the suggestion to the owner's review (it no longer only saves a draft); it never publishes. `get_related` is on, with its own switch ("Let agents follow links"), one step at a time. |
| FR-602, FR-603 | Changed | From agents, still no question text. Words a person sends on purpose (a suggestion, a named report, a saved question, a comment) are kept with their name. Ask chats stay in the person's browser. |
| FR-601 | Changed | A delivery record also keeps the answer state its reply gave and the kind of agent that called, so Observability can count them. |
| FR-612 | Changed | Weekly counts per domain, answer state and kind of agent are kept without limit, beyond the delivery period, for long-range trends. They hold no words and no person. |
| FR-604, FR-606 | Changed | Case 1 of FR-606 counts across a month edge. The month stays in the topic's key. |
| FR-615, FR-517 | Changed | The Observability pages and the domain page's health line replace the domain dashboard and the weekly scorecard to a chat tool. Alerts are Inbox cards. |
| FR-701 to FR-703, FR-707 to FR-710, FR-713 | Changed | Ask (a page and a dock), using the answer engine for the state line and sources and the model only for words. History, Share, Where and Asked this week. |
| FR-801, FR-804, FR-809, FR-812, FR-813, FR-814 | Changed | A domain is a document. Two roles, Admin and Member, with ownership on the domain. People have invites. Only an empty domain can be deleted, and the sandbox never. Limits are read-only on screen. |
| FR-803 | Withdrawn | Removed on 14 October 2026. |
| FR-610, FR-704 to FR-706, FR-711, FR-712, FR-714, FR-715 | Withdrawn | Removed on 30 October 2026 (P14c), with the in-app assistant (its chat, ratings, web lookup and help search) and the earlier web app's link from a gap to test questions. |
| Section 1.5, "It is not a data tool" | Changed | Heed stores no numbers. It reads one when asked, if an administrator switches figures on for an integration. |

**New.** FR-137 to FR-140 (owners publish, terms and synonyms, bulk actions, restore as a draft). FR-224 to FR-227 (the suggestion's body and its difference, the clash gate, read receipts, undo). FR-349 and FR-350 (six answer states, the overlap notice). FR-416 to FR-419 (sign-in, invites, the live line of Connect an agent, access keys). FR-526 (saved questions and the free check). FR-620 to FR-622 (observability, alerts, named reports). FR-716 and FR-717 (figures in Ask, Ask history). FR-815 to FR-818 (a domain as a document, the setup checklist, comments and reactions, the workspace's name). CON-611, CON-612 and CON-118 (content sources, the figures capability, Disconnect). NFR-087 (the golden specs).

The roles table in section 3 still shows the earlier roles (auditor, approver). Read it with FR-804 as changed: v1 has two roles, Admin and Member, and ownership belongs to the domain. The earlier role values stay in the data for history and receive no new grants.

## 1. About the product

### 1.1 The problem

AI agents now answer questions about company data. A good answer needs more than the numbers. It needs facts that are not in the data:

- A market closed on a known date.
- A tracking tool changed, so older numbers are not comparable.
- Data before a certain date is not reliable.
- A forecast model is only valid from a certain run.

Today these facts sit in chats, files and people's memories. An agent cannot read them. Business people also have no simple way to add them.

### 1.2 A worked example

*This example is invented. The country and the numbers are not real.*

A company sells outdoor gear in its own stores and online, in several markets. In August, orders in the market Norway fall by 70 percent compared with July.

**Without the Context Layer**, an agent answers:

> Orders in Norway fell 70 percent in August compared with July. This might come from weaker marketing or fewer new customers. I suggest checking the campaign budget.

The agent guessed. It did not know that a new customs rule stopped all online sales to Norway on 4 August.

**With the Context Layer**, the same question gives this answer:

> Orders in Norway fell 70 percent in August compared with July.
> A context note says that online sales to Norway stopped on 4 August 2026. The source is the link in the note.
> This might be related to the fall. The note does not prove the cause.
> To test it, compare Norway with other markets before and after 4 August.

How the note got there:

1. Maria works in the regulation team. She opens the short form. She types what happened, picks "Norway" and the start date 4 August, and pastes a link to the customs notice.
2. The system shows Maria a preview of what an agent will see. She submits.
3. The system tests the change. It finds three test questions that the note affects. It checks that agents answer better with the note than without it.
4. Jon is the owner for the domain. He sees the proposal, the differences and the test results. He accepts it.
5. The system saves a new numbered edition of all accepted context.
6. An analyst asks an agent about Norway orders. The agent asks the Context Layer first. It receives the note and answers as shown above.
7. A different analyst asks about orders in another market, Spain. The system finds no note that applies. It tells the agent so. It also tells the agent that finding nothing does not prove that no caveat exists. The system adds one to the count of questions without context for that topic. It does not record who asked.

### 1.3 Who uses it

| Person | What they do in a day |
| --- | --- |
| Contributor | Notices a fact that agents need to know. Writes it with the form or the assistant, or from a chat message. Follows the status of the proposal. |
| Analyst | Asks questions through an AI agent. Gets context with the answer. Gives feedback when context is wrong or missing. |
| Owner | Reviews proposals for one domain. Accepts, asks for changes or rejects. Checks flagged items. Reads the weekly test results and the list of missing context. |
| Engineer | Connects the system to other tools. Imports old notes in bulk. Runs and improves the service. |
| Administrator | Starts domains. Assigns roles. Sets limits. Uses the stop switch if something goes wrong. |
| AI agent | Asks for context before it answers. Reports missing context. It may write a draft for the person it acts for, who checks and submits it. It never changes context. |

### 1.4 What goes in and what comes out

**In:** proposals from people and the assistant; metric and dimension definitions read from connected tools; test questions from owners; feedback and reports of missing context from agents.

**Out:** context for agents, with the source of every fact and a clear note of what was checked. A review queue for owners. Weekly test results. Counts of questions without context. A history of every change.

### 1.5 What it is not

- It is not a store of metric definitions. Those stay in the tool that owns them. The Context Layer only points to them.
- It is not a data tool. It stores no data rows and runs no data queries of its own. (Amended 25 Oct 2026: when an administrator switches figures on for an integration, it reads one figure when someone asks in Ask and keeps it nowhere. See FR-716 and CON-612. Figures are off by default.)
- It is not a wiki or a document library.
- It is not a knowledge graph. An item can mention other things, but the system never infers a link between them.
- It is not a way to watch people. It does not record who asked what.
- It does not publish by itself. People accept every change.

### 1.6 How context moves

```text
 WRITE     A person or the assistant drafts an item and submits a proposal.
   |
   v
 REVIEW    An owner checks the proposal. The system tests the change.
   |       The owner accepts, asks for changes, or rejects.
   v
 PUBLISH   The system saves a new numbered edition of all accepted items.
   |
   v
 USE       An AI agent asks for context before it answers. It gets the items
   |       that apply, with their sources, and a note of what was checked.
   v
 LEARN     The system counts the questions that found no context.
   |       It does not record who asked.
   |
   +-----> People write the missing context, and the cycle starts again.
```

### 1.7 Goals and success measures

| Goal | How we measure it |
| --- | --- |
| Agents answer with the relevant documented facts and do not claim a cause that is not proven. | In each domain, we test with questions that the system has not seen before. At least 90 percent of required caveats appear (strict pass). At most 5 percent of answers claim an unproven cause. At least 80 percent of answers are acceptable. We report counts as well as percentages. |
| Every agent reaches the same context through one server. | MCP connection tests pass for each AI client family in use (MCP is explained in section 2). |
| Business people can contribute easily. | Five people outside the data platform team complete a valid proposal without help in the Phase 2 trial. After the third domain, at least 15 percent of accepted items come from outside the data platform team. |
| Only accepted context is served, and reviews are fast. | Zero accepted items without a recorded decision. Median review time is within the agreed time (recommended: two working days for low and normal risk). |
| Missing context becomes visible without tracking people. | Weekly counts of questions without context, by domain and topic. An automatic test proves that no record links a question to a person. The median time from a gap to an accepted fix is reported. |
| Items stay correct as source tools change. | An item past its review date is delivered as `unverified` and listed for its owner. Every source change flags the affected items within 24 hours. |
| The system is simple to run and to join. | A new engineer runs it on a laptop in 15 minutes. A new contributor submits a proposal in 15 minutes. |
| Agents ask for context. | Later: the weekly number of context requests next to the weekly number of data queries, as totals only. |

## 2. Words used in this document

### 2.1 Product terms

Terms are in alphabetical order. Each has one meaning only. The term is the word of this document, the code, the database and the API. *Name on screen* is what people read in the app, the help pages, the assistant and the MCP text people hear, from `src/domain/words-v1.ts` (glossary v2, for the new web app, is `src/domain/words.ts`) (decided 18 October 2026). "Not shown" means people never read the term.

| Term | Name on screen | Meaning | Example |
| --- | --- | --- | --- |
| Accept | Accept | An owner's decision that a proposal is correct and can be used. | Jon accepts Maria's proposal. |
| Agent | agent | A program that uses a language model to answer questions and to use tools. | A chat assistant that answers data questions. |
| Area | Domain | The name the code, the database and the API keep for a domain, such as `areaId`, `area_id` and `/areas`. People read Domain (decided 18 October 2026). | `area_sales` is the id of the domain Sales. |
| Assistant | Assistant | The helper built into this system. It helps people write, understand and improve items. | It turns a pasted paragraph into a draft. |
| Audience | Who can see it | Who can receive an item: everyone, or named groups. | An item for the finance group only. |
| Backlink | Not shown | A link seen from its target: an item that mentions the target. | The metric Orders has a backlink from the note about the stop on online sales. |
| Baseline | Not shown | The reference result that new results are compared with. | The results of the live edition. |
| Candidate edition | What agents will get | An edition that is not live yet and is being tested. | The edition that would exist if a proposal were accepted. |
| Caveat | Fact | A warning about how to read a number. | "Data before June is not reliable." |
| Catalogue | Catalogue | The pages that list every metric and dimension of the vocabulary, with a copy of the description from the source tool and what the library holds about each (FR-136). It shows definitions; it does not store them. | The page for Orders shows its description from Cube and the 92 items about it. |
| Change mark | Not shown | A short code computed from a definition. If the definition changes, the code changes. | The mark for "revenue" changes when its calculation changes. |
| Check report | Not shown | The part of every reply that says what the system looked at and what it found, including when it found nothing. | "No item matched. This does not prove that no caveat exists." |
| Claim level | Cause, as in "Cause: not proven" | How strong the claim of an item is. `fact_only` means a fact is documented and a cause is not proven. `effect_stated` means a named authority states the effect. | "Online sales to Norway stopped on 4 August" is `fact_only`. |
| Connector | Connector | A small add-on that connects the system to one outside tool. It only reads. | A connector that reads metric definitions from a semantic layer. |
| Context item (item) | Fact | One piece of context. It has a kind, a scope, dates, evidence, an owner and a risk level. | The note about the stop on online sales to Norway. |
| Cube Core | Cube | The open-source version of Cube, the semantic layer of the organisation (section 7). The first build takes identity, groups and domains from it. | The tool that defines "orders" and lists who may see it. |
| Data platform team | Data team | The team that owns the data tools of the organisation and the answers to data questions. | The team that runs the warehouse and the semantic layer. |
| Delivery | What agents get | One time that the system sends items to an agent. | The reply to one `get_facts` call. |
| Digest | Not on contributor screens | A short code made from content. It changes when the content changes. | The digest of an edition. |
| Dimension | The dimension's own name, such as market; Dimension in the Catalogue and Administration only | A way to split or filter a number. | Market, month or brand. |
| Dimension value | The value's own name, such as Norway | One choice of a dimension. | The market "Norway". |
| Domain | Domain | A part of the company with its own data and owners. Cube calls it a domain too. Its owner writes what it is and what kind of data it holds: a summary line and a description. Every domain that exists is served. | Finance, or paid advertising. |
| Domain map | Not shown | The list that links each metric to a domain. | Revenue belongs to Finance. |
| Draft | Draft | A proposal that the writer has not submitted yet. | Maria's text before she presses submit. |
| Edition | Edition, on the Editions page and the review stamp; elsewhere what agents get today | The complete set of accepted items, saved at one moment, with a number. It never changes after it is saved. | Edition 2026-10-07.3. |
| Evidence | Where this comes from | A link and a short quote that support an item. It is never a copy of the source. | A link to the customs notice and one sentence from it. |
| Flip | The answer got worse (or better) | A test result that changes between two runs, from pass to fail or from fail to pass. | A question passes with the live edition and fails with the candidate. |
| Gap | Gap | A topic where people asked questions and the system had no context to give. | Many questions about Spain orders found no item. |
| Held-out test question | Hidden test question | A test question that writers and the assistant never see. It checks real quality. | One third of the test set of a domain. |
| Hosting stage | Not shown | The stage after the first build, when the service moves from a local run to a hosting platform for the whole organisation. | Choosing the cloud accounts, the region and the network rules. |
| Impact set | The test questions it could change | The test questions and topics that a change can affect. | Three test questions about Norway. |
| Kind | Kind | The type of an item. A *note* is a lasting remark. An *event* is something that happened in a period. A *guide* tells how to investigate a question. An *example* is a checked question with a correct answer. An *issue* is a temporary problem with the data (section 4.4). | "Online sales to Norway stopped on 4 August" is an event. "Partner reporting was down from 3 to 14 August" is an issue. |
| Link | Link | A connection between an item and another thing: a mention, the scope, a replaced item or a conflict. | The note about the stop on online sales mentions the metric Orders. |
| Matcher | Not shown | The part of the system that chooses which items apply to a question. | It selects the Norway note for a question about Norway. |
| MCP | MCP, with "the connection AI agents use" | Model Context Protocol. A common standard that lets AI agents call tools on a server. | An agent calls the tool `get_facts`. |
| Mention | Mention | A link written with @ inside the summary or the body of an item. It points to a metric, dimension, dimension value, item or domain. It helps an agent find related items. It is not scope and not access. | "Online sales stopped in @Norway." |
| Metric | Metric | A number that the organisation measures. | Revenue, or orders. |
| Neighbour | Not shown | The thing at the other end of a link. | The metric Orders is a neighbour of the note that mentions it. |
| Owner | Owner | A named person who reviews and accepts items for one domain. A domain may have several owners, and an owner may look after several domains. Until 20 October 2026 the code, the database and the API called this person the steward. | Jon. |
| Preview | What agents will get | A view of what an agent would receive if a proposal were accepted. Only some people can see it. | Maria sees the preview before she submits. |
| Proposal | Proposal | A request to add, change or retire an item. | A draft that Maria has submitted. |
| Reference | Not on contributor screens | A stable name for a metric or dimension in another tool. A vocabulary term holds the reference. A mention names the term, not the reference. | `semlayer:orders.total_orders` |
| Replay | Not shown | To run stored delivery records again against a new edition to see what would change. | 1,000 stored records are replayed and 12 give different items. |
| Retire | Archive | To remove an item from service. The item and its history stay in the system. | The stop ends, so an owner retires the note. |
| Review date | Check date, as in "Check again by 31 January 2027" | The date by which an owner checks an item again. | 90 days after acceptance. |
| Risk level | Risk | `low`, `normal` or `high`. It sets how much approval and testing a change needs. High means legal, regulatory, financial-reporting or restricted content. | A new customs rule is high. |
| Rubric | What a right answer says | A short rule for scoring an answer. | "The answer names the date the stop began." |
| Scope | Where it applies | What an item is about: metrics, dimension values, and dimensions with any value. Only scope decides which items match a question. | Orders in the market Norway. Orders for any market, shown as "market: any value". |
| Semantic layer | Cube, by its own name | A tool that holds the official definitions of metrics and dimensions. | The tool that defines "orders". |
| Source details | Source details | The facts that travel with every delivered item: id, version, edition, evidence, owner, dates and risk. | Shown next to the Norway note. |
| Source tool | The tool's own name, such as Cube | The outside tool that owns a definition, a document or a message. | The semantic layer. |
| Stop switch | Stop | An action that removes one item, one domain or all delivery at once. | An administrator stops delivery for a domain. |
| Strict pass | Not shown | A test passes only if all its tries pass. | Three tries, three passes. |
| Target | Not shown | The thing that a mention or a link points at. | The market Norway. |
| Test question | Test question | A question with a known good answer. It checks that a change does not make answers worse. | "How did orders in Norway change in August?" |
| Topic | Topic | What a count is about: domain, metric, dimension values, dimensions named without a value, and month. | Orders, Spain, August 2026. |
| Validity | When it applies | The dates when an item applies: a start date and an optional end date. | From 4 August 2026, no end. |
| Version (of an item) | Version | One saved state of an item. A new change creates a new version. Old versions never change. | Version 2 of the Norway note. |
| Vocabulary | Names: the metric, the market, by its own name | The governed list of metrics, dimensions, metric groups and dimension values, with their other names. | "Norge" is another name for "Norway". |
| What not to conclude | What not to conclude | An optional line on an item: what someone might wrongly conclude from it, or who to check with first. Agents get it with the item (FR-104). | "Lower orders in Norway after 4 August do not mean fewer customers." |
| Window | The dates | The period that a question is about. | 1 July to 31 August 2026. |

### 2.2 Technical terms

| Term | Meaning |
| --- | --- |
| API | A way for programs to talk to each other. REST is one common style of API. |
| Container | A package that holds a program and everything it needs to run. |
| Git | A tool that stores files and the history of every change. |
| HTTPS | A secure way to send web traffic. |
| JSON, YAML | Two plain text formats for structured data. |
| JSON Schema | A file that describes what valid JSON looks like. |
| Load balancer | A server that shares incoming requests between several copies of a service. |
| Markdown | A plain text format with simple marks for headings, lists and links. |
| MCP App | A small screen that an MCP server can show inside the window of an AI client. |
| OAuth, OpenID Connect | Standards for signing in and for giving a program limited access. |
| PKCE | A check that stops a stolen sign-in code from being used by someone else. |
| PostgreSQL | A widely used open-source database. |
| Prompt injection | Text that tries to give hidden orders to a language model. |
| SDK | A set of code that helps people build programs for one tool. |
| SQL | The language used to ask a database for data. |
| Tag | A name for one point in the history of a Git repository. |
| TLS | The standard that protects traffic on the internet. |
| Token | A small piece of data that proves who is calling. |
| UTC | The world time standard. |
| WCAG | A standard for web pages that people with disabilities can use. Level AA is the middle level of three. |

## 3. People and permissions

Each person can have several roles. Every signed-in person is a contributor and an analyst. An administrator assigns the other roles (FR-804).

Two named jobs sit on top of the roles. A **high-risk approver** is a named person who gives the second approval for high-risk items (OQ-3). An **auditor** can read the history log.

| Action | Contributor and analyst | Owner (own domain) | AI agent | Engineer | Administrator |
| --- | --- | --- | --- | --- | --- |
| Read accepted context | Yes | Yes | Yes, as the person it acts for | Yes | Yes |
| Create, submit, comment, withdraw or discard own proposal | Yes | Yes | Create a draft only, for the person it acts for (FR-121). Never submit, comment, withdraw or discard | Yes, by interface or tool | Yes |
| See a preview | Own proposals | Own domain | No | Own proposals | Yes |
| Report missing context, give feedback | Yes | Yes | Yes | Yes | Yes |
| Accept, ask for changes, reject | No | Yes, own proposals too | No | No | Yes, in every domain, own proposals too |
| Retire an item | No | Yes | No | No | Yes |
| Manage test questions | No | Yes | No | Propose only | Yes |
| Write what a domain is (its summary and description, FR-813) | No | Own domain | No | No | Yes |
| Assign roles, use stop switch, go back to an earlier edition, set limits | No | No | No | No | Yes |
| Read the history log | No | No | No | No | Yes (an auditor can only read) |
| Read the text of a question | Nobody. It is not stored (FR-602). | | | | |

## 4. What the system stores

### 4.1 Main records

| Record | What it holds |
| --- | --- |
| Domain | Name, owner team, chat channel, summary, description, owners, approvers, review time. |
| Item | A stable id, a kind, a domain, and its versions. |
| Item version | Title, summary (at most 280 characters), optional body, mentions, references, scope, validity, review date, evidence, claim level, risk level, audience, owner, change marks, how it was created. It never changes. |
| Proposal | One item version, the proposer, the target domain, a state, a due date and check results. Retiring an item is also a proposal. |
| Decision | Who decided and in what capacity (owner, approver or administrator), the outcome, a reason and the exact item version. |
| Edition | A number, a digest, and all accepted item versions, the vocabulary and the domain map. Editions sealed before 14 October 2026 also hold the domain states of that time. It never changes. |
| Test question | Domain, wordings, scope, expected items, rubrics, risk level, status. |
| Test run | What was tested, the result of each try, and the cost. |
| Delivery record | One anonymous record of one `get_facts` call: scope, edition, items, status. No person. |
| Gap | Topic, type, weekly counts, status, notes, linked test questions and whether a test verified it. No person. |
| History entry | Who did what and when. It is never changed or deleted. |

### 4.2 Proposal states

| From | Action | To | Who |
| --- | --- | --- | --- |
| `draft` | Submit | `submitted` | Proposer |
| `submitted` | Claim | `in_review` | Owner |
| `submitted` or `in_review` | Accept | `accepted` (all needed approvals recorded) | Owner |
| `submitted` or `in_review` | Ask for changes | `changes_requested` | Owner |
| `submitted` or `in_review` | Reject | `rejected` (a new draft can start from it) | Owner |
| `changes_requested` | Resubmit | `submitted` | Proposer |
| `submitted`, `in_review` or `changes_requested` | Withdraw | `withdrawn` | Proposer |
| `draft` | Discard | Closed for good: no longer listed or readable, history kept | Proposer or administrator |

An accepted version enters the next edition. An item leaves service when an owner retires it, or when someone uses the stop switch for it, its domain or all delivery. An item stops applying by itself when its end date passes. An item past its review date is still delivered, with the label `unverified`.

A domain has no state. Its accepted items are delivered as soon as they are accepted, and its gaps reach its owner (FR-320, FR-802). Only the stop switch holds them back for a while (FR-805).

### 4.3 Two separate ideas

**Acceptance** says whether an owner has approved an item version. **Validity** says whether the item applies to the dates of a question. An item can be accepted and not yet valid. It can also be valid and past its review date.

### 4.4 Standing facts and temporary issues

A standing fact starts on a date and has no end. "Online sales to Norway stopped on 4 August" is an event with no end date, and it applies to every later question. A temporary issue is an item of the kind *issue*. It has a start date and may have an end date, for example a partner whose reporting is down for twelve days and then comes back. While it lasts, an issue is a live warning. Once it has ended, it is history: it is still delivered for questions about its own period, because the data of those days is not reliable, and it is silent for questions about later dates. Both use the same validity and the same matching rule (Appendix A, rows I01 to I07). An issue with no end date is checked again soon (FR-135).

## 5. Functional requirements

Each section has its own table. Priority is *First build* or *Later*.

### 5.1 Contribute

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| FR-101 | The system must have one write interface. Every channel must use it: web form, assistant, chat tool, command-line tool and import. | First build | Kept |
| FR-102 | Any signed-in person must be able to create a draft, submit it, comment on it and withdraw it. | First build | Kept |
| FR-103 | A proposal must record who proposed it, how it was created (`form`, `assistant`, `chat`, `command_line`, `mcp` or `import`), the domain, and the item version it holds. | First build | Kept |
| FR-104 | The web form must ask for six things only. The first three are what happened, where it applies, and the dates (a start date, and an end date or "no end"). The last three are how we know (a link), who should confirm, and what not to conclude. The default for who should confirm is the owner of the domain. What not to conclude is optional and starts empty; left empty, the system stores the default "cause not proven" and gives agents no line, because the claim level already says it. The form must say in plain sight, next to the field, that agents get the line with the item and are told not to draw that conclusion. The item page must show the line to readers. The text of "what happened" may hold mentions (FR-129). (Amended 18 Oct 2026: "what not to conclude" replaces "what this does not mean"; optional, empty by default, and shown on the item page.) | First build | Changed |
| FR-105 | The system must fill every other field with a default or a derived value. An owner must be able to change these values during review. | First build | Changed |
| FR-106 | The default risk level must follow the kind: low for a note, normal for other kinds. An owner must be able to raise it to high, and then the checks must run again. | First build | Withdrawn |
| FR-107 | The "where it applies" pickers must offer only metrics, metric groups, dimensions and dimension values from the vocabulary. They must treat other names for a value as the same value. A dimension can be picked on its own, as "any value". The picker must search on the server and never load every value of a large dimension: it stays empty until the person types, shows a page of results grouped by dimension with a count, and puts recent and often-used choices first. | First build | Kept |
| FR-108 | The form must show a live preview named "What an agent will see". The preview must use the same code as the reply to an agent. It must also show the links of the item (FR-331). Under what not to conclude (FR-104), a card named "What an agent gets" must follow the line as it is typed, before the draft is saved, and show on request the field as the app receives it. (Amended 18 Oct 2026: the card.) | First build | Changed |
| FR-109 | Before submit, the form must list the accepted items and the person's own open proposals that overlap the draft. For other people's open proposals it must show only that one exists, never its content. | First build | Kept |
| FR-110 | The system must save drafts automatically. A draft must survive when the person closes the browser. | First build | Kept |
| FR-111 | Every accepted item must have a "Suggest a change" action. It must open the form with the current version, show the differences, and create a new proposal. The system must never change an accepted version in place. | First build | Kept |
| FR-112 | A person must be able to propose that an item is retired, with a reason. | First build | Kept |
| FR-113 | The chat connector must give people a message action "Add to context". It must create a draft with the link and the quote of the message and send it to the chat channel of the domain. | First build | Withdrawn |
| FR-114 | Each person must have a status page. It must list their proposals with a timeline of submit, check results, comments and decision. The person must be able to reply to comments there. | First build | Changed |
| FR-115 | The system must tell the proposer in the chat tool when a decision is made or a reviewer comments. | First build | Withdrawn |
| FR-116 | The system must store evidence as a link, a short quote and a date. It must never store a copy of the source document. | First build | Kept |
| FR-117 | The system must reject text that looks like a password, a key or personal data. It must name the pattern that it found. | First build | Kept |
| FR-118 | A summary must have at most 280 characters. A body is optional and must stay below a set maximum. A mention counts as its visible words only. | First build | Kept |
| FR-119 | People must be able to write item text in one editor for every kind, in which the summary and the body are two parts of one document and a small safe Markdown subset renders while they type: headings 2 and 3, bulleted and numbered lists of one level, quotes, code, bold, italic and links. The editor may offer exactly Markdown shortcuts, a slash menu and a selection toolbar, each within that subset, and nothing else: no images, tables, raw HTML or nested lists. The stored body stays plain Markdown in that subset. Mentions appear as chips in the summary and the body. Pasted text is read as Markdown in the subset; anything outside it stays the typed text. | First build | Changed |
| FR-120 | Engineers and coding agents must be able to create drafts through the same interface with a command-line tool. The tool must support bulk import with a dry run. An import must create proposals only. [OQ-1] | First build | Kept |
| FR-121 | The system must offer an MCP tool, `suggest_context`, with which an AI agent sends a suggestion for the signed-in person it acts for, only after the person says yes. Only a person's token with the propose scope may call it; a token that names no person is refused. The propose scope is granted at consent, and the consent page names it. The tool saves the suggestion as the person's draft and sends it for review through the same path as the person's own Send for review (FR-122), so it waits for the owner of its domain; if the review checks refuse it, it stays the person's draft and the reply says why. It must never accept or publish: only the owner does. It must fill itself only the values it can derive exactly and the documented defaults, and take every other value from the agent as a suggestion that the owner checks. It must never raise the risk level, choose an audience, an owner, a stated effect, replacements, conflicts or mentions. It must record where each field came from on the suggestion and keep it through review. Showing it on the draft and on the review screen, as a mark beside each field, is deferred to a later version. It must list overlapping items before it saves. It must call no language model. It records the person on the proposal only, never in an MCP record or log (FR-410). It is on by default, with its own switch an administrator can turn off (FR-407), and it must limit the suggestions of each person per day (FR-809). When the person's AI client can show forms (MCP elicitation), it should ask its open questions there before it saves, in a request state bound to the tool, the person, the client and the call that expires and is used once; the answers are marked as confirmed by the person. A client that cannot show forms gets the link and the questions. The earlier id, `draft_context`, stays for one release and keeps what it did: it saves a draft and never sends it. [OQ-1] | First build | Changed |
| FR-122 | Each item version must record the human proposer. If an agent or the assistant wrote the draft, the person who submits it is the proposer. | First build | Kept |
| FR-123 | The system must choose the domain from the references of the item. If it cannot, it must ask the contributor. An owner must be able to move a proposal to another domain. | First build | Kept |
| FR-124 | The system must publish a JSON Schema of the item format. The same definition must create the schema and check items. The format must include mentions. | First build | Kept |
| FR-125 | Changes to the vocabulary must use the same draft, review and edition path as items. | First build | Kept |
| FR-126 | An item must name at least one metric, one dimension value, or one dimension with any value. A dimension with any value is shown as "dimension: any value", for example "market: any value", and it may not also list values of the same dimension. A mention does not count as scope (FR-131). | First build | Kept |
| FR-127 | An event must have a start date. An item with no end date must have a review date. The default review date is 90 days after acceptance, except for an issue (FR-135). | First build | Kept |
| FR-128 | The web interface must let any signed-in person browse and search accepted items by domain, kind, metric, dimension and dimension value. It must also filter by what mentions a metric, value, domain or item, and list what links to an item. It must apply the same audience rule as delivery. | First build | Changed |
| FR-129 | Typing @ in the summary or the body must open one list of what can be mentioned. It holds metrics, dimensions and dimension values from the vocabulary, other accepted items, and domains. The list must group choices by type, work with the keyboard alone, and treat other names as in FR-107. If a Cube metric or dimension is missing from the vocabulary, the list should offer a one-step request to an owner. A mention must show as an inline chip from the badge family with the look of what it points at (design contract 6.13, "The @ mention chip"). | First build | Kept |
| FR-130 | The system must store a mention as a typed link. The link must hold the id of its target and the words as the author wrote them. The target must be a vocabulary key, an item id or a domain id, never a name taken from a source tool. The database must refuse a version whose text and links disagree. A mention is part of its version and never changes in place (FR-111). | First build | Kept |
| FR-131 | A mention is not scope and not access. It must never change the audience or the domain of an item. In the first build it must not change matching either. [OQ-17] | First build | Kept |
| FR-132 | The system must refuse a new mention of a target that does not exist. It must also refuse a retired item, a term whose definition is missing, and the item itself. | First build | Kept |
| FR-133 | A mention may appear only in the summary and the body. It must not appear in the title, the evidence quote, the notes or the comments. | First build | Changed |
| FR-134 | A version must have at most 50 mentions. The limit is a setting (FR-809). | First build | Kept |
| FR-135 | When an issue has no end date and no review date is given, its review date must be its start date plus a set number of days. The number is a setting (FR-809), 14 by default. At that date the owner is asked "Is this still going on?". An issue with an end date gets no default review date, because it stops applying by itself. The review date defaults of the other kinds do not change. | First build | Kept |
| FR-136 | The web interface must have a catalogue of metrics and dimensions next to the context library, so that anyone signed in can see what the organisation has. It must list every metric and dimension of the live vocabulary, grouped by domain, with its name, its other names and the short description that the definition source gives, shown as a copy with the date it was read (CON-207). It must say when a definition changed in the source or disappeared from it. The domain of a term is the domain the vocabulary gives it, otherwise the domain the source gives, otherwise none. For each term it must also show what the library holds: the accepted items by kind, the items that need a look, the issues that still apply, the open gaps and the items that mention it. A dimension must also list its values with their other names. The catalogue must never show a calculation; it links to the model file in the source instead. It must apply the same audience rule as the library, and must not show a term whose definition the person's groups cannot see (CON-509). A metric or dimension chip in an item must open the page of that term. Any signed-in person must be able to suggest a missing term, as a vocabulary proposal (FR-125). | First build | Changed |
| FR-137 | An owner of a domain must be able to publish their own context item in one step from the editor, saying in the editor how it relates to the live context it clashes with (FR-225). Anyone else sends it as a suggestion to the owner of the domain. | First build | New |
| FR-138 | The system must support terms: a word with its own meaning, written in the workspace, and synonyms, which are other names for a metric or a dimension ("Another name for"). One word must have one meaning across the workspace. A word that already means something else must be refused, naming who has it. | First build | New |
| FR-139 | A person must be able to act on many rows at once from one bar, with per-row skip reasons for what they may not change, a partial-failure message with Retry, and Undo. Only drafts may be deleted. A published item is archived. | First build | New |
| FR-140 | An owner or an administrator must be able to restore an earlier version of a context item as a draft. The restore never changes the live version. | First build | New |

### 5.2 Review and accept

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| FR-201 | A proposal must follow the moves in section 4.2 and no others. | First build | Kept |
| FR-202 | Only an owner of the domain or an administrator may accept, ask for changes or reject; any of its owners may, and an administrator may in every domain, as administrator. Until 16 October 2026 an administrator decided only if also named owner of that domain. | First build | Kept |
| FR-203 | Every decision must record who decided, when, a reason of at most 500 characters, and the exact item version. | First build | Kept |
| FR-204 | An accept must apply to one item version only. A new version needs a new decision. | First build | Kept |
| FR-205 | The database must refuse an accepted version that has no accept decision by an owner of the domain or an administrator. It must refuse a version without a passing result of each required check, levels 1 to 3 (FR-513). The rule is the same at every risk level, and it must hold for every code path, including administrator tools and data migrations. Until Heed v1 a high-risk version also needed the named approver's accept. | First build | Changed |
| FR-206 | An administrator may decide any proposal, also their own, and an owner of the domain may decide their own proposals there, at every risk level and only when every required check passes. Anyone else never decides their own proposal, and an approver decides nothing (FR-207 is withdrawn). The proposal's timeline and the history log must say plainly that its proposer decided. One accept publishes a version, at every risk level; one person gives one accept to a version. An accept given before Heed v1 that waited for the approver publishes once the person who gave it accepts again. Until 16 October 2026 the proposer and the accepting owner had to differ for normal and high risk. [OQ-3] | First build | Changed |
| FR-207 | A high-risk proposal must also be accepted by a named high-risk approver of the domain. [OQ-3] Withdrawn for Heed v1: one accept by an owner or an administrator publishes at every risk level. The approver role and the approver's earlier accepts stay in the data as history. | First build | Withdrawn |
| FR-208 | The review queue must list proposals per domain, ordered by risk level and then age, and show the time left. | First build | Changed |
| FR-209 | The review screen must show the differences field by field, the check results, the effect on test questions, duplicates and conflicts, and the evidence quote. It must also show the mentions added and removed. It must warn the owner when a mention points at something that fewer people can see. The warning must never block a decision. | First build | Changed |
| FR-210 | The review screen must ask: "Does this change a definition or the way agents choose data? That belongs in the source tool." An owner must be able to reject with that reason. | First build | Kept |
| FR-211 | An owner must be able to claim a proposal and hand it to another owner of the domain. | First build | Withdrawn |
| FR-212 | Each proposal must get a due date from the review time of its domain. The system must remind the chat channel of the domain at the due date, and then every owner of the domain. [OQ-3] | First build | Withdrawn |
| FR-213 | The system should withdraw a proposal that stays undecided for 28 days, with the reason "expired", and tell the proposer. [OQ-3] | Later | Kept |
| FR-214 | The proposer, the owners of the domain, administrators and test runs must be able to ask for a preview of a proposal. No other person may receive content that is not accepted. | First build | Kept |
| FR-215 | Each accepted proposal, retirement, vocabulary change and change in the domain map must create a new edition. The edition number must have the form `YYYY-MM-DD.N`. The live edition must move to the new one in one step. | First build | Changed |
| FR-216 | The system should offer a trial edition that chosen clients can use before it becomes live. | Later | Kept |
| FR-217 | An administrator must be able to go back to any earlier edition in one action. The history log must record it. | First build | Changed |
| FR-218 | An owner or administrator must be able to retire an item at once, with a reason and without review. This must create a new edition. | First build | Kept |
| FR-219 | A proposal may name the items it replaces. When it is accepted, the system must retire them in the same edition and name the new item in replies. | First build | Kept |
| FR-220 | An item may say that it conflicts with another item. The matcher must then deliver both with a conflict flag and must never choose a winner. A conflict is resolved only with a quoted written authority. | First build | Kept |
| FR-221 | The system must post a message in the chat channel of the domain when a proposal is submitted. | First build | Withdrawn |
| FR-222 | Each proposal must have a discussion: comments from its proposer and its reviewers (the owners and approvers of its domain, and administrators for a term), whatever it changes, in a small Markdown subset without headings or mentions, each with its writer, their part in the review and the time. Only those people may read the comments, also after the proposal is accepted. A request for changes may carry a comment beside its reason. Each comment must be in the history log and must tell the proposer, or the reviewers, in the app. | First build | Changed |
| FR-223 | A reviewer must be able to select several proposals in the review queue and accept, ask for changes, reject or assign them in one step, with one reason for all. Each selected proposal must still get its own decision, its own checks and every rule of FR-202 to FR-207; the step must leave out, and name, each proposal it may not decide that way, such as one with a failed required check or one the reviewer proposed and may not decide (FR-206). Before the step the screen must say what will happen to each, and accepted proposals must be published in as few editions as the rules allow, one when they allow it. | First build | Changed |
| FR-224 | A suggestion must carry its body. The review must show a deterministic difference of the parsed document by change kind: Wording, Formatting, Link, Order, Added, Removed and Dates. No language model decides a difference. | First build | New |
| FR-225 | A suggestion that clashes with live context must not be publishable until the owner records how the two relate: replaces, disagrees with, or unrelated. An edit whose difference is only formatting, only order or only a change of dates is no clash. | First build | New |
| FR-226 | The review must record which suggestions the owner has read. "Publish the N you've read" must publish only plain changes that were read, and must list the changes that need their own look and are left out. | First build | New |
| FR-227 | A person who made a decision must be able to undo it within a short window. The undo is written as a new edition and a history entry, and restores exactly what the decision changed. | First build | New |

### 5.3 Editions and delivery to agents

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| FR-301 | The system must offer one MCP server over HTTPS with no server-side session. It must follow the current MCP specification (version 2026-07-28 at the time of writing) and should also serve clients of the previous version (2025-11-25). | First build | Kept |
| FR-302 | The tool `get_facts` must accept the question text. It must also accept optional structured scope (metrics, dimension filters, dates) and an optional size limit. A dimension filter with no values names the dimension without choosing a value. | First build | Changed |
| FR-303 | `get_facts` must return the matching items, the scope it used, the edition number, the check report and instructions for the agent. Each item must carry its links (FR-331). For a question about what a metric means, it must first give each asked metric's definition as `find_facts` does (FR-338): the source's words, where they come from, and what the system adds. | First build | Changed |
| FR-304 | If the scope is unclear or a dimension value is unknown, `get_facts` must answer `need_more_detail` and list the options. It must not guess. A question that names a metric, a dimension value or a dimension has a scope. The dates in a question's words are read by one reader, which `find_facts`, `report_gap`, `improve_question`, Try it and the assistant's turn context share: a day, a range of days with or without a year ("1 Jan to 30 Sep", "from March to May 2026"), a month, a quarter ("Q1 2026"), a bare year ("in 2026"), the periods named from today (this or last week, month, quarter or year, and year to date) and the days back to today ("the last 30 days", "this past week"), counted in UTC days (NFR-048). A named period is the whole period, a "this" period runs to today, a "last" period is the last complete one, and a day, month or quarter without a year is the latest one that has started. The reply must say how it read them: as the days, what they are and the time zone in `dates_read` ("1 Jan to 7 Oct 2026 (this year so far; UTC)"), and as the days and what they are in `say` ("from 1 January to 7 October 2026 (this year so far)", FR-344). A question that gives no dates is not unclear: it is read at today, a UTC day (NFR-048), and the reply must say so, never silently: in `assumed_date` (the day, its time zone and the reason, with a sentence the agent repeats, such as "I assumed today, 14 October 2026. Tell me if you meant a different period.") and in the check report. Dates the caller gave, read or not, are never replaced by today: words the system cannot read as one period ("since the launch", two periods) get `need_more_detail`, which names the words and what the system reads. `improve_question` still names missing dates (FR-307). | First build | Changed |
| FR-305 | The tool `search_facts` must return titles, summaries, kinds, owners and ids, without item bodies. It must accept a filter for the items that mention a given target, and give the number of links of each result. | First build | Changed |
| FR-306 | The tool `read_item` must return one item by id. It may also return the item as it was in an earlier edition. It must return all links of the item and the first page of its backlinks, as of that edition. | First build | Changed |
| FR-307 | The tool `improve_question` must not use a language model. It must return what is missing from the question (dates, definition, comparison, market). It must also return the events that overlap the question and the guides that apply. | First build | Withdrawn |
| FR-308 | The tool `report_gap` must add one to the count of the gap for the topic of the given scope. It must not record a person. | First build | Changed |
| FR-309 | The tool `give_feedback` must record a verdict and an optional short note for one reply. It must not record a person. | First build | Changed |
| FR-310 | The system must mark read tools as read-only and safe to repeat. It must mark `report_gap` and `give_feedback` as not destructive. | First build | Kept |
| FR-311 | Tool descriptions must tell the agent to call `get_facts` before it answers a data question. | First build | Kept |
| FR-312 | The system must offer no tool that accepts, publishes, edits, deletes or changes roles or policy. | First build | Kept |
| FR-313 | The reading path must not call a language model. | First build | Kept |
| FR-314 | One visibility rule must decide what is delivered. An item is delivered only if four things are true. It is in the live edition. The audience rule allows the caller. Its validity overlaps the dates of the question. It is not retired. A preview adds the proposal for people who can see it. The same rule must apply to the target of every link. | First build | Kept |
| FR-315 | The matcher must use only its inputs: the edition, the scope, the dates, the audience and the size limit. It must have no side effects. | First build | Kept |
| FR-316 | An item must match a question when all three rules are true. Rule 1: its metrics overlap the metrics of the question, directly or through a metric group. A question about a metric group asks about every metric in it. Rule 2: its dimension values overlap the filters of the question, and the question names every dimension that the item scopes with any value, by the dimension or by one of its values. Rule 3: its validity overlaps the dates of the question. Validity overlaps when the item starts on or before the last day of the question. The item must also have no end date, or end after the first day of the question. In the first build, mentions take no part in matching. | First build | Kept |
| FR-317 | A dimension without a filter covers all values. An item about one value must still match, with a note such as "applies to market Norway only". It must rank below an exact match. | First build | Kept |
| FR-318 | Every reply must have a check report. The report must give a status: `matched`, `conflict`, `no_match`, `need_more_detail` or `check_failed`. It must give the number of items matched and withheld, the number of links withheld, what was checked, and whether the reply was cut. It must also say: "No match does not prove that no caveat exists." | First build | Kept |
| FR-319 | If a check cannot run, the system must answer `check_failed`. It must never report this as `no_match`. | First build | Kept |
| FR-320 | The accepted items of every domain that exists must be delivered to everyone the audience rule allows. No state of a domain holds them back; only the stop switch does (FR-805). When the metrics of a question belong to a domain, the reply must name that domain with its summary and description (FR-813); a concise reply (FR-342) names it only. | First build | Kept |
| FR-321 | A reply must never exceed the size limit. The system must list the items that it left out, by id, with `cut: true`. It must remove items in a fixed order: partial matches first, then lower risk, then older start date, then item id. Items past the item limit (`max_items`) go first, so they never cost the delivered items their links. Then the descriptions of the domains the reply names (FR-813), whose summary lines stay. Before it removes any other item, it must cut links to 5 per item, then to the links that name where an asked metric is defined, and then remove them. | First build | Kept |
| FR-322 | The instructions in a reply must be written by the system. Contributors must not be able to change them. When a reply holds links, the instructions must say what a link is and how to follow it. | First build | Kept |
| FR-323 | The instructions must apply the cause rule. State the documented fact with its source and dates. Say "might be related" only if an event overlaps the dates and the metric is in scope, and then add that the context does not prove a cause. Never say "caused by" unless the claim level is `effect_stated`. Suggest a check that would test the effect. A link shows what a text refers to. It never proves a cause and never shows that an item applies. | First build | Kept |
| FR-324 | Only an owner may set the claim level `effect_stated`. It must need a named authority and a quote. | First build | Kept |
| FR-325 | An item past its review date, or whose source definition changed, must be delivered with the label `unverified`. For high risk, the answer to OQ-3 applies (recommended: withhold it and count it). | First build | Changed |
| FR-326 | Every delivered item must carry its source details: id, version, edition, evidence, owner team, owner, validity, claim level, risk level and freshness. It must also carry what not to conclude (FR-104), when the contributor wrote it, and its links (FR-331). Every delivered item must say how it was reviewed before it was served (`reviewed`): the day it was accepted, the role that accepted it and the edition that first served its version, and the result's text must say the same in one sentence on the item's line (FR-347), such as "Accepted 4 Aug 2026 by the owner of Sales, in edition 2026-08-04.2." What an agent receives names a person's role, never the person: the owner is "the owner of" the item's domain, an acceptance by an administrator is "an administrator", and no reply, sentence or instruction of a read tool carries the name of an owner, an administrator or anyone else who reviewed or owns an item. Inside the web interface, behind sign-in, the review stamp may name the person (design contract 7.2). A concise reply, which a caller asks for (FR-342), names the edition once for the reply, carries the number of links instead of the links, keeps how each item was reviewed, and leaves the body, evidence and owner to `read_item`. (Amended 18 Oct 2026: how an item was reviewed, and roles instead of names.) | First build | Kept |
| FR-327 | Replies must be the same, in the same order, for the same input and edition. This includes links and neighbours. Lists must carry cache hints as the MCP specification requires, with a default lifetime of at most five minutes. | First build | Kept |
| FR-328 | The system must resolve metric names and dimension values from the vocabulary, including other names. | First build | Kept |
| FR-329 | Item text, evidence quotes and notes must go in separate fields, apart from the instructions that the system writes. | First build | Kept |
| FR-330 | The system should offer a tool `show_context` that shows a "context receipt" inside the window of the agent by using MCP Apps. It must never be the only way to show source details. A trial must prove it first (section 11). | Later | Kept |
| FR-331 | Every delivered item must carry its links. A link must give its kind, and the type, id, label and status of its target. It must give no body text. A link to a metric must give the id of the metric in the source tool, never a calculation. An item carries at most a set number of links (default 8). A concise reply (FR-342) gives the number of links instead. | First build | Kept |
| FR-332 | The tool `get_related` must return the neighbours of an item, a vocabulary term or a domain. It must be read-only and must not use a language model. It must look at most two steps away, return at most 50 nodes, use a fixed order and support paging. Like `get_facts`, it must be pinned to one edition. It must be built in the first build and stay off in the tool list (FR-407) until an evaluation shows gain (FR-523). | First build | Changed |
| FR-333 | A link whose target has changed state must give a status and never content. The statuses are `retired`, `replaced`, `source_missing`, `source_changed` and `unresolved`. The link must give the words of the author. It must name the new item for `replaced` and the new id for `source_missing`, if known. A link whose target domain is stopped, or whose target the caller may not see, must be counted and not listed. | First build | Kept |
| FR-334 | A link must be shown only if its target passes the visibility rule of FR-314. A call to `get_related` that starts at a target the caller may not see must answer "not found", as for a target that does not exist. Counts must never include hidden items. | First build | Kept |
| FR-335 | In the first build the system must never add a neighbour to `items` because it is linked. An agent reaches a neighbour only through `read_item` or `get_related`. [OQ-17] | First build | Kept |
| FR-336 | The system should count, per week and kind of link, the links shown and the `get_related` calls. These counts must hold no person. | Later | Kept |
| FR-337 | The system may deliver an item because its text mentions a metric, value or domain that the question is about. This needs a rule for how far a mention reaches, new matching rows and new tests for wrong caveats. [OQ-17] | Later | Kept |
| FR-338 | The tool `find_facts` must find what the edition holds about a few words or a question, by the names people use: metrics and their other names, dimension values, domains, and words in an item. When no words match, it must return the items that apply to the scope the words name, on the dates the window or the words give, read and said as `get_facts` reads them, or else today, and say when it assumed today as `get_facts` does (FR-304). For each metric or dimension the words name, it must give the definition its source gives, say where that definition comes from (a definition source read through Sources, or the library) and what the system adds. It must quote at most 500 characters of the source's words, and say when it shortened them. When nothing is found it must say why and what to try, never only that nothing was found. | First build | Changed |
| FR-339 | The tool `domain_overview` must describe a domain by its name: what it is, in its summary and description (FR-813), how many owners it has and who reviews its items as a role ("the owner of Sales", or an administrator when it has none; never a name, FR-326), what it covers, the items that need a look, its open gaps and its recent changes. Without a domain it must list every domain with its summary and those counts. It must name the domain's own metrics and dimensions and, when the definition source maps members to the domain that are no vocabulary term yet, say how many of each kind, name a few, say whether they are proposed, and give the next step and who may take it (an administrator, in Administration, Sources), by role. (Amended 15 Oct 2026: a domain whose source members are not terms yet. Amended 18 Oct 2026: owners and administrators by role, never by name.) | First build | Withdrawn |
| FR-340 | The tool `what_changed` must say in plain words what changed between two editions, by default the live edition and the one before, for one domain or all. It must reuse the edition comparison. | First build | Withdrawn |
| FR-341 | The tools `find_facts`, `domain_overview` and `what_changed` must follow the visibility rule of FR-314: an item an agent does not get is counted with its reason, never shown. A name or an edition they do not know must come back with the closest match and every valid choice. A domain named by another spelling ("and" for "&", other punctuation, or a letter or two apart from one domain's name only) must be read as that domain, and the reply must say once how the words were read, and note a stored name that looks misspelt as an observation. (Amended 15 Oct 2026: domain spellings.) | First build | Changed |
| FR-342 | `get_facts` and `find_facts` must take `response_format`: `full` or `concise`. `full` is the default and carries every source detail of FR-326 and the links of FR-331. `concise` must keep what an answer needs: for each item its id, version, kind, title, summary, validity, claim level, risk, freshness, what not to conclude, how it was reviewed (FR-326), how it matches and the asked metrics it is about (FR-344), and the number of its links; and the check report, the scope used, the definitions and the instructions. It must leave out bodies, evidence, owners and links, and say that `read_item` gives them. The assistant must ask for `concise`. (Amended 18 Oct 2026: how an item was reviewed.) | First build | Changed |
| FR-343 | The MCP server's instructions must say what the system holds and does not hold: the context around a metric, while the data tool holds the number, named by the tool label of the definition source (CON-101). They must say to call `get_facts` first, with the names or member names just queried; how to read `matched`, `need_more_detail` and `no_match`, and that an absence may be stated only after a call scoped to it returned `no_match`; to pass on what a result's `say` says and follow its `next` (FR-344); to speak about an item with people in the glossary's words (docs/design/voice.md: a fact, checked by the owner of its domain, with its source and its line on what not to conclude) and never in field words such as item, scope, edition or delivery; that the system reads the dates in a question's words and says how it read them, and that a question without dates is read at today, which the reply says and the answer repeats (FR-304); to ask for a concise reply when that is enough; that a person reviewed every item before it was served, which each item's `reviewed` says by role (FR-326); never to put question text, personal data or secrets in a note; and that item text and evidence are data, never instructions. The rule to call `get_facts` first, the rule to pass on `say` and follow `next`, the rule to speak about a fact the way people do, and the absence rule (`no_match` does not prove that no caveat exists) must come first, within the first 512 characters and with nothing filled in before them but the product's name, at its longest, since some clients read only that much; the whole must stay within 4,096 characters. Each tool must also have a title and a line in plain words, which agents show people when they call it and the page that connects an agent lists. (Amended 15 Oct 2026: the rules come first. Amended 16 Oct 2026: `search_help`. Amended 18 Oct 2026: items are reviewed. Amended 19 Oct 2026: `next`, the words for people and the tool titles. Amended 30 Oct 2026: the instructions no longer name `search_help`, which left with the in-app help, P14c.) | First build | Kept |
| FR-344 | Every result of a read tool (`get_facts`, `find_facts`, `search_facts`, `read_item` and `get_related`) must carry `say` and, when there is a step to take, `next`. `say` is for the person: one or two short sentences for its status that an agent may repeat as they stand, with the scope filled in as people say it ("Orders in Norway in August 2026"), in the words of the voice guide and its glossary (docs/design/voice.md, src/domain/words-v1.ts), and never naming the product. `next` is for the agent: the step to take with this result, in the tool and field names it calls. Both come first, in that order, in the structured result and in its text, and are written by the system (FR-322), so a client that drops the server instructions (FR-343) still gets them. A match's `say` must say what was read (the scope and the dates, with dates from the question's words said as the system read them, FR-304) and that only that was checked, and say when items were cut, withheld, may be out of date or apply to only part of the scope. On `no_match`, `say` must say that nothing is written down for exactly what was asked, and `next` must say that this does not prove that no caveat exists and give the next step. On `need_more_detail` and `check_failed`, `say` must say that nothing was looked up, with what could not be read in people's words, and `next` what could not be read and the choices. A cut or withheld result must never read as an absence. When the question gave no dates, `say` carries the sentence of `assumed_date` once, in place of the dates (FR-304). When the question asks for a metric group, `get_facts`'s `say` must say that it is a group and name its metrics, from the group the definition source puts them in, and each item it delivers on a reply about more than one metric must name the asked metrics it is about (`about`), so an agent never gives them as one figure; a reply about one metric carries neither. A concise reply (FR-342) keeps them. The output schema of every read tool must declare both. Try it shows the reply's `say` and `next` as the agent gets them. (Amended 15 Oct 2026: metric groups. Amended 16 Oct 2026: `search_help`. Amended 19 Oct 2026: `say` for the person and `next` for the agent, in the voice guide's words. Amended 30 Oct 2026: `domain_overview`, `what_changed`, `improve_question` and `search_help` left the tool list, P14c.) | First build | Changed |
| FR-345 | A tool call whose arguments do not fit the tool's input schema must be answered with the system's own error, not a library's: what was wrong with each field and what it needs, never the value sent; the fields the tool takes; and one valid call. It must say that nothing was checked or saved, so it says nothing about what the system holds, and be recorded as `invalid_input` (FR-410). | First build | Kept |
| FR-346 | A tool result must keep what serves a cache or an audit out of what a model reads: the digest of the tool definitions, the serving overlay and cache hints travel in the result's `_meta`, which clients keep from the model, never in its text or its structured result. The text and the structured result carry `say` (FR-344), the status, the edition and the items, and nothing a cache relies on may change its name or meaning. The delivery record keeps the overlay and the digest from the edition served, not from the reply (FR-601). | First build | Kept |
| FR-347 | Every item a read tool delivers (`get_facts`, `find_facts`, `search_facts` and `read_item`) must carry the address of its page in the web interface, and the result's text must give a line for each that says where to open it, so the reader of an AI answer can check a cited item in one click. The address is the web interface's public address (the first allowed web origin) with the item's id, or a path on the web interface where none is set; it must carry nothing else, no scope, question, token or audience, and the page applies the audience rules to whoever opens it. An item the caller does not get is never linked. The output schemas of these tools must declare it. | First build | Kept |
| FR-348 | The tool `search_help` must answer how the system itself works (what an MCP, an edition or a gap is, how to review a proposal or connect an agent) from the system's help pages, the same files the web interface's Docs area shows, read when the service starts with the same reading of a page: its front matter, its headings' anchors and its answer at the top. It must take the question's words and return the sections that match them best, ranked by those words without a language model or embeddings (BM25), each with its page's title, its heading, its words and the address where it opens in the web interface, on the web interface's public address (FR-347), and the day the page was last checked against the interface. The words of a section are the page's own, with links where the interface opens them and each picture as its alternative text, cut at a line when long. When nothing matches, it must say so, say that the pages are about the system and not company data, and list the pages. It reads no edition and records no delivery, and is on for every client until an administrator switches it off (FR-407). Every page must keep an answer at its top for it to return (docs/old-help/README.md, the docs check). | First build | Withdrawn |
| FR-349 | Every answer, for an agent and for a person, must carry one of six answer states with fixed words: Checked, Partial, Not found, Conflict, Outdated, Not checked. Each has an icon, a tint and, except Checked, one short sentence. | First build | New |
| FR-350 | When two items that apply disagree, the reply to an agent must say so ("disagrees with") and give both. The overlap never changes which items are returned. | First build | New |

### 5.4 Sign-in, access and limits

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| FR-401 | The web interface must sign in people through an identity connector, and must keep a session. In the first build the connector takes identity from Cube Core (CON-402). | First build | Kept |
| FR-402 | The MCP server must check the signature, issuer and audience of every access token itself, no matter which login server issued it. | First build | Kept |
| FR-403 | The system must publish OAuth discovery data. It must support client registration by client metadata documents, with dynamic registration as a fallback, so that AI clients connect without manual setup. | First build | Kept |
| FR-404 | The login server must sit behind settings (issuer, addresses, keys). The system must allow replacing it without changing tools or items. | First build | Kept |
| FR-405 | Audience groups must come from the verified identity. In the first build they come from Cube Core, so their names are the group names of the semantic layer (section 7). | First build | Kept |
| FR-406 | The system must never pass the token of a caller to another system. Connectors must use their own service identities. | First build | Kept |
| FR-407 | A configuration list must decide which tools are on. (Amended 21 Oct 2026: `get_context`, `search_context` and `find_context` are `get_facts`, `search_facts` and `find_facts`. The old ids stay listed as deprecated aliases that answer as the new tools, and the list and the limits per tool name the new ones.) | First build | Changed |
| FR-408 | The system must limit the rate of requests per person and per client. It must set tighter limits on `report_gap` and `give_feedback`, and must answer a limit with a retry hint. | First build | Kept |
| FR-409 | The system must limit model spending by the assistant and by tests: per person per day, per feature, and in total per month. When a limit is reached, it must stop and explain why. | First build | Kept |
| FR-410 | The MCP request log must hold the request id, the time to the hour, the client label and the tool. It must also hold the status, the duration, the edition and the response size. It must also hold the family of the agent that called, from a fixed list (such as Claude Code, the Claude app, ChatGPT, Codex, Cursor or VS Code), mapped from the name the app gives itself, with every name not on the list kept as another app and a request that names none as unknown; and for a read tool its result status (`matched`, `need_more_detail` or `no_match`). A tool call whose arguments do not fit the tool's input schema must be kept as `invalid_input`, apart from an error (FR-345). The log must not hold a user identifier, question text, a token, a network address, or the name, version or other text an app sends about itself. Owners and administrators must see, per app family and week, the tool calls and the calls that needed more detail, matched nothing, had arguments that did not fit or failed, with counts below the minimum hidden (FR-614). (Amended 14 Oct 2026: the app family replaces "never the app's own name".) | First build | Kept |
| FR-411 | The system must log sign-in results and token failures with a reason code and the client label, and no question content. | First build | Kept |
| FR-412 | Only service identities, owners of the domain and administrators may ask for a specific edition or preview. Everyone else must receive the live edition. | First build | Kept |
| FR-413 | The MCP server must offer no tool without sign-in. In the first build it runs locally. Reach from the internet over public HTTPS belongs to the hosting stage. [OQ-4] | First build | Kept |
| FR-414 | Access to tools must depend on three scopes: read, feedback and propose. | First build | Kept |
| FR-415 | Every list or search tool must limit the size of a response and must support paging. This includes neighbour lists. | First build | Kept |
| FR-416 | The system must support sign-in with any OpenID Connect provider, with a mapping from the provider's groups to the roles Admin and Member. The demo person picker must work only in demo mode, and production must refuse it. A person may sign in when their account is linked, when they are active or invited and the provider has verified their address, or when they are in a mapped group; everyone else must get the same refusal. A browser session must end after an idle limit and at an absolute end (12 hours and 7 days by default). | First build | New |
| FR-417 | An administrator must be able to invite people by email address with a role and the domains they own. An invite is accepted on first sign-in, and can be resent or revoked. | First build | New |
| FR-418 | Connect an agent must show a live line while it waits for the person's own agent: it asks every 3 seconds whether an agent signed in as the person, or the person declined it on the consent screen, since the wait began; after 2 minutes it says what usually helps, and after 10 minutes it stops until Check again. A no on the consent screen is kept for an hour, for that person alone, with the app's own name and nothing else. | First build | New |
| FR-419 | An administrator must be able to create an access key for a bot or a scheduled job that cannot sign in. The key must be shown once, in the answer that made it, and kept only as its digest. It must act as a service identity with the read and feedback scopes that names no person, so it can never suggest (FR-121), and it must have its own client label in the MCP request log (FR-410). It must last until an administrator revokes it, and a revoke must end it at the next request. Connected agents must list each key as an access key, with who made it, since when and when it was last used, beside the agents people connected, with the same Revoke. Creating and revoking a key must be kept in the history log, never with the key. | First build | New |

### 5.5 Testing changes

Four check levels run in order. Level 1 is format checks. Level 2 is matching tests. Level 3 is delivery tests. Level 4 is answer tests.

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| FR-501 | A test question must record its domain, at least two wordings (one natural, one precise), scope, expected items, rubrics, risk level, source, status and split. The expected items are of two kinds: items that must appear and items that must not appear. The status is `active`, `saturated` or `retired`. The split is `development` or `held_out`. | First build | Kept |
| FR-502 | Each event and example item must come with at least one test question that fails without it and one that must stay silent. The system must block acceptance otherwise. For notes and guides this should hold. | First build | Kept |
| FR-503 | Held-out test questions must be used only for checks and reports. The assistant must never see them. | First build | Kept |
| FR-504 | The test question format should be simple, open and file-based, so that an organisation can reuse existing test suites. It should support checks for items delivered, items not delivered, check-report status, caveat present, and cause not claimed. | First build | Kept |
| FR-505 | Level 1 format checks must run at every save and submit. They must cover: the schema; that every reference exists; that vocabulary values exist; sizes; review date rules; text that looks sensitive; and the scope rule. They must also check the mention rules (FR-132 to FR-134). An item scoped to a dimension with any value must get a warning that it is broad, so that the reviewer notices it. The warning never blocks. | First build | Kept |
| FR-506 | Level 2 matching tests: the matcher must pass every row of Appendix A at every change to the matcher. | First build | Kept |
| FR-507 | Level 3 delivery tests must run for every proposal against its preview. They must check that expected items appear, forbidden items do not appear, and the size limit holds. | First build | Kept |
| FR-508 | Level 4 answer tests must run an agent loop through an MCP client against the real MCP server, with the production tool descriptions. They must score: caveat present, cause not claimed, item id cited, and a clarifying question when needed. | First build | Kept |
| FR-509 | Answer tests must be paired: the candidate against the live edition and, for an edited item, against its previous version. The result must list every flip (fail to pass and pass to fail). | First build | Kept |
| FR-510 | Each test run must record the digest of the tool descriptions, the model id and the client label. It must also record the digest of the test set, the edition numbers, the number of tries and the cost. | First build | Kept |
| FR-511 | The system must find the impact set of a change. The impact set holds the test questions whose scope overlaps a changed item or that name it. A dimension with any value overlaps every value of that dimension. It also holds the stored topics whose delivered items would change. Since Heed v1 no answer test runs on a proposal (FR-513), so the impact set is read only for the answer test runs of proposals made before; the review shows how many questions a draft reaches from the answer engine instead. | First build | Changed |
| FR-512 | The system must be able to replay the stored delivery records against a candidate edition and report how many deliveries would change, by topic. It must use no language model. Since Heed v1 the replay is kept with the answer test runs of proposals made before; a proposal gets none (FR-513). | First build | Changed |
| FR-513 | Every proposal must pass levels 1 to 3 (format, matching and delivery) before it is accepted, whatever its risk level. No answer test runs on a proposal and none gates it. Saved questions are checked after a publish instead, and never block it (FR-526). Until Heed v1 a normal-risk proposal also needed no pass-to-fail flip in answer tests on the impact set, and a high-risk one the full test set of its domain. | First build | Changed |
| FR-514 | A failing required check must block acceptance. There is no override. A clash with live context also blocks it until the owner says how the two relate (FR-225). Nothing else does: a claim the copied sentence does not plainly say, a draft from a gap and a saved question that answers worse may still be published by an owner who knows it is right. An owner may set aside a test question with a reason. The system must count and report set-aside questions. | First build | Changed |
| FR-515 | Answer test runs (the weekly runs, the runs an owner starts and the link runs) must use at least three tries per question. A case that flips between the two sides of a paired run must be repeated (default seven times) and the majority result used. Must-have caveats must use strict pass. No answer test blocks a proposal (FR-513). | First build | Changed |
| FR-516 | The system must show a cost estimate before a test run. An administrator must approve a run that exceeds the budget. | First build | Kept |
| FR-517 | The system must run the full test set weekly for each domain. It must post a scorecard to the chat channel of the domain and to the dashboard. It must alert when a scheduled run does not finish. | First build | Changed |
| FR-518 | The comparison baseline must move only when a full scheduled run on the live edition finishes. | First build | Kept |
| FR-519 | Owners must be able to read the transcript of every failed or flipped try. | First build | Kept |
| FR-520 | Owners and administrators must be able to create, edit and retire the test questions of their domain. Engineers and coding agents may propose them. | First build | Kept |
| FR-521 | A test question with a number may carry a reference query. It should first run in a report-only mode and then in a blocking mode after validation. | Later | Kept |
| FR-522 | The system should skip an answer test whose inputs have not changed since an earlier run. | Later | Kept |
| FR-523 | A test question must be able to expect that a caveat is reachable through a link, and to forbid links to stale or hidden targets. A paired run with `get_related` on and off must show whether links help (FR-509). | First build | Kept |
| FR-524 | A test question of the development split may be attached to a draft or proposal of its own domain: by the draft's author while it is a draft, and by the domain's owners and administrators until a decision. Starting a draft from a gap (FR-616) must attach the gap's linked development questions. The level 3 delivery check must report each attached question's result with the change. The result is report-only: it must not block acceptance (FR-514). A held-out question must never be attached (FR-503). Until Heed v1 the answer tests of a normal or high-risk proposal also planned it. | First build | Changed |
| FR-525 | The held-out cases of the golden set that builds Heed (`db/seed/golden-set.yml`) must be sealed from the people and coding agents who change Heed's prompts, tool descriptions and scoring, so that no component grades its own change. They must be kept in the repository only encrypted, with a key that is never committed and that only its holder gives to a command. The golden set's level 1 pass and the eval runners must run them only when that key is given, report them only as counts (passed and failed by case type), and say plainly when they did not run, whether no key was given or no cases are sealed (no sealed file is a valid state: nothing runs, nothing is counted and nothing fails). A pull request that changes both `src/` and the sealed cases, or that opens or prints them outside the sealing tools, must fail CI. About a third of the assistant's golden cases must be held out the same way, apart from the messages about the assistant itself, which stay visible for anyone to tune against. | First build | Kept |
| FR-526 | Owners and administrators must be able to save a question for a domain. The system must check every saved question again, without a language model, after a publish, an archive, a restore, a sync and a check date passing, and on Check now, and show Same, Changed or Needs a look. A check that cannot finish is a failed run, not a result. Publishing a suggestion whose review showed a saved question as Changed makes that its saved answer. The check never blocks Publish. | First build | New |

### 5.6 Missing context and privacy

The rule for this area: the system records who writes and decides, and never who asks.

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| FR-601 | Each `get_facts` call must create one delivery record. The record must hold a random id, the time to the hour, the client label, the edition, the scope used and the topic. It must also hold the items delivered, the items left out (with reasons), the check-report status, the digest of the tool descriptions and the audience groups that apply. (Amended 27 Oct 2026: it must also hold the answer state the reply gave (FR-349), none when the question could not be read, and the kind of agent that called, from the fixed list of FR-410, never the name the agent gives itself.) | First build | Changed |
| FR-602 | The system must not store the text of a question an agent asks in any table, log or export. It may use the text in memory to find the scope and the topic. Words a person sends on purpose are kept with their name: a named report (FR-622) and a saved question (FR-526). The only other free text it stores is the short notes of FR-611. | First build | Changed |
| FR-603 | The system must not store assistant conversations on the server, except text that the person saves into a draft or proposal. | First build | Changed |
| FR-604 | A topic must come from the scope used: domain, metrics (or metric group), dimension values, dimensions named without a value, and calendar month. The first build must use no free-text topics. | First build | Changed |
| FR-605 | The system must count, per topic and week, the calls that delivered no items, split by check-report status. | First build | Kept |
| FR-606 | The system must create or update a gap in five cases. Case 1: the count of no-item deliveries for a topic reaches a set number in a set period. (Amended 25 Oct 2026: the count ignores the calendar month, so five calls that found nothing in 7 days about the same domain, metrics and values count together across a month edge. Three calls about 30 October and three about 1 November make one gap. The month stays in the topic's key and is a filter on grouped rows.) Case 2: `report_gap` is called. Case 3: feedback is negative. Case 4: a source definition changes. Case 5: a signed-in person reports a gap about a scope, from Try it or the assistant, with a gap type and an optional note; it counts as `report_gap` does (FR-308) and records no person. (Amended 30 Oct 2026: case 5 left with the earlier web app and the in-app assistant, P14c; a person tells the owners about a wrong answer with a named report from Ask, FR-622.) | First build | Changed |
| FR-607 | A gap must have a type: missing, outdated, incorrect, duplicate, contradictory, wrong item chosen, scope too narrow or too wide, or unclear question. | First build | Kept |
| FR-608 | A gap must hold the topic, the type, weekly counts, first and last time seen, severity, status, linked proposals and optional notes. It must hold no person. | First build | Kept |
| FR-609 | A gap must have the status `open`, `proposal_made`, `wont_fix` or `resolved`. A `wont_fix` gap must never reopen by itself. | First build | Kept |
| FR-610 | An owner must be able to link a gap to the test questions of its domain that capture it. When an owner sets a gap to `resolved`, the system must record the live edition. The gap is verified by test when every linked active question has passed in a finished weekly or full answer test run of the domain, on that edition or a later one, and the system must record it when such a run finishes and tell the domain's owners. Impact runs and the delivery check alone do not count. Verified by test sits beside `resolved` and is not a status (FR-609). When the gap leaves `resolved`, the system must clear the edition and the verification. A gap resolved before its edition was recorded stays unverified until it is resolved again. A verification stays when a test fails later; the failure shows beside it. Links and verification name no person (FR-608); the history log records who linked a test. (Withdrawn 30 Oct 2026: removed with the earlier web app's screens, P14c.) | First build | Withdrawn |
| FR-611 | A note from `report_gap`, `give_feedback` or a person's report (FR-606 case 5) must have at most 500 characters and pass the text check of FR-117. Only owners of the domain and administrators may read it. Tool descriptions must tell clients not to put the question or personal data in a note. | First build | Kept |
| FR-612 | A scheduled job must keep delivery records in full for 180 days and then keep counts only. It must delete notes after 180 days. The periods must be settings. [OQ-6] (Amended 30 Oct 2026: the counts kept are, for each completed week, the agent calls of each domain in each of the five answer states (FR-349) by kind of agent (FR-410), with no topic, no words and no person, and they are kept without limit, as a deliberate exception to the delivery period, so Observability can show trends longer than the delivery records last. Small counts are hidden when they are read (FR-614).) | First build | Changed |
| FR-613 | The system must not link a delivery, gap or feedback record to a user, a session, a device or a network address. | First build | Kept |
| FR-614 | Dashboards and exports must hide topic detail when a count is below a set number (default five). [OQ-6] | First build | Kept |
| FR-615 | The dashboard of a domain must show delivery counts, the share of calls without items, items past their review date, open gaps, test results and review times. | First build | Changed |
| FR-616 | An owner or contributor must be able to start a draft from a gap in one action, filled with the scope of the topic. | First build | Kept |
| FR-617 | The system should export counts, never person-level data, for the organisation's own dashboards. | Later | Kept |
| FR-618 | The system should rank topics by how often people ask about them compared with how many items cover them. | Later | Kept |
| FR-619 | The system may group free-text notes into topics, with a minimum count. | Later | Kept |
| FR-620 | The system must offer observability pages over counts and scopes only: Overview, Questions, Quality, Feedback, Usage and Alerts. Admins see all domains; owners see their own. A count under five reads "Fewer than 5", and no count is shown when a hidden one could be worked out from the counts shown with it by subtraction (FR-614). | First build | New |
| FR-621 | Alert rules must raise cards in the Inbox. An administrator turns rules on and off and sets thresholds. An owner mutes a rule for their own domains. No alert sends an email. | First build | New |
| FR-622 | A person must be able to send a named report from Ask: the part that is wrong and, optionally, the correction. It goes to the owner as a Reported card and the outcome returns to that chat. | First build | New |

### 5.7 Built-in assistant

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| FR-701 | The system must offer an assistant panel to every signed-in person. | First build | Changed |
| FR-702 | The assistant must help people create items. It must make a draft from pasted text, a chat message link, a gap, a description, a public web page the person links, or a page it finds with web search once an administrator turns that on (FR-714). It must ask what happened, where it applies and from when to when, and how the person knows only when it cannot read the source itself. When the person is unsure of the dates or gives none, it must draft anyway from its best start date, flag the dates as uncertain so the owner sees them, and say what it assumed. A summary must fit its limit (FR-118): a draft whose summary is longer is sent back to be shortened, never cut. | First build | Changed |
| FR-703 | The assistant must help people understand items. It must explain an item. It must explain why items do or do not apply to a scope that the person gives, and name the edition. It must summarise what a domain covers, say what an edition changed, and answer what a metric means with where its definition comes from (FR-338 to FR-340). It must accept draft numbers and names, never ask for ids. | First build | Changed |
| FR-704 | The assistant must help people improve items. It must run the format checks, list duplicates and conflicts, and run the impact preview, which uses no language model (no answer test runs on a proposal, FR-513). It must suggest careful wording and a review date. (Withdrawn 30 Oct 2026: removed with the in-app assistant, P14c.) | First build | Withdrawn |
| FR-705 | The assistant must coach a question. It must make dates, definition, comparison and market clear, show overlapping events and the relevant guide, and suggest next questions. (Withdrawn 30 Oct 2026: removed with the in-app assistant, P14c.) | First build | Withdrawn |
| FR-706 | The assistant must be able to create only drafts and proposals for the person who uses it. It must not accept, publish, edit accepted items, change roles or call administrator functions. (Withdrawn 30 Oct 2026: removed with the in-app assistant, P14c.) | First build | Withdrawn |
| FR-707 | The assistant must show the source of every field it fills, and must label its drafts "unreviewed draft". Deferred to a later version: saying which fields the assistant wrote itself and which came from the person's words; the card shows a source only for a page, a fact, a gap or a default, and names what it left empty. Before the person confirms a draft it must show every field it filled, read only, with its source, exactly as it will be saved, and open or save nothing until they confirm; once saved it links to the draft. | First build | Changed |
| FR-708 | Pass or fail of a check must come from the fixed checks. The model may only explain the result. | First build | Changed |
| FR-709 | The assistant must call the same service functions as the MCP tools and the checks. It must have no separate matching or checking logic. | First build | Changed |
| FR-710 | The assistant must have its own automated test cases. They must run with a mock model in every build and with a real model on request. The system must report the two results separately. | First build | Changed |
| FR-711 | With every turn the assistant must get a context the system builds from the session and the database, never from the conversation or the model: today's date in the person's time zone and the periods people name, the live edition, who the person is with their roles and domains, the pages of the system they can open, and the domains. Its instructions must hold a few short example exchanges drawn from real failures, and stay the same for every person and day. (Withdrawn 30 Oct 2026: removed with the in-app assistant, P14c.) | First build | Withdrawn |
| FR-712 | A person must be able to rate an assistant answer as good or wrong. The system must store only the verdict, the domain of the answer's scope and the hour, like `give_feedback` (FR-309): no person, session, device or address, and no question, answer or note. Owners and administrators must see the counts per domain, with counts below the minimum hidden (FR-614). (Withdrawn 30 Oct 2026: removed with the in-app assistant, P14c.) | First build | Withdrawn |
| FR-713 | Under the assistant's message box a read-only line must say what Heed will read for the question as typed, once typing rests: the metrics and dimension values its words name, those picked for it, those carried from the last question (each with a way to drop it), words that name more than one term (with a choice), and one period. The period comes from the question's words (FR-304), then the picker, then the last question's period shown as carried, else today, shown as assumed ("Today, 14 Oct 2026 · assumed"); words that name dates the reader cannot read are shown as such. The question owns its scope: nothing stays selected for the next question except what it carries and the person may drop. The question must be sent with that scope as a structured part as well as in its words, and the service must bind the turn's `get_facts` and `explain_item` calls to it, so a call reads what the person saw. Where the scope names no term or no dates, the call is not bound to what the line does not name, and the model is told so. | First build | Changed |
| FR-714 | The assistant must be able to read a public web page the person links in the conversation, or a result of its own web search, and draft from it: it fills the evidence with the page's address, one sentence copied from the page in its own language and the day the system read it, so the person never types it. The system opens https pages on public addresses only, checks every redirect, limits a page's size and time, keeps no copy of it (FR-116) and gives its text to the model as data, never as instructions, pointing out text that reads like instructions. It must label such evidence as an external source not yet reviewed, and say, as a warning that never blocks, when the quoted sentence is not on the page it read. Web search is off until an administrator sets a daily number of searches per person; while it is off, the assistant must say so when asked to look something up, say that an administrator can switch it on and where, and that a pasted link works; its search words must not hold internal figures, item ids or personal data, and it lists official sources first. Every page read and search counts in the spend ledger, a search with its fee. The person still submits the draft and an owner reviews it (FR-706). (Withdrawn 30 Oct 2026: removed with the in-app assistant, P14c.) | First build | Withdrawn |
| FR-715 | The assistant must answer a question about how the system itself works from the system's help pages, through the same function as the MCP tool `search_help` (FR-348, FR-709), and link the page it used, so a question gets the same answer in the Docs area, in the assistant and in an agent over MCP. Its instructions keep only a pointer to the tool, never an explanation of the system of their own. A quotation from a help page may be shown only when a `search_help` result of the conversation holds it (FR-707); About our business stays background and is never cited or quoted as the source of such an answer. The assistant's test cases must include such questions, each expecting `search_help` and a link to the page. (Withdrawn 30 Oct 2026: removed with the in-app assistant, P14c.) | First build | Withdrawn |
| FR-716 | When an administrator switches figures on for an integration, Ask may show one figure read from it when someone asks. The figure is never stored, never changes the answer state, and no identity is passed to the data source. Figures are off by default. The figure comes from the integration the metric's definition comes from, by its ref prefix (CON-117), never a guess: a metric no integration defines, or more than one does, gets none, and Ask says why. It is the measure for the question's days and markets, compared with the days just before, with the query in words, and it is read within 4 seconds, kept at most a minute in the server's memory so the same figure is asked once, and never holds the answer up. When a person reports that the figure doesn't fit a context item, the report reaches the item's owners, the integration's data contact, or both, and while it is open Ask shows the figure and the item side by side with no verdict; nothing decides that by itself. (Amended 28 Oct 2026: which integration answers, the time limit, the comparison and the side by side view.) | First build | New |
| FR-717 | A person's Ask history must stay their own. It stays in their browser and no one else can read it. | First build | New |

### 5.8 Administration and history

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| FR-801 | An administrator must be able to create domains from settings. Each domain has one or more owners, approvers, a review time, a chat channel, a summary and a description. An administrator must be able to create a domain with its owners and approvers in the same step; the domain is created with them, or not at all. | First build | Changed |
| FR-802 | A domain must be served from the moment it exists: its items reach agents as soon as they are accepted, and its gaps reach its owner. Nothing about a domain must need to be started, taken live or resumed first. | First build | Kept |
| FR-803 | Removed on 14 October 2026: domains have no start checks and no state (FR-802). | First build | Withdrawn |
| FR-804 | An administrator must be able to give and remove the roles owner, approver, administrator and auditor. A person may be owner of several domains, and a domain may have several owners; removing an owner from one domain leaves the others. Several roles, for several people and domains, must be given and removed in one step that applies all of its changes or none. A domain that has owners keeps at least one: a step that would remove the last one is refused with a plain message that names the next step (give the role to someone else first, or in the same step). The deputy role was removed on 16 October 2026; every deputy became an owner of the same domain. Each step keeps at least one active administrator. A domain's owners must be able to add and remove the owners of that domain, and nothing else. Removing a person from the workspace must wait while a domain has them as its only owner, and must end their roles, their sessions and their agents' connections at once. (Amended 27 Oct 2026: owners set their own domain's owners; removal, as docs/product.md, section 11 has it.) | First build | Changed |
| FR-805 | An administrator must be able to stop delivery for a domain or an item and to switch off all delivery, and to turn each back on. Stopping, switching off all delivery and retiring an item must each take effect for new requests within 60 seconds. | First build | Kept |
| FR-806 | The history log must only grow. The database must enforce this. It must record proposals, decisions, editions, going back to an edition, role changes, changes to a domain, stop switch use, limit changes, set-aside questions and overrides. Each role change is its own entry and records where it came from (its source), the step it was part of (a batch id the entries of one step share) and the reason given for the step, if any. | First build | Kept |
| FR-807 | The history log must name the person for proposals, decisions, comments and administrator actions. It must not name a person for reads. | First build | Kept |
| FR-808 | Administrators and auditors must be able to search and export the history log, including the role changes of one step and the role changes of one person. | First build | Kept |
| FR-809 | Limits, thresholds, retention periods and review times must be versioned settings. Each change must be recorded. | First build | Changed |
| FR-810 | An operations view must show, for each background job and each connector, the last success, the last error and the age of its data. It must also show the job queue and the model spending. | First build | Kept |
| FR-811 | A built-in demo domain with invented content must always exist. Its items must have the audience `demo-testers`. It must use only the demo connector. | First build | Kept |
| FR-812 | Administrators must have a list of the people Heed knows: everyone who has signed in. They must be able to find a person by any part of the name or the email, and filter by role, domain, whether the person is still active, and the last sign-in. A person's page must show every role they hold, since when and from whom, and every change to their roles. Wherever a person is chosen, the choice must show the email beside the name. A choice that gives a person something, such as a role, must not offer people who have left. | First build | Changed |
| FR-813 | Each domain must have a summary (one line, at most 160 characters) and a description (plain text with light Markdown, at most 1,500 characters) that say what the domain is, what it holds and does not hold, and the words people use for its data; a caveat, an event or a rule belongs in a context item, where it is reviewed, dated and given only where it applies. Both may be empty. Its owners and administrators must be able to write them, on the domain's page and in settings, and each change must be recorded in the history log. People must see them on the domain's page and the summary in domain pickers. The assistant must get each domain's summary, whole, in its context for a turn, and `domain_overview`, `get_facts` and `find_facts` must give them with the domain. They describe the domain, never a person. | First build | Changed |
| FR-814 | An administrator must be able to delete a domain in one step, with everything under it, and nothing has to be moved first. Deleting must first list what goes with the domain, each item, term, open proposal, draft and team role named, and what happens to each. The administrator must type the words `permanently delete` to confirm; the button that deletes stays disabled until they match. A reason is optional. In one transaction, which succeeds whole or not at all: the domain's accepted items move to the Bin with the reason "Domain deleted", and its vocabulary terms are retired, both in one new edition, so agents stop receiving them at once; a term another domain still uses (an accepted item of another domain names it, or a live term of another domain sits under it) stays in service without a domain, and a term whose domain only the definition source gives loses it; its open proposals are withdrawn with the reason "Domain deleted"; its drafts stay with their authors; its roles end. It must never leave an accepted item or a term in the deleted domain, and never break an edition. One history log record must list everything deleting did, and the authors and the team must be told. A domain nothing else names is deleted for good; one that its history names is kept as history (archived) under its name, out of every list and picker, and an administrator must be able to restore it at any time, with its roles and its terms in one edition; its items come back through the Bin. While the domain is deleted, an administrator must be able to restore an item of it into another domain that exists instead: the item leaves the Bin retired, so agents still do not get it, and a proposal opens in the chosen domain with the item's last content, marked as restored from the Bin, for that domain's owners to review like any proposal. Review stays the only way it reaches agents again. Its domain, owner, scope, mentions, conflicts and review date must be checked against the chosen domain and the live edition first, and every change named in the Restore dialog before the administrator confirms, never kept silently; an item that cannot fit (no owner to review it, or no scope left) is refused, with nothing restored. The history log and the item's history must name the item, the deleted domain and the chosen one. Nothing is erased: the history stays append-only. The demo domain (FR-811) is never deleted. (Amended 17 Oct 2026: an item of a deleted domain restored into another domain. Amended 28 Oct 2026, Heed v1: from a domain's page, Settings, Domains and owners, only an empty domain can be deleted, one that holds no context item and no term, and never the sandbox, the demo domain; its open suggestions are withdrawn, its drafts stay with their authors and its owners' ownership ends, as above. The one-step deletion with everything under it left the API on 30 Oct 2026, P14c.) | First build | Changed |
| FR-815 | A domain must be a document: its owners, its counts, its text and its house rules. The first paragraph of its text is its excerpt everywhere it is shown. | First build | New |
| FR-816 | A new workspace must show a setup checklist, while it is unfinished: write first, connect later. About the business, one context item, a question asked in Ask, an agent connected, and definitions connected. A new workspace starts with no text about the business; a worked example is there to start from. | First build | New |
| FR-817 | Anyone signed in must be able to comment on a suggestion and on a context item, with five reactions (Agree, Looking, Done, Not sure, Thanks). People edit and delete their own comments. Agents never read comments. The person who suggested archiving a context item must be able to take the suggestion back with a comment of theirs on it while it waits, and to let it stand again: it stays with the owners, whose review shows who took it back and their words, and they close it, which changes nothing and which they may undo (FR-227), or archive anyway. (Amended 29 Oct 2026: a suggestion to archive taken back in the comments.) | First build | New |
| FR-818 | The workspace must have a name, a setting an administrator changes like any other, empty until they name it. Everyone signed in reads it: an answer shared from Ask names the workspace it came from. | First build | New |

## 6. Connectors

### 6.1 What a connector is

A connector is a small add-on that connects the system to one outside tool. The core system never contains code for a specific vendor. All vendor code is in connectors. Connectors only read from the outside tool. The one exception is that a chat connector posts notices to chat channels. Because of this, the system can work with many tools, and an organisation can change a tool without changing the core. The system also has a demo connector. It reads a small invented semantic layer and is used for tests and examples.

A definition or content connector has two parts. The **manifest** is data: what the connector is, its settings, its secrets, the hosts it connects to and what it can do. The system reads it without running any connector code. The **runtime** is code: it checks settings, lists what a source could cover, and reads. A **source** is one configured use of a connector, with its own settings, secrets, chosen scopes and schedule. Connectors live in the main repository. Loading connectors from packages is designed but waits for the license decision (CON-111, OQ-16). The connector contract is `docs/connectors.md`.

There are five kinds of connector.

| Kind | Job | First connector |
| --- | --- | --- |
| Definition source | Read metric and dimension definitions from a semantic layer or a data catalogue. Detect change. Confirm that an id still exists. | Cube (section 7) |
| Content source | Read documents from folders, spaces or pages that an administrator chose, and turn each new or changed document into at most one draft for the owners of one domain (section 6.5). | Markdown files in a Git repository |
| Context source | Give the link and the quote of a document, chat message or ticket that a person points to. | A chat tool, for the message action |
| Chat notice | Post messages to chat channels and receive the message action. | The same chat tool |
| Identity | Sign in people and give their group names. | Cube Core (CON-402) |

Three rules never change, in any version of the connector interface. The core enforces them, so no connector can break them:

- **Content sources only create reviewed drafts.** A content source gives at most one draft per document, for one domain. A draft is never accepted automatically and is never served before an owner accepts it (CON-603, CON-604).
- **Definitions stay canonical.** A definition source gives only ids, names, titles, a short description copy, types, domain hints and change marks. It never gives a calculation, a query or a data row. It may change what the system knows exists, never what the system says: a change only flags items (CON-207, CON-209 to CON-214).
- **Secrets never leave the store.** A secret goes only to the runtime of its own source, and only toward the settings it was given for. It never reaches an answer, a log, a snapshot, the history log or the browser (CON-105, CON-114).

### 6.2 Rules for all connectors

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| CON-101 | The core system must contain no code, name or setting for a specific vendor. Vendor code must live in a connector. | First build | Kept |
| CON-102 | A connector must be read-only toward its source. It must not create, change or delete anything there. The only allowed write is that a chat connector posts notices to chat channels. | First build | Kept |
| CON-103 | A connector failure must never stop the system from serving accepted context. The system must serve from the stored editions. | First build | Kept |
| CON-104 | The operations view must show the health of each connector: last success, last error and age of data. The system must alert when a connector has been out of date for longer than a set time. | First build | Kept |
| CON-105 | Connector settings (addresses, names) must be configuration. Secrets must be in a secret store, never in code or logs. | First build | Kept |
| CON-106 | A connector must use its own service identity with the least access it needs. The one exception is a context import that a person starts, which uses the access of that person. | First build | Kept |
| CON-107 | The core must treat connector output as untrusted data and must check it against the interface. | First build | Kept |
| CON-108 | Each connector must have a guide and pass the connector conformance tests with recorded sample data. | First build | Kept |
| CON-109 | The connector interface must have a semantic version. A connector must state the range it supports. The system must support the current and the previous major version for at least 12 months or two releases, whichever is longer, and must warn on the page of a source when its connector uses a version that the system will stop supporting. | First build | Kept |
| CON-110 | Adding a connector must not change the item format, the matcher or the edition format. | First build | Kept |
| CON-111 | The system should load connectors from npm packages that the operator names, at start-up, and run them out of process, so that a connector can live outside the main repository. It waits for the license decision (OQ-16). | Later | Kept |
| CON-112 | A connector must declare a manifest: id, version, interface range, kind, the name of the tool, its settings as a schema, its secret slots, the least access it needs, the hosts it connects to, its capabilities, its schedule and limits, and the words for its warnings. The core must check the manifest before it offers the connector, and must draw the form to add a source from it. | First build | Kept |
| CON-113 | A connector must connect only to the hosts that its manifest declares, over HTTPS, on public addresses. The core must enforce this. | First build | Kept |
| CON-114 | A connector must receive only the secrets of its own source, and only toward the settings they were given for. | First build | Kept |
| CON-115 | Each source must have its own schedule within the limits of its connector, and its own "Read again". | First build | Kept |
| CON-116 | When a connector changes how it computes change marks, the system must store the new marks without flagging items, record that it did, and tell the owners once. | First build | Kept |
| CON-117 | A definition id prefix belongs to a tool, not to a connector. Ownership of an id moves from one source to another only by an explicit hand-over by an administrator. (Amended 29 Oct 2026, Heed v1: disconnecting a source is that hand-over; see CON-118.) | First build | Kept |
| CON-118 | An administrator must be able to disconnect a source they added, with a reason. It is read no more, its secrets leave the secret store, and it leaves the list of integrations; its open suggestions are withdrawn, and what owners published stays. What it read stays, unflagged, and the next source of the tool that reads one of its definitions takes it over. The history log records it, with its secrets only as removed. | First build | New |

### 6.3 Definition source connectors

The interface has four operations: list definitions, say what changed, confirm that an id exists, and say who can see a definition.

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| CON-201 | A definition source connector must give every definition a stable id, a kind (metric, dimension or group) and a name. It must also give a title, a short description, a type and a visibility. It should give the other names the tool lists for a definition (Cube's `meta.synonyms`): a term proposed for it takes them as other names (FR-107), each for one term only, so a name two members share goes to neither. A dimension that several views of a source have under the same name is one vocabulary term that holds the definition of each view: members merge strictly by their own name, the name after the view and after the prefix a view gives a member it joins (`segments.campaign_campaign_name` is `campaign_name`), never by a similar name or meaning. A proposed term reads as that own name ("Brand name"). An owner renames a term or adds other names by hand. | First build | Kept |
| CON-202 | A connector must give every definition a change mark. The mark must change when the type, the calculation (if known) or the visibility changes. It should also change when the description changes. | First build | Kept |
| CON-203 | A connector must be able to say which definitions changed or disappeared since a given time or version. | First build | Kept |
| CON-204 | A connector must be able to confirm that one stable id still exists. | First build | Kept |
| CON-205 | A connector should say which user groups can see each definition, if the source tool has such rules. | First build | Kept |
| CON-206 | The system must map each definition to a domain. The mapping is per source: the hint that the tool gives, plus a map of the names of the tool to the domains of the system that an administrator sets for that source. In the first build the Cube connector gives the hint as the domain of the view (CON-516). A hint never creates a domain. A term takes the domain all its definitions agree on: a dimension whose views lie in different domains, or in a view without one, is shared and has no domain. An administrator decides changes to a term without a domain, also their own (FR-206). | First build | Kept |
| CON-207 | The system must not copy definitions. It may store the id, the kind, the name, the title, a short description (marked as a copy and refreshed at each update) and the change mark. It must never store a calculation or a query. A screen may show the stored copy, at most 500 characters, labelled as a copy with the date it was read, and must link to the source for anything more (FR-136). | First build | Kept |
| CON-208 | Items must refer to definitions by stable id, which is a vocabulary key or a definition id, never by display name. A vocabulary term holds the definition ids it stands for: a metric one at most, a dimension one for each view of the source that has a member of its name. | First build | Kept |
| CON-209 | When a connector reports a change in a referenced definition, the system must mark each affected item `needs_check`. It must add the item to the queue of the owner and tell the chat channel of the domain. For a definition that an item only mentions, the system must not mark the item. It must add a note to the queue of the owner and to the list of stale links, and the link must show `source_changed`. A dimension that holds several definitions affects an item only through its definitions in the views of the item's metrics, or through all of them when the item names no metric in one of its views, so a change in one view does not flag items about the metrics of another. | First build | Kept |
| CON-210 | When a referenced definition disappears, the system must mark each affected item `source_missing` and follow the same steps. It must show the new id if the connector knows it. For a definition that an item only mentions, the item is not marked and the link shows `source_missing`. A dimension that holds several definitions affects an item only through the definitions that CON-209 names. | First build | Kept |
| CON-211 | An owner must be able to record "checked, still correct" for a flagged item. The system must store the new change marks, record who did it, and create a new edition. | First build | Kept |
| CON-212 | The system must never treat a missing or unknown change mark as checked. | First build | Kept |
| CON-213 | While a connector is unavailable, the system must keep the last known change marks and must not flag items because of the outage. | First build | Kept |
| CON-214 | While a connector is unavailable, mentions must keep their last known status and must not change status because of the outage. | First build | Kept |

### 6.4 Person-started context capture and chat connectors

A person starts these. Automatic content sources are in section 6.5.

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| CON-301 | A context source connector must read a document, message or ticket only when a signed-in person asks, and only with the access that this person has. | First build | Kept |
| CON-302 | The connector must return only a link, a short quote, the date read and a change mark. The system must store no more. | First build | Kept |
| CON-303 | The system must never copy a whole source system. | First build | Kept |
| CON-304 | The chat connector must receive the message action, send notices (FR-115, FR-212, FR-221), and map chat users to system identities by verified email address. [OQ-11] | First build | Kept |
| CON-305 | Connectors for documents and tickets should be available. | Later | Kept |
| CON-306 | The system should check on a schedule whether linked evidence has changed or disappeared, and flag the item. | Later | Kept |

### 6.5 Automatic content sources

A content source reads documents on a schedule, as a service identity, and turns them into drafts. It never adds to the library by itself: an owner reviews every draft like any other proposal.

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| CON-601 | An administrator may add a content source: a connector that reads documents from the folders, spaces or pages that the administrator chose, as a service identity with read-only access. | First build | Kept |
| CON-602 | Each chosen scope must map to exactly one domain. Drafts from it go only to the owners of that domain. | First build | Kept |
| CON-603 | Each new or changed document must produce at most one draft proposal, through the same write path and checks as any proposal, with the creation channel `source`, provenance that names the source, and a mark on every field (FR-121). Audience, risk, owner and links are never inferred. | First build | Kept |
| CON-604 | A content source must never accept, publish or change an accepted item or an edition. | First build | Kept |
| CON-605 | For each document the system stores only its id in the tool, its link, the date read, a change mark and a quote of at most 500 characters. A draft holds only the fields of the proposed item, within the item limits. The system never stores a whole document. | First build | Kept |
| CON-606 | A changed document must replace its open draft instead of adding one. A discarded draft must not be offered again for the same change mark. | First build | Kept |
| CON-607 | A source must cap new drafts per day. The other documents wait. | First build | Kept |
| CON-608 | A document that appears to name people must be skipped unless an owner drafts it by hand. Text that reads like instructions must be flagged. | First build | Kept |
| CON-609 | A document that is deleted, or leaves the chosen scopes, must withdraw its open draft. An accepted item that cites it as evidence must be listed for its owner. | First build | Kept |
| CON-610 | The system does not copy the sharing of a document. Sources must say so when an administrator adds the source. | First build | Kept |
| CON-611 | A content source (Markdown in Git, Google Drive through a service account) must turn documents into suggestions, one per document, grouped under the read that made them. A sync never publishes. | First build | New |
| CON-612 | A definitions integration may have a figures capability, with a declared host, a data contact and a switch that is off by default. The connector declares the capability in its manifest and reads one figure from the data endpoint an administrator sets, read only, with a token kept in the secret store and sent only to that endpoint's origin (its scheme, host and port: the declared host); a new origin forgets the token. The host's name is looked up once and the connection pinned to an answer that is public. Switching figures on needs the endpoint, its token and a data contact. (Amended 28 Oct 2026: the endpoint, the token's binding and what switching on needs.) | First build | New |

### 6.6 Identity connectors

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| CON-401 | An identity connector must sign in people and give their group names. | First build | Kept |
| CON-402 | The first build must take identity and group names from Cube Core. It must not run a separate directory of accounts or groups. Other providers should use the same interface later. | First build | Kept |
| CON-403 | If identity or group data is missing or cannot be checked, the system must deliver only items for the audience `all`, or give no access. | First build | Kept |
| CON-404 | An identity connector must only read accounts and groups. | First build | Kept |

### 6.7 Future connectors

These are not part of the first build. Each one needs only the interface above, and the extra points in the last column.

| Connector | Kind | Extra points it needs |
| --- | --- | --- |
| dbt project (semantic models and metrics) | Definition source | An id format such as `dbt:model.name`; a way to read project files or the dbt manifest; a map from dbt groups to domains. |
| LookML (Looker) | Definition source | An id format such as `lookml:view.field`; a reader for LookML files; a way to detect changes in files. |
| Data catalogue (for example DataHub, Atlan or OpenMetadata) | Definition source | Change events or polling; import of owners and glossary terms as hints; read-only API access. |
| Open interchange file (Apache Ossie) | Definition source | A reader for the interchange format; a way to say that no group information exists (section 7.5). |
| Document tool (for example Google Docs, Notion or Confluence) | Content source and context source | For a content source: a service identity on chosen folders or pages, a change feed or polling, and the text of a page. For a context source: sign-in on behalf of the person; link, quote and change mark of a page. |
| Ticket tool (for example Linear or Jira) | Context source | The same as a document tool. |
| Other chat tool (for example Microsoft Teams) | Chat notice and context source | A message action; a way to post notices. |
| Other identity providers | Identity | Group names from claims; discovery by OpenID Connect. |

## 7. Getting definitions from Cube

This section is about the first definition source connector. It describes how the system can get metric and dimension definitions from Cube. It compares the routes, recommends one, and states the requirements. Facts were checked against public sources on 2026-10-07. Section 7.6 lists the sources.

### 7.1 What Cube offers

- **Model files.** A Cube data model is a set of files in YAML, JavaScript or Python. They define cubes and views. A cube holds measures (numbers), dimensions and segments. A view shows a chosen set of members to users. Members can have a description, a `meta` section for custom data and a `public` flag. Cubes and views can have an `access_policy`.
- **Metadata API.** A running Cube server answers `GET /cubejs-api/v1/meta`. The answer lists cubes and views with their measures, dimensions, segments, joins and folders. Each measure and dimension has a name, a title, a description, a type and `meta`. The documented answer does not include the calculation of a measure. The `meta` scope is open by default. An operator can limit it to service accounts.
- **Access policies.** A policy gives a user group access to members (`includes` and `excludes`), filters rows, and can mask values. Cube Core can map a login to groups with a setting named `contextToGroups`.
- **Agent hints.** The documented key for hints to the agent of Cube is `meta.ai_context`. Cube reads it on views and members only. It cuts text at 2,000 characters without warning.
- **Hosted MCP server and agent features.** The hosted product of Cube has an MCP server with 30 tools (on 2026-10-07). The tool `searchDataModel` finds views and members by similarity and returns short records. The tool `runQuery` queries data as the signed-in person. People who can edit the model can also list and read the raw model files. The hosted product also has its own agent, with rules and certified queries kept in the model repository. The documentation describes these features as part of the hosted product, not of self-hosted Cube Core.

### 7.2 What Apache Ossie is, and how it relates to Cube

Apache Ossie is an open specification for exchanging definitions of metrics, dimensions and their relations between tools. It used to be called Open Semantic Interchange. It is an Apache Incubator project. Its source is at `github.com/apache/ossie` under the Apache 2.0 license.

- **Maturity.** The specification in the repository is version `0.2.0.dev0`. The repository marks it as a draft: "do not depend on this version in production". The last stable version listed in the specification is 0.1.1, dated 2025-12-11. The repository was created in November 2025 and changes often.
- **Support.** The project lists more than 50 supporting organisations. Cube is one of them. In September 2025 Cube announced that it planned open adapters to read and write the format.
- **The Cube converter lives in the Ossie project.** Its folder `converters/cube` holds an offline command-line tool in Python. It reads Cube model files and writes an Ossie document, and it can do the reverse. It needs no Cube server. It maps a Cube view to an Ossie model and cubes to datasets. It converts YAML models only. It refuses models that use `extends`. It keeps Cube-only data, such as `access_policy`, in an extension area, because access policy has no meaning in Ossie.
- **Cube itself does not read or write Ossie.** The public documentation of Cube and the public source repository of Cube do not mention Ossie (searched on 2026-10-07). The converter is an outside tool, not a feature inside Cube.
- **Other tools.** The same project holds converters for dbt, Snowflake, Databricks, Salesforce, GoodData, ThoughtSpot, Sigma and others. One Ossie connector could therefore serve many source tools.

### 7.3 The routes compared

| Route | What we get | Stays current by | Maturity | Main limits |
| --- | --- | --- | --- | --- |
| A. Read the model files from the Git repository at a tagged version | Everything we need: names, titles, descriptions, types, calculations, public flags and access policies. | Reading a new tagged version when it appears. | The documented file format of Cube. It is the same source that Cube itself runs. | Needs read access to the repository. YAML is easy to read. JavaScript and Python files need extra work. |
| B. Call the metadata API of a running Cube server | Names, titles, descriptions, types and `meta`, as the caller is allowed to see them. | Asking the server on a schedule. | Documented. | Needs a running server. The answer has no calculation. It depends on who asks. |
| C. Convert the model files to an Ossie file and read that | The common parts: datasets, fields, metrics and relations. | Running the converter when files change. | New. The specification is a draft. The converter belongs to a young project. | One more step that can fail. Access policy loses its meaning. Some Cube features are kept only in an extension area. |
| D. Use the hosted MCP server of Cube | Definitions found by similarity, as the signed-in person. Raw files for people who can edit the model. | Asking at request time. | Documented. Hosted product only. | No change detection. It runs as a person, not as a service. It does not fit regular updates. |

### 7.4 Recommendation

**Use route A first. Add route B as a live check when a Cube server exists. Plan route C as a second connector later.**

Reasons:

1. The model files hold everything we need. They hold the calculation, so the change mark can detect a change of meaning. They hold the access policy, so the system can respect it.
2. The files change in step with the tagged versions that go to production. Reading a tagged version is simple and repeatable. It needs no running server.
3. Route C adds a conversion step and depends on a draft specification. It also loses the access policy as meaning. It is not a good first route for one source tool.
4. Route C has strong long-term value, because one Ossie connector could serve many tools. So the system keeps its connector interface close to what Ossie describes. This makes an Ossie connector easy to add.
5. Route D has no change detection and runs as a person, so it does not fit regular updates. It is still useful in another way. An agent can use the MCP server of Cube for data and the MCP server of this system for context. OQ-2 covers how to link the two.

The alternative, route C from the start, is recorded as an open question (OQ-9). Three things would change the recommendation. The Ossie specification reaches a stable release. Or the organisation wants one route for several tools. Or Cube ships Ossie export inside its own product.

### 7.5 Requirements for the Cube connector

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| CON-501 | The Cube connector must be the first definition source connector. | First build | Kept |
| CON-502 | The connector must read the Cube model files from a Git repository, at a version set in configuration (for example the newest tag). It must use a read-only credential. | First build | Kept |
| CON-503 | The connector must list the measures and dimensions of every view and cube that is not hidden. The id must be `cube:` followed by the view or cube name, a dot and the member name. | First build | Kept |
| CON-504 | The connector must read YAML files. It must show a warning in the operations view for each file that it cannot read, for example a JavaScript or Python file. It must not skip such files silently. | First build | Kept |
| CON-505 | The change mark of a member must come from its type, calculation, description and visibility. A source whose change marks cannot see calculations (for example one that reads only metadata from an API) must say so, and Sources and the catalogue must show it. | First build | Kept |
| CON-506 | The connector should look for a new version of the repository at least every hour. Administrators must be able to start a refresh at any time. The time from a published change to the flag on an item must be at most 24 hours. | First build | Kept |
| CON-507 | When a Cube server exists, the connector may call the metadata API with a service identity that can see the whole model, to confirm that members exist. This must not replace the files as the main route, because the answer has no calculation and depends on the caller. | Later | Kept |
| CON-508 | The connector must read the access policies in the model files. For each member it must give the groups that can see it: the `includes` and `excludes` of the member level, and the hidden flag. | First build | Kept |
| CON-509 | The system must not deliver an item that names metrics to a person whose groups can see none of those metrics. Items without metrics are not affected. If a connector gives no group information, every definition counts as visible to all. [OQ-9] | First build | Kept |
| CON-510 | The connector must ignore row filters and masking rules. The system holds no data rows. | First build | Kept |
| CON-511 | The connector must not call the data query endpoints of Cube. It must read model files and metadata only. | First build | Kept |
| CON-512 | The connector may read a list of renamed members (old id, new id) from configuration. If a list exists, the flag on an item must name the new id. | First build | Kept |
| CON-513 | The connector should read the agent hints of Cube (`ai_context`) as a read-only baseline, so that the assistant can warn when an item contradicts them. The system must not copy them into items. | Later | Kept |
| CON-514 | The connector may read the values of a dimension from Cube if the organisation allows it. Without it, owners keep dimension values in the vocabulary. Cube metadata lists members, not the values of a dimension. | Later | Kept |
| CON-515 | A second connector should read Ossie documents as a definition source, with ids such as `ossie:<model>.<name>`. It depends on a stable Ossie release (OQ-9). | Later | Kept |
| CON-516 | The connector must read the `meta.domain` entry of each view as the domain of its members. It must show a warning in the operations view for each view that has none. [OQ-24] | First build | Kept |
| CON-517 | Scope inputs (`get_facts`, `find_facts`, `report_gap` and drafts) must accept a definition id (`cube:orders.orders`) or a source member name (`orders.orders`) and resolve it through the term's definition references: the member of any view that a shared dimension holds resolves to that one term. A member that no term points at must come back with the closest names, never be read as the words inside it. | First build | Kept |

### 7.6 Sources

- Documentation of Cube: [REST API and API scopes](https://docs.cube.dev/reference/core-data-apis/rest-api.md), [Load Metadata](https://docs.cube.dev/api-reference/data/load-metadata.md), [Access policies](https://docs.cube.dev/docs/data-modeling/data-access-policies.md), [Member-level security](https://docs.cube.dev/docs/data-modeling/access-control/member-level-security.md), [AI context](https://docs.cube.dev/docs/data-modeling/ai-context.md), [MCP server](https://docs.cube.dev/docs/integrations/mcp-server.md), [Agent configuration](https://docs.cube.dev/admin/ai/index.md), [Cube Core](https://docs.cube.dev/cube-core/index.md).
- Announcement of Cube, 2025-09-23: [Cube joins the Open Semantic Interchange launch initiative](https://cube.dev/blog/cube-joins-snowflakes-open-semantic-interchange-launch-initiative).
- Apache Ossie: the [repository](https://github.com/apache/ossie), its core specification (`core-spec/spec.md`), its converter overview (`converters/README.md`), the guide of the Cube converter (`converters/cube/README.md`), and the [Apache Incubator proposal](https://cwiki.apache.org/confluence/spaces/INCUBATOR/pages/430408796/OssieProposal).

## 8. Quality requirements

Values marked "proposed" are starting values. Measure them in Phase 1. A requirement marked Hosting stage waits for the hosting stage (section 11.7). The design size is 5,000 accepted items, 5,000 people and 100,000 deliveries a month. This is about ten times the expected size.

The first two digits of an NFR number show its area. The areas are 01 simplicity, 02 security, 03 privacy, 04 reliability, 05 speed, 06 cost, 07 monitoring, 08 maintenance, 09 neutrality, 10 deployment and 11 accessibility.

### 8.1 Simplicity and getting started

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| NFR-011 | A first-time contributor with no training must be able to submit a valid proposal through the web form or the chat tool in under 15 minutes. | First build | Kept |
| NFR-012 | The service must be one deployable unit: one container image and one database. It must use no other data store, queue or cache. | First build | Kept |
| NFR-013 | A new engineer must be able to run the whole service on a laptop with at most five commands in under 15 minutes. The laptop quick start must use a fake sign-in, demo items and a mock model. A full local run uses Cube Core and calls the model provider directly. | First build | Kept |
| NFR-014 | A one-page architecture overview, a one-page contributor guide, an owner guide and a domain start guide must exist before the first domain starts (section 11.4). | First build | Kept |
| NFR-015 | A contributor must be able to propose context without knowing Git, YAML or MCP. | First build | Kept |
| NFR-016 | Texts in the user interface must follow the plain-language rules of this document. | First build | Kept |

### 8.2 Security and access

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| NFR-021 | All traffic between computers must use TLS 1.2 or later. Traffic inside one computer, as in the local first build, may use plain HTTP. | First build | Kept |
| NFR-022 | Automatic tests must run in every build. They must cover the login and token rules: reuse of a sign-in code, a missing proof key (PKCE), a wrong audience, and reuse of a refresh token. | First build | Kept |
| NFR-023 | The MCP server must create a new server object for each request and share no state between requests. | First build | Kept |
| NFR-024 | Item text, the words and titles in links, evidence quotes, notes and pasted text must be treated as untrusted data. They must never become instructions to a model. The test set must contain prompt-injection cases. | First build | Kept |
| NFR-025 | Secrets must live in a secret store, never in the repository, the image or logs. Every role must have the least access it needs. | First build | Kept |
| NFR-026 | The database role of the application must not be able to change or delete item versions, editions, decisions or history entries. | First build | Kept |
| NFR-027 | Every build must scan dependencies for known problems. Versions must be fixed. An upgrade of the MCP library or the login library must pass the connection and login tests. | First build | Kept |
| NFR-028 | A security review of the public MCP server must pass before the first domain starts (section 11.4). | First build | Kept |
| NFR-029 | If an identity or a group is missing or cannot be checked, the system must refuse access or give only the content for everyone. It must never give more access in this case. | First build | Kept |

### 8.3 Privacy

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| NFR-031 | An automatic test must fail if a column that identifies a person, session, device or address is added to the delivery, gap or feedback tables. | First build | Kept |
| NFR-032 | MCP logs must hold no question text, token, user identifier or name an agent gives itself (FR-410). Load balancer logs, if on, must be kept at most 30 days and never exported. | First build | Kept |
| NFR-033 | Rate counters and daily spending counters per person must live in memory or in a table that expires within 24 hours. They must hold no content. | First build | Kept |
| NFR-034 | Retention periods must be settings, and a job must enforce them (FR-612). History entries must hold no question content and be kept for the period set in OQ-6. | First build | Kept |
| NFR-035 | A plain notice of what is recorded and what is not must be linked from the interface, the MCP tool documentation and the contributor guide. | First build | Kept |
| NFR-036 | Items, test questions and test transcripts must hold rules and situations, not personal data about customers or staff. | First build | Kept |

### 8.4 Reliability

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| NFR-041 | The MCP server must be available 99.5 percent of each calendar month, measured at the load balancer, not counting announced maintenance (proposed). | Hosting stage | Kept |
| NFR-042 | `get_facts` must depend only on the database and on cached keys for checking tokens. A failure of any connector, the chat tool, the model provider or the identity provider must not make it fail. A database failure must give `check_failed`. A failure to write a delivery record must not fail the reply. | First build | Kept |
| NFR-043 | Production must run at least two instances in two zones. Updates of the software must cause no planned downtime. | Hosting stage | Kept |
| NFR-044 | The database must have backups, and a restore drill must pass before the first domain starts (section 11.4). At the hosting stage, backups must be automatic. They must allow a restore to any moment in the backup period. Targets: lose at most 15 minutes of data, restore within 4 hours (proposed). | First build | Kept |
| NFR-045 | The digest of an edition, computed again from its content, must equal the stored digest. An edition must convert to one canonical JSON document, so that a read-only copy in Git can be added later without a change to the data model. The digest and the JSON must include mentions. | First build | Kept |
| NFR-046 | Database changes must be plain SQL files, applied in order, one at a time, at start-up, and tested on a copy first. | First build | Kept |
| NFR-047 | Background jobs must be safe to run twice. A failed job must retry with growing waits, and then raise an alert. | First build | Kept |
| NFR-048 | Dates must be UTC calendar days. A validity period includes its start day and excludes its end day. [OQ-12] | First build | Kept |

### 8.5 Speed

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| NFR-051 | `get_facts` must answer in 300 ms or less for 95 percent of requests. It must answer in 1 second or less for 99 percent. This applies at 20 requests a second with 5,000 accepted items (proposed). | First build | Kept |
| NFR-052 | The matcher must finish in 50 ms or less for 95 percent of calls with 5,000 accepted items (proposed). | First build | Kept |
| NFR-053 | A replay of 100,000 delivery records over a candidate edition must finish in 10 minutes or less (proposed). | First build | Kept |
| NFR-054 | Results of levels 1 to 3 for a proposal must be ready within 30 seconds. An answer test run must start within one minute and finish within 30 minutes for an impact set of up to 60 answers (proposed). | First build | Kept |
| NFR-055 | `get_related` must answer in 100 ms or less for 95 percent of requests with 5,000 accepted items (proposed). | First build | Kept |
| NFR-056 | A search for people (FR-812) must answer in 150 ms or less for 95 percent of searches with 5,000 people. The list must show its first 50 people in 300 ms or less (proposed). | First build | Kept |

### 8.6 Cost

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| NFR-061 | Infrastructure for one test environment and one production environment should cost no more than about 250 US dollars a month at list price. This is an estimate to check again. | Hosting stage | Kept |
| NFR-062 | Model spending must be capped (FR-409), and the cost of every test run must be recorded (FR-510). | First build | Kept |
| NFR-063 | The operations view must show daily model spending. At the hosting stage it must also show infrastructure cost. An alarm must fire at 80 percent of the monthly model cap. | First build | Kept |

### 8.7 Monitoring

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| NFR-071 | The service must write structured logs with a request id. | First build | Kept |
| NFR-072 | Alarms must exist for failed jobs, out-of-date connectors and daily model spending. At the hosting stage, alarms must also exist for error rate and delay at the load balancer, restarts, and database load and free space. | First build | Kept |
| NFR-073 | The change check job, the weekly scorecard and the retention job must each show a last-success time. A missing run must raise an alert. | First build | Kept |
| NFR-074 | The service should pass on trace context from MCP requests where clients send it. It may export traces later. | Later | Kept |

### 8.8 Maintenance

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| NFR-081 | The service must use one programming language (TypeScript) for interface, server, MCP and tests, as one package. The item schema, the matcher and the edition builder must sit in a module that does no input or output. [OQ-13] | First build | Kept |
| NFR-082 | Tests must include unit tests of that module, integration tests with a real database, MCP connection tests for each AI client family in use, and few end-to-end tests. Answer tests must never run as unit tests. | First build | Kept |
| NFR-083 | The matcher must be checked against a second, independently written version on generated items and questions. | First build | Kept |
| NFR-084 | Each decision in section 17 must have a short written decision record. | First build | Kept |
| NFR-085 | A new service or data store must not be added without a decision record. | First build | Kept |
| NFR-086 | Dependencies must be open source with permissive licenses. A dependency with another license needs a decision record. | First build | Kept |
| NFR-087 | The golden job specs (J1 to J30 of the approved mockup) must pass in mock mode and against the real service before a release. | First build | New |

### 8.9 Neutrality and no lock-in

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| NFR-091 | Names, addresses and settings that belong to one organisation must be configuration or connector code, never core code. | First build | Kept |
| NFR-092 | Each role that calls a model (answering, judging, the assistant, test authoring) must name its provider and model in a setting. A provider must be one entry in a registry (its protocol adapter, key setting, base URL setting and the models it may serve with their prices), so another vendor or a second gateway is one more entry, plus one adapter only for a new protocol. | First build | Kept |
| NFR-093 | Items and editions must export as JSON that passes the published schema (FR-124). The export must include mentions. The system must use no closed storage format. | First build | Kept |
| NFR-094 | If a source tool is removed, its items must stay valid, with the references and the mentions marked unresolved. | First build | Kept |

### 8.10 Deployment

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| NFR-101 | The service must run as a container on any standard container platform with one PostgreSQL database. It must need no paid third-party product. | First build | Kept |
| NFR-102 | Infrastructure must be defined as code. The deployment pipeline must use short-lived credentials, not long-lived keys. [OQ-10] | Hosting stage | Kept |
| NFR-103 | PostgreSQL must be the only database. The system may use only extensions that managed database services commonly offer, for example `btree_gist` and `pg_trgm`. | First build | Kept |
| NFR-104 | The same container image must be promoted from test to production. | Hosting stage | Kept |

### 8.11 Accessibility

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| NFR-111 | The contributor, status and owner flows must meet WCAG 2.2 level AA. Color must never be the only sign of a status. A mention must show its type with a word or an icon, and a screen reader must read it as, for example, "Net revenue, metric". | First build | Kept |
| NFR-112 | Every flow must work with a keyboard and a screen reader. This includes choosing and removing a mention. Automatic accessibility checks must run in every build. | First build | Kept |
| NFR-113 | The contributor and status pages must work on a screen 360 pixels wide. Owner review may need a larger screen. | First build | Kept |

## 9. Open-source readiness

The organisation might one day release this product as open source. Other people could then write connectors for other vendors. Release is not a goal of the first build. The requirements below keep the option open. They are all marked Later. NFR-091 and CON-101 already keep company specifics out of the core in the first build.

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| OSR-101 | The repository must hold no secret and no company-specific name, address or data. A scan in every build must check this. The facts of one deployment stay outside the repository (section 16). | Later | Kept |
| OSR-102 | Company specifics (domain names, teams, tool addresses, vocabulary) must be configuration files, not code. | Later | Kept |
| OSR-103 | The repository must include a public example dataset: a fictional domain with invented items, vocabulary and test questions, and a fictional semantic layer model for the demo connector. It must be enough to run the system and its tests. | Later | Kept |
| OSR-104 | The repository must include an install guide, a settings reference, a connector guide, a contributor guide and a security note. | Later | Kept |
| OSR-105 | The connector interface must be documented as a public contract with a version number, and its conformance tests must be published so that any connector outside the repository can run them. Built-in connectors run them from the first build (CON-108). | Later | Kept |
| OSR-106 | No dependency may have a license that stops an open source release. | Later | Kept |
| OSR-107 | The choice of license is open (OQ-16). The repository must not assume one before that decision. | Later | Kept |

## 10. Architecture and technology

### 10.1 Shape

There is one service, one database and one image. The web interface, the write interface, the MCP server, sign-in, the assistant and the background jobs all run in that service. Connectors run inside it too. The domain core holds the item schema, the matcher and the edition builder. It does no input or output, and every other part calls it.

```text
  AI clients (through MCP)                         People (browser, chat tool)
        | signed in                                     | signed in
        +--------------------------+--------------------+
                                   v
                 (hosting stage: load balancer with TLS)
                                   |
   +-------------------------------v--------------------------------------------+
   | ONE SERVICE: one container image (hosting stage: two or more instances)    |
   |  Web interface   Write interface   MCP server   Sign-in (replaceable)      |
   |  Domain core: item schema, matcher, edition builder (no input or output)   |
   |  Assistant: uses the same functions as the MCP tools                       |
   |  Jobs: change checks, tests, weekly scorecard, retention, reminders        |
   |  Connectors: definition, content and context sources, chat, identity       |
   +---+------------------+-----------------------------+-----------------------+
       | SQL              | model provider              | read only
       v                  v                             v
   PostgreSQL        Language models         Outside tools: Cube Core (model files,
   (only database)   (chosen by a setting)   identity, groups, domains), chat tool
```

### 10.2 Recommended technology

This is the reference design. Any item can change by a decision record. Section 17 gives the reasons.

| Layer | Choice |
| --- | --- |
| Language | TypeScript on the current long-term-support version of Node.js, as one package |
| Server | Fastify, serving the API, the MCP server and the built interface |
| Interface | A React single-page application built with Vite, with a Markdown text field for guides and chips for mentions in the summary |
| Database | PostgreSQL 18, the only database and the system of record; range types for validity, full-text search, plain SQL migrations |
| MCP | The official TypeScript MCP library, version 2, with no server-side session |
| Sign-in and tokens | An OAuth 2.1 login server inside the service. In the first build it takes identity and groups from Cube Core and runs no separate directory of accounts. Better Auth is the default under test. `node-oidc-provider` and Keycloak are the alternatives. The MCP server checks tokens itself. |
| Jobs | pg-boss on the same database, running in the service |
| Assistant | The Vercel AI SDK (an open-source library) as a plain tool loop. Tools are defined once and shared with MCP. |
| Language models | Chosen by a setting (OQ-4). The first build calls the model provider directly. A managed service such as Amazon Bedrock is a choice for the hosting stage. |
| Tests | Vitest, a real database, MCP connection tests, a few Playwright flows, and generated tests (fast-check) for the matcher |
| Hosting | The first build runs on a local computer. At the hosting stage, any container platform will do (section 11.7). |

## 11. Delivery plan

A phase is done only when its definition of done holds. This plan gives no durations, because they depend on staffing and on the answers in section 14. Each requirement marked Later is planned for Phase 4 or Phase 5, unless the organisation decides otherwise. Each requirement marked Hosting stage waits for the hosting stage (section 11.7).

### 11.1 Phases

| Phase | Goal | What happens | Definition of done |
| --- | --- | --- | --- |
| 0. Decide and prepare | Remove the last doubts. | Test the form idea with three people, with mentions in the clickable mock (OQ-5). Sort existing context into "stays in the source tool" and "becomes items". Agree the test question format. Answer the questions marked Phase 0 in section 14. | The direction is confirmed or changed, and the Phase 0 questions are answered. No production code. |
| 1. Core system | Everything works with the demo domain. | Build the store, proposals, decisions and editions. Build the visibility rule, the matcher, the MCP server and the check report. Build the level 1 to 3 checks and the Cube connector. Build delivery records, sign-in with identity and groups from Cube Core, administration and the history log. Build mentions: storage, checks and links in replies. Build the local setup and the build pipeline. | Checks (b), (c), (d), (e) and (g) of section 11.2 pass. The login and token tests pass. |
| 2. Writing and review tools | Business people can propose. Owners can review. | Form with preview, status page, review queue, notifications, chat message action, assistant, question coach, gap counts, dashboard, answer tests through MCP, weekly scorecard. Chips for mentions, the backlinks panel, and link-follow tests of `get_related` behind the tool switch. | All checks of section 11.2 pass, including (a) and (f). Five people outside the data platform team complete proposals unaided in a trial. |
| 3. Start domains | Prove the method, one domain at a time. | Start one domain by section 11.4. Four weeks of start-up support, then the next domain. | The first domain meets section 11.5. The first proposal from outside the data platform team is accepted. Results per domain are reported. |
| 4. Connect and harden | Join the tools' own channels. | Pointer lines in the source tool's files [OQ-2]. Checks of source changes before they merge. Trial edition. A trial of the context receipt (MCP Apps). More connectors. Count export. Proposal expiry. Optional MCP resource links for mentions. | The reach measure of section 1.7 is defined and reported. |
| 5. Learning and copy | The system improves with human control. | Topic grouping with privacy limits, ranking by demand, gap verification, test caching, trace export, and a read-only copy of accepted editions in Git. | The median age of gaps falls. Coverage rises for the most asked topics. |

The hosting stage (section 11.7) is not a numbered phase. The organisation decides when it happens.

### 11.2 The core system is complete when

- (a) The demo domain meets every check of section 11.5, with demo content.
- (b) A deliberately wrong item is blocked by the checks. An attempt to accept a version without an owner decision is refused by the database.
- (c) Going back to an earlier edition works.
- (d) MCP connection tests pass for each AI client family in use (OQ-8).
- (e) The visibility rule and the matcher pass every row of Appendix A, in any order, and the generated tests find no difference from the second version.
- (f) At least two of three people outside the data platform team complete the proposal flow without help.
- (g) The privacy test (NFR-031) and the log tests pass.

### 11.3 No start checks

Removed on 14 October 2026. A domain has no automatic start checks and no state: every domain that exists is served (FR-802). Section 11.5 says when a team has started a domain well.

### 11.4 How a domain starts

A domain's items reach agents as soon as they are accepted. These steps are how a team starts a domain well; none of them is a switch in the system.

| Step | What happens | Result |
| --- | --- | --- |
| 1. Entry check | The domain exists in the settings, with a summary and a description of what it holds. At least one owner is named. The owner has read the one-page guide. | The domain in settings |
| 2. Scope session (60 minutes) | The owner and an engineer list what is in and out of scope, the ten most important metrics, dimensions and markets, and the caveats that people already know. | Scope note and vocabulary additions |
| 3. First items | The team collects existing context: notes in tool files, lists of lessons, known data limits, open questions. The assistant drafts items or marks them "stays in the source tool". The owner accepts them. | First items with evidence and owner |
| 4. Test questions | 25 to 40 questions with two wordings, questions that expect no item, reference queries for numbers, and a held-out third. Two experts agree on every expected result. | Test set and first baseline |
| 5. References | Every reference resolves. Each metric maps to the domain. | No unresolved reference |
| 6. Dry run | The held-out checks pass. AI clients are tested. Failing cases are understood. | Dry-run report |
| 7. Announce | A person outside the data platform team completes one real proposal. The owner accepts it. The domain is announced in its chat channel. | People know where to add context |
| 8. Start-up support (four weeks) | Weekly review of gaps with the owner. Review times are tracked. One retirement or expiry is practised. | Exit review |

### 11.5 Definition of done for a domain

| Check | Threshold |
| --- | --- |
| Ownership | Owners named. The chat channel reaches them. Review time agreed and tracked. |
| Content | The first items cover the top metrics and known caveats. Every item has evidence, an owner, a review date and a risk level. None is past its review date. |
| References | None unresolved. Change marks current. The change check job ran without error for seven days in a row. |
| Test set | 25 to 40 questions, two wordings, questions that expect no item, held-out part, agreement of two experts recorded. |
| Quality | The targets of section 1.7 on the held-out part. |
| Delivery | `get_facts` works from at least two AI client families in the dry run, shown by the client label. |
| Method proven | One accepted proposal from outside the data platform team. One rejection with a reason. One retirement or expiry. One return to an earlier edition, in the demo domain or a trial edition. |
| Gaps | The gap list has an owner. No gap is older than the agreed age without a decision. |
| Monitoring | The dashboard shows deliveries, freshness, gaps and test results. The domain is in the weekly scorecard. |
| Exit | Four weeks of start-up support without a severe incident (a wrong caveat reaching an answer). |

### 11.6 Order of domains

1. Start with a domain that the data platform team owns and for which existing context is easy to find. This proves the method without needing another team.
2. Then let the counts of questions without context decide. Also consider legal exposure and the time that owners have.
3. Start one domain at a time per owner team, so that start-up support is real.
4. A domain owned by a team outside the data platform team is the best test of an owner from outside. It is not the first domain. [OQ-15]

### 11.7 The hosting stage

The first build runs on a local computer. It needs no cloud account of the company. It calls the model provider directly. It takes identity, groups and domains from Cube Core.

The hosting stage comes after the first build. It moves the service to a platform that the whole organisation can reach. The organisation decides when it happens (OQ-10). It covers:

- The cloud accounts, the region and the network rules (OQ-10).
- Reach from the internet over public HTTPS (FR-413, OQ-4).
- The model route, for example Amazon Bedrock with the `eu.` geographic inference profile only (OQ-4).
- Two instances in two zones, availability, automatic backups and alarms at the load balancer (NFR-041, NFR-043, NFR-044, NFR-072).
- Infrastructure as code, and the move of one image from test to production (NFR-102, NFR-104).
- Infrastructure cost (NFR-061, NFR-063).

Each deployment keeps its own plan for this stage outside the repository (section 16).

## 12. Acceptance and verification

| Area | The system is accepted when | How we check |
| --- | --- | --- |
| Contribute (FR-1xx) | At least two of three people complete "add context" and "update context" without help, first on a mock and then on the real interface. A draft survives a browser restart. A bulk import dry run creates proposals and accepts none. Text with a password pattern is rejected. A mention in the summary or the body shows in the preview and as a link in the reply. The database refuses a version whose text and mention links disagree. | Test with people, browser tests, integration tests, database tests |
| Review (FR-2xx) | An attempt to accept without an owner decision and passing checks fails through the database, the interface and the administrator tools. A decision does not carry to a later version. High risk needs two approvals. Proposer and accepter differ at normal and high risk. A preview is visible only to allowed people. Reminders fire. | Database tests, a bypass test in every build, integration tests |
| Delivery (FR-3xx) | Every row of Appendix A passes. The generated tests find no difference. `get_facts` makes no model call (tested with the network to model hosts blocked). Every reply has a check report, an edition number and source details. A cut is never silent. A mention never changes which items are delivered. A link never names a target that the caller may not see. `get_related` is off in the default tool list. MCP connection tests pass for each AI client family. | Unit and generated tests, connection tests, a network-blocked test |
| Access (FR-4xx) | A token with a wrong audience or issuer is refused. Code reuse, a missing proof key and refresh token reuse are refused. A rate limit gives a retry hint. A spending limit stops work and explains. Logs hold no user identifier or question text. | Login test suite, log scan test, load test |
| Testing changes (FR-5xx) | A deliberately wrong item is blocked. A with-and-without run lists the expected flips on demo data. A replay reports the expected number of changed deliveries on a demo log. Runs record the digest of tool descriptions, the model and the client. The weekly scorecard posts, and its absence raises an alert. | Integration tests on demo data, a trial run, an alert test |
| Missing context and privacy (FR-6xx) | The schema test finds no person column. A test sentence never appears in a database dump, a log or an export. A thousand calls from one test person leave no record linked to them. Counts and topics are right on demo data. Small counts are hidden. The retention job deletes the records that are due. | Schema test, test sentence search, retention test, dashboard tests |
| Assistant (FR-7xx) | The assistant cannot accept, publish or edit an accepted item. Its check results equal the format check results. Drafts show their sources and are labelled. Its test cases pass with a mock model. A spending limit stops it. | Permission tests, test cases, budget test |
| Administration (FR-8xx) | History entries cannot be changed or deleted. Every change to a domain creates an entry. A stop switch works within 60 seconds. Every domain that exists is served, with no state or start check. | Database tests, timed test, integration tests |
| Connectors (CON-xxx) | A connector failure does not change a reply. A connector cannot write to its source (its credential has no write right). A changed or removed definition flags the item within one check cycle. The demo connector passes the connector tests. An out-of-date source raises an alert without flagging items. | Failure tests, credential test, tests on recorded sample data |
| Content sources (CON-6xx) | On recorded documents, the same document read twice makes one draft, a change replaces the open draft, and a deletion withdraws it. No draft is accepted or served without an owner. Only the id, link, date, change mark and quote are stored per document. A document that names people is skipped. The draft cap holds. | Tests on recorded sample documents |
| Cube connector (CON-5xx) | On recorded Cube model files, a renamed member flags its items. A member hidden from a group hides items that only name that member, for that group. Unreadable files give warnings. A view with no `meta.domain` gives a warning. A removed or renamed member marks the mentions of it `source_missing` and informs the owner, and the items are still delivered. No data query is sent. | Tests on recorded sample files, network log check |
| Quality (NFR) | The load test meets the proposed targets. With every connector, the chat tool, the model provider and the identity provider switched off, `get_facts` still works. A restore drill passes. Accessibility checks pass and a manual review is done. A new engineer starts the service in 15 minutes. At the hosting stage, infrastructure deploys from empty with one pipeline. | Load test, failure tests, restore drill, accessibility checks, timed start, infrastructure apply |

## 13. Risks

| ID | Risk | What reduces it | Early sign |
| --- | --- | --- | --- |
| R1 | An item that is not accepted reaches an answer because of a bug. | Database rule (FR-205), bypass test in every build, history log, stop switch, regular sample check. | An audit query finds an accepted version without a decision. |
| R2 | Review is too slow, so context moves back into chats. | Risk levels, a fast path for low risk, several owners, reminders, an agreed review time. | Queue age and median review time. |
| R3 | The data platform team prefers to review in Git. | Test with three people (OQ-5), including reviewers. A later read-only copy in Git. | Share of decisions made in the system. |
| R4 | Two sources of truth: instructions in the source tool and items here. | Definitions and routing stay in the source tool. Items cannot change them (FR-210). One pointer line (OQ-2). | Conflicts found by reviewers. |
| R5 | Few business people propose. | Chat message action, assistant, gap-to-draft, owner office hours. | Share of proposals from outside the data platform team. |
| R6 | The form has too many fields, so people give up. | Six visible fields. All else is derived (FR-104). Tested in Phase 0. | Drafts that are never submitted. |
| R7 | Items go stale as definitions change. | Change marks, a change check at least hourly, review dates. | Share of items in `needs_check`. |
| R8 | The source tool is not yet in production, or its edition is not settled. | The connector reads files at tagged versions, so the running edition does not matter (OQ-9). | No server running by Phase 3. |
| R9 | Test cost and flaky results. Teams optimise for the test set. | Impact-set runs, repeats for flips, held-out part, realistic wordings, spending limits, reading transcripts. | Flaky rate. Gap between test score and feedback. |
| R10 | MCP and login standards change. AI clients differ. | No server-side session, fixed library versions, tests per client, no dependency on optional extensions. | Client failures after upgrades. |
| R11 | The login server component is young and exposed. | Own token checks, login tests in every build, advisory watching, a replaceable server, a test with three clients (OQ-14). | New security notices. |
| R12 | Agents do not ask for context. | Tool descriptions, a pointer line (OQ-2), the reach measure. | Low ratio of context requests to data queries. |
| R13 | The privacy choice hides detail that owners need. | Topics from scope, notes, weekly tests through the real interface, an open question on redacted text (OQ-6). | Owners cannot explain the top topics without context. |
| R14 | Prompt injection through evidence, notes or pasted text. | NFR-024, separate fields, propose-only agents, attack cases in the test set. | Failing attack cases. |
| R15 | Sensitive content in items. | Text check (FR-117), audiences, the high-risk path. | Check hits. |
| R16 | Public exposure of the MCP server at the hosting stage. | Sign-in on every tool, read-only tools, rate limits, security review (NFR-028). | Unusual request counts. |
| R17 | Model spending grows, mostly from tests. | Cost estimates, impact-set runs, caps, cheaper judging models. | Daily spending alarm. |
| R18 | Too much context makes answers worse. | Size limit (FR-321), with-and-without tests, the rule "only add what a model could not know". | Negative test differences. |
| R19 | A mention is mistaken for applicability, by owners or agents. | A separate kind of link, FR-131, FR-335, the wording of the instructions, a test that a mention is not scope. | Items delivered "because of a mention" in review. |
| R20 | Agents follow too many links: more calls, more context, worse answers (extends R18). | Limits on steps and nodes, links cut first, `get_related` off by default, paired tests. | Cost and calls per answer. Negative test differences. |
| R21 | A hidden target leaks through a link, a count or a title. | The same visibility rule, counts over visible items only, "not found" for a hidden start, tests with planted hidden names. | A planted hidden name appears in a reply. |
| R22 | Link rot: retired, replaced or missing targets. | Link statuses, a list of stale links for owners, the replacement chain. | Share of items with stale links. |
| R23 | Over-linking: authors mention everything. | A limit of 50 mentions (FR-134), a short writing guide, no automatic mentions. | Mentions per item. |
| R24 | The mention editor costs too much, or is hard to use with a keyboard or a screen reader (chips, paste, undo). | A text field first, a trial of the chip input before it is built, the release checks of the design contract. | Failing checks in the trial. |

## 14. Open questions and decisions

Each question has plain options. The first option is the recommended one. "Needed before" names the phase that cannot finish without an answer. A question marked *Decided* already has an answer. The other options stay listed for the record.

**OQ-1. How do engineers and coding agents propose changes?** (Needed before Phase 1.)

- A. Through the same system: a command-line tool, and an MCP tool with which an agent drafts for the person it acts for (FR-121), both in the first build. Proposals go to the same review queue. *Recommended.*
- B. Through pull requests in a Git repository.

**OQ-2. Can the data platform later add one pointer line to the files of the source tool?** The line would say: "For launches, regulations and period caveats, call the Context Layer." It would also add a check of source changes before they merge. (Needed before Phase 4.)

- A. Yes, as changes that the data platform owns and reviews. *Decided* (13 October 2026): the two servers stay separate, and the data platform team adds the pointer, in each view's agent hints and in its own data tool servers, later and outside this project. The system's side is the handoff: it accepts the member names an agent just queried (CON-517) and its server instructions name the data tool (FR-343).
- B. No. Agents learn about the Context Layer only from its tool descriptions.

**OQ-3. Who are the owners, how fast is review, and who approves high-risk items?** (Needed before Phase 1.)

- Owners: named owners from the owner team of each domain. *Recommended.*
- Review time: two working days for low and normal risk. *Recommended.*
- High-risk approver: one named person per domain. *Recommended.*
- Can an owner or an administrator accept their own proposal? Yes, at every risk level, if the checks pass; a high-risk item still needs the approver's accept. *Decided* (16 October 2026): an administrator decides any proposal and an owner their own in their domain.
- Does an overdue high-risk item stay visible? No: withhold it and count it. *Recommended.*
- Can the check report say "restricted items matched"? Yes, with a count only. *Recommended.*

**OQ-4. (a) Which language model provider? (b) Can AI clients reach the MCP server from the internet?** (Needed before Phase 1 for (a). Question (b) waits for the hosting stage.)

- (a) The first build calls the model provider directly: the Anthropic API, or the Vercel AI Gateway in front of the same models and, for demo data, Google's Gemini 2.5 Flash-Lite. Each role's provider and model is a setting (NFR-092). It uses no cloud account of the company and no Amazon Bedrock. Questions and answers leave the company to the named provider and the model's vendor, so real company data needs company approval of them first. The assistant's web search (FR-714) runs on the same provider: through the gateway, Anthropic's web search on its Messages API, so search words also go to Anthropic and its search partners, which is why it is off until an administrator turns it on. *Decided.* At the hosting stage, the recommended route is Amazon Bedrock in the cloud account of the organisation, with the `eu.` geographic inference profile only. That is decided again then.
- (b) Not in the first build, which runs locally. At the hosting stage, the recommended answer is yes, over HTTPS and behind sign-in. Web and desktop AI clients need this. The other option is internal access only, which excludes most hosted AI clients.

**OQ-5. Test the editor idea with three people before building it?** (Needed before Phase 1.)

- A. Yes. Three business users and two reviewers try a clickable mock with invented content, including mentions, for 45 minutes each. Compare it with a plain form and with a Git-based flow. *Recommended.* A result that favours Git or the plain form changes the proposal flow only (FR-101).
- B. No. Build it now.

**OQ-6. How long do we keep records, and when do we hide small counts?** (Needed before Phase 1.)

- Delivery records in full: 180 days, then counts only. *Recommended.* The weekly counts per domain, answer state and kind of agent are kept without limit (FR-612). *Decided 30 Oct 2026.*
- Hide topic detail when a count is below five. *Recommended.*
- History log: keep without limit. It holds no question text. *Recommended.*
- Keep a redacted excerpt of questions for owners? No. *Recommended.*

**OQ-7. Where do identity and group names come from?** (Needed before Phase 1.)

- Cube Core, in the first build. The service runs no separate identity design and keeps no directory of accounts or groups. Group names are the group names of the semantic layer. *Decided.* Cube Core can map a login to groups with `contextToGroups` (section 7.1). A decision record settles how the local sign-in reaches it.
- Other identity providers can use the same connector interface at the hosting stage or later.

**OQ-8. Which AI clients and plans are in use?** (Needed before Phase 1.) The answer sets the list of connection tests. Recommended start: plain tools with sign-in, tested for each client family.

**OQ-9. How do we get definitions from Cube?** (Needed before Phase 2.)

- A. Read the model files at tagged versions first. Add a live check when a Cube server exists. Add an Ossie connector later. *Recommended.*
- B. Use the Ossie route from the start. Choose this only if the Ossie specification reaches a stable release, or the organisation wants one route for several tools.
- Also confirm two things. Is self-hosted Cube Core the production plan? Do we hide items about a metric from people who cannot see that metric (CON-509)? Recommended: yes to both.

**OQ-10. When is the hosting stage, and which hosting facts apply?** (Needed before the hosting stage.) The first build runs locally and needs no cloud account of the company. The hosting stage needs the account layout, the region, the network rules and the standard for infrastructure as code. Recommended: the region of the other services of the organisation, and its own standard.

**OQ-11. Can a chat tool app be installed, and who runs it?** (Needed before Phase 1.) Recommended: yes, run by the data platform team.

**OQ-12. Which time rules apply?** (Needed before Phase 1.) Recommended: UTC days now, fiscal calendars later.

**OQ-13. Who owns the service code?** (Needed before Phase 0 ends.) TypeScript is the default. Python would be considered only if data platform engineers will write most of the code. Recommended: TypeScript, owned by the data platform team with TypeScript skills.

**OQ-14. Which login server after the three-client test?** (Needed before Phase 1 ends.) Recommended: the default under test if it passes, with the two alternatives as a way out.

**OQ-15. Which domain starts first?** (Needed before Phase 3.) Recommended: a domain owned by the data platform team with existing context, chosen at the end of Phase 2. Then choose by counts of questions without context and by owner time.

**OQ-16. Which license, and do we release the product?** (Needed before any release.) Release is not a goal now. Recommended: decide later, and keep every dependency compatible with an open license (OSR-106).

**OQ-17. Do mentions only help an agent navigate, or may they also decide what `get_facts` delivers?** (Decided for the first build. Look into the second option at a later point, when the link-follow tests of FR-523 give results.)

- A. Navigate only. `get_facts` is unchanged, and an agent follows a link with a separate call. *Decided.*
- B. A mention of something that the question is about also delivers the item that holds the mention (FR-337). Choosing it means new matching rows, a rule for how far a mention reaches, and new tests for wrong caveats.

**OQ-18. Where may a mention appear in an item?** (Decided.)

- A. In the summary and the body. Not in the title, the evidence quote, the notes or the comments. *Decided.*
- B. In the summary only.

**OQ-19. What may be mentioned, and from where?** (Decided.)

- A. A metric, a dimension, a dimension value, another accepted item or a domain. The choices come from the vocabulary, the accepted items and the domains only. A one-step request to an owner adds a missing term. *Decided.*
- B. Anything that Cube lists, even if it is not in the vocabulary. This would need a second set of ids that nobody has checked.

**OQ-20. Is `get_related` in the first build?** (Decided.)

- A. Yes. It is built and kept off in the tool list until an evaluation shows that it helps. *Decided.*
- B. No new tool. Only the links in replies.
- C. On for everyone from the start.

**OQ-21. May authors choose a relationship word for a mention, such as "see also", "depends on" or "supersedes"?** (Decided.)

- A. No. There is one authored kind of link, `mentions`. The sentence around the mention carries the meaning. *Decided.*
- B. Yes, from a short list. This is easy to add later.

**OQ-22. When a mentioned metric or dimension changes or disappears in Cube, is the item flagged, or is the owner informed?** (Decided.)

- A. The owner is informed, in the queue and in a list of stale links. The item is still delivered, and the link shows its new status. *Decided.* The flag `needs_check` stays for scope.
- B. The item is flagged `needs_check`.

**OQ-23. What happens when an item mentions something that fewer people can see?** (Decided.)

- A. The review screen warns the owner, and nothing blocks. At read time the system hides the target from people who may not see it. *Decided.*
- B. The system blocks the item at submit.
- C. The system ignores it.

**OQ-24. Where does a domain come from in Cube?** (Decided. It needs the data platform team.)

- A. A domain is the same as an area. Each Cube view carries a `meta.domain` entry that the data platform team adds. The proof of concept model has none today. *Decided.*
- B. The domain map stays configuration in this service until Cube has the entry.

## 15. Out of scope for the first build

- A read-only copy of accepted editions in Git, and anything that reads Git back into the system. It is planned for Phase 5. The first build only keeps editions exportable as canonical JSON (NFR-045).
- Pull requests as a way to propose items.
- A rich-text editor for item text (typed mentions are allowed, FR-119), a page tree or a company directory. A list of the people Heed knows, with their roles, is in scope (FR-812).
- A graph view of the links, and links that the system infers. The typed links of FR-331 to FR-335 are in scope.
- Syncing documents into editions, accepting drafts automatically, and copying the sharing of a document (CON-610).
- MCP Apps (FR-330), a trial edition (FR-216), proposal expiry (FR-213), evidence checks (CON-306) and answer test caching (FR-522).
- For the MCP draft tool (FR-121): a model inside the tool, and submitting from the client. The person submits in the web interface.
- Delivering an item because it mentions something that a question is about (FR-337).
- Sending data queries through this service so that caveats attach to data results.
- A separate MCP gateway product and a separate language-model gateway product. The service builds both layers itself. The hosting stage may look at them again.
- A vector database, embedding search, a graph database, a workflow engine and live shared editing.
- Learned or personal memory.
- Any tracking of people, any history of questions per person, and any analytics per person.
- Publishing by agents or by the assistant.
- Enforcing data access, replacing the access policy of the semantic layer, or changing any source tool.
- Column-level lineage, and detection of metric movements that no item explains.
- Everything that needs a hosting platform: cloud accounts, public HTTPS reach, two zones and infrastructure as code. These belong to the hosting stage (section 11.7).
- Running in more than one region.
- Open source release (section 9 only keeps the option open).

## 16. Deployment context

This document names no organisation. The requirements hold for every deployment. The first build runs on one computer, and the hosting stage runs on any container platform (section 11.7).

Each deployment keeps its own facts outside the repository, in its settings and its own documents. A folder named `overlay` in the repository root is a good place: Git ignores it. The facts are:

- its data stack and its semantic layer model, and how that model is deployed;
- its domains and the teams that own them;
- the context it already keeps, and the tools that hold it;
- its agents, its chat tool and its identity provider;
- its hosting plan, cloud accounts, regions and costs.

A deployment's own tests, such as a check of its real model's views, belong there too. The only data in the repository is the invented demo world (OSR-103).

## 17. Design decisions and reasons

| Topic | Decision | Reason |
| --- | --- | --- |
| Where context is stored | PostgreSQL is the system of record. A read-only copy in Git is a later phase. | One write path and one approval path. Public issue trackers of open-source editors that hide Git behind a form still show open problems with drafts, review comments, notices and permissions for people without Git accounts. |
| Who accepts | An owner per domain accepts. Only accepted context is served. | The data platform team owns the answers and controls what agents receive. |
| How to match | The matcher uses only its inputs. | It can run in tests and in the browser preview. It makes the replay of past deliveries exact and free of model cost. |
| How to test | Answer tests run through the real MCP server. | Tool descriptions steer agents. Only a run through the real server sees them. |
| How to show trust | A context receipt inside the window of the agent is a later trial. | It could help, but clients differ, so it cannot be the only way. |
| Item format | Publish a JSON Schema from the same definition that checks items. | Engineers and coding agents can check items offline. It keeps the language choice reversible. |
| Sign-in | The login server is replaceable. The MCP server checks tokens itself. | AI clients need registration methods that many identity providers lack. A token library is the riskiest part. |
| Connectors | All vendor code lives in read-only connectors. A connector failure never stops serving. | The product stays neutral. A tool outage never breaks answers. |
| Connector contract | Each connector is a manifest (data) and a runtime (code), interface 3.0, in the main repository. Loading packages is designed now and built when the license is decided. | The core can check and show a connector without running its code, and a third party can build on the same contract later. Opening external loading before the contract has served both kinds would freeze it too early. |
| Content sources | A content source only creates drafts that an owner reviews. Markdown in a Git repository is the first one. | Documents hold context that people already wrote down, but only an owner decides what agents receive. Git reuses the hardened fetch of the Cube connector and needs no sign-in on behalf of a person. |
| Definitions from Cube | Read model files first. Add a live check later. Add an Ossie connector later. | The files hold calculations and access policy. Cube does not itself read or write Ossie, and the specification is still a draft. Section 7 has the details. |
| People | Count questions by topic. Never record who asked, and never store question text. | A product decision: people are not tracked. Replay uses the stored scope, not the text. |
| Starting | No pilot domain. Prove the whole system on a demo domain, then start domains one at a time. | It avoids a special first case and proves the method. |
| Item kinds | Five kinds only: note, event, guide, example, issue. | They cover caveats, dated facts, how-to guidance, checked answers and temporary problems with the data. |
| Risk levels | Low, normal and high decide approval and tests. | Effort follows risk. High risk gets a second approver and the full test set. |
| Open source | Keep the option open with later-priority requirements. Do not make release a goal. | It limits risk without adding work to the first build. |
| Where the first build runs | A local computer with no cloud account of the company. The service calls the model provider directly. Identity, groups and domains come from Cube Core. Hosting is a later stage. | The first build starts without cloud accounts, regions or network rules. Cube Core already holds the groups and the access policy, so a separate identity design would repeat them. |
| Mentions and delivery | Mentions help an agent navigate. They never decide which items `get_facts` delivers. Delivery by mention is a later item (FR-337). | A passing mention of a market would turn every note that names it into a caveat for that market. This would break the cause rule. |
| Links between items | Typed links in PostgreSQL, with a read model derived from them. No graph database. | At the design size, link reads are small. Links need the same visibility rule as items. |
| Gateways | The service builds the MCP gateway and the model gateway layers itself and buys no gateway product. | One service and one image stay simple. The hosting stage may look again. |

## Appendix A. Matching tests

Each row tests FR-314 to FR-328. The item in most rows is an event: "online sales to Norway stopped", valid from 2026-08-04, no end date, about the market Norway. "Silent" means the item is not delivered. FR-506 requires every row to pass in any order of items and calls.

| # | Question | Item | Expected |
| --- | --- | --- | --- |
| C01 | Market Norway, dates inside the validity | The event | `matched` |
| C02 | Market Norway, dates all before 2026-08-04 | The event | Silent, `no_match` |
| C03 | Market Norway, dates start before 2026-08-04 and end after it | The event | Delivered, with a note that the dates start before the item starts |
| C04 | Market Spain, same dates | The event | Silent |
| C05 | No market filter (all markets) | The event | Delivered below exact matches, with the note "applies to market Norway only" |
| C06 | Market Norway, dates after 2026-08-04 | The event | Delivered |
| C07 | Market Norway, dates after the end date of the item | An event with an end date | Silent |
| C08 | Dates start on the end date of the item | An event with an end date (the end day is not included) | Silent |
| C09 | Market Norway | The event, past its review date | Delivered with the label `unverified` (high risk follows OQ-3) |
| C10 | Market Norway | Two items that conflict, same scope | `conflict`, both delivered, no winner |
| C11 | A metric inside a metric group | An item about the group | Delivered |
| C12 | A metric outside the group | An item about the group | Silent |
| C13 | Market "Norge" | A vocabulary entry says it is another name for Norway | Resolved to Norway, delivered |
| C14 | Unknown market "Xland" | Any item | `need_more_detail` with the options, nothing guessed |
| C15 | Market Norway | A proposal that is not accepted (draft, submitted or in review) | Never delivered |
| C16 | Market Norway | A retired or replaced item | Silent, and the reply names the new item |
| C17 | A caller whose groups are not in the audience | An item for a restricted audience | Not delivered, counted as withheld (OQ-3) |
| C18 | Market Norway | An item whose source definition changed | Delivered with the label `unverified`, state `needs_check` |
| C19 | Any, about a metric of a domain just created | An accepted item of that domain | Delivered: every domain that exists is served (FR-320), and the reply names the domain |
| C20 | Market Norway | A needed dependency is unavailable | `check_failed`, never `no_match` |
| C21 | Market Norway, many matching items | Total text above the size limit | Items removed in the fixed order, `cut: true`, ids listed |
| C22 | Any market | An item about a metric only | Delivered |
| C23 | Market Norway | A proposal under review, as a preview | Delivered only to the proposer, the owners of the domain, administrators and test runs |
| C24 | The same question twice | The same edition | The same reply in the same order |
| C25 | Any | The edition changes between two calls | Each reply names its own edition |
| C26 | A metric that the groups of a person cannot see in the source tool | An item that names only that metric | Not delivered to that person (CON-509) |
| C27 | Market Norway | An item about orders for any market ("market: any value") | Delivered as an exact match. Norway is a market |
| C28 | Orders by market, no market value | An item about orders for any market | Delivered as an exact match |
| C29 | Total orders, no market named | An item about orders for any market | Silent. The question names no market |
| C30 | A metric of one domain | An item of another domain about it | Delivered |

Rows I01 to I07 test an issue (section 4.4): "partner reporting for Norway is down", about the market Norway. In rows I01 to I04 the issue started on 2026-08-04 and ended on 2026-08-16 (the end day is not included), and the questions are asked after it ended. In rows I05 to I07 it started on 2026-10-02 and has no end date. These rows belong to Appendix A, so FR-506 applies to them too.

| # | Question | Item | Expected |
| --- | --- | --- | --- |
| I01 | Market Norway, dates inside the period of the issue | The ended issue | `matched`: the data of those days is not reliable |
| I02 | Market Norway, dates after the end date of the issue | The ended issue | Silent, `no_match` |
| I03 | Dates start on the end date of the issue | The ended issue (the end day is not included) | Silent |
| I04 | Dates start before the end date and end after it | The ended issue | Delivered |
| I05 | Market Norway, dates after the start | The open issue | Delivered: a live warning |
| I06 | Market Norway, dates all before the start | The open issue | Silent, `no_match` |
| I07 | Market Norway, dates after the start | The open issue, past its review date | Delivered with the label `unverified`. Its re-check asks "Is this still going on?" (FR-135) |

Rows L01 to L12 test the link rules (FR-131 and FR-331 to FR-335). The item in most rows is the same event as above. These rows belong to Appendix A, so FR-506 applies to them too.

| # | Call | Setup | Expected |
| --- | --- | --- | --- |
| L01 | `get_facts`, market Norway | The event mentions the metric Orders and an accepted item. The caller may see both | The event is delivered with two links, both `current`. No other item is added |
| L02 | `get_facts`, market Norway | The event mentions an item whose audience excludes the caller | No link to it. `links_withheld` is 1. Its id and title appear nowhere in the reply |
| L03 | `get_facts`, market Norway | The event mentions a retired item | A link with status `retired` and the words of the author. No content |
| L04 | `get_facts`, market Norway | The event mentions an item that a newer item replaced | A link with status `replaced`, the words of the author, and the id of the new item |
| L05 | `get_facts`, market Norway | The event mentions a metric whose definition is missing in the source tool | A link with status `source_missing`. The event is still delivered, and the owner is informed |
| L06 | `get_related` from item A | A mentions B and B mentions A | Each appears once, at its shortest distance. The link between them is kept |
| L07 | `get_related` with depth 3 | A chain of four items | The reply goes no deeper than 2 steps and says so |
| L08 | `get_related` from a metric | 60 items mention the metric | At most 50 nodes, `cut: true`, the ids left out listed, and a way to get the next page |
| L09 | `get_related` from an item | Neighbours at different distances, with different kinds of link | Listed by distance, then kind of link (replaces, conflicts with, applies to, mentions, mentioned by), then higher risk, then newer start, then id |
| L10 | `get_related` for the same item before and after an edition change | Two editions with different links | Each reply names its own edition and shows the links of that edition |
| L11 | `get_related` from an id | The id does not exist, or the caller may not see it | The same "not found" reply in both cases |
| L12 | `get_facts`, market Norway | An item whose scope is Spain and whose text mentions Norway | Silent. A mention is not scope |
