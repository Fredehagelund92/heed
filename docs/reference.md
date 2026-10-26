# MCP and API reference

How agents connect over MCP and what they get, and the HTTP API for definition sources, proposals, review and release, live updates and the assistant. The API is described once in `src/contract` and published as [OpenAPI](api/openapi.json).

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
`improve_question`, `domain_overview`, `what_changed` and `search_help` left the list (the in-app
assistant still runs them in process, by the same code).

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
      "url": "/library/itm_norway01"
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

With `response_format: "full"` (FR-342) the reply keeps the same fields and adds what it always
carried: each item's version, body, validity, claim level, every source, owner, review stamp and
links (FR-326, FR-331), `scope_used`, `dates_read` and `assumed_date`, the domains the question is
about with what their owners wrote (FR-813), `options`, `check_report` and `instructions`. Every
item carries `url`, its page in Heed, and the result's text has a line per item, `Open in Heed -
<title>: <url>`, with who checked it, so the reader of an answer can check a cited item in one click
(FR-347). The address is the first of `CL_WEB_ORIGINS`; the eval runner and the previews run
without one and give the path (`/library/itm_...`). A link holds only the item's id: the page
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
domain named by another spelling is read as that domain (`src/domain/domain-match.ts`).

**`read_context`** reads one item in full (`context`): its text, every source, who checked it, its
What not to conclude line and its outgoing links, with a page of the items that link to it.

**`report`** takes what the person says, after they say yes: `kind` is `missing`, `wrong`,
`unclear` or `helped`, with the `reply_id` of a `get_context` reply, a `context_id` when it is about
one item, and an optional short note checked for sensitive text (FR-611). It is recorded as
anonymous feedback on the reply, with the item's domain when it names one, and the gap job turns
missing, wrong and unclear into a gap for the reply's topic (FR-606, case 3). Something missing with
no reply takes the question's metrics, markets and dates instead and is recorded as a gap, as
`report_gap` did. The reply says who will see it (`to`, "the owner of Sales") and never keeps who
asked (FR-602).

`get_related` (FR-332) follows links from an item id, a vocabulary key such as `metric:orders`,
or a domain (`area:finance`): the neighbours one step away (`depth: 2` for two), each listed once
at its shortest distance, in a fixed order (distance, kind of link, higher risk, newer start, id),
at most 50 a page (`max_nodes`, default 20) with `next_cursor`, and the stored links among them
as `edges`. `relations` narrows the kinds (`replaces`, `replaced_by`, `conflicts_with`,
`applies_to`, `mentions`, `mentioned_by`, `in_area`; all but `in_area` by default) and `window`
the dates of neighbour items. Neighbours carry titles and summaries, never bodies; a retired or
replaced item shows only the author's words. A neighbour the caller may not see is counted in
`links_withheld`, never listed or counted in `counts`, and a start the caller may not see is "Not
found", exactly like one that does not exist. A link never changes what `get_context` delivers.
The pure resolver is `src/domain/links.ts`. **It is on by default**, with its own switch
(`POST /tools/get_related`). For the assistant, `assistantRelatedTool` in
`src/server/mcp/related-tool.ts` is the same tool as an AI SDK tool run in process (null while
switched off, and checked again on each call); `relatedCitations` lists the ids a turn may cite
from its result: items in service only, never a retired item's marker.

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
same function as the assistant's `create_draft` (`saveAgentDraft`) and sends it for review through
the same path as the person's own Send for review (`proposals.submit`), so it waits in the owner's
queue (`status: "suggestion_sent"`, with the link to the suggestion). Nothing is accepted or
published: only the owner does that. If the review checks refuse it (a blocking finding), it stays
the person's draft and the reply says why (`status: "draft_saved"`, `blocking`, and the draft's
link). It names the person on the proposal and its history only: the MCP request log keeps the
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
access tokens and rotating refresh tokens. **Connect your AI** lists the apps connected as the
person and disconnects them. Dynamic client registration, which Claude Code uses, is on
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
does the same every hour (`connectors.sync`), and administrators watch and read them again in
Administration › Sources. There an administrator also adds a source, such as a Cube model in a Git
repository read with a read-only token, tests it before saving and changes its settings. See
[the connector contract](connectors.md) for what a connector declares and reports, the
invariants, sources an administrator adds and snapshot behavior;
[Security and egress](connectors/security.md) for the secret store and the hosts a connector
may reach; and [the Cube connector](connectors/cube.md) for `CUBE_MODEL_DIR`, domain
overrides, renames and the `sources.cube_model_url` setting that links a metric's or dimension's
Source tab to its model file. Connector authors start at
[Writing a connector](connectors/authoring.md).

A refresh compares each definition with what accepted items recorded:

- An item whose live version references a definition that changed is flagged `needs_check`; one
  that references a definition that disappeared is flagged `source_missing`, naming the new id
  when `CUBE_RENAMES_FILE` lists it. Flagged items are still delivered, as `unverified`, and the
  domain's owners get an inbox item (`item.flagged`). An owner clears `needs_check`
  with `POST /items/{id}/recheck`; any accepted version written against the current definitions
  clears either flag in the edition that serves it.
- A definition an item only mentions never flags it. The link shows `source_changed` or
  `source_missing`, the item is delivered as before, and the owners are told (`item.links_stale`).
  A recheck records the current marks, so the links read as current again.
- A domain that changed in Cube flags nothing: owners of the terms that use the definition are
  told (`vocabulary.domain_changed`), and serving keeps the accepted domain until a vocabulary
  proposal changes it.
- A source that cannot be read changes no flag and no link status. The operations view shows it.

`GET /api/v1/catalogue` lists every metric and dimension of the live vocabulary (FR-136): its
definition as the source last read it (the description copy, never a calculation), its domain
(the vocabulary's domain, then the source's, then none), its status, and what the library holds
about it, counted per term in the same answer. `GET /api/v1/catalogue/{kind}/{id}` reads one,
a dimension with its values. Both read as the library does.

The "where it applies" picker reads `GET /api/v1/vocabulary/search` (a page of metrics and
dimensions, with per dimension "any value", a count and a few values; a page at a time inside one
dimension). A scope can
name a dimension with any value (FR-126); see `docs/api/openapi.json` for the shapes.

`GET /api/v1/sources/flags` lists flagged items with the definitions behind each flag, oldest
first. `GET /api/v1/sources/stale-links` lists mentions in live items whose target was retired,
replaced, changed or is gone. Both take an optional `areaId`.

## Proposal write API

The proposal write API adds `/api/v1/proposals` to the session-authenticated contract. Use the sign-in cookie,
allowed `Origin`, and session `x-heed-csrf` header for writes. Create, submit, comment and discard
also require an `Idempotency-Key` header (8-128 printable characters). The key belongs to the acting
person for 24 hours: an identical request replays its response, different content returns 422,
and a concurrent request using the same key returns 409. A rolled-back request can be retried.

- `POST /proposals` creates an incomplete draft. Supply `{ draft }`, optionally `itemId` to
  suggest a change to an accepted item, or `derivedFrom` to restart a rejected proposal.
- `GET /proposals` supports `own`, `areaId`, `state`, `limit` and `offset`. It answers
  `{ rows, total, limit, offset }` for every kind of proposal the person may read (item, retire,
  recheck and vocabulary), newest first by actual timestamp. `total` counts the readable matches
  before pagination. `GET /proposals/{id}` and `/events` read a proposal and its timeline
  under row security; `draft` holds item form content only and is empty for the other kinds.
- `PUT /proposals/{id}/draft` replaces the saved form with `{ revision, draft }`. Save is allowed
  while drafting or after changes are requested. Every mutation checks `revision`; a stale
  write returns 409 with the current record.
- `POST /proposals/{id}/submit` takes `{ revision }`. The proposer submits an immutable version,
  scope, evidence, references, mention rows, digests and format checks in one transaction with
  the proposal state, audit and outbox records. Resubmit creates another version. Submission
  does not publish anything.
- `POST /proposals/{id}/claim` takes `{ revision }`. A domain owner can claim.
  `/hand-over` adds `personId` and requires the current claimant and an active domain reviewer.
- `/comments` takes `{ revision, text, replyTo? }`; `/withdraw` takes `{ revision, reason }`.
  Comments and withdrawal reasons are plain text, without mentions. Only the proposer withdraws.
- `POST /proposals/{id}/discard` takes `{ revision }` and closes a draft that was never sent;
  withdraw is for a sent proposal, which answers 409. The proposer or an administrator may
  discard. The row stays for its timeline and audit entries, but reads as not found and leaves
  every list, the overlap check and a gap's proposals. The answer is `{ id, discardedAt }`.
- `GET /proposals/{id}/overlap` returns accepted overlaps and the caller's own open proposals,
  each with title and kind (proposals also with number and state). An owner or approver
  of the domain, or an administrator, also gets other people's open proposals in `otherProposals`;
  anyone else gets only `otherProposalExists`. Scope and validity decide overlap.
- `POST /proposals/{id}/preview` takes `question`, optional `metrics`, `dimension_filters`, and
  `window: { from, to }` (inclusive). It uses the same resolver, link filtering, instructions and
  response formatter as `get_facts`, in a private candidate bundle. It records no deliveries
  or demand. Preview access is limited to the proposer, domain owners and administrators
  for unaccepted content.
  The answer is `{ proposalId, revision, result }`, where `result` is `get_facts`'s reply,
  typed by `previewReplySchema` in `src/contract/proposals.ts`.

Draft fields follow `src/contract/proposals.ts` and `src/domain/draft.ts`. The service derives
identity from the session, title from summary when absent, risk from kind, owner from domain,
and definition references and their change marks from governed scope. Missing domain can be
inferred from governed scope or references; ambiguous scope requires an explicit domain. An
omitted review date starts at 90 days from the current UTC day. Submission due dates use the
domain's review time in weekdays. A recheck moves the review date (see [Review and release API](#review-and-release-api)).

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

The review and release API adds decisions, check levels 2 and 3, gates, publishing, rollback, retirement, rechecks, the
stop switch and vocabulary proposals to the same contract. Writes need the session
cookie, `Origin` and `x-heed-csrf`; decisions, retirements, rechecks, rollback and
vocabulary proposals also take an `Idempotency-Key`.

- `GET /review/queue` lists open proposals the person may decide, highest risk first, then
  oldest: an owner those of their domain, an administrator every one, vocabulary included. An
  approver decides nothing any more, so their queue is empty.
- `GET /proposals/{id}/review` returns the field diff against the version in service, mentions
  added and removed, narrower-audience warnings, findings, the gate and the decisions. The gate
  is the newest result of levels 1 to 3, which every proposal needs whatever its risk (FR-513),
  whether an owner or an administrator accepted (`approvals.approver` is always null), and the
  database's own verdict (`cl_item_version_problem`). `POST /proposals/{id}/checks` runs levels
  1 to 3 again. No answer test runs on a proposal.
- `POST /proposals/{id}/review-edits` lets an owner of the domain (not the proposer)
  change a submitted or in-review item proposal: `riskLevel`, `reviewDate`, `claim` (with
  authority and quote for `effect_stated`), `ownerId` and `areaId`, with an optional `reason`.
  Name only what changes; the content stays the proposer's. Moving to another domain also needs an
  owner there, or an administrator. The edit is a new version that supersedes the
  submitted one, so earlier accepts and check results stay with the old version; an open answer
  test run of the old version, made before Heed v1, is cancelled, and levels 1 to 3 run again. A
  risk level changes no check and needs no other accept. It answers the review, as
  `GET /proposals/{id}/review` does.
- `POST /proposals/{id}/decisions` takes `{ revision, outcome, reason, capacity? }` with
  `accept`, `request_changes` or `reject`. An owner of the domain or an administrator decides; an
  approver decides nothing (403). An administrator decides any proposal, their own too, and an
  owner their own in the domain; anyone else never decides their own (403). Accept runs levels 1
  to 3 against the current live edition, and the accept publishes an edition in the same
  transaction: the version enters service, replaced items leave it, the edition is sealed with its
  content digest and the live pointer moves. An accept given before Heed v1 that waited for the
  approver publishes when the person who gave it accepts again. A change written against a
  version that is no longer live returns 409.
- Level 2 probes the item's own scope with the resolver: inside it and on its first day it must
  be delivered (an exact match, a partial one with no dimension filter); the day before, its end
  day, another value of a filtered dimension and an unrelated metric must stay silent. Level 3
  runs the candidate through `get_facts`'s code: its probe delivers it, replaced items are
  absent, the reply fits, and no active test question of the domain turns from pass to fail. Both
  look at the item as delivered once nothing stops it.
- No answer test gates a proposal (FR-513): levels 4 and 5 (`answer_impact`, `answer_full`) are
  history, kept on the versions whose runs recorded them before Heed v1. A failed level 1 to 3
  blocks acceptance, with no override (FR-514).
- `POST /items/{id}/retire` retires at once (owner or administrator, with a reason).
  `POST /items/{id}/retire-proposals` lets anyone propose it; one can be open per item.
- `POST /items/{id}/recheck` records "checked, still correct": a new version with the same content,
  the current change marks and, without an end date, a review date `review.default_days` from
  today. It answers `{ proposal, edition }`. Levels 1 to 3 run at once; when they pass, at every
  risk level, the recheck is accepted and publishes a `source_rechecked` edition and clears a
  needs-check flag. When one fails it answers 422 with the gate, and nothing is published.
- `POST /vocabulary/proposals` proposes a new or changed term. An owner of the term's domain or an
  administrator decides; a term without a domain is the administrator's. A Cube domain that
  differs from a metric's domain is a warning when proposed and refused at the decision; a
  dimension's Cube domain is only a suggestion, since views share dimensions such as market.
- Terms from the definition source, for administrators: `GET /vocabulary/candidates` lists the
  members no term or open proposal links yet, each as the term to propose (one per metric, one
  per dimension name however many views share it; dates and ids are not suggested), and
  `POST /vocabulary/batches` proposes many terms in one step, all or none, in one import batch
  (a value may name a dimension of the same batch). Each term is still decided on its own by an
  owner of its domain or an administrator, the proposer too; `POST
/vocabulary/batches/{batchId}/decisions` accepts or rejects every open term of the batch the
  person may decide, and an accept publishes them as one edition. The proposer can withdraw a
  term while it waits (`POST /proposals/{id}/withdraw`).
- `GET /editions` and `GET /editions/{label}/diff?against=` list editions and what changed, for
  owners of any domain and administrators. `POST /editions/{label}/rollback`
  (administrator) serves that edition's content as a new edition with the same digest. When a
  version it would serve again no longer passes the serving rules (for example a check that
  failed since), it answers 409 naming the item and the reason, with every such version in
  `data.blocked`.
- Seeing what changed (Editions design G1, G2, G3 and G7), for the same people. Each changed item
  is `added`, `changed`, `checked` (checked, still correct), `resaved` (another version, the same
  content), `retired` (retired or replaced) or `removed` (taken out by going back), and carries
  who and why: the proposal that brought its version in, the proposer and channel, the owner who
  edited it in review, and the accept (or retire) decisions with their reasons. Like the edition
  export, a version with an audience group (groups are parked) is only counted, as `withheld`:
  its title, attributes and fields stay out, and the one-item view answers 404.
  - `GET /editions/feed?before=&after=&through=&limit=` lists editions newest first, each with counts by
    change, the domains, the highest risk, vocabulary changes, the first ten changed
    items, who made it and why, and one sentence in plain words built from a template ("Norway
    closure" changed in Finance. Proposed by Maria Lindqvist, accepted by Jon Abara. Why: the
    owner's reason). `next` is the `before` of the next page; `after` stops at an edition and
    `through` starts at one (included), for a range edition by edition.
  - `GET /editions/compare?from=&to=` nets every item that differs between two editions once (by
    default the live edition against the one before it; `to` older than `from` compares
    backwards), with counts by change, domain, kind and risk over all of them, a sentence, and a
    page of items (`change`, `areaId`, `kind`, `riskLevel`, `limit` up to 200, `offset`) with the
    names of the fields that differ. Sealed editions never change, so a page of two named editions
    is stable.
  - `GET /editions/compare/items/{id}?from=&to=` shows one item field by field (the fields the
    system fills in, such as change marks and markup, are marked `systemFilled`), its mentions
    added and removed, and each edition in between that changed it, with who and why.
  - `GET /editions/{label}/rollback-preview` (administrator) compares the live edition with that
    one before anyone goes back, and lists the versions that cannot be served again.
  - The web client reads the feed, the comparison and the one-item view through `ContextApi`
    (`editionFeed`, `compareEditions`, `compareEditionItem`, with query options in
    `src/web/api/edition-queries.ts`, loaded only by the pages that use them), one set of reads
    for the Editions pages and the Workbench. The mock binding nets its own editions by the same
    rules (`src/web/api/mock-edition-compare.ts`). Every version of a fixture item holds the same
    content, as the database seed stores them, so its starting history reads as added, saved
    again and retired, except the demo's one regression, whose second version ended its note. A
    change accepted in the mock compares the version that was accepted, though the library keeps
    the fixture text, and the mock keeps no vocabulary versions.
  - The Editions page's What changed opens `/editions/compare` (administrators): Since and Until
    in the address, ranges such as the last 7 days, the overall result grouped by the kind of
    change in one windowed list with Filter and a Viewed box per item (`v`, kept in the browser),
    an item field by field in the docked panel, or edition by edition from the feed.
- `POST /serving/stops` (administrator) switches delivery off or on for an item, a domain or
  everything. Serving reads the overlay on every call, so it applies to the next request.
  `GET /serving/stops` lists the stops that are on for every signed-in person, so the app can
  show a banner; only an administrator also gets each stop's event number (`seq`).
- Every domain that exists is served (FR-320, FR-802): its accepted items reach agents and its
  gaps reach its owner from the start, with no state, start checks or go-live step. The stop
  switch above is the one way to hold a domain's items back for a while.

## Live updates, inbox and activity

Every write records an event in `outbox_events` in its own transaction. The relay
(`src/server/modules/notifications`) picks events up within milliseconds of commit (PostgreSQL
`NOTIFY`, with a five-second poll and the `outbox.relay` job as backstops), writes inbox items and
numbers each event in the order it relays them. Events carry ids and states, never item or
comment text.

- `GET /events` is a server-sent event stream for the signed-in person. Each message's `id` is
  its relay number; reconnecting with `Last-Event-ID` replays exactly the events after it, then
  continues live. A stream without one starts with `stream.ready` (the position to resume from);
  an unknown or expired id gets `stream.reset`, which means refetch. Events are filtered per
  person and per read: a proposal's events reach its proposer, the domain's owners
  and administrators. `inbox: true` marks an event that also reached the person's inbox. A
  comment line every 15 seconds keeps the stream open; the stream ends when the session does.
- `GET /inbox` lists the person's items newest first (`filter` = `all`, `unread` or `archived`,
  `limit`, `before`), with the unread count. `POST /inbox/read` and `/inbox/archive` take
  `{ ids }`; `POST /inbox/read-all` takes no body. Each change sends `inbox.changed` to the same
  person's other streams.
- `GET /activity` lists submissions, comments, claims, hand-overs and withdrawals (and decisions
  and releases) the person may see, newest first, optionally for one
  `areaId`, paged by `before`. Entry ids equal stream ids.

Inbox items go to the reviewers (the claimant, or every active owner of the domain
while unclaimed) on submit, withdraw and the proposer's comments; to the proposer on claim,
reviewer comments and decisions; and to the new reviewer on hand-over. Source notices (a flagged
item, stale links, a changed domain) go to the domain's owners, or to the
administrators for a term without a domain. Nobody is told about their own action.

In the front end, the shell reads the stream (`src/web/api/live.ts`): each topic names the
caches it makes stale, and open screens fetch them again; `stream.reset` refetches everything,
and while the stream is down the app reconnects with `Last-Event-ID` and polls every 60 seconds.
The header's bell shows the inbox (read, read all, archive), and the sidebar counts the
proposals waiting for the person. The mock keeps an outbox and inboxes with the same rules
(`src/web/api/mock-live.ts`, checked by `tests/conformance/context-api-live.ts`); outside
production builds `window.heedMock.as('per_jon')` acts as another person in the page's mock
world, so a change arrives live without a reload.

## Assistant

The assistant runs behind `POST /assistant/chat` (FR-701 to FR-710). It explains deliveries
and items, coaches questions, checks drafts and drafts items. It may propose, never accept or
publish. The front end's Ask tab in the assistant panel calls it.

- **One turn per request**: the client holds the conversation as AI SDK UI messages and sends it
  each turn (at most 60 messages and 200,000 characters) with the person's time zone (`timeZone`,
  UTC when left out or unknown); the server keeps none of it (FR-603),
  only the drafts a person confirms and the spend counters. The answer streams back as UI message
  chunks over server-sent events, which the AI SDK's chat reads as they come.
- **Tools** call the same services as the MCP tools, the form and review, in process and without
  recording demand (FR-709): `get_facts`, `find_facts`, `read_item` and `improve_question`
  on the live edition; `explain_item` (why one item does or does not apply to a scope, from the
  resolver itself, naming the edition); `check_draft` (levels 1 to 3 as submit runs them, saving
  nothing; test questions appear as counts only, FR-503); `find_overlaps`; `estimate_impact`
  (what agents would get with the draft accepted, from the fixed rules: no answer test runs on a
  proposal); `read_gap`;
  `domain_overview` (a domain by its name, or every domain with the metric and dimension names
  Heed knows) and `what_changed` (the live edition against the one before, for a domain or all);
  `search_help` (how Heed itself works, from the help pages, through the MCP tool's function, with
  the app's paths as links: the answer links the page it used, FR-715); and `create_draft`. A
  draft is written with names, not ids: the domain, the owner and the
  scope's metrics and dimension values as the person says them. Heed resolves them as the MCP
  `draft_context` does (the domain defaults from the metrics, the owner from the domain), before
  the person is asked to confirm, and a name it cannot match goes back to the model.
- **Permissions** (FR-706): every tool names its operation, and runs only when it is one of the
  assistant's own operations and a propose-only principal (no global or domain role) may perform it,
  in its own transaction as the person, after the session is read again. There is no tool to
  submit, accept, publish, retire, edit accepted items or administer, whoever uses it.
  `create_draft` waits for the person's confirmation, signed by the service so a client can
  confirm only the call the assistant proposed. The card shows every field the draft will be saved with, read only, and nothing opens until the person confirms; once saved the answer links to the draft. A summary over its limit (FR-118) is sent back to be shortened, never cut. It saves a draft with the channel `assistant`,
  and the draft's `created` history entry carries the label "unreviewed draft" and the source of
  each field it filled (FR-707). A confirmation sent twice saves one draft.
- **Citations**: the answer reaches the person a sentence at a time, after a check. A sentence
  that names an item id no tool returned in this conversation (in any letter case), or quotes text of 20
  or more characters that no tool result (or the person's own text) holds, is replaced with a
  plain notice. Quotations are checked whole, so one that runs across sentences is held until it
  closes; double quotes and single quotes both count, and an apostrophe inside a word (aren't) is
  not a quote mark. Each tool result is sealed with an HMAC (a key derived from the secret that
  signs confirmations) over the person, the conversation, the call, the edition and an expiry of two
  hours (`seals.ts`), sent as a `data-evidence` part. A later turn counts an earlier result as
  evidence only when its seal verifies, so forged or edited history is not evidence, and a result
  that expired or was read in an edition no longer live must be read again. A `data-citations`
  part closes each answer with what it cited, what was removed, and how many cited items were read
  in an earlier answer.
- **Turn context**: each turn adds a second system block after the cached instructions, built on
  the server from the session and the database (`turn-context.ts`), never from the conversation:
  today's date and weekday in the person's time zone, the live edition, who the person is with their
  roles and domains, the domains with their state and owner, and Heed's pages. The model never
  asks for what Heed knows (ids, the person's role, a domain's name).
- **Untrusted text** (NFR-024): item text, evidence, gap topics, pasted text and web pages reach
  the model as tool results or as the person's message, never as instructions; gap notes are not
  shown to it.
- **Drafts from the web** (FR-714): `read_source` opens a page the person linked in the
  conversation (or a `search_web` result) and hands the model its title and passages, so the
  assistant fills the evidence itself: the page's address, one sentence in the page's language and
  the day it was read. Heed reads it (`src/server/modules/web`): https to public addresses only, the
  name resolved once with every answer public, each redirect checked again (at most five), 2 MB
  decompressed and 15 seconds, text pages only, the page's own character set (some pages serve
  Windows-1252 with none declared). Text that reads like instructions is pointed out in the result,
  in English, Portuguese and Spanish. A draft whose evidence comes from a page read in the
  conversation is marked an external source, unreviewed (`provenance.external`), with the automatic
  quote match: a warning on the draft and in review when the sentence is not on the page, never a
  block. `search_web` runs one search through the assistant's provider (Anthropic's web search on
  the gateway's Messages API, on Claude Haiku 5.5, about USD 0.012 a search), returns titles and
  links with official sources first, refuses search words that look like figures, ids or personal
  data, and is off until `limits.web_searches_per_day` is above 0 (searches per person a day).
  Every page read and search is counted in the spend ledger (`web_reads`, `web_searches`), a search
  with its fee. `CL_WEB_READ_LOOPBACK=on` lets the tests serve their pages on this machine; it is
  refused in production.
- **Budgets** (FR-409): at most eight model steps and 2,000 output tokens a step. Before the first
  step and between steps the turn checks the monthly cap, the assistant cap in
  `limits.llm_feature_monthly_micros` and the person's daily limit against an estimate, and stops
  with a message (`data-limit`) that names the limit. Usage from each step goes to the ledger at
  once, and a step that ends early (client disconnect, the 90 second step timeout, a provider
  error mid-stream) is recorded too: the provider's partial usage when there is one, otherwise an
  estimate (known input plus the output streamed so far), counted in `estimated_calls`. A refusal
  by the model ends with a plain message (`data-refusal`).
- **Model**: `models.assistant` (Claude Sonnet 5.5 by default) with high effort and a prompt cache
  breakpoint after the tools and instructions, where its provider has one. `MODELS=mock` is a
  scripted assistant: it
  picks one tool from the words of the message and explains its result, citing only what the tool
  returned; a link pasted with a request for a draft is read first, and the draft is made from it. A greeting, thanks, "what can you do" and other messages about the assistant itself
  get a plain answer with no tool, and a message it cannot place says it is the demo model
  (`src/domain/assistant-meta.ts`). Errors are logged by kind and status only, never with a prompt.
- **Test cases** (FR-710): `npm run eval:assistant -- --as <email>` runs the assistant's own cases
  (explain a delivery, explain an item, why an item does not apply, coach a question, draft from
  pasted text, an instruction hidden in pasted text, a request to publish) against the live
  edition, with the scripted mock in every build (`tests/integration/assistant.test.ts`) and with
  the real model on request (`--real --max-cost-usd`). Runs are recorded as `assistant_mock` and
  `assistant_real` and listed apart under `GET /evals/runs` for administrators (a run of no domain).
  Each case is tried three times (`--tries`), each try a fresh conversation of one or more turns
  (`then`); the majority decides, or every try with `--pass-rule all`. Code checks what happened,
  the judge model (`models.judge`) grades a turn's rubrics, and a case where the two disagree is
  named. Every try is kept whole in `assistant_case_tries` (each turn's words and answer, the tool
  calls with their inputs and results, citations, the time to the first words and the first
  sentence, the verdict and the cost), readable by administrators and the person who ran it; a try
  the provider kept failing is not made, and the run ends incomplete. `--golden` runs the golden
  set's assistant cases instead (`db/seed/golden-set.yml`: definitions, conversations checked turn
  by turn, the companion's turns, `meta` messages about the assistant itself, which must be
  answered without a question about the metric, market or dates, and the `pilot` conversations a
  pilot saw go wrong, such as a domain asked for by another spelling that holds nothing
  yet, and `help` questions about how Heed itself works, which must call `search_help` and link the
  help page, `links_any`), each on its as-of day; a case
  whose items are not in the live edition is skipped, so run it on a database with the golden
  library. `--type <type>` keeps one type, and `--dry-run` prints each case's estimated cost and
  makes nothing. With the held-out key, `--golden` also runs the sealed held-out cases and reports
  them as counts only ([The sealed held-out cases](evaluations.md#the-sealed-held-out-cases)).
- **Ratings** (FR-712): the thumbs under a finished answer send `POST /assistant/ratings` with the
  verdict (`helpful` or `wrong`, give_feedback's words) and the metric keys of the answer's scope,
  nothing else: no question, answer or note, and the service refuses any other field. It stores
  the verdict, the one domain those metrics belong to on the live edition (as a gap's topic takes
  it; null when none or several) and the hour in `assistant_ratings`, with a random id and no
  person, session or address, and no history entry or log line names who rated. Nothing can find
  a rating again, so an answer is rated once; the page remembers which, in memory, until New chat.
  Each person may rate `limits.assistant_ratings_per_minute` (default 20) a minute; over it, 429
  with `Retry-After`. Health shows the counts per domain and week (`GET /quality/ratings`,
  [Quality reads](evaluations.md#quality-reads)).

## Connect your AI and What an agent would get

Two reads for every signed-in person, with no model and nothing recorded:

- `GET /connect` (FR-404): the MCP server's address (`MCP_RESOURCE_URL`; null where the service
  serves no MCP), the tools switched on for every client, and the clients switched on, by label
  and name. Each client's tools, rate and size limits, and the clients switched off stay with
  `GET /tools` and `GET /clients`, which are for administrators. The evaluation runner is the
  gateway's own client and is left out.
- `POST /try-it` (What an agent would get): a typed scope, `metrics`, `dimension_filters` and an
  inclusive `window`, and nothing else. It answers `get_facts`'s reply on the live edition
  exactly as an agent with the default limits gets it (the items in rank order, the check report
  and the instructions), without its `delivery_id`, with the reply's size and the 100,000 byte
  limit. There is no question field, so no question text can be stored (FR-602), and no audience
  field: the bundle resolves with no audience groups, which is every person's audience while
  groups are parked. It records no delivery, topic, gap or request. Before the first edition is
  live it answers 412. Beside the reply it gives the answer engine's `answer` for the same scope
  (its state, items, what was left out and its steps, [The answer engine](#the-answer-engine)).
  With `draft` (a proposal's id the person may read) both are for the live edition with the
  draft in it, as the proposal's preview builds it; the answer's `target` names the draft and its
  item, and a draft's answer is never called Checked.
- `POST /gaps/reports` (Report a gap, FR-606 case 5): any signed-in person reports a gap about
  the scope they were looking at: the same `metrics`, `dimension_filters` and `window` as Try it,
  a gap `type` (FR-607) and an optional `note` of up to 500 characters (FR-611). The scope is
  resolved on the live edition as `get_facts` resolves it, so an unknown term is refused (422
  with findings), a scope without dates is read at today, and the topic comes from it alone
  (FR-604). One
  report counts against the topic's gap of that type exactly as `report_gap` does (FR-308): the
  open gap, a won't-fix gap that keeps its status, or a new gap opened by case 5. The answer is
  the gap's `id`. Nothing records the person (FR-608, FR-613): `cl_report_gap_person` never
  reads `cl.person_id`, writes no history entry, and the request log keeps its method, path and
  status only; the gap's weekly counts keep the part of its reports that people made
  (`personReports` in the API, for the gap's owners and administrators only; `human_reports`
  in the table). The note goes to the gap's notes
  as `person` and is checked like an agent's note (no personal data, secrets or question text).
  An `Idempotency-Key` of 128 random bits (32 hex digits or a version 4 UUID) is required:
  a double click or a retry counts once, through
  `gap_report_keys`, which holds a digest of the caller with the key, and one of the request,
  for a day; without the key, which only the page holds, it names no one. Anyone signed in may
  add reports, so a reader who does not manage the gap never sees people's reports, and they
  count neither in that reader's `reports` nor towards which weeks show (FR-614): nobody can
  uncover a hidden count by adding to it.
  Each person may report `limits.gap_reports_per_minute` (default 5) a minute; over it, 429 with
  `Retry-After`.

The front end shows What an agent would get in the assistant's panel, expanding to its page,
`/try-it`, which keeps the scope asked in its address (`about`, `from`, `to`). Connect your AI is
a section of the person's own Settings (`/settings?section=connect`), reached from Home's quick
action, the user menu and `g` then `y`; the old `/connect` and `/try-it?tab=connect` lead there. When nothing applies, Start a
draft opens Add context with the scope and the first day (`/library/new?about=...&from=...`).
Report a gap, beside it (and under the facts when some apply), opens a dialog with the scope in
words, the gap type and a note, and a toast confirms it. The dialog
(`components/gaps/report-gap-dialog.tsx`) takes any typed scope, so the assistant can offer the
same action with the scope of its answer. The Gaps page and Health mark the gaps people reported (From
people), filters by origin, and shows people's reports in the gap's panel, through the same
privacy rule as every other count.
Signing in from a person's own client (FR-403) is not built yet, so Connect says that a client
connects with a token the data platform team gives out.

## The answer engine

One deterministic function (`src/domain/answer.ts`) answers people the way `get_context` answers
an agent, with no model: Ask, Try it, the replay of a topic, Asked this week and the reach of a
draft read it, and the review's before and after and the saved-question check are to follow. It
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
state) and `said`. Its state is one of the six (FR-349), in this order: `failed` when the checks
could not run; `missing` when nothing was given or the question could not be read; `conflict`
when given items disagree; `partial` when an asked metric or value has no item that covers it in
full (`uncovered` names them) or the dates were assumed; `stale` when a given item may be out of
date; else `grounded`.

- `POST /ask/lookup` (Ask): a question (1 to 2,000 characters) and the names a person picked
  beside it (`metrics`, `dimension_filters`, `window`, as Try it), on the live edition. It answers
  with server-sent events: each step as it is done, then the answer. The question is read in
  memory and never stored or logged (FR-602), and nothing is recorded.
- `GET /ask/asked` (Asked this week): the topics agents asked about in the week of today (Monday
  to Sunday, UTC), one row per metric, market and dimension with its shown months joined, most asked
  first, each with the state the engine gives its newest shown month now (the month of today for a
  row listed only by its total) and how many items that gives.
  Counts only (FR-614): a month under `privacy.min_count` never shows on its own, a row's `count`
  is null when a total would give such a month away (its `atLeast` is what the shown months add up
  to), a row that shows under the minimum is not listed, and `hidden` counts the calls of the rows
  not listed, itself hidden under the minimum.
- `POST /engine/reach` (the editor's and the review's "12 questions agents asked this week would
  get it"): a draft (a proposal's id the person may read). Each topic asked at least the minimum
  times this week is answered for its month with the draft in the live edition, and the topics
  whose answer gives the draft count their questions. A topic under the minimum never counts, so
  the total gives none away.
- `POST /observability/replay` (the answer panel's replay): a topic's id and `when`, `now` (the
  live edition) or `before` (the sealed edition before it, 412 when there is none). The topic is
  answered for its whole month, step by step. For administrators and the owners of the topic's
  domains (`cl_manages_topic`), as its gap is; anyone else is told the topic does not exist.

The bundles are read once and kept for 15 seconds by edition and overlay, as the agents' edition
source keeps them, so a new publish or stop switch is read at once.
