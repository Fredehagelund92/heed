# Connectors: the contract

A connector is how Heed reads a tool it does not own. It is the contract between the core and
every connector: what a connector declares, what it returns and what the core does with it.

There are two kinds:

- A **definition source** says which metrics and dimensions exist, so Heed can check items
  against them. It may change what Heed knows exists, never what Heed says: a change only flags
  the items that rely on it (CON-209 to CON-214). Cube model files are the first one, and the demo
  source (two invented definitions) the fallback.
- A **content source** reads documents from folders, spaces or pages an administrator chose, and
  turns each new or changed document into at most one draft for one domain's owners to review
  (CON-601 to CON-610). Markdown files in a Git repository are the first one. None is built yet.

Chat and identity connectors have other shapes and are outside this contract (CON-304, CON-401).

**Interface 3.0** is the contract: a manifest that is data and a runtime that is code, for both
kinds. Its first slice is built: the manifest, the runtime and its messages, the registry, and
adding a source of any connector from its manifest in Sources ([what is built](#what-is-built)).
Connectors written to **interface 2**, below, keep working through an adapter: Cube is one, until
it is ported. The other connector documents:

| Document                                          | For                                                                                    |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [Security and egress](connectors/security.md)     | Where connector code runs, the hosts it may reach, the secret store and its output     |
| [Writing a connector](connectors/authoring.md)    | Authors of a new connector: the steps, the rules and the review checklist (a skeleton) |
| [Connectors as packages](connectors/packaging.md) | The design for loading connectors from packages later; not built                       |
| [The Cube connector](connectors/cube.md)          | The Cube model setup, its settings, the demo model, compilation and change marks       |

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

## Interface 2: what Cube is written to

Administrators look after the sources in **Administration › Sources**: a list of the sources with
their status, last read, what they hold and their issues, Add a connector, and one page per
source with its status, issues, views and domains, settings and recent reads, and Read again. AI
apps that read _from_ Heed are the other direction, in MCP and gateway.

A source is configured in one of two places. Whoever runs the server selects one with its
environment (the Cube model folder, or the demo): its settings are read only in the product. An
administrator **adds** others in **Administration › Sources** (a Cube model in a Git repository):
their settings are configuration in the database, their secrets are in the server's secret store
(CON-105).

Public code imports `src/server/modules/connectors/index.ts`. `DefinitionSource.read` returns a
snapshot; `ConnectorRegistry` holds the server's own sources and loads those administrators added
from the database at each read; `ConnectorService` persists a read through the API-role
PostgreSQL pool. Its `list`, `exists` and `changesSince` methods read PostgreSQL only. They never
compile a model at request time.

### Version

This is interface version **2** (`interfaceVersion: 2`, `INTERFACE_VERSION` in `types.ts`,
CON-109). The registry refuses any other version, a duplicate id and an id outside
`^[a-z][a-z0-9_-]{1,39}$`. A change to anything in this section is a new interface version.

What changed from version 1: a read is handed the cursor of the newest good read and may return
one (`read(context)`, `cursor`); a type may declare how an administrator adds a source of it
(`workspace`: its form, its access and how it checks settings), with its secrets kept in the
secret store; the core tests settings with one read it keeps nowhere; and a member another source
already reads is left with that source (`taken`) instead of failing the read.

### What a connector declares

A **connector type** (`ConnectorType` in `types.ts`) says what every source of the type has in
common:

| Field         | Meaning                                                                                                                                                                                                                                                                                                  | Cube                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `type`        | The type's id, stored on the connector (`connectors.type`).                                                                                                                                                                                                                                              | `cube`                   |
| `tool`        | The tool it reads, as people say it. Every word on screen that names the tool comes from here ("Changed in Cube", "We could not read Cube lately"): no core code names a vendor (CON-101). The API sends it as `tool` on each catalogue source and definition and on each source of the operations view. | `Cube`                   |
| `settingKeys` | The administrator settings (FR-809) that belong to the source the server's configuration selects. Its page in Sources shows and changes them; Limits leaves them out.                                                                                                                                    | `sources.cube_model_url` |
| `workspace`   | How an administrator adds a source of the type, below. Absent when they cannot (the demo).                                                                                                                                                                                                               | Cube model in Git        |

A type an administrator may add declares (`WorkspaceConnector`):

| Field                          | Meaning                                                                                                                                                                                                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`, `title`, `description` | What a source of it is and reads, as Add a connector says it.                                                                                                                                                                                                                                  |
| `access`                       | The least access it needs, said before anything is given (CON-106).                                                                                                                                                                                                                            |
| `fields`                       | Its form: each field's `key`, `kind` (`text`, `address`, `secret`, `domain_names`), label, description, whether it is required, an example and a first value. The screen draws the form from these, so no screen names a vendor (CON-101). A `secret` field is never stored with the settings. |
| `parse(config)`                | The settings as stored (empty ones left out), or what is wrong with them, by field. It never sees a secret.                                                                                                                                                                                    |
| `secretsBoundTo`               | The settings its secrets are bound to: where they are sent. A change to one forgets the stored secrets unless new ones come with it.                                                                                                                                                           |
| `domains(config)`              | The Heed domains the settings name; the core checks that each exists.                                                                                                                                                                                                                          |
| `create(source)`               | The source for stored settings and the secrets the store holds (null when the store lost them; its reads then fail with `secret_missing`).                                                                                                                                                     |

A **source** (`DefinitionSource`) is one configured reader of that type:

| Field              | Meaning                                                                                                                                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`               | Stable id of the connector row: `cube` or `demo` for the server's, and for an added one an id from its name (`analytics-model`), which never changes.                                                                                                           |
| `type`, `name`     | Its type, and its name on screen ("Cube local model").                                                                                                                                                                                                          |
| `interfaceVersion` | `2`.                                                                                                                                                                                                                                                            |
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
cursor is stored on its snapshot (`connector_snapshots.cursor`). The hourly job `connectors.sync`
reads every source that is switched on, the server's and those administrators added, loaded from
the database each time; one that breaks the refresh itself does not keep the others from being
read. Read again on a source's page runs it now. A source whose last good read is older than
`stale_after` (6 hours by default) is out of date, and the watchdog alerts (CON-104).

### Sources an administrator adds

**Add a connector** in Administration › Sources (administrators only) lists every connector an
administrator may add a source of, by what it syncs, with its title, its summary and how far
along it is. Choosing one opens its page: what it syncs, how often it reads, the hosts it reaches
and the least access it needs, then the form its manifest declares (an interface 2 type's form
comes through the adapter). **Test connection** runs the connector's check step by step, then
reads the source once with the form's settings and keeps nothing: it says what Heed would hold
(version, views, metrics, dimensions and the read's warnings, including members another source
already reads) or why it could not read. **Add connector** saves the source with a reason and
queues a read. The source's page shows its settings, each secret only as set or not set, and
**Change settings** opens the same form filled in; a secret left empty keeps the one the store
holds, and a new one replaces it.

| Operation        | Path                 | What it does                                                                                                           |
| ---------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `sources.types`  | `GET /sources/types` | The connectors an administrator may add a source of: each manifest, and the interface it was written to                |
| `sources.get`    | `GET /sources/{id}`  | An added source's settings, and for each secret whether it is set (404 for the server's own)                           |
| `sources.add`    | `POST /sources`      | Adds one with its settings, secrets and reason; needs an `Idempotency-Key`                                             |
| `sources.update` | `PUT /sources/{id}`  | Changes one on the revision read (409 when stale), with a reason; a secret left out is kept                            |
| `sources.test`   | `POST /sources/test` | The connector's check, then one read with these settings, kept nowhere; with `id`, a secret left out is the stored one |

Every operation is for administrators; the service refuses anyone else (403) whatever the screen
shows. Settings with problems are refused (422) with a finding per field: an address that is not
https (plain http only to this machine), credentials in an address, a ref git could read as an
option or a range, a folder that leaves the repository, a domain name that is not a Heed domain,
and a secret pasted into another field. Changes are kept in the history log (`source.added`,
`source.changed`) with the settings and, for each secret, only `set` or `replaced`.

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

- **Interface version**, a semver: interface 2 today, 3.0 next. A minor version only adds; a
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

The first slice of interface 3.0 is in this build. The rest of this section is decided and comes
in the next slices ([what the next slices build](#what-the-next-slices-build)).

| Part                 | Where                                                      | Status                                                                                                                      |
| -------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Manifest             | `src/domain/connector-manifest.ts`                         | Built: the schema, `checkManifest`, `checkManifests` and the interface range; `defineManifest` in `define-manifest.ts`      |
| Settings form        | `src/domain/connector-config.ts`                           | Built: every field kind, checked the same way in the form and in the service                                                |
| Runtime and messages | `src/domain/connector-runtime.ts`                          | Built: the types, the message schemas, `SourceError`, `defineRuntime`, `defineConnector`                                    |
| Registry             | `src/server/modules/connectors/registry.ts`, `platform.ts` | Built: manifest and runtime pairs, checked at start; interface 2 types through an adapter                                   |
| Built-in connectors  | `src/connectors/`                                          | Built: the list and the static list of definitions (`static-definitions`, experimental); Cube is still interface 2          |
| Sources              | Administration › Sources                                   | Built: Add a connector, a form from the manifest, the check step by step, status, last read and errors on the source's page |
| Definitions pipeline | `ConnectorService.syncSource`                              | Built for interface 3 runtimes: a read's messages are checked and gathered into one snapshot, and interface 2's rules apply |
| Content pipeline     |                                                            | Decided: a content connector's manifest is valid, but no source of one can be added yet                                     |
| Scopes, discover     |                                                            | Decided: `discover` is typed and not called; every read gets no scopes                                                      |
| Schedules and health |                                                            | Decided: every source is read by the hourly job; the manifest's schedule and `staleAfter` are not applied yet               |
| Conformance kit      |                                                            | Decided: the tests in `tests/server/connectors/platform.test.ts` and `tests/unit/connector-manifest.test.ts` are its seed   |
| Packages             |                                                            | Decided, later ([Connectors as packages](connectors/packaging.md))                                                          |

Where the build differs from the decided text above:

- **The form** is `config: { groups, fields }`, a list of fields with these hints: `required`,
  `placeholder`, `default`, `options` (select and radio), `group`, `advanced` (folded under More
  settings), `visibleIf`, `pattern` with `patternMessage`, `minimum`, `maximum`, `maxLength` and
  `maxItems`. A field's place in the list is its order. `widget` and `examples.invalid` come with
  the conformance kit. The core adds Name and Why to every form; Schedule and the scopes step
  come with schedules and `discover`.
- **The icon** is a name from a short list (`database`, `git`, `file`, `list`, `cloud`, `book`),
  not a file, so the web app draws it without loading anything. `docs` is optional.
- **The registry** refuses a manifest that does not pass the schema, an interface range this
  build does not speak (written `^3`, `^3.0`, `^3.0.0`, `3.x` or `~3.0`), an id out of form, an
  id another connector or an interface 2 type has, a ref prefix claimed by two tools, a secret
  that is also a setting, a secret bound to no setting and a warning without words. It also
  refuses what this build cannot run yet: a definitions connector whose `deletions` is not
  `full-listing`. The server does not start, and the error names every problem.
- **The runtime's context** has `config`, `scopes` (empty), `cursor`, `secret` (its own secrets
  only), `fetch`, `signal` (the manifest's `limits.timeoutSeconds`), `log` and `now`. `fetch` is
  GET or HEAD only, to an address Heed may fetch (https to a public host in production), on a
  host the manifest declares by name or through an address setting, without following a
  redirect. Pinning the checked address, the request rate and `Retry-After` come next. `ctx.git`
  comes with the Cube port.
- **A read** is checked message by message: a definition must be strict, under the connector's
  `refPrefix`, and sent once; a warning must be one of the core's codes or the connector's own
  (`<id>.<code>`, worded in its manifest); a definitions connector sends no document or
  tombstone; and the read ends with `end`. Anything else fails the read with `invalid_output`
  and keeps nothing. A read past `limits.timeoutSeconds` fails with `timed_out`; one past
  `limits.maxRecords` keeps the first records, warns `too_many_records` and is partial. A
  `SourceError` with a code the connector may use is the failed read's warning; any other error
  says only `invalid_output`, since its message could hold what was read.
- **The definitions pipeline** is interface 2's: a read is gathered into its snapshot and stored
  by `ConnectorService.syncSource`, with every rule of [what the core does with a
  read](#what-the-core-does-with-a-read). Until Cube is ported, the core still calls a domain
  from the tool `cube` there (`domainSource`), so a runtime's `source` is stored as that.
- **Interface 2 types** go through the adapter (`fromInterface2`): their manifest comes from what
  they declare (`manifestFromInterface2`, version `2.0.0`, refs under their type), and their own
  `parse` and `create` check settings and make the source, as before. The server's own Cube
  source (`CUBE_MODEL_DIR`) and `npm run connectors:sync` are unchanged.
- **What is stored**: a source's `connectors.type` is its connector's id and `interface_version`
  is the interface the connector was written to (3, or 2). The history log's `source.added`
  records the connector's version. No migration was needed.

### What the next slices build

Slice 2, Cube on interface 3:

- Cube as connectors of its own (`cube-files` for the server's model folder, a Cube model in Git),
  each a manifest and a runtime, its rules as the runtime's `parse`, its warnings namespaced
  (`cube-files.unsupported_file`) and worded in its manifest; the adapter then has nothing left
  to adapt.
- `ctx.git`: interface 2's Git fetch (`git.ts`) behind the same rules as `ctx.fetch`, and the
  compiler run from the runtime in its child process (T1).
- The server's own sources from a configuration file the operator writes, with `CUBE_MODEL_DIR`,
  `CL_DOMAIN_OVERRIDES` and `CUBE_RENAMES_FILE` producing the same entry.
- `domainSource` `source` in the core and the API (today `cube`), and the coverage it counts.
- The connector's version and mark version stored on every read (a migration), shown on the
  source's page, and the first read after a mark version change stored without flags (CON-116).
- Each source's own schedule and `staleAfter` from its manifest, and backoff for a `transient`
  failure.
- `ctx.fetch` pinned to the address it checked, with the manifest's request rate and
  `Retry-After`; `ctx.log` into the server's log, codes and targets only.
- The conformance kit, `src/connectors/_template/` and a README per connector with its tables
  from the manifest; the operator's list of connectors to allow (`HEED_CONNECTORS`).

Slice 3, Markdown in a Git repository: `discover` and the scopes step in the form, the content
pipeline (documents to drafts, the drafts per day), delta reads with tombstones, and content
connectors on Add a connector.

## Validation

`npm test` includes the synthetic compiler cases, the manifest and settings checks
(`tests/unit/connector-manifest.test.ts`) and the registry, adapter and runtime reads
(`tests/server/connectors/platform.test.ts`). `npm run test:integration` exercises PostgreSQL
snapshots, failures, partial reads, removals, reappearance, concurrency and the API role's grants.
`tests/integration/source-flags.test.ts` drives recorded model changes end to end: a changed and a
renamed member flag the items that reference them and are delivered as unverified, mentions are
only informed, an outage changes nothing, rechecks and new versions clear flags, and a changed
domain informs only. `tests/integration/source-health.test.ts` runs the hourly job and reads the
operations view. `tests/integration/sources.test.ts` adds, tests, changes and reads a source
through the API against a Git host on the machine, and checks that only administrators reach it
and that its token is in no answer, row, history entry, retry record or log line, and adds,
tests and reads a static list end to end through the definitions pipeline; the Settings
conformance suite (`tests/conformance/context-api-settings.ts`) holds the mock to the same rules.
The Cube connector's own tests are in [its page](connectors/cube.md#validation).
