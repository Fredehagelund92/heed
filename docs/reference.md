# MCP and API reference

How agents connect over MCP and what they get, and the HTTP API for definition sources, proposals, review and release, and the inbox. The API is described once in `src/contract` and published as [OpenAPI](api/openapi.json).

### Connect Claude Code to Heed

On `docker compose up`, Claude Code signs in through the web app's consent page, with no token:
`claude mcp add --transport http heed http://localhost:3000/mcp`, then `/mcp` and Authenticate in
Claude Code. The token below is for the dev service, without sign-in: get the local database ready
as in [Run the service locally](operations.md#run-the-service-locally), start `npm run dev:server`, and add the local endpoint with a dev token:

```sh
claude mcp add --transport http heed http://localhost:3000/mcp \
  --header "Authorization: Bearer $(npm run --silent token:dev)"
```

#### The six tools (the agent contract)

Since the agent contract (Heed v1, [the product page](product.md#10-what-agents-get)) the server
offers six tools, described in one list (`AGENT_TOOLS` in `src/domain/mcp-text.ts`):
`get_context`, `find_context`, `read_context`, `report`, `suggest_context` and `get_related`.
`improve_question`, `domain_overview`, `what_changed` and `search_help` left the list, and left
the service with the in-app assistant (30 Oct 2026).

The earlier ids stay for one release as deprecated ids: `get_facts` (now `get_context`),
`find_facts`, `search_facts` and `search_context` (now `find_context`), `read_item` (now
`read_context`), `report_gap` and `give_feedback` (now `report`) and `draft_context` (now
`suggest_context`). Each is listed beside the tool that replaced it, with a description that says
`Deprecated: use <tool>.`, and answers with its old arguments and its old reply, plus a `note`
first in it and a last line of text that names the tool to use. A call by an old id is checked,
limited and recorded as the tool that replaced it, so it needs that tool's switch and scope.
`draft_context` keeps what it did: it saves a draft and never sends it.

Heed's server instructions (FR-343) tell the agent what Heed holds and what the data tool holds,
to call `get_context` first, how to read each status and its answer state (FR-349), to pass on a
result's `say`, which starts with the answer line, and to follow its `next`, the step for the agent
(every read result has them, FR-344, so they reach a client that drops the instructions), how to
speak about a fact with people, how dates in a question's words are read and that a question
without dates is read at today, that the reply is short by default, when to `report` and when to
`suggest_context` (after the person says yes), and never to put question text or personal data in
a note. The call-first and absence rules come first, within the first 512 characters, since some
clients (the OpenAI Apps SDK) read no further; Claude Code reads up to 4,096. The rules are one
text: the Connect page's setup line and its skill file read the same sentences from
`src/domain/mcp-text.ts`.

**`get_context`** answers a question, or a metric, markets and dates. For the Norway test fixture,
ask "Orders in Norway, August 2026"; with the bulk seed, use a metric, market and date range from
that data. Its default reply is short:

```json
{
  "status": "matched",
  "say": "Checked. 1 fact applies to Orders in Norway in August 2026. Only that was checked.",
  "asked": "Orders in Norway in August 2026",
  "context": [
    {
      "id": "itm_norway01",
      "title": "Norway closure",
      "summary": "Online sales stopped on 4 August.",
      "kind": "event",
      "when": "From 4 August 2026 on",
      "applies": "Orders in Norway.",
      "checked": { "role": "the owner of Finance", "date": "2026-08-04" },
      "source": {
        "url": "https://example.test/law",
        "quote": "Online sales are stopped from 4 August."
      },
      "not_to_conclude": "cause not proven",
      "url": "/context/itm_norway01"
    }
  ],
  "reply_id": "0f8fad5b-d9cb-469f-a165-70867728950e",
  "edition": "2026-10-07.1"
}
```

`status` carries the answer state (`src/domain/answer-state.ts`): `matched` (Checked), `partial`
(Partial: no item covers the whole question, or `get_context` read a question with no dates at today), `no_match` (Not found), `conflict` (Conflict: two
items that apply disagree), `stale` (Outdated: an item's check date passed or its source changed)
and `check_failed` (Not checked); `need_more_detail` means the question could not be read, which is
no answer state. `say` starts with the answer line, its label and, but for Checked, its sentence.
`next` comes only when there is a step to take. Each item's `kind` is the label agents read
(`event`, `warning`, `rule`, `guide`), `when` and `applies` say when and where it applies, `checked`
names the role that checked it and the day, never a person, and `may_be_out_of_date: true` and
`disagrees_with` (the ids of the items in the same reply it disagrees with, the overlap notice of
FR-350) appear when they hold. A question about what a metric means ("What does net revenue
mean?") also gets `definitions`. `reply_id` is what `report` takes.

Terms and synonyms people write in Definitions (FR-138) reach agents too. A synonym of a metric or
a dimension ("Purchases" for Orders) is one of its other names, so a question in that word is read
as a question about the metric, in the words and in `metrics`. When the question uses a word a
person defined, `terms` names it, up to five, each meaning once: `word` as the question has it,
`name` and `kind` (`term`, `metric` or `dimension`) of what it names, `synonym: true` when the
word is another name for it, a term's `meaning` as written, its `domain`, `written` (the role that
wrote it, the owner of its domain or an admin, never the person, and the day) and `url`, its page
in Definitions, with a line `Open in Heed - <name>: <url> - Written ...` in the text. `next` then
says to read the words by them and never to give a term as a checked source. A term changes
neither the items that apply nor the answer state: a question that only names a term ("What does
peak season mean?") is still `need_more_detail`. Agents get the live terms whatever the edition, as
they get the overlay, and from the next call after a person writes one: never a deleted term, a
word a sync gave a second meaning (the conflict Definitions shows), a word the vocabulary already
has, or a term of a stopped domain.

With `response_format: "full"` (FR-342) the reply keeps the same fields and adds what it always
carried: each item's version, body, validity, claim level, every source, owner, review stamp and
links (FR-326, FR-331), `scope_used`, `dates_read` and `assumed_date`, the domains the question is
about with what their owners wrote (FR-813), `options`, `check_report` and `instructions`. Every
item carries `url`, its page in Heed, and the result's text has a line per item, `Open in Heed -
<title>: <url>`, with who checked it, so the reader of an answer can check a cited item in one click
(FR-347). The address is the first of `CL_WEB_ORIGINS`; the eval runner and the previews run
without one and give the path (`/context/itm_...`). A link holds only the item's id: the page
applies the audience rules to whoever opens it. Metric and dimension names may be the member names
the agent just queried in Cube (`orders.returns`, or `cube:orders.returns`): Heed resolves them
through the term's definition, and a member no term points at comes back with "Did you mean" and
the closest names (CON-517). A metric group (Revenue) stands for its metrics: `say` names them, and
on a reply about more than one metric each item names the ones it is about in `about`, so an agent
never gives them as one figure. Agent replies never carry a comment, a report or a saved question:
they are built from the served edition only.

**`find_context`** (FR-338, merging `find_facts` and `search_facts`) finds what is written down
about a few words: names and other names (Net sales), domains, member names and words in an item's
title, summary or text. It falls back to the items that apply to the scope the words name, gives
each named metric's or dimension's definition with where it comes from and what Heed adds, and says
why when nothing is found. It takes a `domain` (a name or an id), a `kind` (`event`, `warning`,
`rule`, `guide`), a `window` and a `limit`, and lists titles and summaries under `context`, never a
body. An unknown domain comes back with the closest match and every valid choice (FR-341); a
domain named by another spelling is read as that domain (`src/domain/domain-match.ts`). The words
of the query a person defined come back in `terms`, as for `get_context`.

**`read_context`** reads one item in full (`context`): its text, every source, who checked it, its
What not to conclude line and its outgoing links, with a page of the items that link to it. The
words of its title, summary and text that a person defined come back in `terms`, as for
`get_context`.

**`report`** takes what the person says, after they say yes: `kind` is `missing`, `wrong`,
`unclear` or `helped`, with the `reply_id` of a `get_context` reply, a `context_id` when it is about
one item, and an optional short note checked for sensitive text (FR-611). It is recorded as
anonymous feedback on the reply, with the item's domain when it names one, and the gap job turns
missing, wrong and unclear into a gap for the reply's topic (FR-606, case 3). Something missing with
no reply takes the question's metrics, markets and dates instead and is recorded as a gap, as
`report_gap` did. The reply says who will see it (`to`, "the owner of Sales") and never keeps who
asked (FR-602).

`get_related` (FR-332) follows links from an item id, a vocabulary key such as `metric:orders`,
a term written in Definitions (`term:<id>`, FR-138) or a domain (`area:finance`): the neighbours one step away (`depth: 2` for two), each listed once
at its shortest distance, in a fixed order (distance, kind of link, higher risk, newer start, id),
at most 50 a page (`max_nodes`, default 20) with `next_cursor`, and the stored links among them
as `edges`. `relations` narrows the kinds (`replaces`, `replaced_by`, `conflicts_with`,
`applies_to`, `mentions`, `mentioned_by`, `in_area`; all but `in_area` by default) and `window`
the dates of neighbour items. Neighbours carry titles and summaries, never bodies; a retired or
replaced item shows only the author's words. A term comes with its word and what it means (`meaning`), as
a person wrote it (a synonym with what it is another name for, `same_as`), read as it is now:
terms are not sealed in an edition, so a deleted term reads as `retired` with the author's words,
and a term that means something else now as `unresolved`. A neighbour the caller may not see is counted in
`links_withheld`, never listed or counted in `counts`, and a start the caller may not see is "Not
found", exactly like one that does not exist. A link never changes what `get_context` delivers.
The pure resolver is `src/domain/links.ts`. **It is on by default**, with its own switch
(`POST /tools/get_related`).

**`suggest_context`** (FR-121) lets an agent send a suggestion, as the person it acts for, after
the person says yes. **It is on by default**, and the `propose` scope is granted at consent (the
consent page names it). Only a person signed in through a login server may call it: a dev or
service token names no person and is refused with a 403 that says so, and is never offered the
tool. The agent passes the words (`text`, at most 2,000 characters, never a transcript) and
optional hints: `title`, `summary`, `kind`, `scope` (names, as in its `get_context` call), `window`
(inclusive dates), `evidence` (links and one sentence each), `not_to_conclude` (if the person said),
`area` (only when the person chose one) and `item_id` to suggest a change. Heed calls no model here.
`src/domain/agent-draft.ts` derives what it can exactly: names to vocabulary keys (never a key the
agent made up), the domain when every scoped metric belongs to one domain (the vocabulary's domain,
otherwise the Cube domain), dates the words name, and the kind by the shape of the words. It never
sets the risk above its default, a claim with a stated effect, an audience, an owner,
replacements, conflicts or mentions; words that suggest a legal or regulatory matter only raise a
"may be high risk" flag for the owner, and words that read like orders to a model are kept as text
and flagged. Every field carries a mark (`derived`, `default`, `prefilled`, `not_inferred`), stored
on the proposal (`provenance`) and sent by the API, so the owner sees what the agent filled in.
Text that looks like personal data or a secret (FR-117) is refused and nothing is saved. Before
saving, accepted items whose scope and dates overlap and whose words read alike are returned as
`possible_duplicate`, so the agent asks the person and calls again with `item_id` or
`new_item: true`; without one domain it answers `needs_area`. Then it saves the draft through the
`saveAgentDraft` and sends it for review through
the same path as the person's own Send for review (`proposals.submit`), so it waits in the owner's
queue (`status: "suggestion_sent"`, with a link to it waiting in the person's Inbox). Nothing is
accepted or published by the tool: only the owner does that, in the review or in advance with a
policy for the agent and domain (FR-421). Under a policy that covers it, a new low-risk item is
published in the same transaction, as that owner's decision (`status: "suggestion_published"`, with
`policy` and a link to the item); when a policy is on but does not cover it, `policy.waits_because`
says why it waits. If the review checks refuse it (a blocking finding), it stays
the person's draft and the reply says why (`status: "draft_saved"`, `blocking`, and a
link that opens the draft in the editor). It names the person on the proposal and its history only: the MCP request log keeps the
shared `signed-in` label. The setting `limits.agent_drafts` caps one person's agent drafts at 10 in
24 hours and 20 waiting unsubmitted. `npm run eval:drafts` measures the derivation over the 1,500
seeded items with a held-out third (`scripts/draft-eval.ts`, also run by `npm test`).

When the person's agent can show forms (MCP 2026-07-28 multi round-trip elicitation: the app
declares `elicitation`, form mode, on the request), the tool asks up to four of its open
questions there before it saves anything: the domain, the kind when the agent's hint and the
words disagree, the term an ambiguous name means, the first day, whether an issue is still going
on, and the source link and sentence, as one form of flat fields with closed choices where there
are any. The app retries the call with the answers and the request state the tool returned. That
state is signed with `CL_MCP_STATE_KEY_FILE` (HMAC-SHA256, through the SDK's request state
codec), bound to the tool, the person and the app, carries a digest of the call's arguments, expires after
ten minutes, and saves at most one draft (`proposals.answers_round` is unique). A changed,
foreign, expired or reused state saves nothing and is refused with a `reason`. Answers are read as
untrusted data: a value outside the choices offered, a malformed date or link counts as no answer
and its question stays open. The answers go through the same derivation and `saveAgentDraft`,
marked `confirmed` ("Confirmed" in the draft editor and on the review screen), and the result
lists them in `answered`. If the person declines or cancels, it is saved and sent as before. An
app that cannot show forms (Claude.ai and ChatGPT today, every 2025-era connection, an app that
shows only links) gets the link and the question list exactly as before. Which attributes the tool derives, defaults, prefills or never infers is one table
shared with the form: `src/domain/proposal-attributes.ts` (CONTRIBUTING.md, "Proposal
attributes").

`token:dev` creates a reusable Ed25519 key in `.heed-dev-key.pem` with owner-only permissions.
The file is ignored by Git. Tokens expire after eight hours; mint a new one and update the
client header when it expires. Tokens contain a client label and scopes, never a person or
group. `--client <label>` mints for another client label, which the endpoint serves once an
administrator has added and enabled it. `--client eval --service` grants an evaluation client access to historical editions;
ordinary tokens always use the live edition.
Both token generation and verification refuse production mode. `MCP_RESOURCE_URL` must match
the token audience, and `MCP_DEV_KEY_FILE` must point to the same file for both commands.

The endpoint supports the 2025-11-25 and 2026-07-28 MCP protocols without sessions. Requests
require a bearer token and a local Host/Origin. `GET` and `DELETE` return 405, and a JSON-RPC
batch (an array body) is refused with 400, so every call meets its own limits and log record. The serving pool
uses `DATABASE_URL_SERVE`, with no access to raw item versions or people. `tool_config` and
`client_policies` control tools, clients, response limits and request rates. Each call counts
per minute against the person (their token) and against the client label, in separate counts:
the setting `limits.mcp_requests_per_minute` gives 30 for each person and 120 for each client
whose policy sets no rate of its own, so one person cannot spend the budget of everyone sharing a
client label (the evaluation runner's token is no person, so a run counts against the `eval`
client only). The setting `limits.mcp_rate_per_minute` also limits each tool per client (by
default 120 `get_context` calls and 20 `report` calls a minute; a feedback tool without a value
gets ten). Over a limit, the answer is 429 with `Retry-After` in
seconds. Administrators change all of these through the API ([Administration, import and export](operations.md#administration-import-and-export)), and a
change applies on the next request. Local rate counters live in memory for at most one minute.
Several replicas of the service would need a shared limiter.

### Sign in with your own agent

The service also runs a login server, so a person's own agent can sign in as them without a
dev token: the app reads `/.well-known/oauth-protected-resource/mcp`, the person signs in and
allows it on the consent page (`/connect/approve` on the web app), and the app gets ten-minute
access tokens and rotating refresh tokens. Settings, under Agents and access, lists the agents
connected and revokes them. Dynamic client registration, which Claude Code uses, is on
outside production and needs `CL_OAUTH_DYNAMIC_REGISTRATION=on` in production. How it works, the settings, key rotation and the threat notes
are in [docs/ai-sign-in.md](ai-sign-in.md).

Structured question dates are inclusive (`window.from` and `window.to`); returned validity and
stored scopes use an exclusive end date. `max_bytes` covers the serialized tool result,
including its text fallback. Links are trimmed before items, and cut item ids are reported.
If the required report itself cannot fit, the tool returns a bounded `check_failed` error.
Search and backlink cursors are invalidated by an edition or overlay change.

The cache checks the live edition and overlay on every call, fails closed when that check
fails, and retains at most four bundles for 15 seconds. Anonymous deliveries and request logs
flush in bounded batches after the response; write failures increment a logged dropped-record
counter without failing the answer. Shutdown drains the queue. A process crash can lose queued
records. Questions, bearer tokens, addresses and incoming RPC ids never enter these records.
Tool descriptions, schemas and annotations have a snapshot and SHA-256 digest, exposed in
`X-Heed-Tool-Digest` and each tool result's `_meta` and stored with deliveries. What serves a cache
or an audit stays out of what a model reads (FR-346): `tool_schema_digest`, `overlay` and, on
paged replies (`read_context`, `get_related`), `ttlMs: 0` and `cacheScope:
"private"` travel in `_meta`, which clients keep from the model (ChatGPT documents it as hidden).
The text and `structuredContent` carry `say`, `next`, the status, `edition` and the items. A cache keys on
`edition` and `_meta.overlay`, as before under the same names.

## Definition sources

Run `npm run connectors:sync` to refresh stored demo definitions or a local Cube model; the service
does the same on each source's own schedule, hourly by default (`connectors.sync`, which runs every
five minutes and reads the sources that are due), and administrators watch them, read them again
and pause them in Settings › Integrations (`GET /api/v1/sources`,
`GET /api/v1/sources/{id}/activity`, `PUT /api/v1/sources/{id}/paused`). There an administrator
also adds a source, such as a Cube model in a Git
repository read with a read-only token, tests it before saving and changes its settings
(`POST /api/v1/sources/test`, `POST /api/v1/sources`, `PUT /api/v1/sources/{id}`), choosing the
views it reads and the domain of each, and disconnects it (`POST /api/v1/sources/{id}/disconnect`). See
[the connector contract](connectors.md) for what a connector declares and reports, the
invariants, sources an administrator adds and snapshot behavior;
[Security and egress](connectors/security.md) for the secret store and the hosts a connector
may reach; and [the Cube connector](connectors/cube.md) for `CUBE_MODEL_DIR`, domain
overrides, renames and the `sources.cube_model_url` setting that builds the address of a model
file. Connector authors start at
[Writing a connector](connectors/authoring.md).

A refresh compares each definition with what accepted items recorded:

- An item whose live version references a definition that changed is flagged `needs_check`; one
  that references a definition that disappeared is flagged `source_missing`, naming the new id
  when `CUBE_RENAMES_FILE` lists it. Flagged items are still delivered, as `unverified`, and the
  domain's owners get an inbox item (`item.flagged`). An accepted version written against the
  current definitions clears either flag in the edition that serves it.
- A definition an item only mentions never flags it. The link shows `source_changed` or
  `source_missing`, the item is delivered as before, and the owners are told (`item.links_stale`).
- A domain that changed in Cube flags nothing: owners of the terms that use the definition are
  told (`vocabulary.domain_changed`), and serving keeps the accepted domain until a vocabulary
  proposal changes it.
- A source that cannot be read changes no flag and no link status. The operations view shows it.

`GET /api/v1/catalogue` lists every metric and dimension of the live vocabulary (FR-136): its
definition as the source last read it (the description copy, never a calculation), its domain
(the vocabulary's domain, then the source's, then none), its status, and what the library holds
about it, counted per term in the same answer. It reads as the library does.

`GET /api/v1/library` is the library index: every item the person may read, with what a list's
columns read from it. `lastChecked` is the last acceptance of the current version (a recheck is
one), `trust` is `current`, `needs_check` or `ended`, `chips` is the scope by name, and `opened` says whether the person opened the item
(Mark as checked takes only those). `GET /api/v1/search?q=` is search everywhere, for
the command palette: items, definitions (by name or another name), domains and people whose names
have the words, at most five of each, a name that starts with the words first.

A scope can name a dimension with any value (FR-126); see `docs/api/openapi.json` for the shapes.

## Proposal write API

The proposal write API adds `/api/v1/proposals` to the session-authenticated contract. Use the sign-in cookie,
allowed `Origin`, and session `x-heed-csrf` header for writes. Create and submit also require an
`Idempotency-Key` header (8-128 printable characters). The key belongs to the acting
person for 24 hours: an identical request replays its response, different content returns 422,
and a concurrent request using the same key returns 409. A rolled-back request can be retried.

- `POST /proposals` creates an incomplete draft. Supply `{ draft }`, optionally `itemId` to
  suggest a change to an accepted item, or `derivedFrom` to restart a rejected proposal.
- `GET /proposals` supports `own`, `areaId`, `state`, `limit` and `offset`. It answers
  `{ rows, total, limit, offset }` for every kind of proposal the person may read (item, retire,
  recheck and vocabulary), newest first by actual timestamp. `total` counts the readable matches
  before pagination. `GET /proposals/{id}` reads a proposal under row security; `draft` holds
  item form content only and is empty for the other kinds. Every mutation checks `revision`; a
  stale write returns 409 with the current record.
- `POST /proposals/{id}/submit` takes `{ revision }`. The proposer submits an immutable version,
  scope, evidence, references, mention rows, digests and format checks in one transaction with
  the proposal state, audit and outbox records. Resubmit creates another version. Submission
  does not publish anything.
- `POST /proposals/{id}/withdraw` takes `{ revision, reason }`. The reason is plain text, without
  mentions. Only the proposer withdraws.

Draft fields follow `src/contract/proposals.ts` and `src/domain/draft.ts`. The service derives
identity from the session, title from summary when absent, risk from kind, owner from domain,
and definition references and their change marks from governed scope. Missing domain can be
inferred from governed scope or references; ambiguous scope requires an explicit domain. An
omitted review date starts at 90 days from the current UTC day. Submission due dates use the
domain's review time in weekdays. A recheck (Mark as checked, or Still true on a Due for a check
card) moves the review date.

Use `summaryMarkup` and `bodyMarkup` for `@[visible words](target)` tokens; tokens supplied in
plain summary/body fields are normalized too. Plain text and mention rows are derived on the
server. Targets are live vocabulary keys, accepted item ids or domain ids, with at most 50 mentions
and 120 visible characters per label. The versioned setting `limits.mentions_per_version` can
lower the mention limit (the database ceiling remains 50). Mentions never infer scope, audience, references or domain.
Both the domain parser and PostgreSQL decode `\\` as a literal backslash and `\@` as a literal
`@`. Title, evidence quote, claim quote, notes and comments cannot contain mentions.

Save returns format findings without discarding incomplete work. Sensitive text is refused
with the matching pattern's name. Submit requires complete content, valid scope and valid
mention targets. Definition checks read the stored Cube snapshots, never Cube over the network.
A missing scoped definition, a changed reference mark, a metric Cube puts in another domain or a
dimension with any value (broad) is a warning: the author and the reviewer read it, and it never
fails the format gate (FR-505, FR-209), which an error alone does. A new mention of a missing
definition is blocked. Source outages keep the last successful snapshot. Submit also runs check levels 2 and 3
once a live edition exists; decisions and publishing are in "Review and release API".

Run `npm run api:generate` after contract changes. `npm run check` and
`npm run test:integration` cover this API, including concurrent authors, retry races, rollback,
resubmission, mention parser parity, Cube metadata and disclosure boundaries.

## Review and release API

The review and release API adds check levels 2 and 3, gates, publishing, rollback, suggestions to
archive and the stop switch to the same contract. A person decides a suggestion through the
review path below. Writes need the session cookie, `Origin` and `x-heed-csrf`; a suggestion to
archive and a rollback also take an `Idempotency-Key`.

- Level 2 probes the item's own scope with the resolver: inside it and on its first day it must
  be delivered (an exact match, a partial one with no dimension filter); the day before, its end
  day, another value of a filtered dimension and an unrelated metric must stay silent. Level 3
  runs the candidate through `get_facts`'s code: its probe delivers it, replaced items are
  absent, the reply fits, and no active test question of the domain turns from pass to fail. Both
  look at the item as delivered once nothing stops it.
- No answer test gates a proposal (FR-513): levels 4 and 5 (`answer_impact`, `answer_full`) are
  history, kept on the versions whose runs recorded them before Heed v1. A failed level 1 to 3
  blocks acceptance, with no override (FR-514).
- `POST /items/{id}/retire-proposals` (API only, with no screen in the web app) lets anyone
  suggest archiving an item, with a reason; one can be open per item. Its owners review it like
  any suggestion, and publishing it archives the item.
- `GET /editions` lists editions, for owners of any domain and administrators.
  `POST /editions/{label}/rollback` (administrator, API only, with no screen in the web app)
  serves that edition's content as a new edition with the same digest. When a
  version it would serve again no longer passes the serving rules (for example a check that
  failed since), it answers 409 naming the item and the reason, with every such version in
  `data.blocked`.
- `GET /editions/{label}/rollback-preview` (administrator, API only) compares the live edition
  with that one before anyone goes back, and lists the versions that cannot be served again.
- `POST /serving/stops` (administrator) switches delivery off or on for an item, a domain or
  everything. Serving reads the overlay on every call, so it applies to the next request.
  `GET /serving/stops` lists the stops that are on for every signed-in person, so the app can
  show a banner; only an administrator also gets each stop's event number (`seq`).
- Every domain that exists is served (FR-320, FR-802): its accepted items reach agents and its
  gaps reach its owner from the start, with no state, start checks or go-live step. The stop
  switch above is the one way to hold a domain's items back for a while.

## The review path and the Inbox

Heed v1's one review screen and its Inbox (docs/product.md, sections 4 and 5) read and decide
through these operations, typed in `src/contract/review-path.ts` and `src/contract/inbox.ts`.
Writes need the session cookie, `Origin`, `x-heed-csrf` and an `Idempotency-Key`. A decision
that can be taken back answers with an `undo` token for `POST /decisions/undo`.

- `GET /review/{id}/sheet` is the review page's one read of a suggestion (FR-224), waiting or
  decided; a suggestion to archive shows the version it archives, and once archived the version
  it archived. The read holds the change by
  kind and the values that moved (`diff`), the stored Markdown line by line with the changed
  words (`source`), and, for what an agent wrote, each claim against the
  sentence it copied (`claims`). It carries the clashes, the overlaps, the readiness line, the
  person's read state and Try it: the suggestion's own question answered on the live edition
  and with the suggestion in it, as agents would get it. A mention of an item the audience rule
  hides from the reader reads as its words only.
- `POST /review/sheets` takes `{ ids }` (at most 100) and gives the same read for many
  suggestions at once, in the order asked, leaving out one that went or that the reader may not
  see: the Inbox reads every suggestion it lists in one call. It changes nothing; as a POST it
  needs `Origin` and `x-heed-csrf`.
- A clash (FR-225) is a live item an agent would get in the same answer as the suggestion,
  except the item it changes and those it already names as replaced or conflicting. An edit
  whose difference is only formatting, only order or only a change of dates has no clash; an edit
  that changes anything else as well (wording, added, removed, a link) clashes as for any other. Publish
  waits until the owner says how each one relates: `replaces` (the new version replaces it, and
  publishing archives it), `disagrees` (both stay, and agents get the conflict) or `unrelated`.
  Overlaps (live items whose scope and dates overlap) are for information only.
- `POST /review/{id}/publish` takes `{ revision, relations?, reason? }` and accepts the
  suggestion, which publishes it, for an owner of its domain or an administrator; a clash with
  no answer is 422. `POST /review/{id}/return` takes `{ revision, note, body? }`: the suggestion
  goes back to its writer, and the note is its first comment, marked returned (`body` is the
  note as the comment box wrote it, with its mentions; without it the comment is the note's
  words).
- `POST /review/{id}/read` takes `{ itemVersionId }` and records that the person read that
  version (FR-226); a version that is no longer the one under review is 409.
  `POST /review/publish-read` takes `{ ids }` (up to 50) and publishes each suggestion the
  person read that needs no look of its own, each as Publish would: a plain change, with no
  clash, no claim to check, no new source and no new value without one. A retirement and a
  draft for a Not found card always get their own look. It names every one it left out, with a code
  (`not_read`, `needs_care`, `not_waiting`, `not_allowed` or `refused`), and one token undoes
  them all.
- `POST /decisions/undo` takes `{ token }` (FR-227). Only the person who decided undoes it, and
  only within `limits.undo_seconds` (15 by default); twice is once (409). Undoing a publish is a
  new `decision_undone` edition that serves again what the publish changed, and the suggestion
  waits again; undoing a return sends it back to waiting and takes its note out of the comments.
  The decision stays as history, and a person may decide the same version again once they undid
  it.
- `GET /inbox/feed?tab=needs|all` lists the person's cards by need: Not found (`gap`), Reported
  (`flag`), Mentioned you (`mention`), Due for a check (`check`), then suggestions. An owner gets
  those of their domains, an administrator every domain, anyone else none; a Mentioned you card
  is the person's own, in any domain: one for each thread with a comment that mentions them and
  that they haven't read, named `mention:<subject>`. Reported cards are the anonymous wrong or unclear
  reports of the last 90 days, with no person; each names the context the reported answer gave
  (`items`), the version agents got and only one the person may read. Beside them come the named
  reports from Ask of the last 90 days (`source: ask`, named `report:<id>`), with who sent each
  (`by`), the question, what is wrong (`note`), the correct version and the link they gave, and
  the item they are about; one waits until an owner closes it or checks, changes or archives its
  item, and is then done with that outcome. A Not found card's title
  names what agents asked about and the month: "Orders in Spain, October 2026". Under All come what the person sent that waits
  on an owner and what was done in the last 14 days. A suggestion's card says whether the
  person read the version under review (`read`), so it may go out with the others they read.
  `week` counts this week's agent questions, each hidden under `privacy.min_count` (FR-614).
- `POST /inbox/cards/read` takes `{ cards }`: the person opened them (a Mentioned you card:
  they read the comments that mention them there). `POST /inbox/cards/decide`
  takes `{ card, action, reason? }`, the one decision a card offers: `not_written` for a Not
  found card (the gap is set to `wont_fix`), `not_a_problem` for a Reported card (closed for
  every owner, a named report too), and `still_true` or `archive` for a Due for a check card (a
  recheck, by an owner of the item's domain or an admin as Mark as checked is, or a retirement).
  Each answers with an undo token.
- `GET /setup` is the setup checklist of a new workspace (FR-816), read from what exists: what
  the business is about, one context item, a question in Ask, an agent connected, and a source
  of definitions. Ask keeps no record of its own (FR-602), so its step is a mark with no person or
  question.

## Named reports

A person tells the owners from Ask that an answer is wrong, with their name (FR-622; docs/product.md,
section 9), through these operations, typed in `src/contract/reports.ts`. A report keeps only what
the person sent on purpose: the question, the part that is wrong (one context item of the answer,
or the answer itself, filed on its first item), what is wrong and, optionally, the correct version
and a web address. It is filed in the item's domain and reaches that domain's owners as a Reported
card. Its sender, the owners of its domain and administrators read it; nobody else does, and
agents never read it: the serving role has no grant on it, and nothing an edition holds is built
from it.

- `POST /reports` takes `{ question, itemId, part, what, correction?, link? }` (`part` is `item`
  or `answer`; texts up to 2,000 characters) and answers `{ id, at }` only, so the answer a retry
  replays never holds the words. An item the person may not read is not found. A person's reports
  share the per-minute limit of their gap reports (FR-408). Writes need the session cookie,
  `Origin`, `x-heed-csrf` and an `Idempotency-Key`.
- `GET /reports/mine` lists the person's own reports of the last 90 days, newest first, each with
  its question and `outcome`: null while nobody has acted on it, else the first of what the owners
  did after it, `not_a_problem` (its card closed), `checked`, `changed` or `archived` (its item),
  and when. Ask shows it under the answer it was about.

## Comments, reactions and mentions

People talk about a suggestion or a context item in a thread under it (FR-817; docs/product.md,
section 4), through these operations, typed in `src/contract/comments.ts`. A thread is named as
the app names it: `review:<suggestion id>` or `context:<item id>`. Anyone who may read the
suggestion or the item reads its thread and writes in it; people edit and delete only their own
words. Agents never read any of it: the serving role has no grant on these tables, and nothing an
edition holds is built from them. Writes need the session cookie, `Origin`, `x-heed-csrf` and an
`Idempotency-Key`.

- A comment is the comment box's small document (Tiptap's JSON): paragraphs, bullet and numbered
  lists, bold, italic, inline code, line breaks, and mentions of people as
  `{ "type": "mention", "attrs": { "id": "person:<id>", "label": "<name>" } }`. Up to 2,000
  characters of words and 20 people. Anything else is refused (400), and a mention of someone not
  in the workspace is 422 (`src/domain/comments.ts`).
- `GET /comments?subject=` reads one thread; without `subject`, every thread the person may read
  that holds a comment or a reaction. A thread has its comments oldest first, each with its
  replies (one level), its reactions, `editedAt`, and `deleted` for one deleted while something
  answers it, whose words are gone. It also has the reactions on the suggestion or item itself,
  `newReply` (the newest reply by someone else since the person last opened the thread or wrote
  in it, in a thread they wrote in or a suggestion they sent) and `mentions` (the comments there
  that mention them and that they haven't read).
- `POST /comments` takes `{ subject, body, parentId? }`; writing in a thread is opening it.
  `PUT /comments/{id}` takes `{ body }` and `DELETE /comments/{id}` deletes it, for its author only
  (403 for anyone else, 409 once deleted). A deleted comment that a later one answers keeps its
  place without its words (`removed: "kept"`), with its reactions and mentions gone; one nobody
  answered goes (`removed: "gone"`).
- `POST /reactions/toggle` takes `{ subject, commentId?, emoji }` and gives or takes back one of
  the five reactions (👍 Agree, 👀 Looking, ✅ Done, 🤔 Not sure, 🙏 Thanks), once per person, on a
  comment or on the suggestion or item itself; any other emoji is 400, and the database refuses
  one too.
- `POST /comments/threads/read` takes `{ subject }`: the person opened the thread, so no reply
  before now is new to them. `POST /comments/mentions/read` takes `{ subject }`: they read the
  comments that mention them there, and the Mentioned you card goes.
- The history log names who created, edited or deleted which comment, never its words.

## Context

Heed v1's Context list, a context item's page, the editor and Settings, Advanced (docs/product.md,
section 3) read and change items through these operations, typed in `src/contract/context.ts`.
Writes need the session cookie, `Origin`, `x-heed-csrf` and an `Idempotency-Key`. A change that
can be taken back answers with an `undo` token for `POST /decisions/undo`.

- `GET /items/{id}/page` is a context item's page: the item as published, what its list row
  reads (`lastChecked`, `trust`, `chips`), its own `owners` and its `history`, newest first. Each
  entry is a version agents got (`published`, `wording`, `link`, `dates`, `checked`, `moved`,
  `retyped`) with the field it changed and its words before and after, or what changed beside
  the versions (`archived`, `owners`). `canChange` says whether the person may change it.
- `POST /items/{id}/read` records that the person opened an item, in the quick view or on its
  page. Mark as checked takes only items the person opened.
- `POST /items/bulk` takes `{ action, rows, areaId?, kind?, personId? }`
  (FR-139), up to 200 rows: published items by id and drafts by their proposal's id. `action` is
  `archive`, `delete` (drafts only), `domain`, `kind`, `owner_add`, `owner_set` or `check`.
  Owners of an item's domain and admins change it, and a domain is moved into only by its owners
  and admins (403 otherwise). It names the rows it acts on and each other row with a code
  (`not_found`, `not_allowed`, `archived`, `draft`, `published`, `same_domain`, `same_kind`,
  `not_owner_there`, `already_owner`, `only_owner`, `not_opened`), a few words (`why`) and a
  sentence (`message`). The change does each row it may in full or not at all: an archive is a
  retire decision, a move or a new kind is a change its owner publishes through the review's
  checks and gate, a check is a recheck, and a deletion discards the draft. A row that fails
  stays as it was, in `failed` with why, to try again. One `change:<id>` token undoes the whole
  change within `limits.undo_seconds`, for its maker only.
- `GET /context/changes` is the History log: each change to many items, newest first, with what
  it did in one sentence. An item the audience rule hides from the reader is counted in
  `withheld`, never named, and then the sentence says only how many items changed. `GET /context/deleted` lists the drafts that were deleted, with who
  deleted them and when (admins). Published context is archived, never deleted.
- `POST /items/{id}/restore-draft` takes `{ version }` (FR-140): an owner of the item's domain or
  an admin gets a draft of a change with that version's words, dates and sources. What agents
  get does not change until the draft is published.
- `GET /items/{id}/related` is Related on a context item: its neighbours one step away, as
  `get_related` follows them on what agents get now, with how each relates to the item itself
  (`mentions`, `mentioned_by`, `replaces`, `replaced_by`, `conflicts_with`, `applies_to`).
  Neighbours the person may not see are counted in `withheld`, never named. A retired or replaced
  item is named by its title, as the Context list shows it, where agents get only the words that
  linked to it. A term written in Definitions is a `term` node, by `term:<id>` and its word. A
  metric the text mentions is a `mentions` link even when the item also applies to it.
  `areaId` is the item's domain and each neighbour's, a metric's or a dimension's as
  Definitions shows it; `following` says whether agents follow links now (the `get_related`
  switch).
- `POST /items/publish` takes `{ draft, itemId?, reason?, draftId?, relations? }` (FR-137). An
  owner of the draft's domain (and, for a change, of the item's domain now) or an admin publishes
  it in one step, through the same checks and clash gate as the review; anyone else's goes to the
  domain's owners as a suggestion (`published: false`, with `ownerIds`). `relations` says how it
  relates to each live item it clashes with (`replaces`, `disagrees` or `unrelated`), as the
  owner answered in the editor: a clash left unanswered refuses the publish (422, with the open
  clashes as `data.clashes`, each `{ itemId, title }`), and an answer
  for an item it does not clash with is left out. `draftId` names the person's own draft it
  finishes: the draft takes the words and is sent as itself, changing the item it was started
  from, if any; only its writer sends a draft (403 otherwise). A publish the checks refuse keeps
  nothing.
- `POST /drafts/from-text` takes `{ text }`: a draft read from pasted text, or from the page a
  single link points to, with no model. It fills the words, a kind and dates by rule and where
  it applies by the vocabulary's names, and lists in `unsure` what it guessed.

A context item's kind belongs to each version (migration 0008), so Change kind keeps its id,
history and links. In a change to many items, an owner of a draft's domain may delete it, and
Mark as checked records a check even when nothing else moved, for an owner of the domain or an
admin.

## Conflicts

A conflict is two live context items where one item's version says it disagrees with the other
(FR-220). A person declares it, in the review ("These disagree") or in the editor; nothing compares
what the items say. Agents get both with the Conflict state until someone settles it. The contract
is in `src/contract/conflicts.ts`, the rules in `src/domain/conflicts.ts`.

- `GET /conflicts?whose=mine|all` lists the pairs the person may read, most asked first: both
  items, the topic in words built from the holder's scope ("Orders in Norway"), how many agent
  questions got the pair as a Conflict in the last 7 days, since when agents get both, and whether
  the person can settle it. A pair kept as both is left out while both items are at the versions
  the decision saw.
- `GET /conflicts/{holderId}/{otherId}` reads one pair, in either order, the item that holds the
  flag first: each side's words, domain, owners, version, check and first source with its quoted
  line; what agents say to the holder's own question now, with only the holder, with only the
  other, and with the flag removed (the answer engine on the live edition, no model); who may
  settle it how; and the decision that kept it as both, if it still holds and the person may read
  both items. A pair is read only when the person may read both items; otherwise it is not found,
  as in the list (FR-128).
- `POST /conflicts/settle` takes the pair, the outcome (`kept_one` with `keepId`, `kept_both` or
  `not_conflict`), a reason in plain words, an optional quoted line, and the versions the person
  saw. A newer version of either answers 409 and changes nothing. Each outcome is checked against
  the item it changes: keeping one archives the other, so it needs an owner of the other item or an
  administrator; removing the flag publishes a new version of the item that holds it (and of the
  other, when both hold it), so it needs its owner; keeping both needs an owner of either. Keeping
  one also drops the kept item's flag on the archived one. The other owners are mentioned in a
  comment on the item (on the one that stays, when one is archived), and the decision is on both
  items' history (`conflict`). Its `undo` token, `conflict:<id>`, goes to `POST /decisions/undo`
  within the undo window, by the person who decided, and takes back exactly what it did.
- `GET /items/{id}/page` gives `conflicts`: the live items the item is in a conflict with, either
  way round, that the person may read.

## Terms and synonyms

Definitions (docs/product.md, section 3) keeps the words people write beside the metrics and
dimensions the definitions source syncs, which stay read only (FR-138). These operations are typed
in `src/contract/terms.ts`. Writes need the session cookie, `Origin`, `x-heed-csrf` and an
`Idempotency-Key`. A term is a word with its own `meaning`; a synonym is another name for a metric,
a dimension or a term (`sameAs`: `metric:<id>`, `dim:<id>` or `term:<id>`), and a synonym of a
synonym means what that one means.

- `GET /terms` lists the terms and synonyms, by word. Each says who wrote it and when, its
  `revision`, its domain (a synonym's is what it means), how many live context items are about it
  (`items`: those agents get whose words use the term or one of its synonyms; null for a synonym),
  whether the person may change it (`canChange`), and its `conflict`, when it misleads agents now:
  a sync gave its word to a metric or a dimension it does not mean (`source`), or what it means is
  no longer in the definitions (`missing`).
- `POST /terms` takes `{ name, meaning? | sameAs?, areaId? }`, and `PUT /terms/{id}` the same with
  the `revision` the person read; an edit that leaves out `areaId` keeps the term's domain, and only
  an explicit null clears it. An owner of the term's domain or an admin writes it (403
  otherwise); a word with no domain is an admin's. One word has one meaning across the workspace:
  a word, compared trimmed, its spaces folded and case aside, that the vocabulary, the definitions
  source or another term already uses is refused with 409, `data.refusal` `{ code, holder, by }`
  and a sentence that names who has it. `here`: what it would mean is already called that;
  `source`: a metric's or a dimension's name, other name, or the source's name for one; `taken`:
  another term's synonym, with who added it; `term`: a term with its own meaning, with who wrote it.
  An edit that keeps the word and what it means still saves when a later sync gave the word a
  second meaning; the conflict stays shown until its owner renames it. A term other words point at
  keeps its own meaning.
- `POST /terms/delete` takes `{ ids }` and `POST /terms/move` takes `{ ids, areaId }`, up to 200
  terms. A deleted term takes the synonyms that point at it with it; a moved one takes them to its
  new domain, and a synonym moves only with what it means. What the person may not change is left
  as it was, in `skipped` with why. One `terms:<id>` token undoes the whole change within
  `limits.undo_seconds`, for its maker only.
- `GET /terms/deleted` lists the deleted terms, newest first, with who deleted them and the
  synonyms that went with them, for the domain's owners, admins and whoever deleted them.
  `POST /terms/restore` (API only, with no screen in the web app) takes `{ ids }` and brings each back with its synonyms; a word that means
  something else by now stays deleted, in `skipped` with why. A term is never removed.
- `GET /terms/{id}/history` is a term's versions, newest first: what each write made of it
  (`created`, `edited`, `moved`, `deleted`, `restored`) and who wrote it.
- `GET /definitions/related?key=` is Related on a metric or a dimension, by its key
  (`metric:orders`, `dim:market`), in the shape of `GET /items/{id}/related`: the items that
  mention it or apply to it. A key agents do not read is not found.

Agents read the live terms and synonyms through `serving_terms()` (migration 0011), which names
no person; the serving role has no grant on the terms tables. What they get is in the agent tools
above (`terms`).

## The outbox and inbox items

Every write records an event in `outbox_events` in its own transaction. The relay
(`src/server/modules/notifications`) picks events up within milliseconds of commit (PostgreSQL
`NOTIFY`, with a five-second poll and the `outbox.relay` job as backstops), writes inbox items and
numbers each event in the order it relays them. Events carry ids and states, never item or
comment text. The Inbox reads the inbox items its alert cards come from (see [Alerts](#alerts)).

Inbox items go to the reviewers (every active owner of the domain) on submit, withdraw and the
proposer's comments, and to the proposer on reviewer comments and decisions. Source notices (a
flagged item, stale links, a changed domain) go to the domain's owners, or to the administrators
for a term without a domain. Nobody is told about their own action.

The web app has no live stream: it reads a screen again after each change it makes, and when its
tab comes back into view with what is older than half a minute.

## Connect your AI and What an agent would get

Two reads for every signed-in person, with no model and nothing recorded:

- `GET /connect` (FR-404): the MCP server's address (`MCP_RESOURCE_URL`; null where the service
  serves no MCP), the tools switched on for every client, and the clients switched on, by label
  and name. Each client's tools, rate and size limits, and the clients switched off stay with
  `GET /clients`, which is for administrators (API only, with no screen in the web app). The evaluation runner is the
  gateway's own client and is left out.
- `POST /try-it/read`: a question read as a scope with the live edition's vocabulary, so Try it
  opens on what was asked. The question is never stored (FR-602).

The web app shows what an agent would get in Ask and in the review's Try it panel.

## The answer engine

One deterministic function (`src/domain/answer.ts`) answers people the way `get_context` answers
an agent, with no model: Ask, Try it, the review's before and after, the replay of a topic,
Asked this week, the reach of a draft and the free check of saved questions read it. It
takes what is asked (a question's words with the names sent beside them, a typed scope, or a
topic's scope) and one edition bundle: the live edition, the edition before it, or the live
edition with a draft in it. It reads the scope as `get_context` does, resolves it with the agent's
audience, gives at most 20 items (`max_items`'s default), and says the same sentences (FR-344). On
every case of the golden set its status, items, cut and sentences equal `get_context`'s
(`tests/integration/golden-set.test.ts`), and it answers in under 50 ms at the 95th percentile
on the demo library.

An answer has five steps, each timed: `read_scope` (the scope, how the dates were read, the day
assumed, what could not be read), `looked_up` (the items given), `left_out` (what was about the
question and why it did not reach the answer: the resolver's reasons `source_visibility`,
`stopped` and `high_risk_unverified`; `cut` past the item limit; `replaced`; and the near misses
about an asked metric with other `dates`, other `values` or a `dimension` the question did not
name, ten at most, the rest counted in `leftOutMore`; an item for another group is only counted,
in `forAnotherGroup`, and never named, not even by its id), `checked` (the answer
state) and `said`. Each item given carries the line its owner copied from its first source
(`quote`) and what its writer said not to conclude (`notToConclude`, null for the default), which
Ask's Show me where it says that walks a sentence back to. Its state is one of the six (FR-349), in this order: `failed` when the checks
could not run; `missing` when nothing was given or the question could not be read; `conflict`
when given items disagree; `partial` when an asked metric or value has no item that covers it in
full (`uncovered` names them) or the dates were assumed; `stale` when a given item may be out of
date; else `grounded`. Ask shows an answer whose status is `need_more_detail` with no state at all:
"Nothing was looked up" and the reason its `say` gives, never Not found. When the question named
nothing at all, Ask says so in its own words and offers the metrics and markets whose names are
closest to the question's words (`suggestTerms`), never reading them as asked; agents get `say`
and `next` as before.

- `POST /ask/lookup` (Ask): a question (1 to 2,000 characters) and the names a person picked
  beside it (`metrics`, `dimension_filters`, `window`, as Try it), on the live edition. It answers
  with server-sent events: each step as it is done, then the answer. The answer's `links` say what
  `get_related` follows from its items, as an agent would (`on` is its switch): one step from
  each, to another item or a term it did not get already, with what the agent read there (an
  item's summary, a term's meaning), and the retired or replaced ones listed apart, never
  followed. It never changes which items the answer has. For a question about what a metric means
  (`asksDefinition`), `definitions` gives what the definition source says about each metric asked
  (its words, at most 500 characters, the tool, the source and the ref), as `get_context` gives an
  agent; a term an agent may not see, or one whose definition is limited to groups, has none. For a
  question that names values and no metric and finds nothing, `valueMetrics` names the metrics the
  context about those values is written for, most items first, at most three. Neither changes the
  state or the items, and agents never get them. With real models
  (`MODELS=live`), a `words` event follows an answer that gives items: the words of
  `models.assistant`, written from those items only, each sentence that uses one ending with its
  number. The model decides nothing: the state, the items and what agents are told are the
  engine's. Its words are kept only when they pass a check (one paragraph of at most 1,200
  characters, citing only the items given and at least one, with no list, heading, link or number
  it was not given); otherwise, and when the spending limits leave no room, the provider takes
  over 12 seconds or fails, no `words` event comes and Ask writes its own words from the items.
  The call counts under `assistant` in the spend ledger, for the person who asked. The question
  goes to the model's provider for that call; it is read in memory and never stored or logged
  (FR-602), and with `MODELS=mock` nothing at all is recorded. The cases of Ask's words
  (`src/server/modules/answer/words-cases.ts`) run on a scripted words model in every build and
  with `npm run eval:ask-words` (mock), or `-- --real --max-cost-usd <dollars>` with the model of
  `models.assistant`, which sends the cases' made-up questions and items to its provider.
- A question about the context's own records (FR-718, `src/domain/records.ts`), asked as words with
  no `metrics`, `dimension_filters` or `window`, is not looked up: `POST /ask/lookup` answers with
  one `records` event. It has the intent (`created`, `changed`, `due`, `archived`, `owner`,
  `count`, `asked_nothing`, `terms` for the metrics and dimensions Definitions lists, or `values`
  for a dimension's values), what it was understood as, the period (ISO instants, and its words
  in UTC), what was read, the sentence, at most five `rows` (a context item, a domain, a topic, a
  term with the Definitions page it opens, or a kind's counts) with `columns`, the exact `total`,
  and where the full list lives (`more`, with `page` for one Definitions page). A
  question about one person's work gets `refused: true` with its sentence and what to ask
  instead. Everything is counted in the request's own transaction from the items `GET /library`
  lists for the person, their editions' times, the domains and their owners, the live vocabulary
  without a term whose definition the person's groups may not see (CON-509) and, for
  `asked_nothing`, Asked this week. `records_asked_weekly` counts which intent was asked each week
  (or `refused`), and nothing else.
- `GET /ask/asked` (Asked this week): the topics agents asked about in the week of today (Monday
  to Sunday, UTC), one row per metric, market and dimension with its shown months joined, most asked
  first, each with the state the engine gives its newest shown month now (the month of today for a
  row listed only by its total) and how many items that gives.
  Counts only (FR-614): a month under `privacy.min_count` never shows on its own, a row's `count`
  is null when a total would give such a month away (its `atLeast` is what the shown months add up
  to), a row that shows under the minimum is not listed, and `hidden` counts the calls of the rows
  not listed, itself hidden under the minimum. `asked` counts every call of the week, hidden
  under the minimum and whenever what it adds over the rows' counts and `hidden` is under the
  minimum, so it never gives a small month away by subtraction; `askedAtLeast` is what the rows
  show together. For the owners of a row's domains and
  administrators, a row whose state is Not found names the Not found card open on its topic and
  the draft that waits on it (`gap`); for anyone else it is null. `starters` are the workspace's
  first questions, made from what it has written (decided 27 October 2026): the scope of each live
  context item an agent would be given (for everyone, and not stopped; a metric and the first value
  it names), then the vocabulary's metrics, four at
  most, each at the month of today; none while nothing is live. Ask offers them while nothing
  has been asked yet.
- `POST /observability/replay` (the answer panel's replay): a topic's id and `when`, `now` (the
  live edition) or `before` (the sealed edition before it, 412 when there is none). The topic is
  answered for its whole month, step by step. For administrators and the owners of the topic's
  domains (`cl_manages_topic`), as its gap is; anyone else is told the topic does not exist.

The bundles are read once and kept for 15 seconds by edition and overlay, as the agents' edition
source keeps them, so a new publish or stop switch is read at once.

## Observability

What agents asked and what they got (FR-620), as topics and counts: never the words of a question
and never who asked (FR-602, FR-613). Each `get_context` call keeps, with its topic, the answer
state its reply gave (FR-349; none when the question could not be read) and the kind of agent
that called, from FR-410's fixed list, never the name it gave itself (migration 0015).
Administrators read every domain and the calls with no domain; an owner reads the domains they
own, and Usage is for administrators only. Every read is in `src/contract/observability.ts`.

A view counts back from yesterday, the last full day: 7, 30 or 90 days (`range`), and the same
length before it to compare with. Every count goes through `src/domain/observability.ts` before
it leaves the service (FR-614): a count from one to just under `privacy.min_count` is `null`,
and no count is given when a hidden one could be worked out from it by subtraction. Everything
asked in a view, and what found nothing, are always counted when they reach the minimum (a view
under it is `quiet`, with no counts at all). To keep them, finer counts are hidden first: a
topic keeps its total before its answer states, a domain its total before its topics, and an
answer state its total before a bar of the chart; a total over a topic's months is hidden itself
(`atLeast` is what its shown months add up to: "13+"). The topics, the chart and its numbers are
disclosed in one pass, so a count on one never gives away a count on another. A view narrowed to
one kind of agent also hides any count that differs from the same count over every agent by a
hidden one. A topic is in Questions' views of conflicts and of what may be out of date only as
far as its shown counts say, and in the view of what found nothing when its subject (the topic
over its months) found nothing at least the minimum times.

- `GET /observability/agents` (Overview and Questions): `range`, and `areaId` to narrow the numbers
  and the chart to one domain, or `agent` (a kind of agent, administrators only). It answers with
  `state` (`empty` when no agent asked anything in the domains read, `quiet`, or `normal`), the
  numbers (`asked`, by answer state, and the range before), the bars (a day each for 7 and 30
  days, a week each for 90, counted back from the last day), every topic of the range in the
  domains the reader sees (its metric, values and month as the definitions name them, its counts,
  which views it is in, and what waits for its gap in the Inbox: the draft written from it, a
  suggestion, or nothing yet), the subjects (a topic over its months) and the domains,
  `notFound` (what found nothing at least the minimum times in the last 7 days, its months counted
  together, FR-606 case 1), the calls that could not be read (no topic, so no domain: an
  administrator's whole view only), what was published in the range, and the kinds of agent that
  asked (administrators only).
- `GET /observability/feedback` (Feedback): `range` and `areaId`. What agents reported about
  answers, each with its kind of agent and where it stands (`inbox` while its Reported card waits,
  `fine` when an owner closed it as not a problem, `looked` otherwise), and the reports people made
  from Try it and, until it left on 30 Oct 2026, the in-app assistant, which name nobody; and the
  answers people marked good in that assistant, a week each for 14 weeks, and good and wrong in
  the range (FR-712).
- `GET /observability/usage` (Usage, administrators): `range`. Each tool's calls and how they
  ended (answered, needed more detail, found nothing, failed), the calls of each kind of agent
  with its last hour, reply times (the median and 95 of 100, a day each for 7 days, a week each
  otherwise) and this month's model spend by feature against the caps (NFR-062).
- Weekly counts, kept without limit. The delivery records last `retention.delivery_days` (180
  by default), so the `observability.rollup` job keeps, each night before retention, every
  completed week (Monday to Sunday, UTC) in `obs_weekly`: the agent calls of each domain in each
  answer state, and nothing else (FR-612, [db/README.md](../db/README.md#gaps-counts-and-privacy)).
  Summary's trend is their reader. The same job keeps what Heed caught in `obs_caught_weekly`: for
  each week and domain, how many times a saved question's answer changed after a change, by the
  change (a publish, an archive, a restore, a sync, a check date passing), and the alerts each rule
  raised with how many an owner or administrator acted on within 14 days. Counts only, no words and
  no person; it counts the last four weeks again each night, as an alert may still be acted on.
- `GET /observability/summary` (Summary, the first page): `period` (`month` by default, or
  `quarter`), and `areaId` to narrow every number to one domain. It reads the last whole calendar
  month or quarter, ending yesterday at the latest, and the same length before it. It answers with
  `state` (`empty`, `quiet` or `normal`), the headline numbers (`asked`, and of them `checked`,
  `warned` and `missing`, the answer states grouped as checked, with a warning, and not found),
  the same for the period before (`previous`, or null with `notCompared` saying why), a weekly
  trend of checked answers (13 weeks, read from `obs_weekly` where it keeps a whole week and from
  the delivery records for the rest), what is still open (topics that found nothing, with what
  waits for each in the Inbox), the changes published after review, with who approved each, and
  what was caught besides the answers with a warning (`caught`): `saved.total` and
  `saved.triggers`, the times a saved question's answer came out Changed or Needs a look where it
  was Same before, in a check Heed ran on its own after a change; and `alerts.raised` and
  `alerts.acted`, the alerts that asked an owner for a decision (Not found, a saved question needs
  a look, a check is due) and those an owner or administrator acted on within 14 days, by a
  decision Heed keeps. Each is its own line on the page, never added to another and never called
  prevented. A whole week is read from `obs_caught_weekly`, any other day from the records through
  `cl_obs_caught`, which runs as the owner. An alert about several domains counts only for every
  domain together.
  Every number goes through one disclosure pass in `src/domain/obs-summary.ts`, so none can be
  worked out from the others (FR-614); `hidden` counts the ones kept back. The change counts
  (`changes.total`, `changes.before`) go through it too, and the latest list is dropped when its
  total is hidden. So do the caught counts: a saved question's total is hidden only when it is
  under 5 itself, a kind of change first; the alert counts stand alone. Days up to the first day
  agents asked (`since`) count as a known zero, and the open-spot counts are left out of the pass while the period is not `complete`.
- `GET /observability/snapshots` (`areaId` to read one domain's), `GET /observability/snapshots/{id}`
  and `POST /observability/snapshots` (administrators): Summary's monthly snapshots
  (`obs_snapshots`), kept without limit as FR-612 allows. A snapshot is the last whole month's
  Summary, for every domain together and for each domain, as the page showed it on the day it was
  taken: the counts after the disclosure pass (a hidden count is kept as hidden, never as its
  value), what is still open and what changed as counts alone (no topic, no item, nobody who
  approved), what was caught (`caught`, absent in a snapshot taken before it was counted), and the
  sentences, what was caught and the notes said over them then
  (`src/domain/obs-summary-words.ts`), so a digest printed later reads the same after the delivery
  records are gone. Administrators read every snapshot, an owner those of the domains they own;
  without `areaId` the list is every domain's together for an administrator. The
  `observability.snapshot` job takes the last whole month's each night where it is not kept yet and
  agents asked anything, and the `POST` takes it at once, as the job does; a month taken is never
  taken again, changed or deleted. The change counts on Summary and in a snapshot come from
  `cl_obs_changes`, which runs as the owner, so they are the same whoever reads.
- `GET /observability/views`, `POST /observability/views` (`{ name, filters }`) and
  `DELETE /observability/views/{id}`: the views people save on Questions, for everyone in the
  workspace (`observability_views`): a name, unique whatever its case, and filters (answer states,
  a domain, a kind of agent, what waits in the Inbox, a month), never a question. Only whoever saved
  a view, or an administrator, removes it.

## Settings, domains and agents

Heed v1's Settings (FR-815, FR-418, FR-818, golden plan P11a). Every read and change below is in
`src/contract/index.ts`; the app's http binding words them for the screens
(`src/web/api/http-settings.ts`).

- `GET /workspace`: the workspace's name, for everyone signed in, and nothing else of the
  settings. An administrator names it as any other setting, `PUT /settings/workspace.name` (one
  line, at most 80 characters); a new install's is empty, and an answer's share card then says
  only when it was answered.
- `POST /areas` takes a domain from its own page with a name, its owners (`team.ownerIds`) and its
  text alone: the hue is the one the fewest domains have, the review time the default, and no
  chat channel or owner team. `PUT /areas/{id}/description` takes a `name` beside the summary and
  the text, so a domain's owners rename it too; a name another domain has is refused (409).
- `POST /areas/{id}/delete` (administrators): deletes a domain that holds no context item and no
  term, never the sandbox (409, with what it holds). Its open suggestions are withdrawn, its
  drafts stay with their authors and its owners' ownership ends; one that history names is kept as
  history.
- `GET /connect/pending?since=` (Connect an agent's live line): the newest of the person's own
  agent signing in (`connected`: it has its tokens) and their no on the consent screen
  (`declined`), since `since`, at most an hour back, with the agent's name for itself; `waiting`
  when there is neither. A no is kept for an hour, for that person alone, and the history log is
  not told, as nothing changed.
- `GET /agent-connections` and `POST /agent-connections/{id}/disconnect` (administrators, formerly
  `/ai-connections`): every person's agents, and ending one, with a reason the history log keeps
  (docs/ai-sign-in.md).
- `GET /agents`, `POST /agents/{id}/name`, `POST /agents/{id}/tools` and
  `POST /agents/{id}/revoke`: every agent by name, with its kind, each tool it may call and where it
  publishes without review (an administrator sees all, anyone else their own apps), renaming an
  access key, switching one tool on or off for one agent, and ending it (FR-420, FR-421,
  docs/ai-sign-in.md).
- Publishing without review (FR-421, docs/ai-sign-in.md): `GET /agent-policies/switch` and
  `POST /agent-policies/switch` (administrators) read and switch it for the workspace, and switching
  it off ends every policy; `GET /areas/{areaId}/agent-policies` lists one domain's policies, whether
  the workspace allows them, whether the signed-in person may set one, and the apps that suggested
  there lately; `POST /agent-policies` sets one (an owner of the domain) and
  `POST /agent-policies/{id}/end` turns one off (whoever set it, an owner of the domain, an
  administrator or the person the agent works for), each with a reason the history log keeps.
- Pause sharing is `POST /serving/stops` (FR-805): everything, or one domain at a time, on the
  Agents and access page; the tools agents call are switched with `POST /tools/{tool}`, and the
  page reads both from `GET /connect` and `GET /serving/stops`, which everyone signed in may read.
- Settings, Advanced reads every tuning setting (`GET /settings`, read only on the screen), in
  groups, each with Default (the first version, which the install wrote) or Changed and who changed
  it last: the person, or an update or a script when no person wrote the version. It also reads what
  was deleted (`GET /context/deleted`, `GET /terms/deleted`), the history log's latest entries
  (`GET /audit`), the jobs (`GET /operations`) and the editions (`GET /editions`). Check the chain
  is `GET /audit/verify`; the exports are `GET /audit/export` and the live edition's
  `GET /editions/{label}/export`.

## Saved questions

A saved question is a question a domain's owner or an administrator keeps for that domain, with
their name (FR-526; FR-602 as amended: words a person sends on purpose are kept with their name).
It names the items it should answer from: by default every item its answer gives when it is
saved, and a person may leave some out. Owners read and change their own domains' saved
questions and administrators every domain's; anyone else gets none (row security, migration
0019). Agents never read them: nothing serves, seals or exports them. The contract is in
`src/contract/saved-questions.ts` and the rules in `src/domain/saved-check.ts`.

The free check answers a saved question again with the answer engine on what agents get now,
with no model, and compares it with the answer it should keep getting (its baseline). The result
is `same`; `changed` when the answer moved and is no worse (new `words` in the sentences agents
read, other `items`, or `better`); or `look` (Needs a look) when it got `worse` (a less certain
answer state, or an item that may be out of date now though it was not when saved) or an item it
should answer from is `gone`. How the reply words it besides is not what it checks. A check that
could not finish is a failed run, never a result. A check never blocks a publish: it runs after
the change, in its own transactions.

- The `saved.check` job runs every minute and checks every saved question once what agents get
  has moved since its last run: a new edition (named `publish`, `archive`, `restore` or `sync`
  after the newest edition's reason), new stops or flags over it (`sync`), or a new day, on which
  a check date may pass (`check_date`). Nothing moved, nothing runs. A run that failed is not
  tried again for the same edition, overlay and day until a wait has passed, which doubles with
  each failure up to an hour.
- `GET /saved-questions` (`areaId` to narrow): newest first, each with its saver, the items it
  should answer from, its baseline (`saved`: the state, the items with their title and summary,
  and what a person hears) and its last result (`result`, `reason`, the answer `now`, when, and
  what started the run).
- `POST /saved-questions` (`{ areaId, question, origin: ask | gap | typed, expectItems? }`): saves
  it; what it gets now becomes its baseline, and its result is `same` (`saved`). Undo
  (`saved:<id>`, through `POST /decisions/undo`) removes it, for its saver only.
- `POST /saved-questions/{id}/keep`: Keep the new answer; what it gets now becomes its baseline.
  Refused when it already answers as saved. Undo (`kept:<baseline id>`) puts the one before back,
  for whoever kept it, once.
- `DELETE /saved-questions/{id}`: removes it; it is kept, marked removed, out of every list and
  check.
- `POST /saved-questions/check` (`{ areaId? }`, Check now): checks every saved question the person
  manages, or one domain's, counting as it goes, and answers with the run and how many are Same,
  Changed and Needs a look. Nothing is published.
- `GET /saved-questions/status` (`areaId` to narrow): the newest run the person started or the job
  ran (its trigger, `running`, `done` or `failed`, how many it checked of how many), when the saved
  questions were last checked, and for each of the last eight weeks, Monday first, how many
  answered as saved at its end (the current week: now) of how many there were.
- The review sheet (`GET /review/{id}/sheet`) gives `saved`: the saved questions the person
  manages that answer from the suggestion's item, or should, each checked against the draft. It is
  shown only, never kept. After a publish from the review commits, each of those whose answer
  moved and is no worse takes it as its baseline (`published`): the review showed that change
  before Publish. One that got worse stays to be looked at.

## Alerts

Alert rules raise cards in the Inbox; nothing sends an email (FR-621). There are eight, each one
sentence, in `src/domain/alerts.ts`: Not found, A saved question needs a look, Conflict, More
questions not found, Calls fail, Model spend, A connected tool did not sync, and A check is due. A
rule goes to the owners of the domain it is about, to the administrators, or to both. An
administrator turns a rule on or off for everyone and picks its threshold from those its sentence
offers; the Not found threshold is the gap detection's own setting, `gaps.no_item_threshold`, so
changing it there writes a new version of that setting. An owner mutes a rule for a domain they
own: its cards stop reaching them there and still reach the domain's other owners and the
administrators. The tables are `alert_rules`, `alert_mutes` and `alert_raises` (migration 0022);
the contract is in `src/contract/alerts.ts`.

- The `alerts.raise` job runs every 15 minutes, beside `gaps.detect`. Each rule that is on reads
  what it is about, as no person, and raises once for each thing it finds, keyed on what it was
  about, so a second run raises nothing new: a gap that is open (Not found); a domain's saved
  questions that came to need a look since its last raise (A saved question needs a look); a topic
  agents got two disagreeing items for at least the threshold of times in 7 days, once a week,
  unless every pair it gives was kept as both and neither item changed since (Conflict); a share
  of a full day's questions that found nothing, above the threshold two days running (More
  questions not found); a share of yesterday's calls that failed or could not be read (Calls
  fail); this month's model spend at the threshold of the monthly cap (Model spend); a
  definition source whose last read failed or that has not read for longer than it should (A
  connected tool did not sync), told to the owners of the domains whose live items rely on its
  definitions too; and a live item whose check date passed, from 07:00 UTC (A check is due).
- A raise is one row and one outbox event, written together by `cl_alert_raise`; the relay
  delivers it as Inbox items to the rule's audience less those who muted it for the domain. Its
  title is counts and scopes only, never anyone's words, and a count from agents under the minimum
  reads "fewer than 5 times" (FR-614). A share fires only on a part of at least the minimum, so it
  never tells of a hidden count.
- In the Inbox (`GET /inbox/feed`), a domain whose saved questions need a look has one card
  (`look:<domain>`, group `look`) that lists them. Each raise of the five rules with no other card
  (Conflict, More questions not found, Calls fail, Model spend, A connected tool did not sync) is
  an Alert card (`alert:<raise id>`, group `alert`, in the Alerts group after Saved questions) for
  whom it reached, for a week or until its Inbox item is archived: its title, the rule, and where
  its one action goes. An Alert card, a Not found card, a Saved questions card and a card for an
  item whose check date passed do not reach anyone while their rule is off, nor someone who muted
  their rule for the card's domain. An Alert card is left out only when the person muted its rule
  for every one of its raise's domains they own now; a raise with no domains is never muted away.
- `GET /alerts/rules`: the eight rules, each `enabled`, its `threshold`, its `audience`, the
  domains the person muted it for, and its newest raise the person may read. For owners and
  administrators.
- `POST /alerts/rules/{rule}` (`{ enabled?, threshold? }`): turns a rule on or off, or sets its
  threshold; for administrators. A threshold its sentence does not offer is refused. The history
  log keeps each change (`alert.rule_changed`).
- `POST /alerts/rules/{rule}/mute` (`{ areaIds, muted }`): mutes or unmutes a rule for domains the
  person owns. A rule for administrators only cannot be muted.
- `GET /alerts/raised` (`limit`, 20 by default): what the rules raised lately, newest first, each
  with its domains, title, where it sends people (its Inbox card, a topic, a page, or a connected
  tool) and whom it reached, by name. Administrators read every raise; an owner those about a
  domain they own.

## Figures in Ask

Figures in Ask on the service (FR-716, CON-612, golden plan P11a). A definitions integration whose
connector reads figures (Cube) has figures settings, off by default; the connector side is in
[the connector contract](connectors.md#figures-in-ask) and
[the Cube connector](connectors/cube.md#figures-in-ask). The app's http binding words them for
Ask and the integration's page (`src/web/api/http-figures.ts`).

- `GET /figures`: each integration that reads figures, with Show figures in Ask (`enabled`) and
  its data contact, for everyone signed in; for administrators also `connection`, the data
  endpoint, its declared host and whether its token is set. Never the token, or any of it.
- `PUT /figures/{id}` (administrators): `enabled`, `dataContactId` (a person in the workspace, or
  null), `endpoint` (Cube's `/v1/load`) and `token`, each optional, with a `reason`. The token goes
  to the secret store and is sent only to the endpoint's origin; an endpoint at another scheme,
  host or port forgets it. Switching on needs the endpoint, its token and a data contact (422
  otherwise). The history log records `figures.changed` with what changed, and of the token only
  whether it was set, replaced or removed.
- `POST /figures/read`: one figure for an answer, `{ metric, values, from, to, items? }` with the
  metric's key, the dimension values' keys and the days, both included. It answers `off` (with the
  tool's address to link to, when its endpoint is set and the reader is an administrator), `none`
  with a reason (`undefined`, `ambiguous`, `no_date`, `no_split`, `no_value`, or `failed` with a
  code), or `figure`: the value
  and its format, the same for the days just before, when the tool last refreshed its data, the
  query in words, the data contact, and `against`, a context item someone said the figure doesn't
  fit while their report is open. It is read within 4 seconds, kept a minute in the server's
  memory, and stored nowhere; no person's identity is passed on.
- `POST /reports` takes `part: 'figure'` with `figure: { source, metric, values, from, to, route }`:
  the figure doesn't fit the item, to the item's owners, the data contact, or both (`route`). The
  data contact reads it in their Inbox and may close it as not a problem.
