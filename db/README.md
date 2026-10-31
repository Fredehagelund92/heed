# Heed database baseline

PostgreSQL 18 is required. `npm run db:migrate` (`db/prepare.ts`) gets a database ready; it never
starts PostgreSQL. With a superuser in `DATABASE_URL_BOOTSTRAP` it first creates
`context_layer_owner` (migrator, CREATEDB), `context_layer_api`, `context_layer_serve` and
`context_layer_readonly`, and the database `DATABASE_URL_MIGRATE` names, owned by the owner, when
they are missing. Without it they must exist already. It then applies new migrations and the grants
as the owner (`DATABASE_URL_MIGRATE`), and with `SEED_DEMO=on` loads the demo (below). The
container (`compose.yaml`) runs it before every start. The three runtime roles cannot create
databases, inherit privileges or bypass row security. Local login uses the server's existing
loopback authentication, and the compose file's database trusts its own network; neither changes
`pg_hba.conf` or installs passwords.

`db/migrations` holds forward-only SQL. `0001_baseline.sql` is the whole schema: the job queue's,
then the types, functions, tables and views, the rows a new installation starts with (the proposal
workflow, the agent tools and clients, one version of each setting), then the indexes,
constraints, triggers and row security. It replaced the migrations that built the schema step by
step, and a schema-only `pg_dump` of a database it makes equals one of a database they made. A
database those earlier migrations made cannot be upgraded: the runner refuses it, naming the
migration its history starts with. Its data is demo data, so make it again: `docker compose down
--volumes` for the compose file's database, or drop the database and run `npm run db:migrate`
(and `npm run seed`, or `SEED_DEMO=on`) for a local one.

The migration runner serializes callers with an advisory lock, commits one file at a time,
and records its SHA-256. Missing, reordered or edited applied files fail before new SQL runs.
Add a migration to change an installed database; never edit or rename one that has been applied.

A new migration takes the number after the last one on `main` when it merges: numbers run from
0001 without a gap and no two files share one, so the first after the baseline is 0002. Add one
with `npm run db:new-migration -- <snake_case_name>`. `db/migrations/latest.txt` names the last
file, so when `main` gains a migration while your branch waits, your pull request conflicts on that
line: rebase and run `npm run db:renumber`
([Generated files and rebasing](../docs/development.md#generated-files-and-rebasing)). Files run
in name order, so two branches that took the same number would sort by the rest of the name, and a
database migrated between their merges would be refused. A database that applied a migration
from its branch before it was renumbered is refused too, naming both numbers; make it again. The
runner and `tests/server/migration-files.test.ts` refuse a shared or skipped number, and the test
checks `latest.txt`. SQL enum additions that need to be used in another statement belong in their
own migration transaction.

`db/bootstrap/grants.sql` is applied after migrations with identifier-quoted environment role
names. Migrations do not create cluster roles. Functions have no PUBLIC execution privilege;
serving and analytics have explicit read surfaces. The jobs schema is below.

The API is a trusted application role. Auth and application authorization must set
`cl.person_id` with `set_config('cl.person_id', personId, true)` inside each transaction.
Row policies are defense in depth, not a login system: a holder of the API database credential
can set that value. Runtime connections must never use the owner or a superuser.

## Reviewed schema changes

- Version child reads follow the parent's row policy, including the link view. Inserting all
  version content is one transaction; adding children to a committed version is refused.
- Service changes must use a real, unsealed edition after sealed history. Vocabulary and area
  ranges have the same protection as item ranges. Retirement checks the version's own area.
- Audit chaining can read earlier rows despite request RLS and hashes timestamps in UTC.
  Overlay counter updates run under the schema owner's privileges.
- Anonymous record ids must be UUIDv4. Delivery, feedback, note and request hours cannot carry
  sub-hour precision. Integration tests pin their allowed columns.
- The API view includes the active check flag; analytics cannot read person-bearing editions,
  evaluation runs or the item list. Maintenance functions are owner-only, except those the
  scheduled jobs call (see Jobs and Gaps).

## Mentions

Tokens are `@[label](target)` in optional summary/body markup. Targets are `metric:`, `dim:`,
`val:`, `item:` and `area:`; metric groups are excluded. Labels have 1-120 characters, without
`]`, CR or LF. A backslash immediately before `@[` keeps the whole sequence literal,
including the backslash in plain text. Token positions start at zero separately in each field.
The database compares target, label, field and position at commit, caps the total at 50,
rejects self/unknown targets, and requires the markup's visible text to equal the plain field.
Mentions never supply scope. Live-target and source-health validation belongs to the write
services; link filtering and `get_related` are the pure resolver in `src/domain/links.ts`.
`get_related` starts switched off in `tool_config` (FR-332, FR-407); the `links` evaluation kind is
a paired run with the tool off and on (FR-523).

## Jobs

The baseline starts with pg-boss 12.37.0's own schema (`pgboss`), generated by the library and
never edited; `tests/server/job-queue-schema.test.ts` fails when the installed pg-boss would
create anything else. The service starts pg-boss with `migrate: false`, so upgrading pg-boss
means a new migration from its `getMigrationPlans()`. The API role reads and writes the queue
tables and has no DDL there: every queue shares the one job table, and index rebuilds are off.

`job_heartbeats.registered_at` makes a job that never succeeded still become overdue. Both
partition helpers run as the owner and make at most 12 months of monthly partitions ahead; the
baseline makes this month's and the next two. The API role may execute `cl_retention_run()`, `cl_ensure_delivery_partitions(int)`,
`cl_ensure_request_partitions(int)` and `cl_obs_weekly_rollup_due(date)`, which all run as the owner. Because the API role can also
write settings, `cl_retention_run()` refuses a missing retention period or one under a day,
which would otherwise drop partitions still being written. Notes follow `retention.note_days` at
delete time, by their creation hour, so a changed setting also re-ages existing notes. Of pg-boss's functions the API role
may run only `job_now`, `create_queue` and `delete_queue`; `job_table_run` serves its install.
The serving and analytics roles can reach neither the maintenance functions nor `pgboss`.

## Gaps, counts and privacy

`topic_week_counts` is kept by a trigger on `deliveries`: each agent
delivery with a topic adds one call (and one no-item call when it delivered nothing) to its week
and status. Evaluation, preview and replay calls are not demand. The counts outlive the delivery
partitions that retention drops.

`obs_weekly` (migration 0029) keeps Observability's weekly counts without limit, the deliberate
exception to `retention.delivery_days` that FR-612 allows: for each completed week (Monday to
Sunday, UTC), the agent calls about a topic in each domain (or none), in each of the five answer
states a chart tells apart. It holds no topic, no words and no person; check constraints refuse
anything but the fixed lists, a Monday and a count over 0.
`cl_obs_weekly_rollup(week)` counts a week again from the deliveries and replaces it, so a second
run keeps the same counts, but leaves a week as it was kept once its deliveries may be gone: when
it starts before both the delivery period and the oldest delivery partition, as retention drops
whole partitions, the oldest first. `cl_obs_weekly_rollup_due(today)`, which the
`observability.rollup` job runs each night before retention, counts every completed week from the
latest one kept (again, for a late call), or from the oldest delivery when nothing is kept yet;
the migration ran it once to count the weeks already held. Small counts are kept as they are and
hidden when they are read (FR-614). The API role reads the table and runs only
`cl_obs_weekly_rollup_due`; the serving and analytics roles reach neither.

`obs_snapshots` (migration 0031) keeps Summary's monthly snapshots without limit, the same
exception: for each whole calendar month and scope (every domain, `area_id` null, or one), the
page's counts as shown, already through the disclosure pass, and the sentences said over them, as
one JSON object of bounded size. It holds no topic, no item, no words of a question and no person;
a check constraint refuses a day that does not start a month, and a month and scope has one row.
The `observability.snapshot` job inserts as no person, an administrator through the API; row
security lets administrators read every row and an owner the rows of a domain they own. The API
role may insert and read, never update or delete, and retention never touches it.
`cl_obs_changes(areas, from, to)` counts the changes published after review and runs as the owner,
so the count is the same for any reader and for the job.

Every way of seeing a gap goes through `cl_gap_touch`: an open gap for the topic and type is
updated; a `wont_fix` gap keeps its status and only counts (FR-609); a resolved gap ignores
evidence from before its `status_since` hour, and newer evidence opens a new gap. `report_gap`
is case 2. `cl_gaps_detect()`, run by the `gaps.detect` job, adds case 1 (agent `no_match`
calls about a topic reach `gaps.no_item_threshold` within its days), case 3 (negative feedback
on an agent delivery; the note moves into `gap_notes` under row security) and case 4 (a
definition's change mark changed; recent topics about a metric it defines get an `outdated`
gap). It is safe to repeat. Case 5 is `cl_report_gap_person`: it
counts a signed-in person's report like `report_gap`, with the type the person chose, marks it
in `gap_weekly_counts.human_reports` (a part of `reports`), and never reads `cl.person_id`.
`gap_report_keys` keeps the digests of a report's retry key and request for a day, so a retry
counts once without naming anyone. Retention also clears feedback notes after `retention.note_days`.

Gap times, note expiry and verification times keep hour precision, like every other anonymous
record. The analytics role reads `v_topic_counts_public` (a topic only in weeks it reaches
`privacy.min_count`, with a no-item count hidden when it is from one to just under the minimum) and `v_gap_totals` (gap totals per area, type and status) instead of the raw
topic and gap tables. The API hides every call count from one to just under the minimum, shows
a gap to others only through topic weeks that reach it (full detail only to the area's owners and administrators), and reads review times through
`cl_area_review_times`, so they do not depend on who looks.

The anonymity suite is `tests/integration/privacy.test.ts` (column contracts, forbidden column
names, foreign keys across every schema, hour and UUIDv4 constraints, serving read-back) and the
runtime canary `tests/integration/canary.test.ts`: one signed-in person makes 1,000 `get_facts`
calls through HTTP and MCP with a marker sentence, a cookie, a user agent and a forwarded address,
and no new row in any schema, no log line and no export may contain any of them.

## Source domains

The domain of a term is one rule everywhere (CON-206, FR-136): the
area the vocabulary gives it, otherwise the domain its definition gives (`definitions.area_hint`,
Cube's `meta.domain`). `source_domain_service` pins the second half per edition, with the ranges
and guards of `area_state_service`; it is part of the edition digest, the export, the restore drill
and a rollback. Every edition the service publishes calls `edition_pin_source_domains`, and a
definition sync publishes an `area_map_changed` edition when `cl_source_domains_behind()` says the
live edition is behind the source (FR-215). An edition with no pinned source domains keeps its
digest and replies (FR-327); the next sync pins them. Serving, gap topics and the catalogue read the pinned map.
`cl_manages_topic` lets the owners of every domain of a topic manage its gap, in the service
and in the row security of `gap_notes` and `gap_tests`, so a topic that spans domains reaches
each of their owners. After a publish, `cl_topics_adopt_domains()` gives an area-less topic the
one domain its metrics now have, with the key `topicFor` gives that scope, so later reports count
against the same gap.

## Gap tests

Gaps are verified by test (FR-610), and tests can be attached to a draft (FR-524).
`gaps.resolved_edition_seq` is the live edition when an owner resolved the gap; a constraint
allows it only on a resolved gap, and `verified_at` only with it, so leaving `resolved` must clear
both.
`gap_tests` links a gap to the test questions that capture it and records each test's first pass
at or after the resolving edition (run, edition, question revision, hour; all four or none);
`proposal_tests` lists the tests attached to a proposal. Neither names a person, and both keep the
hour only: the history log says who linked or attached.

A linked or attached question must be in the gap's or the proposal's area, and a held-out question
is never attached (FR-503). A trigger checks both after row security, and a guard on
`golden_questions` refuses holding a question out while an open proposal carries it, or moving it
to another area while a gap or an open proposal uses it. Row security gives a gap's links to its
managers (administrators and the area's owners). A transaction without a person
reads no links and writes none; the scheduled run's verification will record passes through an
owner-run function. The API role may update only the pass columns. Attached tests are read with
their proposal, except a question held out since, which only its area's maintainers read; the
draft's author attaches and detaches while it is a draft, the area's maintainers until a decision.
The rules that decide when a gap is verified are pure functions in `src/domain/gaps.ts`.

## Agent drafts

`proposals.provenance` is set on a draft an AI agent (the MCP tool
`draft_context`, FR-121) wrote for the person: who wrote it, a mark per field and
the flags of its words; null for a draft a person wrote. `draft_context` starts switched off in
`tool_config`, and the setting `limits.agent_drafts` allows each person 10 in 24 hours and 20
waiting. `cl_similar_items` is an owner-run read of the accepted items whose title or summary reads like a
draft (pg_trgm's `similarity`, which the API role does not hold). The limits count the person's
own `mcp` proposals, so no counter names anyone, and the person is named only where every proposal
names its proposer.

`proposals.answers_round` is unique: when the person answers the
tool's open questions in their agent (MCP elicitation), the draft is saved once with the id of
that question round, so a replayed request state cannot save a second draft. It sits on the
proposal, so no other row names the person.

`gaps.verified_edition_seq` is the edition a gap was verified on,
recorded with `verified_at` (both or neither, never before the resolving edition), so the fact
stays when a test is unlinked later. Two owner-run functions reach past that row security for the
gap's record: `cl_gap_history` gives a gap's managers its rows of the history log (action, hour
and details, never who), and `cl_gap_draft_tests` attaches a gap's linked, active development
questions to a draft started from it, for the draft's author only.

A proposal's attached tests stay in its area: when a draft's
author or a reviewer moves a proposal to another area, a trigger detaches the tests of the area it
leaves, as the owner whatever row security would let the mover delete, and writes each to the
history log as `proposal.test_detached` with the reason `area_changed`.

## The library read API

`v_item_list` carries the current version's mention markup, `v_item_api` puts it in the
ContextItem JSON (`summaryMarkup`, `bodyMarkup`, omitted when null), and both expose the columns
the API filters and sorts on. The active check flag comes from one join instead of a lookup per
row. The current version's `notToConclude` is there too, so Suggest a change starts from the
stored words. The library module (`src/server/modules/library`) reads these views and
`item_version_mentions` as `context_layer_api`; an item with an audience group is treated as
absent until groups return.

## Notifications

`outbox_events.actor_id` defaults to the transaction's `cl.person_id`, and `relay_seq` is the order in which the relay delivered each event. Outbox `seq`
values are taken at insert, so they can commit out of order; `relay_seq` values cannot, because
`cl_outbox_relay(int)` serialises relays with an advisory lock. The relay runs as the owner, because inbox rows belong to other people than the
caller and row security limits the API role to the signed-in person's own inbox; the API role
may execute it, the serving and analytics roles may not. `cl_inbox_recipients` holds the
recipient rules. Inbox items are unique per person and event, so relaying twice adds nothing.

## Source flags and stale links

Each term mention records the definition the term pointed at and
its change mark when the version was written (`item_version_mentions.definition_ref` and
`change_mark`, filled by a trigger from the live vocabulary, so a writer cannot supply them).
`serving_links` returns both, `v_mention_status` gives every mention's status against the live
edition (`current`, `retired`, `replaced`, `source_changed`, `source_missing`, `unresolved`), and
`v_stale_links` lists the live items' mentions that are not current. `cl_inbox_recipients` also
sends source notices (`item.flagged`, `item.links_stale`, `vocabulary.domain_changed`) to the
area's owners. Source flags themselves stay overlay events. The bulk seed
below loads mentions with triggers off, so seeded mentions record no mark and read as current.

A term can name several definitions: `vocab_term_refs` holds a version's definition ids
(append-only, written with the version). A dimension such as
market holds each view's member of its name. `serving_vocabulary` returns `definition_refs`
sorted by ref. Only the members in the views of an item's metrics matter to it
(`cl_relevant_refs`, the SQL twin of `relevantRefs`): a mention records that member's mark, and
`v_mention_status` reads them. A term's source domain (`cl_source_domains_now`) is the area all
its definitions agree on, so a dimension shared by views of different domains has none.

## Seed data

`npm run seed` (`db/seed/main.ts`) is the one command for data to develop, test and show Heed on.
It reads `.env.local`: a library goes into `DATABASE_URL_SEED`, an empty local
`context_layer_dev` or `context_layer_test` database, as a superuser.

```sh
npm run seed                          # the demo: the bulk seed below, then its quality history
npm run seed -- --items-only          # the bulk seed alone
npm run seed -- --items-only --count 50000   # a larger generated library, for performance
npm run seed -- --library golden      # the golden set's library (below), with the history
```

### The demo on a new database

With `SEED_DEMO=on`, `npm run db:migrate` (`db/prepare.ts`) loads the same demo as `npm run seed`
into a database that holds no item, person or edition yet, as the superuser in
`DATABASE_URL_BOOTSTRAP`. The demo is about the demo Cube model, so it loads only while
`CUBE_MODEL_DIR` holds exactly that model (`db/seed/cube`); beside another model it loads nothing
and says why. `SEED_DEMO` is off unless set and refused when `NODE_ENV=production`; `.env.example`
and `compose.yaml` turn it on.

### Demo bulk seed

The bulk seed (`bulkSeed`, `db/seed/bulk.ts`) is the explicit superuser-only
performance/screenshot path. It requires an empty database and refuses production or a nonlocal
CLI target. It disables user triggers inside one
transaction, keeps foreign keys and checks enabled, restores triggers before commit, and
rolls the entire load back on error. It never truncates or replaces data.

The source is the existing frontend fixture generator. Person ids map deterministically to
UUIDs; all audiences are `everyone` while groups are parked; areas get their fixture state.
Every version of an item is stored, each in service from its own edition on the day the
generator's `versionDays` gives it (editions `day.N`: N is 2 and up for acceptances, 9 for
retirements), so item history reads the same as in the mock. A version stores the item's content,
except where `versionDays` says it had something else: the demo regression's note had no end date
in its first version. Evidence, references, mention
markup and mention rows, check flags and retired items roundtrip through `v_item_api`. Every item
and vocabulary version gets the content digest the write path would give it, computed from its
stored content, and every bulk edition its recomputed digest, so exports and the restore drill
verify the demo data exactly.
Every version also gets the review history the serving guards require (FR-205, FR-206): an
accepted proposal, passing results of the check levels its risk required before migration 0005
(levels 1 to 3 are all that is required now), an accept decision by an owner of the area (another
owner when the first proposed a normal or high risk version) and, for high risk, an approver's
accept as history; a retired item gets its owner's retire decision. So every seeded
version passes `cl_item_version_problem`, and going back to any seeded edition serves its
versions again. Roles hold from the first day of that history. Where the fixtures need someone the
mock's roster lacks (a second owner in Marketing, Paid media and Sandbox, approvers outside Commercial),
the seed grants a former role that ended the day after the history, so today's roster stays the
mock's. These fixtures bypass the review path itself and must never be treated as reviewed
production content.

The seed also stores what the Cube connector reads from the demo model in `db/seed/cube`
(`db/seed/fixtures/cube-model.ts`, kept equal to a real read by
`tests/server/connectors/demo-model.test.ts`): the connector `cube`, two reads (a first one and
the newest, on 7 October 2026), the definitions with their description copies, types and domains,
and their change marks. Every metric and dimension of the vocabulary names its definition, and
Support contacts gets an area from the area map. Between the two reads Cube changed Retention
rate and removed a legacy view. Fixture items record the marks they were checked against: an
item flagged `needs_check` carries an older mark, and one flagged `source_missing` references a
member of the legacy view, so a new read of the demo model (`CUBE_MODEL_DIR=db/seed/cube`)
changes no flag.

### Demo quality history

The bulk seed leaves the quality history and the gaps empty, and the tests rely on
that (`npm run seed -- --items-only`). The demo (`npm run seed`, `loadDemo`) runs the bulk seed of
1,500 items and then `seedDemo` (`db/seed/demo.ts`),
which adds, in one transaction and offline with the scripted mock model: the mock's gaps
(`db/seed/gaps.ts`), a handful of test questions in every area about seeded items
(`db/seed/test-questions.ts`), a retrieval pass of every edition sealed since the first of them,
and a finished weekly run of every live area each Monday for the twelve weeks up to the newest
edition. The runs and passes are the service's own (the evaluation worker through the MCP gateway,
and the retrieval pass), each on the edition live then with the clock set to that day: the seed
points the live edition back for each Monday and restores it, and moves the service's time stamps
to the days they stand for. The newest Commercial run fails the demo's regression on its caveat,
and the open gap about net revenue in Spain is linked to that question with the failing run as
evidence. The seed checks this story and rolls back if a run tells another. `seedDemo` also runs on
its own right after the bulk seed, before the service has made any run, retrieval pass or gap.

### Golden set library

```sh
npm run seed -- --items-only --library golden
```

The golden set (`db/seed/golden-set.yml`, the output test plan's cases) is about the 1,500 demo
items plus 18 hand-written fixture items (`db/seed/golden-fixtures.ts`, demo data only): four
conflict pairs, injected text with canary tokens, an invented customer's name in an evidence quote,
companions, and a note whose second version changed its wording. `--library golden` seeds them after the
generated items, so every generated id stays, together with the extras the bulk seed takes for
them: the conflicts, the aliases Net sales, GMV and Margin rate, the renamed Cube member
`basket.margin_rate`, the first version's wording, and a domain that holds nothing yet ("Stores &
Suplliers", `stores_suppliers`, misspelt on purpose) with three Cube members mapped to it that no
term names. `npm run seed -- --library golden` adds the
demo's quality history to the same library. The integration test `tests/integration/golden-set.test.ts` seeds the same library and
runs every case's L1 checks (`goldenL1`, `src/server/modules/evals/golden.ts`) with no model.
The held-out cases go in `db/seed/golden-held-out.age`, sealed, and run there only with the key,
as counts (README, "The sealed held-out cases"). No cases are sealed at present, so that test
says the held-out cases did not run and is skipped.

## Review and release

Every item version needs the same review: levels 1 to 3 pass (`cl_required_levels` gives the
same three at every risk level) and an owner of its area or an administrator accepts it. An
area's approvers still read its proposals and versions, but no longer decide: their earlier
accepts stay as history. A vocabulary proposal may have no area (an administrator decides an
area-less term), and an item has at most one open retirement proposal. The API role may run the
gate functions the serving guards use (`cl_required_levels`, `cl_version_gate_ok`,
`cl_item_version_problem` and their role helpers), so the review screen shows the database's own
verdict. Publishing still goes only through the `edition_*` functions.

The review compares a suggested version with the version in service it was written against
(`cl_proposal_base`). `review_reads` keeps each person's own read receipts: when they opened a
suggestion, and when they read which version of it; only that person reads or writes their rows.
`proposal_relations` keeps how a suggestion relates to a live item it clashes with (it replaces
it, the two disagree, or they are unrelated): an owner of the suggestion's area or an
administrator writes one row per answer, for the version under review, and rows never change.
The owner's answer also goes on the version: a review edit may add to a version's replaced
items and conflicts, its content unchanged, even when the owner wrote the suggestion
(`proposals_guard_state`, migration 0006).

The person who made a decision may undo it within `limits.undo_seconds` (migration 0006).
`decision_undos` keeps one row per undone decision, by its maker as themselves inside the window
(row security), and the `decision_undone` edition that served again what the decision changed;
rows never change. An item leaves service in that edition only when it records an undo
(`item_version_service_closing_authorized`), and an accepted proposal waits again only when its
accept is undone in the same transaction (`proposals_guard_reopen`); so does a closed one, a
suggestion to archive its sender took back, when its close is undone (migration 0028), with no
edition. A decision is never
deleted: `decisions.round` counts how often its maker undid the same decision on the version
before, so they may decide it again (`decisions_once_item`).

The Inbox's cards are read from today's records; three tables keep the rest. `card_reads` keeps
which cards a person opened, only for that person. `card_states` keeps a card closed for every
owner of its domain, such as a report that is not a problem: an owner or an administrator closes
it as themselves, and only they open it again, inside the undo window. A report is anonymous, so
its card is named by text (`feedback:<id>`) and nothing joins a person to the report.
`setup_marks` keeps when a step of the setup checklist first happened when nothing else records
it (a question in Ask), never who or what.

Comments, reactions and mentions (FR-817, migration 0007) hang on a suggestion (`proposal_id`) or a
context item (`item_id`), exactly one. `comments` keeps the comment box's document as JSON, checked
by the service; whoever may read what a comment hangs on reads it (`cl_comment_subject_open`, which
runs under the reader's own row security, and never for a read with no person), anyone writes one
there as themselves, and only its author changes its words or deletes it. A reply answers a comment
of its own, one level, on the same subject (`comments_guard`); what a comment hangs on, its author
and its time never change, and a delete that keeps its place empties its words for good and takes
its reactions and mentions with it (`comments_clear_reactions`). A return with a note is the
suggestion's comment of kind `returned`, tied to its decision, and leaves with the decision's undo.
The person who suggested archiving a context item may mark one of their own comments on it as taking
it back, while it waits (`comments.withdrew_at`, migration 0028): one comment of a suggestion holds
the mark, only its writer sets or clears it, and only while the suggestion to archive waits
(`comments_guard`); deleting the comment clears it. The owners then close it, a `reject` decision
that changes nothing agents get.
`reactions` takes one of five emoji, once per person, on a comment, an item or a suggestion.
`comment_mentions` keeps the people a comment mentions, written by its author, and when each saw
it, marked by that person only. `thread_reads` keeps when a person last opened a thread, for them
only. Agents never read any of it: the serving and analytics roles have no grant on these tables,
and no edition or serving function reads them.

Context (migration 0008). A context item's kind is part of each version (`item_versions.kind`),
as its domain and words are; every version before 0008 took its item's kind, and `items.kind`
stays as the kind it was created with. A version's content digest always held its kind, so
sealed editions verify as before. A version written without a kind takes the kind of the
version it follows (`item_versions_kind`). `item_owners` names who answers for an item beside
its domain's owners: an owner of the item's domain or an administrator writes it, and each
person named owns that domain or is an administrator (row security). `item_reads` keeps which
items a person opened, only for that person. `item_changes` keeps one row per change to many
items at once, with what Undo needs; only its maker marks it undone, once, inside
`limits.undo_seconds`, and a deletion is read only by its maker and administrators. A deleted
draft records who deleted it (`proposals.discarded_by`), and only that person brings it back,
inside the same window and with nothing else changed (`proposals_guard_state`).

Terms (migration 0009). `terms` keeps the words people write in Definitions (FR-138): a word
with its own `meaning`, or a synonym that names what it means instead (`same_as_key`, a live
metric or dimension of the vocabulary, or `same_as_term`, a term with its own meaning; never
another synonym). `word` is the name trimmed, its spaces folded and in lower case, and one live
term holds a word at most (`terms_one_word`). `terms_guard` refuses a word the live vocabulary or
the definitions source uses for a metric or a dimension (`cl_vocabulary_words`: names, other
names, and the source's name, title and synonyms) whenever a term takes a word: written, renamed,
pointed elsewhere or restored. A sync can still give a word a second meaning later; the service
shows that conflict. A synonym's domain is what it means (`cl_term_target_area`), and a term's
synonyms follow it to a new domain (`terms_follow`). An owner of the domain or an administrator
writes a term, and a word with no domain is an administrator's (row security). Nothing removes a
term: a deleted one records who deleted it, the synonyms that pointed at it go with it
(`deleted_with`), and it can be restored. `term_versions` keeps what each write made of a term,
append only. `term_changes` keeps one row per change to many terms with what Undo needs; only its
maker marks it undone, once, inside `limits.undo_seconds`. The serving and analytics roles have no
grant on these tables.

Observability (migration 0015). Each agent delivery keeps the answer state its reply gave
(`answer_state`: grounded, partial, conflict, stale, missing or failed; none when the question
could not be read) and the kind of agent that called (`app_family`, FR-410's fixed list), never
the name it gave itself; deliveries from before keep their resolver's status as their state.
`observability_views` keeps the views people save on Questions for everyone in the workspace: a
name, unique whatever its case, filters and who saved it, never a question. `cl_gaps_detect()`
counts case 1 of FR-606 across a month edge: no-item calls in the period about one domain,
metrics, values and dimensions count together whatever month their dates start in, and the gap
stays on one topic of that scope, whose weekly counts add up every month of it.

Saved questions (migration 0019). `saved_questions` keeps a domain's question with who saved it,
where from (Ask, a Not found draft, or typed) and the items it should answer from; removing one
marks it removed. `saved_question_baselines` keeps the answers it should keep getting: the first
when it is saved, one each time someone keeps a new answer (its keeper may undo it, once), and one
when a publish from the review moved it; the latest not undone is the one it is checked against.
`check_runs` counts each run of the free check as it goes (who started it, or the `saved.check`
job; the edition, overlay and day it read; how many of how many; done or failed), and
`saved_question_results` keeps each question's result in a run. A domain's owners and
administrators read and change its saved questions; the job reads them as no person through
`cl_saved_questions_to_check()`, which runs as the owner. The serving and analytics roles have no
grant on these tables.

Alerts (migration 0022). `alert_rules` holds the eight rules, each on or off with its threshold
and its audience; administrators change them, and the Not found rule's threshold stays in the
`gaps.no_item_threshold` setting. `alert_mutes` keeps what an owner muted, a rule for a domain they
own, readable by that person only. `alert_raises` keeps each raise once for its rule and key, with
a title of counts and scopes only and where it sends people. Only the `alerts.raise` job, as no
person, raises: `cl_alert_raise()` runs as the owner and writes the raise with its `alert.raised`
outbox event, which `cl_inbox_recipients()` sends to the rule's audience less those who muted it.
`cl_alert_reached()` names whom a raise reached for someone who may read it, `cl_saved_looks()`
lists the saved questions that need a look, and `cl_connector_domains()` the domains whose live
items rely on a source's definitions; each runs as the owner. Administrators read every raise and
an owner those about their domains. The serving and analytics roles have no grant on these
tables.

Figures in Ask (migration 0025). A definitions source keeps its figures settings in
`connectors.capabilities.figures`: whether Ask shows figures from it (off by default), the data
endpoint an administrator set and the name of the endpoint's token in the secret store, never the
token; `connectors.data_contact_id` is its data contact. No figure is ever stored. A named report
can be about a figure (`part = 'figure'`): it names the source, the metric, the values and the days
(`figure_*`), never the figure, and goes to the item's owners, the data contact or both
(`figure_route`). The data contact reads it and closes it as not a problem
(`cl_is_figure_contact()`, `cl_closes_figure_report()`), and `cl_figure_disputes()` names, for
anyone signed in, the items an open figure report says a figure doesn't fit, and nothing else of
it; each runs as the owner. The serving and analytics roles have no grant on any of it.

Serving terms (migration 0011). Agents read the live terms through `serving_terms()`, a security
definer function the API and serving roles may run: each word with its own meaning or what it
means, its domain, the day it was last written and the role it was written in (`owner` or
`administrator`, never the person), and `conflict` when the vocabulary or the definitions source
gives the word another meaning or what a synonym means is gone. `serving_terms_mark()` changes
with every write to a term and every sync of a definitions source, so a cached serving bundle is
read again after either.

Named reports (migration 0013). `reports` keeps what a person sends from Ask on purpose, with
their name (FR-622): the question, the item and the part that is wrong, what is wrong, and
optionally the correct version and a link. It is append only. Its sender, the owners of its domain
and administrators read it (row security); a person sends one only as themselves, about an item
they may read. `cl_report_outcome(id)`, a security definer function, gives anyone who may read a
report what the owners did after it: closed as not a problem (its card in `card_states`), or the
item checked again, changed or archived (its decisions, undone ones left out). The serving and
analytics roles have no grant on it.

About our business starts empty (migration 0010). A new install gets an empty `business.about`
version on top of the baseline's default, and so does an install whose text is still that
untouched default (one version, which nobody changed); one where a person wrote or reset the
text keeps it. The baseline's text, an outdoor-gear retailer, is the guide's worked example; the
demo seeds (`db/seed/bulk.ts`) write it themselves.

## Evaluations

A run of the evaluation runner records who it acts for (`requested_by`: whoever started it);
scheduled runs act for nobody and touch only the live edition. No suggestion waits for answer
tests since migration 0005, so nothing queues a run of a version any more; one made before still
finishes, records `answer_impact` and `answer_full` under its requester's row security, and stays
in the history. Cells say when the model refused (`refused`, with `passed` null) or a call failed
(`error`). Transcripts stay append-only: the API role inserts them with the finished
cell and has no UPDATE. The settings add the tries, flip repeats, the run budget, the evaluation spending cap
and the model per feature.

`models.assistant` is the model that writes Ask's words (FR-710). It was the in-app assistant's
model until the assistant left (30 Oct 2026); the drafts it wrote (channel `assistant`) and its
test runs (`eval_runs` of kind `assistant_mock` or `assistant_real`) stay in the history.

`estimated_calls` in `llm_spend_daily` and `llm_spend_monthly` counts the model calls that ended early (abort, timeout, provider error) and were recorded as an
estimate, so they can be told from reported usage.

Each `models.<role>` setting, `models.test_authoring` among them, is a provider and a model
(`{"provider": "anthropic", "model": "claude-sonnet-5-5"}`). `eval_runs` records
`answer_provider` and `judge_provider` next to the families and vendors, and `llm_spend_monthly`
is kept per provider (`provider` joins its key). The caps count every provider.

## Administration, import and export

Administrators change `settings_versions` (a new version each time,
`changed_by` set to the person), `tool_config` and `client_policies` through the API, each with a
history log entry. The serving role reads `settings_current`, for the request limits in
`limits.mcp_rate_per_minute` and `limits.mcp_requests_per_minute`, but not `settings_versions`, which names who changed a setting. An
applied item import writes one `import_batches` row (mode `apply`; a dry run writes nothing),
and each of its proposals carries the batch id and the channel `import`. Edition export reads
the item versions in service, which row security lets every signed-in person read.

## Request ids and the web API limit

`audit_log.request_id` defaults to `cl.request_id`,
which the service sets with `cl.person_id` in every transaction it opens for an HTTP request (the
id its log lines carry). No writer passes it, and work outside a request (jobs, the relay) leaves
it unset, so those entries have no id. The default is applied before the chain trigger, so the id
is part of the hash. `limits.api_rate_per_minute` (`{"person": 600, "ip": 120}`) is the web
API's requests per minute.

## MCP person rate

`limits.mcp_requests_per_minute` (`{"person": 30, "client": 120}`) is MCP calls per minute for
each person (one token) and for each client label whose `client_policies.rate_per_minute` is
null, so one person cannot spend everyone's budget.

## Agent families

`mcp_requests` records the family of the agent that called
(`app_family`), a read tool's outcome (`result_status`: `matched`, `need_more_detail` or
`no_match`, else null) and the status `invalid_input`, for a tool call whose arguments do not fit
its schema (FR-410, FR-345). The service maps the name an app sends about itself (MCP
`clientInfo`) to a fixed list in `src/domain/app-family.ts`, and a check constraint holds the
column to that list, so a raw name, a version or any other free text cannot be stored. Requests
that name no app are `unknown`. Observability's reads filter by it (`GET /observability/agents`).

## Backup and restore

A `pg_dump` backup restores: `pg_restore` loads data with an empty `search_path`, so a function
that a constraint, default or index calls names its own search path (or qualifies its calls).

`npm run db:restore-drill` (README, "Security, scanning and the restore drill") dumps a database
in one read-only snapshot, restores it into `<name>_drill_<random>` owned by the source's owner,
compares every table and sequence, recomputes every edition digest, every served version's
content digest and the history log's chain, then drops the copy. It only ever drops the copy it
created, by its exact name.

## Tests

`npm run test:integration` uses a superuser connection in `TEST_DATABASE_URL` (the scaffold's
local default is `postgres://localhost:5432/postgres`). CI passes the PostgreSQL 18
service connection. Setup builds one freshly migrated, granted template per invocation; every
test file clones it and drops its own database. Tests commit so deferred constraints really run.
Roles are shared idempotent bootstrap objects; database names contain the process id and random
suffix, so concurrent runs do not reset one another. Teardown only drops the exact names created
by that run. A killed process may leave its own `context_layer_test_<pid>_<random>` databases;
remove only those known abandoned names, never sweep other runs' prefix.

A fresh template avoids stale migration checksums and grants.

## Domains are always served

A domain that exists is served, with no `not_started`, `starting`, `live` or `paused` state and no
start checks (FR-320, FR-802). `area_state_service` and the `area_state` enum remain: edition
digests, the edition export and the restore drill read them, and a new edition carries their rows
forward unchanged. `delivery_status` keeps `area_not_live`. `serving_metadata` lists every domain
from `areas` (and an archived one that items in the edition still name), with no state. The stop
switch is the one way to hold a domain's items back. `areas.summary` (one line, at most 160
characters) and `areas.description` (at most 1,500, line breaks allowed), both empty by default,
say what the domain is and what kind of data it holds, written by one of its owners or an
administrator (FR-813).
