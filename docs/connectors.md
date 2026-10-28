# Connectors: the contract

A connector is how Heed reads a tool it does not own. It is the contract between the core and
every connector: what a connector declares, what it returns and what the core does with it.

There are two kinds:

- A **definition source** says which metrics and dimensions exist, so Heed can check items
  against them. It may change what Heed knows exists, never what Heed says: a change only flags
  the items that rely on it (CON-209 to CON-214). Cube model files are the first one, and the demo
  source (two invented definitions) the fallback.
- A **content source** reads documents from folders, spaces or pages an administrator chose, and
  turns each new or changed document into at most one suggestion for one domain's owners to
  review (CON-601 to CON-611). Markdown files in a Git repository are the first one, and Google
  Docs in folders shared with a service account the second ([content sources](#content-sources)).

Chat and identity connectors have other shapes and are outside this contract (CON-304, CON-401).

**Interface 3.0** is the contract: a manifest that is data and a runtime that is code, for both
kinds. Its first slices are built: the manifest, the runtime and its messages, the registry,
adding a source of any connector from its manifest in Sources, `ctx.git`, each source's own
schedule, the content pipeline with Markdown in Git, Cube as a connector of its own, with a
worker for its compiler, and Google Drive, which reads the changes since its cursor
([what is built](#what-is-built)). **Interface 2**, below, is the
snapshot a definitions read is gathered into and the pipeline that stores it; the server's demo
source is the last one written to it. The other connector documents:

| Document                                                    | For                                                                                    |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [Security and egress](connectors/security.md)               | Where connector code runs, the hosts it may reach, the secret store and its output     |
| [Writing a connector](connectors/authoring.md)              | Authors of a new connector: the steps, the rules and the review checklist (a skeleton) |
| [Connectors as packages](connectors/packaging.md)           | The design for loading connectors from packages later; not built                       |
| [The Cube connector](connectors/cube.md)                    | The Cube model setup, its settings, the demo model, compilation and change marks       |
| [Cube](../src/connectors/cube/README.md)                    | The Cube connector's page: its settings, what a read does, its schedule and its limits |
| [Markdown in Git](../src/connectors/git-markdown/README.md) | The first content connector: its settings, its folders and what a read suggests        |
| [Google Drive](../src/connectors/google-drive/README.md)    | Google Docs through a service account: setting it up, full reads and change reads      |

## Invariants

These never change, in any interface version. The core enforces them and the conformance kit
tests them, so no connector can break them.

| #   | Invariant                                                                                                                                                                                                                                                             | Requirements              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| I-1 | **Definitions stay canonical.** A definition is a metric, dimension or group with a ref, a name, a title, a description copy of at most 500 characters, a type, a domain hint and a change mark: a closed list of fields, never a calculation, a query or a data row. | CON-201, CON-207          |
| I-2 | **Definition sources only flag.** They never change an item or an edition, and a failed read changes nothing.                                                                                                                                                         | CON-209 to CON-214        |
| I-3 | **Content sources only create reviewed drafts.** At most one per document, for one domain, every field marked, never accepted automatically and never served before an owner accepts it. A changed document replaces its open draft instead of adding one.            | CON-603, CON-604, CON-606 |
| I-4 | **Secrets never leave the store**, except into the runtime of their own source, toward the settings they were given for.                                                                                                                                              | CON-105, CON-114          |
| I-5 | **Domain mapping is per source and explicit**: a hint plus a map of names, or one domain per chosen scope. A hint never creates a domain; an unknown domain is refused when the settings are saved.                                                                   | CON-206, CON-602          |
| I-6 | **Read only, declared hosts, least access said first.**                                                                                                                                                                                                               | CON-102, CON-106, CON-113 |
| I-7 | **Output is untrusted data**: checked, capped; document text is data, never instructions.                                                                                                                                                                             | CON-107, CON-608          |
| I-8 | **No vendor in the core, and a connector failure never stops serving.**                                                                                                                                                                                               | CON-101, CON-103          |

## Interface 2: the definitions pipeline

Administrators look after the sources in **Administration › Sources**: a list of the sources with
their status, last read, what they hold and their issues, Add a connector, and one page per
source with its status, issues, views and domains, settings and recent reads, and Read again. AI
apps that read _from_ Heed are the other direction, in MCP and gateway.

A source is configured in one of two places. Whoever runs the server selects one with its
environment (the Cube model folder, read by the Cube connector, or the demo): its settings are
read only in the product. An administrator **adds** others in **Administration › Sources**, of
any connector (a Cube model in a Git repository): their settings are configuration in the
database, their secrets are in the server's secret store (CON-105).

Public code imports `src/server/modules/connectors/index.ts`. `DefinitionSource.read` returns a
snapshot: an interface 3 runtime's read is gathered into one, message by message
([what is built](#what-is-built)). `ConnectorRegistry` holds the server's own sources and loads
those administrators added from the database at each read; `ConnectorService` persists a read
through the API-role PostgreSQL pool. Its `list`, `exists` and `changesSince` methods read
PostgreSQL only. They never compile a model at request time.

### Version

This is interface version **2** (`INTERFACE_VERSION` in `types.ts`, CON-109): the shape of a
snapshot and of a source the definitions pipeline reads. A source says the interface its
connector was written to (`interfaceVersion`: 3, or 2 for the demo); the registry refuses any
other version, a duplicate id and an id outside `^[a-z][a-z0-9_-]{1,39}$`.

What changed from version 1: a read is handed the cursor of the newest good read and may return
one (`read(context)`, `cursor`); the core tests settings with one read it keeps nowhere; and a
member another source already reads is left with that source (`taken`) instead of failing the
read. Interface 2 also let a type declare how an administrator adds a source of it, and Cube did,
through an adapter to interface 3; every connector an administrator adds is now written to
interface 3, and the adapter is gone.

### The server's own sources

A **type** of the sources the server's configuration selects (`ConnectorType` in `types.ts`,
`connectorTypes` in `registry.ts`) says what the screen needs of it. No connector may take its
id, except the one that reads it (Cube, for the server's model folder):

| Field         | Meaning                                                                                                                                                                                                                                                                                                                                | Cube                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `type`        | The type's id, stored on the connector (`connectors.type`).                                                                                                                                                                                                                                                                            | `cube`                   |
| `tool`        | The tool it reads, as people say it. Every word on screen that names the tool comes from here ("Gone from Cube", "Changed in Cube, 7 Oct 2026", "We could not read Cube lately"): no core code names a vendor (CON-101). The API sends it as `tool` on each catalogue source and definition and on each source of the operations view. | `Cube`                   |
| `settingKeys` | The administrator settings (FR-809) that belong to the source the server's configuration selects. Its page in Sources shows and changes them; Limits leaves them out.                                                                                                                                                                  | `sources.cube_model_url` |

A **source** (`DefinitionSource`) is one configured reader of that type:

| Field              | Meaning                                                                                                                                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`               | Stable id of the connector row: `cube` or `demo` for the server's, and for an added one an id from its name (`analytics-model`), which never changes.                                                                                                           |
| `type`, `name`     | Its type (its connector's id), and its name on screen ("Cube local model").                                                                                                                                                                                     |
| `interfaceVersion` | The interface its connector was written to: `3`, or `2` for the demo.                                                                                                                                                                                           |
| `serverSettings`   | What it reads from the server's own configuration: `key` (`model_folder`, `domain_overrides` or `renames`), the environment `variable` that sets it, and the `value` (a path, or null). Sources shows them read only, with "Set on the server". Never a secret. |
| `read(context)`    | One read, given the cursor of the newest good read (`context.cursor`, null at first): a snapshot, or a `SourceReadError` with warnings when the source cannot be read at all. It changes nothing anywhere (CON-102), so the core also tests settings with it.   |

The API shows a source's server settings only when this server reads it (same id and type); a
source read by another server or by the seed has none.

### The snapshot

| Field           | Meaning                                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `sourceVersion` | What was read: a Git commit or tag, an etag, or a digest of the files.                                                                          |
| `complete`      | True when every object was read. Only a complete read marks absent definitions missing; a partial read updates what it read and keeps the rest. |
| `definitions`   | Each public member, never a calculation or SQL (CON-207).                                                                                       |
| `warnings`      | Codes and targets only (below).                                                                                                                 |
| `renames`       | Members gone with their new id, from configuration (CON-512).                                                                                   |
| `cursor`        | Optional: where the next read may start (a commit, a change token). The core stores it with the read and hands the newest good one back.        |

A **definition** has:

- `ref`, the id: `<type>:<path>`, matching `^[a-z][a-z0-9_]*:[A-Za-z0-9_.:/-]+$`. Cube's is
  `cube:<view>.<member>`. A ref belongs to one connector for good and is never reused for another
  member; items record it.
- `kind` (`metric` or `dimension`), `name` (the member's name in the tool, `orders.orders`),
  `title`, `descriptionCopy` (at most 500 characters, labelled as a copy), `valueType`.
- `areaHint`, the domain the tool names (a Heed domain id, `^[a-z][a-z0-9_]{1,39}$`) and
  `domainSource` (`cube`, `override` or `none`). A hint is a suggestion: it never creates a domain
  or changes the vocabulary.
- `modelFile`, the file that defines it relative to the model folder, and `changeMark`, the
  SHA-256 of its meaning. The file is not part of the mark.
- `synonyms`, optional: the other names the tool lists for it (Cube's `meta.synonyms`), at most
  20 of at most 200 characters. A term proposed for it takes them as other names.
- `baseName`, optional: the member's own name when a view joins it with a prefix (`campaign_name`
  of `segments.campaign_campaign_name`), so a proposed term reads and merges by it.
- `visibleGroups`, always null until access-policy groups are read (CON-508).

A member's **view** is its name up to the last dot (`orders` of `orders.returns`);
`src/domain/source-views.ts` groups a source's current members by view for Sources.

### Warnings

| Code               | Target                                 | Effect on the read | What Sources says                                         |
| ------------------ | -------------------------------------- | ------------------ | --------------------------------------------------------- |
| `missing_domain`   | a public view or cube                  | complete           | N views have no domain (CON-516)                          |
| `invalid_domain`   | a view, a member, or `override:<view>` | complete           | N domains are not a domain id                             |
| `domain_override`  | a member's ref                         | complete           | N members take their domain from the server (information) |
| `invalid_rename`   | the old ref                            | complete           | N renames do not apply                                    |
| `taken`            | a member's ref                         | partial            | N members are read by another source                      |
| `unsupported_file` | a file                                 | partial            | N files were not read                                     |
| `unreadable_file`  | a file                                 | partial            | N files could not be read                                 |

A read that fails before anything is read says why with one of these, on a failed snapshot:

| Code              | Target           | What Sources says                       |
| ----------------- | ---------------- | --------------------------------------- |
| `private_address` | the repository   | The address is not public               |
| `unreachable`     | the repository   | The repository could not be reached     |
| `unauthorized`    | the repository   | The token was refused                   |
| `not_found`       | the repository   | No repository at the address            |
| `ref_not_found`   | the ref          | The branch, tag or commit is not there  |
| `folder_missing`  | the model folder | The model folder is not there           |
| `secret_missing`  | the secret's key | The token is gone from the secret store |
| `fetch_failed`    | the repository   | The repository could not be read        |

The codes are `sourceWarningCodes` in `src/contract/operations.ts`; the connectors' schema uses
the same list, and `tests/unit/sources.test.ts` fails when a code has no words on screen
(`src/web/lib/sources.ts`). A failed read stores a failed snapshot and changes nothing else.

### What the core does with a read

Refreshes serialize per connector in PostgreSQL. Snapshot creation and definition updates commit
together. A complete read marks absent definitions missing without deleting their ids; a partial
read never does; a failed read keeps every previous mark and status and changes no flag or link
(CON-213, CON-214). A ref belongs to one connector for good: a member another source already
reads stays with it, the read leaves it out with a `taken` warning and is partial. The read's
cursor is stored on its snapshot (`connector_snapshots.cursor`). The job `connectors.sync` runs
every five minutes and reads each source that is switched on and due: the server's and those
administrators added, loaded from the database each time, each on its own schedule
([schedules](#schedules-built)); one that breaks the refresh itself does not keep the others from
being read. Read again on a source's page reads that source now (`sources.read`), and running the
job by hand in Operations reads every source now. A source whose last good read is older than
`stale_after` (6 hours by default) is out of date, and the watchdog alerts (CON-104).

### Sources an administrator adds

**Add a connector** in Administration › Sources (administrators only) lists every connector an
administrator may add a source of, by what it syncs, with its title, its summary and how far
along it is. Choosing one opens its page: what it syncs, how often it reads, the hosts it reaches
and the least access it needs, then the form its manifest declares. **Test connection** runs
the connector's check step by step, then
reads the source once with the form's settings and keeps nothing: it says what Heed would hold
(version, views, metrics, dimensions and the read's warnings, including members another source
already reads) or why it could not read. **Add connector** saves the source with a reason and
queues a read. The source's page shows its settings, each secret only as set or not set, and
**Change settings** opens the same form filled in; a secret left empty keeps the one the store
holds, and a new one replaces it.

| Operation          | Path                         | What it does                                                                                                           |
| ------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `sources.types`    | `GET /sources/types`         | The connectors an administrator may add a source of: each manifest, and the interface it was written to                |
| `sources.get`      | `GET /sources/{id}`          | An added source's settings, and for each secret whether it is set (404 for the server's own)                           |
| `sources.add`      | `POST /sources`              | Adds one with its settings, secrets and reason; needs an `Idempotency-Key`                                             |
| `sources.update`   | `PUT /sources/{id}`          | Changes one on the revision read (409 when stale), with a reason; a secret left out is kept                            |
| `sources.test`     | `POST /sources/test`         | The connector's check, then one read with these settings, kept nowhere; with `id`, a secret left out is the stored one |
| `sources.list`     | `GET /sources`               | Every source, the server's own first: its connector, how it is, when it was read and is read next, and what it holds   |
| `sources.activity` | `GET /sources/{id}/activity` | A source's reads, newest first, codes and counts only; what it reads, with each part's domain; its recent documents    |
| `sources.pause`    | `PUT /sources/{id}/paused`   | Pauses reading a source, or lets it go on, with a reason; the server's own too                                         |

Every operation is for administrators; the service refuses anyone else (403) whatever the screen
shows. Settings with problems are refused (422) with a finding per field: an address that is not
https (plain http only to this machine), credentials in an address, a ref git could read as an
option or a range, a folder that leaves the repository, a domain name that is not a Heed domain,
and a secret pasted into another field. Changes are kept in the history log (`source.added`,
`source.changed`, `source.paused`, `source.resumed`) with the settings and, for each secret, only
`set` or `replaced`.

Settings › Integrations in the new web app reads `sources.list` for its rows: a source is
**Paused** when an admin paused it, **Reading** while a read it was asked for (Read again, or a
change to its settings) waits for the job, **Needs a new key** when its last read failed because
its key was refused or is missing, **Failed** when its last read failed for another reason, and
**Healthy** otherwise. A definitions source counts its metrics, dimensions and groups (a Cube
view: a member's name up to its last dot) and the groups that map to no domain, and the live
items a change to one of its definitions flagged; a content source counts the documents it
holds, its suggestions waiting for owners, and its suggestions over the last 24 hours against
its daily cap. A source's page reads `sources.activity`: each read with what it did (definitions
new, changed and gone; documents suggested, replaced, withdrawn, waiting and skipped), its
warnings by code with how many times each and never their targets, what it reads, and a content
source's last 20 documents, never their text (CON-605). A paused source is left out by the job
and refused by Read again (409); resuming one past its next read reads it at the job's next
turn.

The settings are `connectors.config` (addresses and names only), the row says `origin =
'workspace'`, and `secret_ref` names the source's entry in the secret store. A
retry of an add is keyed on its input without the secret, so the retry record holds no secret,
not even hashed.

The secret store, and how a secret is bound to the settings it was given for, are in
[Security and egress](connectors/security.md#secrets).

### Flags, stale links and notices

After every successful read, and in every publish, `reconcileSourceFlags` brings the overlay in
line with the stored marks: a live item whose version references a definition with another mark
than the one it recorded is `needs_check`, one whose referenced definition is missing is
`source_missing`, and a flag whose cause is gone is switched off. The flags are overlay events
(`overlay_events`), so editions stay immutable and a delivery names the overlay it saw.

A mention records the definition its term pointed at and that definition's mark when its version
was written (the database fills `item_version_mentions.definition_ref` and `change_mark`).
`v_mention_status` compares them with the live edition and today's definitions; `v_stale_links`
lists the mentions in live items that are not current. Serving uses the same rule from the
in-memory bundle, where every term carries its definitions' states. A term repointed by a
vocabulary proposal (a repaired rename) no longer matches the recorded definition, so its links
read as current.

A dimension in several views is one term with each view's member (CON-208). Only the members in
the views of an item's metrics matter to that item, or all of them when it names no metric in
one of its views (`relevantRefs`): its scope brings in those references, its mentions record
that member's mark, and a change to the same dimension in another view flags nothing about it
(CON-209, CON-210).

Each refresh sends outbox events: `item.flagged` for a new flag, `item.links_stale` for an item
whose mentions went stale in that read, and `vocabulary.domain_changed` for a term whose
definition's domain changed. The relay puts them in the inbox of the domain's owners.

Snapshot warnings contain only codes and targets. A public view or cube without `meta.domain`
is reported as `missing_domain` (CON-516). `domain_override` warnings retain domain
provenance without a schema change; `list` exposes that provenance from the member's last-seen
snapshot. Consumers can compute coverage with `domainCoverage`. Invalid domains and overrides
are warnings on an otherwise complete snapshot; unreadable/skipped files make it partial.

## Interface 3.0: the decided contract

This is the contract, so that a new connector touches no core file, both kinds share one
contract, and loading connectors from packages later is a change of transport, not of contract
([Connectors as packages](connectors/packaging.md)). It is built in slices: what the first one
built, and where it differs from the decided text below, is in [what is built](#what-is-built);
the rest is decided and comes in the next slices.

### Words

- A **connector** is a **manifest** (data) and a **runtime** (code), one per tool and route:
  `cube-files`, `cube-cloud`, `git-markdown`.
- A **source** is one configured use of a connector: its settings, its secrets, the scopes an
  administrator chose, its domain mapping and its schedule. The `connectors` table already is the
  table of sources and keeps its name.
- A **scope** is what a source covers: a view of a definition source, a folder, space or page of
  a content source.
- The two **kinds** are `definitions` and `content`.

### The manifest

The manifest is pure data. The server and the web app both import it, and Sources can list and
describe a connector without running its code (CON-112).

```ts
// src/connectors/git-markdown/manifest.ts
export default defineManifest({
  id: 'git-markdown', // stable; a third party namespaces it: 'acme.lookml'
  version: '1.0.0', // the connector's own semver, stored on every read
  heed: '^3.0', // the interface range it implements (CON-109)
  kind: 'content', // 'definitions' | 'content'
  tool: 'Git', // every screen word that names the tool (CON-101)
  title: 'Markdown in a Git repository',
  summary: 'Markdown files in folders you choose become drafts for a domain’s owners to review.',
  icon: './icon.svg',
  docs: './README.md',
  maintainer: { name: 'Heed' },
  support: 'core', // 'core' | 'verified' | 'community'
  maturity: 'beta', // 'stable' | 'beta' | 'experimental'
  refPrefix: undefined, // definitions only: the tool's prefix (CON-117)
  config: { groups, fields }, // the form, as a restricted schema
  secrets: [{ key: 'token', label: 'Read-only token', required: false, boundTo: ['repository'] }],
  access: ['Read access to this one repository. Heed never writes to it.'],
  egress: { hosts: [{ fromField: 'repository' }], git: true },
  capabilities: {
    discover: 'folders', // 'views' | 'folders' | 'spaces' | false
    incremental: true, // honours the cursor
    deletions: 'both', // 'full-listing' | 'tombstones' | 'both'
    domain: 'per-scope', // 'hint' (definitions) | 'per-scope' (content)
    marks: undefined, // definitions: 'meaning' | 'metadata' (do marks see calculations? CON-505)
    links: true,
    figures: undefined, // definitions: reads one figure for Ask (CON-612)
  },
  schedule: { default: 'PT1H', minimum: 'PT15M' },
  staleAfter: 'PT6H',
  limits: { timeoutSeconds: 120, maxRecords: 5000, draftsPerDay: 20 },
  warnings: { not_markdown: { level: 'info', title: '…', detail: '…' } },
  markVersion: 1,
})
```

The registry checks every manifest at start with one schema and refuses: an id outside
`^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)?$`, an interface range this build does not satisfy, a
duplicate id, a `refPrefix` claimed by two connectors for different tools, a secret key that is
also a settings field, and a warning without words. The same schema generates the manifest
reference.

### The settings form

The form is a restricted JSON Schema: no `anyOf`, `allOf`, `if`/`then`/`else` or
`patternProperties`; alternatives are a `oneOf` with a constant. Hints for the screen: `order`,
`group`, `advanced`, `visibleIf`, `widget`, `patternMessage`, `placeholder`, `default`, and
`examples.invalid` for the kit. Field kinds: `text`, `address`, `path`, `ref`, `secret` (from the
manifest's secrets), `select`, `radio`, `boolean`, `integer`, `list`, `json` and `domain_map`
(interface 2's `domain_names`). The core adds Name, Why and Schedule to every form, and a scopes
step after a good check. One schema gives the runtime's settings type, the server's validation,
the form and the docs. A connector may add a `parse(config)` refinement for rules a schema cannot
say, returning problems by field as in interface 2.

### The runtime and its messages

```ts
// src/connectors/git-markdown/runtime.ts (server only)
export default defineRuntime<Config>({
  async check(ctx): Promise<CheckReport>, // ordered steps; changes nothing
  async discover(ctx): Promise<Scope[]>, // views, folders or spaces, each with a suggested domain
  async *read(ctx): AsyncIterable<Message>, // one read; a full one when ctx.cursor is null
  migrateConfig(fromVersion, config), // settings of an older major, brought up to date
  async figure(figureCtx, query): Promise<FigureResult>, // with capabilities.figures only
})

type Message =
  | { type: 'definition'; definition: Definition } // kind definitions
  | { type: 'document'; document: SourceDocument } // kind content
  | { type: 'deleted'; id: string } // a tombstone, in a delta read
  | { type: 'warning'; code: string; target: string }
  | { type: 'progress'; done: number; total?: number }
  | { type: 'end'; version: string; complete: boolean; cursor?: string }

interface Context<Config> {
  config: Config // checked against the manifest's schema
  scopes: Scope[] // what the administrator chose
  cursor: string | null // from the newest good read
  secret(key: string): string | null // this source's own secrets, nothing else
  fetch: GuardedFetch // https, declared hosts, public addresses, pinned, rate limited
  git: GuardedGit // interface 2's Git fetch behind the same rules
  signal: AbortSignal // the timeout from limits.timeoutSeconds
  log: RedactingLogger // codes and targets, never a secret or content
  now(): Date
}
```

- Messages are plain serializable objects: an async iterator in process, JSON lines out of
  process, the same shape either way.
- A `Definition` is interface 2's definition with two changes: `domainSource` is `source`,
  `override` or `none` (no vendor in the core), and the object is strict (unknown keys are
  refused), so SQL a tool returns somewhere in its payload never crosses.
- A `SourceDocument` is `{ id, scope, title, link, modifiedAt, version, text, mediaType }`. The
  text lives in memory for one read only.
- A failed check or read throws a `SourceError` with a code, a target and a class: `config` (an
  administrator must fix it: a refused token, nothing at the address), `transient` (retried with
  backoff: a timeout, a server error, too many requests, with `retryAfter`) or `source` (the
  tool's content is broken: the model does not compile).

### Check, discover, read

- **Check** runs ordered steps (reach, sign in, sample), each with a message and a fix, and
  changes nothing. For a definition source, Test connection may still show what Heed would hold.
- **Discover** lists the scopes an administrator may choose, each with a suggested domain. The
  choice is stored on the source and handed to every read.
- **Read** is a stream that ends with `end { version, complete, cursor }`:
  - a **full** read (`complete: true`) lists every record of the chosen scopes; anything absent is
    gone;
  - a **delta** read sends `deleted` tombstones and never implies a deletion by absence;
  - a **partial** read never deletes;
  - a read that would remove more than a set share of a source's records is stored as partial
    with a warning, so a broken scope never empties the catalogue or withdraws every draft.
- The **cursor** is opaque, stored only with a good read and in the same transaction as what it
  covers. A connector that reads deltas also does a full read now and then (`deletions: 'both'`).

### Warnings, health and schedules

- Warnings are the core's codes (`taken`, `missing_domain`, `secret_missing`, `private_address`,
  `unreachable`, `unauthorized`, `not_found`, `rate_limited`, …), worded in the web app, plus the
  connector's own, namespaced (`cube-files.unsupported_file`) and worded in its manifest. A test
  fails when a code has no words.
- Health is kept per read (status, duration, counts, warnings, failure class, version and
  connector version) and per source (last success, age, next run, backoff, `staleAfter`), on the
  source's page and in Operations.
- Each source has its own schedule, at or above its manifest's minimum, and its own Read again
  (CON-115). A transient failure backs off per source, never past half of `staleAfter`.
- `ctx.fetch` enforces the manifest's request rate and honours `Retry-After`.

### The two pipelines

A connector only returns records. Two core pipelines keep every rule, and a connector has no way
to write anything else.

**Definitions.** Interface 2's rules, unchanged: a ref belongs to one source, marks are stored on
first sight, change or reappearance, only a complete read marks absent definitions missing, a
failed read changes nothing, and flags and notices follow a good read. A source reads only its
chosen scopes.

**Content.** For each document:

1. Check the message; text over the size limit is dropped with a warning.
2. Normalise the text and compute its change mark. A mark already seen for this document means
   nothing to do.
3. A document that appears to name people is skipped; text that reads like instructions is
   flagged; a likely legal or regulatory matter is flagged as possibly high risk.
4. Past the source's drafts for the day, the document waits and goes first next time.
5. Map it to a draft through the proposal attribute registry: title and summary prefilled from
   the document, the evidence its link and a quote of at most 500 characters, the domain its
   scope's domain; audience, risk, owner and links never inferred. Creation channel `source`,
   provenance naming the source.
6. Submit it to the domain's review queue through the same write path and checks as any
   proposal. It is never accepted automatically.
7. A change to the same document replaces its open draft; a discarded draft remembers the mark;
   a deleted or out-of-scope document withdraws its open draft, and an accepted item that cites
   it is listed for its owner.
8. Owners are told once per source per read.

Per document the core stores the source, the document's id, link, title, change mark, quote,
state and draft, and when it was first and last seen. Never the text (CON-605).

### Where connectors live

```
src/connectors/                  built-in connectors, one folder each
  index.ts                       the list of built-in connectors
  _template/                     what an author copies
  cube-files/  manifest.ts  runtime.ts  README.md  fixtures/  conformance.test.ts
  git-markdown/ …
  demo/        …
src/server/modules/connectors/   the core: contract, registry, sources, scheduler,
                                 pipelines, egress, secrets, conformance kit
```

Built-in connectors are on by default; the operator may narrow them. The server's own sources
become a configuration file the operator writes (one entry per source: id, connector, name,
settings, scopes, domains), and today's `CUBE_MODEL_DIR`, `CL_DOMAIN_OVERRIDES` and
`CUBE_RENAMES_FILE` keep working by producing the same entry.

### Conformance kit

"Compatible with interface 3" means passing the 3.x kit (CON-108). Its tests switch on by the
capabilities a manifest declares:

- **Manifest**: valid, a semver version, a range this build satisfies, id and prefix in form,
  every field and warning worded, no secret among the settings, egress declared, an icon and a
  README.
- **Form**: the schema draws a form, defaults are valid, and each `examples.invalid` is refused
  on the field it names.
- **Check**: a good fixture passes, a bad credential is a `config` failure, an unreachable host
  is `transient`, and a planted secret appears in no message, warning, error, log line or
  snapshot.
- **Definitions**: valid, unique, prefixed refs; the same input gives the same marks; formatting
  keeps marks and meaning moves them; an unreadable file makes the read partial; planted SQL never
  crosses.
- **Content**: valid documents with stable ids and https links; the same document twice makes one
  draft, a change replaces it, a deletion withdraws it, and only a quote and a mark are stored.
- **Cursors and deletions**: an unchanged source gives nothing new, a future cursor gives
  nothing, tombstones and full listings remove, and the removal limit holds.
- **Egress and limits**: no request to an undeclared host, the abort signal is honoured, and a
  429 with `Retry-After` backs off.

### Versions

- **Interface version**, a semver: 3.0 today. A minor version only adds; a
  major one may break. Heed runs the current and the previous major for at least 12 months or two
  releases, whichever is longer, and warns on a source's page when its connector uses a major that
  will stop being supported (CON-109). Experimental parts are open to built-in connectors only.
- **Connector version**, a semver stored on each read. A major version ships `migrateConfig`.
- **Mark version.** When a connector changes how it computes marks (a compiler upgrade, for
  example), the first read after it stores the new marks without flagging items, records that it
  did, and tells the owners once (CON-116).
- **Ref prefix.** It belongs to the tool, not the connector: `cube-files` and a Cube Cloud
  connector both write `cube:`, so items keep their references when a model moves. Ownership of
  a ref still belongs to one source and moves only by an administrator's hand-over, followed by
  a new baseline of marks (CON-117).

### What is built

The first slices of interface 3.0 are in this build. The rest of this section is decided and
comes in the next slices ([what the next slices build](#what-the-next-slices-build)).

| Part                 | Where                                                      | Status                                                                                                                                                                                      |
| -------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest             | `src/domain/connector-manifest.ts`                         | Built: the schema, `checkManifest`, `checkManifests` and the interface range; `defineManifest` in `src/domain/define-manifest.ts`                                                           |
| Settings form        | `src/domain/connector-config.ts`                           | Built: every field kind, checked the same way in the form and in the service                                                                                                                |
| Runtime and messages | `src/domain/connector-runtime.ts`                          | Built: the types, the message schemas, `SourceError`, `defineRuntime`, `defineConnector`                                                                                                    |
| Registry             | `src/server/modules/connectors/registry.ts`, `platform.ts` | Built: manifest and runtime pairs, checked at start; the server's own sources beside them                                                                                                   |
| Built-in connectors  | `src/connectors/`                                          | Built: the list, Cube (`cube`, stable), the static list of definitions (`static-definitions`, experimental), Markdown in Git (`git-markdown`, beta) and Google Drive (`google-drive`, beta) |
| Workers (T1)         | `src/server/modules/connectors/worker.ts`                  | Built: `ctx.worker`, a connector's own worker in a child process under Node's permission model; Cube's compiler is the first                                                                |
| Sources              | Administration › Sources                                   | Built: Add a connector, a form from the manifest, the check step by step, status, last read and errors on the source's page                                                                 |
| Definitions pipeline | `ConnectorService.syncSource`                              | Built for interface 3 runtimes: a read's messages are checked and gathered into one snapshot, and interface 2's rules apply                                                                 |
| Content pipeline     | `src/server/modules/connectors/content.ts`                 | Built: documents to suggestions, one per document, grouped by the read, never published; full reads, and reads from a cursor with tombstones ([content sources](#content-sources))          |
| Scopes, discover     | `platform.ts`, `workspace.ts`                              | Built for content: Test connection lists the scopes, an admin maps each to a domain, and every read gets them                                                                               |
| Git                  | `src/server/modules/connectors/egress-git.ts`              | Built: `ctx.git`, interface 2's Git fetch behind the manifest's declared repository and the secrets bound to it                                                                             |
| Schedules and health | `src/domain/source-schedule.ts`, `job.ts`                  | Built: each source's own schedule at or above its connector's minimum, backoff for a `transient` failure, `staleAfter` from the manifest, Read again for one source                         |
| Integrations         | Settings › Integrations (`src/app/pages/integrations.tsx`) | Built in part: the rows and cells, a source's page with its health, reads, documents and settings, Read again and Pause reading; the five-step connect comes next                           |
| Figures              | `src/server/modules/connectors/figures.ts`, `platform.ts`  | Built: the `figures` capability on a definitions connector, Cube's `figure` (REST `/v1/load`), the settings on the source, `figures.read` ([figures in Ask](#figures-in-ask))               |
| Conformance kit      | `tests/server/connectors/kit.ts`                           | Built in part: the manifest, form, check, read, determinism, partial read, calculation, cursor and tombstone, secret and figure checks, run against every built-in connector                |
| Packages             |                                                            | Decided, later ([Connectors as packages](connectors/packaging.md))                                                                                                                          |

Where the build differs from the decided text above:

- **The form** is `config: { groups, fields }`, a list of fields with these hints: `required`,
  `placeholder`, `default`, `options` (select and radio), `group`, `advanced` (folded under More
  settings), `visibleIf`, `pattern` with `patternMessage`, `minimum`, `maximum`, `maxLength` and
  `maxItems`. A field's place in the list is its order. `widget` and `examples.invalid` come with
  the conformance kit. The core adds Name and Why to every form. The API takes a source's
  schedule and, for content, its scopes (`sources.add`, `sources.update`); the old Sources form
  adds definition sources only, and the new web app's five-step connect draws both.
- **The icon** is a name from a short list (`database`, `git`, `file`, `list`, `cloud`, `book`),
  not a file, so the web app draws it without loading anything. `docs` is optional.
- **The registry** refuses a manifest that does not pass the schema, an interface range this
  build does not speak (written `^3`, `^3.0`, `^3.0.0`, `3.x` or `~3.0`), an id out of form, an
  id another connector has or the id of a type of the server's sources it does not read (the
  demo), a ref prefix claimed by two tools, a secret
  that is also a setting, a secret bound to no setting and a warning without words. It also
  refuses what this build cannot run yet: a definitions connector whose `deletions` is not
  `full-listing`. The server does not start, and the error names every problem.
- **The runtime's context** has `config`, `scopes` (those chosen for a content source, each with
  its domain; none for definitions), `cursor`, `secret` (its own secrets only), `fetch`, `git`,
  `folder`, `worker`, `signal` (the manifest's `limits.timeoutSeconds`, or for a connector with a
  worker the server gave longer, that long and a minute more), `log` and `now`. `fetch` is a GET
  or a HEAD, with a query if it needs one, to an address Heed may fetch (https to a public host in
  production), on a host the manifest declares by name or through an address setting, without
  following a redirect. A POST with a body goes only to a host the manifest declares for signing
  in (`signIn: true` on the host), where a connector trades its credential for a short-lived token
  (Google Drive's service account): nothing is written to the tool. Pinning the checked address,
  the request rate and `Retry-After` come next. `git` fetches one commit of the
  repository a settings field names, only when the manifest declares `egress.git` and a host from
  that field, with a secret only when it is bound to that field (and the user name the runtime
  gives with it), in the form the address was checked in, and hands the runtime a read-only view
  of it (`folders`, `files`, `text`) that is removed when its work ends. `folder` is the same view
  of the folder on the server that whoever runs it named for the source (the Cube model folder),
  and null for a source an administrator added. `worker` runs the connector's worker
  ([security](connectors/security.md#where-connector-code-runs)) with an input and returns its
  one answer, untrusted. An address setting the manifest names as a host is refused with the
  settings when Heed may not reach it (in production, plain http or a private address).
- **A read** is checked message by message: a definition must be strict, under the connector's
  `refPrefix`, and sent once; a document must be in a chosen scope and sent once; a warning must
  be one of the core's codes or the connector's own (`<id>.<code>`, worded in its manifest); a
  definitions connector sends no document or tombstone, a content connector no definition, and
  only one that declares tombstones sends them; and the read ends with `end`. Anything else fails the read with `invalid_output`
  and keeps nothing. A read past `limits.timeoutSeconds` fails with `timed_out`; one past
  `limits.maxRecords` keeps the first records, warns `too_many_records` and is partial. A
  `SourceError` with a code the connector may use is the failed read's warning, followed by
  what the read warned about before it failed (the files it left out); any other error says only
  `invalid_output`, since its message could hold what was read.
- **The definitions pipeline** is interface 2's: a read is gathered into its snapshot and stored
  by `ConnectorService.syncSource`, with every rule of [what the core does with a
  read](#what-the-core-does-with-a-read). The core still calls a domain from the tool `cube`
  there and in the API (`domainSource`, and the coverage it counts), so a runtime's `source` is
  stored as that.
- **Cube** is one connector, `cube`, for a model in a Git repository an administrator adds and
  for the server's own model folder (`CUBE_MODEL_DIR`), which its runtime reads as `ctx.folder`;
  the core applies the server's domain names (`CL_DOMAIN_OVERRIDES`) and renames
  (`CUBE_RENAMES_FILE`) to that folder's reads (`server-source.ts`), and `npm run
connectors:sync` is unchanged. Its settings, its refs and the sources administrators added on
  interface 2 are as they were. Its warnings are the core's codes it always had
  (`unsupported_file`, `compile_error` and the rest), since stored reads name them.
- **What is stored**: a source's `connectors.type` is its connector's id and `interface_version`
  is the interface the connector was written to (3, or 2 for the demo; migration 0020 moved the
  Cube sources added on interface 2 to 3). The history log's `source.added`
  records the connector's version, and every read of a content source keeps it too
  (`connector_snapshots.connector_version`).

### What the next slices build

Slice 2, Cube on interface 3, is built: Cube is a connector of its own, a manifest and a runtime
whose compiler runs in its worker (T1), its model fetched through `ctx.git` or read from
`ctx.folder`, and the adapter is gone. What remains of it:

- The server's own sources from a configuration file the operator writes, with `CUBE_MODEL_DIR`,
  `CL_DOMAIN_OVERRIDES` and `CUBE_RENAMES_FILE` producing the same entry.
- `domainSource` `source` in the core and the API (today `cube`), and the coverage it counts.
- The connector's version and mark version stored on every read (a migration), shown on the
  source's page, and the first read after a mark version change stored without flags (CON-116).
- `ctx.fetch` pinned to the address it checked, with the manifest's request rate and
  `Retry-After`; `ctx.log` into the server's log, codes and targets only.
- The rest of the conformance kit (cursors and deletions, egress and limits),
  `src/connectors/_template/` and a README per connector with its tables from the manifest; the
  operator's list of connectors to allow (`HEED_CONNECTORS`).

Slice 4, Google Drive through a service account, is built: its key in the secret store, signed
into a read-only token at a sign-in host the manifest declares, documents exported as Markdown
(`files.export`), reads from its changes list (`changes.list`) with tombstones, and a full read
now and then (`deletions: 'both'`), with the core choosing which by the cursor it hands
([content sources](#full-reads-and-reads-from-a-cursor)).

Slice 5, the screens, is built in part: the Integrations pages of the new web app read the
service (`sources.list`, `sources.activity`), with Read again and Pause reading. The Figures section
of a definitions integration's page is on the service too ([figures in Ask](#figures-in-ask)). What
remains: the five-step connect (Pick, Connect, Choose, Map, Schedule) drawn from the manifests,
Change settings and Disconnect.

### Figures in Ask

A definitions connector may declare `capabilities.figures` (CON-612, FR-716): it can read one figure
for Ask from the tool's data endpoint. The registry refuses a manifest that declares it without a
runtime `figure`, and a content connector that declares it. Cube is the first.

- **Settings** live on the source (`connectors.capabilities.figures`, migration 0025): the switch
  Show figures in Ask, off by default; the data endpoint; and the name of its token in the secret
  store. The data contact is `connectors.data_contact_id`. An administrator changes them with
  `figures.set`; switching on needs the endpoint, its token and a data contact. The token is sent
  only to the endpoint's origin and forgotten when it changes ([security](connectors/security.md#figures-con-612)).
- **The read** (`figures.read`) starts from the metric's term: its definition decides the source
  (the one that holds its ref, under its connector's ref prefix, CON-117), its view gives the one
  time dimension and the member each dimension term names there, and the question gives the days
  and the values (a value's name and other names). The core hands the runtime a fixed
  `FigureQuery { metric, date, from, to, filters }` and a `FigureContext { endpoint, token,
fetch, signal, now }`; the runtime answers `{ value, asOf, format, aggregation? }`, checked like
  every message. The core reads the days and the days just before in one go, within 4 seconds,
  keeps the result a minute in memory, and stores nothing. A failure is a code only.
- **No figure** when no integration defines the metric, more than one does, its view has no single
  date or can't be split by a value the question names, or the tool has no value: Ask says which.
- **Side by side**: a named report can say a figure doesn't fit a context item (`part: 'figure'`,
  migration 0025). It reaches the item's owners, the data contact, or both, and while it is open
  `figures.read` names the item, which Ask shows beside the figure with no verdict.
- **Conformance**: the kit reads a figure through the core from the fixture's endpoint, and checks
  that a refused token, a figure out of time and an endpoint Heed may not fetch each fail with
  their code, and that the token reached only the endpoint's host.

## Content sources

A content source turns documents into suggestions (CON-601 to CON-611). Its connector only
returns documents; the content pipeline (`src/server/modules/connectors/content.ts`) is the one
place that makes suggestions of them, and it has no way to accept, publish or change an item or an
edition (CON-604). Markdown in Git is the first connector
([its page](../src/connectors/git-markdown/README.md)).

### Adding one

An admin adds a content source like any other, with its scopes: **Test connection** runs the
connector's check, then lists the scopes it may cover (`discover`), each with the domain it most
likely belongs to, and reads nothing. The admin chooses at least one scope and maps each to one
Heed domain (CON-602); **Add** saves them on the source (`connectors.scopes`). A change to the
scopes applies from the next read. The source's form says that who may read a document is not
copied (CON-610).

### What a read does

A read runs as nobody, in its own transaction, which names the source it reads for
(`cl.source_id`); row security lets that transaction write the suggestions of that source and
their versions, and nothing else, and a person's request never names a source. For each document,
the ones that waited first:

1. Its change mark is the SHA-256 of its title and its text, with line ends, trailing spaces and
   blank runs left out. A mark the pipeline already handled for the document means nothing to do.
2. A document with an email address or a phone number appears to name people and is skipped, and
   so is one with what looks like a password, a token or a key (CON-608), one that names no metric,
   market or other term of the vocabulary (it applies nowhere), and one with no words. A skipped
   document keeps no quote, and no title that holds such words.
3. Past the source's suggestions for the day (`limits.draftsPerDay`, counted over the last 24
   hours), it waits and goes first at the next read (CON-607). A read with a document that waits
   keeps the cursor it was given, so the next read brings it again.
4. It becomes a draft: its title and first sentences, its text as the body, where it applies from
   the vocabulary names it uses, when from the dates it names (or the day it changed), its domain
   the one its scope maps to, and its evidence its link and its first sentence. Audience, risk,
   owner and links keep their defaults and are marked `not_inferred` (CON-603). The draft goes
   through the same defaults and checks as any proposal, with the channel `source`, provenance by
   `source`, no proposer, and the source, the read and the document named on it, and is submitted
   to the domain's owners. A draft the checks refuse is not offered, with a warning.
5. A changed document withdraws its open suggestion and makes a new one in its place; one whose
   suggestion was published makes a suggestion to change that item. A suggestion an owner
   declined is not offered again until the document changes (CON-606).

Then what is gone: a document outside the chosen scopes, a tombstone, and on a complete full read
a document it did not list. Each withdraws its open suggestion, and an item it became is listed
for its owners (`source.document_gone`) and stays as it is (CON-609). A read that would find more
than half of a source's documents gone at once, and more than five, tombstones included, keeps
them all and is in part (`too_many_removals`), so a broken scope or a folder shared by mistake
never empties the Inbox. A document a read saw and could not hand over (too long, or not text) is
not gone.

### Full reads and reads from a cursor

The core chooses what kind of read it asks for by the cursor it hands (`capabilities.deletions`):

- A connector that lists everything each time (`full-listing`, Markdown in Git) gets its cursor,
  and every read is a full read.
- A connector that reads the changes since its cursor and sends tombstones (`both`, Google Drive)
  gets its cursor, and a document such a read leaves out is not gone. A read in which a folder
  changed (it may have moved in or out) ends with no cursor, so the next read is a full read. Once
  its last good full read is a week old (`FULL_READ_EVERY_DAYS`), it gets no cursor: it lists
  everything again, which finds what a change list missed, and what that read leaves out is gone.

Each read records which it was (`connector_snapshots.full_read`). A read in part, or one with a
document that waits, keeps the cursor it was handed, so the next read brings again what this one
could not take; a full read in part leaves the next one full too.

The domain's owners are told once per source per read (`source.suggested`), never once per
suggestion. In the Inbox the suggestions of one read sit under one header, "From
<tool>, <when>", and the review says it was created by the read, not by a person
(`synced` on the suggestion card and the review sheet).

### What is kept

Per document, only what CON-605 allows (`connector_documents`): its id in the tool, its scope,
title and link, when it changed, its change mark, a quote of at most 500 characters, what the
pipeline did with it (drafted, waiting, skipped and why, or gone) and its suggestion. Never its
text: that lives in memory for one read only. Each read is one `connector_snapshots` row, as for
definitions, with what it did: documents seen, suggested, replaced, withdrawn, waiting and
skipped, and the connector's version.

### Schedules (built)

Each source has its own schedule (CON-115): how often it is read (`connectors.schedule`, the
connector's default when unset), never more often than the connector's minimum and never less
often than it may go unread (`staleAfter`). After a good read, or one that failed for a reason an
admin must fix, the next read is one period later (`connectors.next_read_at`). After a failure
that clears by itself (`transient`: a timeout, a host that could not be reached, too many
requests) it is tried again sooner: one minute, then two, four and so on, never later than half of
`staleAfter` and never sooner than the tool asked (`Retry-After`). The job `connectors.sync` runs
every five minutes and reads the sources that are due. **Read again** reads one source at the job's
next turn (`POST /sources/{id}/read`), and a change to a source's settings makes it due at once.

## Validation

`npm test` includes the synthetic compiler cases, the manifest and settings checks
(`tests/unit/connector-manifest.test.ts`) and the registry and runtime reads
(`tests/server/connectors/platform.test.ts`). `npm run test:integration` exercises PostgreSQL
snapshots, failures, partial reads, removals, reappearance, concurrency and the API role's grants.
`tests/integration/source-flags.test.ts` drives recorded model changes end to end: a changed and a
renamed member flag the items that reference them and are delivered as unverified, mentions are
only informed, an outage changes nothing, rechecks and new versions clear flags, and a changed
domain informs only. `tests/integration/source-health.test.ts` runs the sources' job and reads the
operations view. `tests/integration/sources.test.ts` adds, tests, changes and reads a source
through the API against a Git host on the machine, and checks that only administrators reach it
and that its token is in no answer, row, history entry, retry record or log line, and adds,
tests and reads a static list end to end through the definitions pipeline; the Settings
conformance suite (`tests/conformance/context-api-settings.ts`) holds the mock to the same rules.
The Cube connector's own tests are in [its page](connectors/cube.md#validation), and
`tests/integration/cube-sources.test.ts` takes a Cube model in Git through the API, its own
schedule and its backoff, and proves a read never publishes, decides or suggests anything.

The conformance kit (`tests/server/connectors/kit.ts`) runs against every built-in connector in
`tests/server/connectors/conformance.test.ts`: its manifest and README, its form and defaults,
its check with settings that work, a refused secret and a host that cannot be reached, its
definitions or its documents and scopes read twice the same way, a definitions read in part when a
file cannot be read and with no calculation in it, for a connector that reads from its cursor
nothing new from an unchanged source and a changed document and a tombstone after a change, and
its secret in nothing it returns. A new connector adds its fixture there; Google Drive's runs
against a fake Drive on the machine (`tests/server/connectors/drive-server.ts`) whose service
accounts and keys are invented when it starts. `tests/server/domain/content-document.test.ts`
holds the rules of a document's mark, quote, skips and draft, and of the schedules.
`tests/integration/content-sources.test.ts` takes Markdown in Git end to end on PostgreSQL 18 with
a Git host on the machine: an admin tests it and maps its folders, a read suggests one per
document and publishes nothing (no edition, decision or served version changes), the owners'
Inbox shows them under the read and is told once, an unchanged repository brings nothing, a
changed document replaces its suggestion, a declined one is not offered again, a published one's
deletion is listed for its owners, a deleted document withdraws its suggestion, a changed scope
withdraws what left it, the day's cap makes the rest wait and holds the cursor, too many removals
at once keep everything, and only the read's own transaction writes its suggestions.
`tests/integration/drive-sources.test.ts` takes Google Drive the same way against the fake Drive:
an admin tests its key and maps a shared folder, a read suggests one per Google Doc and publishes
nothing, a read from the cursor brings only what changed (a changed document replaces its
suggestion, a trashed one withdraws it), a week on the core asks for a full read, which withdraws
what a change list missed, a key gone from the store fails the read and changes nothing, and the
key and the tokens Google gave for it are in no answer, row, history entry, retry record or log
line.
