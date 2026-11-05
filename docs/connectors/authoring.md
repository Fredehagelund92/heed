---
title: Writing a connector
line: 'What interface 3.0 asks of whoever writes a connector, step by step.'
group: Connectors
order: 3
reviewed: 2026-11-04
---

## Read this first

A connector is how Heed reads a tool it does not own: a **manifest** (data) and a **runtime**
(code) in a folder of `src/connectors/`. A **definitions** connector says which metrics and
dimensions exist in a semantic layer or a catalogue; a **content** connector reads documents that
become suggestions for owners. This guide is complete for building a definitions connector in
this repository: follow it from top to bottom. The [contract](../connectors.md) is the reference
behind it, and [Security and egress](security.md) the rules the core enforces on your code.
Content connectors follow the same steps; [Markdown in Git](../../src/connectors/git-markdown/README.md)
is their example.

Copy, do not invent: `src/connectors/_template/` is a working definitions connector that passes
the conformance kit. Every step below changes it into yours.

## The contract in one screen

What your code may and may not do (the invariants, I-1 to I-8, in
[the contract](../connectors.md#invariants)):

- [ ] **I-1 Definitions stay canonical.** A definition is a ref, a kind, a name, a title, a
      description copy of at most 500 characters, a value type, a domain hint and a change mark,
      with other names and a base name if the tool has them. Never a calculation, a query or a
      data row.
- [ ] **I-2 Definition sources only flag.** A change you report flags the items that rely on it,
      and a failed read changes nothing. You never change what Heed says.
- [ ] **I-3 Content sources only create reviewed drafts**, at most one per document.
- [ ] **I-4 Secrets never leave the store**, except into your runtime, toward the settings they
      were given for. Never log or return one.
- [ ] **I-5 Domain mapping is per source and explicit.** You pass the domain the tool names; the
      administrator maps the rest. A hint never creates a domain.
- [ ] **I-6 Read only, declared hosts, least access said first** (CON-102, CON-106, CON-113).
- [ ] **I-7 Your output is untrusted.** The core checks every message and refuses unknown keys.
- [ ] **I-8 No vendor in the core.** Your tool's name lives in your folder, nowhere else.

A **definition** (`runtimeDefinitionSchema`, `src/domain/connector-runtime.ts`):

| Field             | What you put there                                                                      |
| ----------------- | --------------------------------------------------------------------------------------- |
| `ref`             | `<refPrefix>:<group>.<name>`, stable for good. The prefix belongs to the tool (CON-117) |
| `kind`            | `metric` or `dimension`                                                                 |
| `name`            | `<group>.<name>`, the ref without its prefix                                            |
| `title`           | The tool's label, or null. Heed words a null title from the name                        |
| `descriptionCopy` | `descriptionCopy(text).copy`: the first 500 characters, or null                         |
| `valueType`       | The tool's own word for the type (`sum`, `time`), or null when it says none             |
| `visibleGroups`   | Always null                                                                             |
| `areaHint`        | The domain id the tool names, from `domainHint`, or null                                |
| `domainSource`    | `source` with a hint, `none` without one                                                |
| `modelFile`       | The file that defines it, relative to the folder you read, or null                      |
| `synonyms`        | `synonymsOf(value)`: the other names the tool lists                                     |
| `baseName`        | The member's own name when the tool joins it under a prefix, or leave it out            |
| `changeMark`      | `meaningMark(meaning)`: the SHA-256 of what it means                                    |

A **read** yields messages: `warning` (a code and a target), `definition`, and one `end` with a
`version`, whether it is `complete`, and a `cursor`. A **failure** throws a `SourceError` with a
code, a target and a class: `config` (an administrator fixes it: a refused token, a missing
file), `transient` (tried again later: a timeout) or `source` (the tool's content is broken). A
code is one of the core's (`sourceWarningCodes`, `src/contract/operations.ts`) or your own,
worded in the manifest and sent as `<id>.<code>`.

## Decide before you write

- **Kind.** Definitions or content; one connector is one of them.
- **Id, tool word and ref prefix.** The id is your folder's name and stays for good: sources store
  it. The tool word (`tool`) is how people say the tool. The ref prefix is the tool's, for good:
  a second connector for the same tool writes the same prefix (CON-117).
- **Where the input comes from.** A file or folder in a Git repository (`ctx.git`), the folder
  whoever runs the server names (`ctx.folder`), or an https address or API (`ctx.fetch`). Prefer the
  tool's own resolved output (a built artifact) to its source files: re-implementing a tool's
  parser is guessing. Never run the tool. A built artifact usually lives where a pipeline uploads
  it, in object storage, so offer that first: [dbt MetricFlow](../../src/connectors/dbt-metricflow/README.md)
  reads one file from an address, an object store, Git or a server folder, and lets the
  administrator choose with one `radio` field and `visibleIf` on the rest.
- **What may read it unchanged.** A file read over https may have an ETag or a date. Send them
  back and end with `unchanged: true` on a `304`, and the core keeps the last read: see
  `read` in the dbt runtime. Put your mapping's version in the cursor.
- **Whether an address is a secret.** A signed link is a credential. Keep it in a secret slot, not
  a setting, and declare its host with `{ fromSecret: <slot> }`; say only its host in a step.
- **Whether it can read a folder on the server.** If `read` works from `ctx.folder` with no
  settings, declare `capabilities.serverFolder: true`. Whoever runs the server then names a folder
  for it (`HEED_SERVER_FOLDERS`, by connector id), and that folder is one of the server's own
  sources, with no form. The connector never names the path, and the core hands no folder to a
  connector that does not declare this. Leave it out for an API or a live service.
- **What a group is.** The part of a name before the last dot. Integrations lists groups in the
  Choose and Map steps, and an administrator maps each to a domain. A name without a dot is in no
  group, and Integrations cannot list it.
- **What is left out.** Join keys, inputs people never query, hidden or private members, saved
  queries. Leave them out of the read rather than flagging them.
- **Whether same-named dimensions are one.** `mergeDimensions: 'by-name'` when the tool's views
  share their dimensions (Cube), `'never'` when each group's dimension is its own (dbt's semantic
  models): Heed then proposes each as a term of its own (CON-201).
- **Least access and hosts.** The access lines an administrator reads before giving anything, and
  every host you reach.

## Steps

1. **Copy the template.** `cp -R src/connectors/_template src/connectors/<id>`.
2. **Fill in the manifest** (`manifest.ts`). Each field has a one-line comment saying what goes
   there; change every value. Word every warning code you send. `checkManifest` names every
   problem, and the server does not start with one.
3. **Write the mapping** (`mapping.ts`): a pure function from the tool's format to definitions
   and warnings, with no Git, no folder and no clock. Check the input at its edge with
   `zod/mini`, and use the helpers of `src/domain/definition-helpers.ts` for synonyms,
   descriptions, domains and marks. Follow the [mapping rules](#mapping-rules).
4. **Write the runtime** (`runtime.ts`) around it: `check` reaches the input and says what it
   found, step by step, in your tool's words; `read` gets the input (`ctx.git` or `ctx.folder`),
   maps it, yields the warnings first, then the definitions, then `end`. Throw a `SourceError`
   for a failure. `ctx.fetch` throws a `SourceError` itself for a host it refuses or cannot reach
   and for an answer over its cap: only an answer's status is yours to turn into one. Use only what
   the context hands you: lint refuses `fetch`, `process`, files and the rest
   ([rules for connector code](security.md#rules-for-connector-code)). If the input
   needs a parser or compiler you would not run in the server, hand it to a `worker.ts`
   (`ctx.worker`, T1); Cube's compiler is the example.
5. **Record the fixture** in `tests/fixtures/<id>/`: the tool's input, invented, with a
   `REBUILD.md` that says how it was made, and the expected `definitions.json` (written by the kit
   with `-u`, step 9). See [fixtures](#fixtures).
6. **List the connector twice**: its manifest in `src/connectors/manifests.ts` (the web app's
   list) and `defineConnector(manifest, runtime)` in `src/connectors/index.ts` (the server's). A
   test fails when a folder is not listed, or when the two lists differ. Two tests name every
   connector and order them as these lists do: add yours to the list in
   `tests/server/connectors/platform.test.ts` (twice) and in `tests/integration/sources.test.ts`.
   Nothing else in the app: the Integrations cell, the connect form and every word on screen come
   from the manifest. A logo is optional: add the tool's to `logos` in `src/web/model/integrations.ts`, keyed by your
   connector's id, or the cell shows the manifest's `icon`. When the tool has a Soon cell in
   `src/web/model/catalogue.ts`, remove it: the manifest replaces it. The lead of its page and the
   name of its domain setting are optional too, in `words` in the same file.
7. **Add a `describeConnector` block** to `tests/server/connectors/conformance.test.ts` with the
   fixture hooks of [the kit](#the-kit). The template's block, at the end of that file, is the
   one to copy.
8. **Write the README**, which holds the manifest's `title` as its heading, with the sections the
   [review checklist](#review-checklist) names and no TODO left: a test refuses a listed
   connector's README otherwise.
9. **Run the checks**: `npx vitest run --project server tests/server/connectors` (add `-u` once to
   write `definitions.json`, then read it; with the README not written yet, the kit's README test
   fails on that first run, and the file is still written), then `npm test`, `npm run typecheck`, `npm run lint`
   and `npm run test:integration`.

## Mapping rules

Every definitions connector follows these. The template does each of them.

- **Refs and groups.** `<prefix>:<group>.<name>`. The same member gives the same ref on every
  read, whatever the order of the input. Send each ref once: when two members of a group can have
  one name, keep one and warn with your own code. A ref never moves to another member.
- **Titles and descriptions.** The tool's label and description as they are, or null. A
  description longer than 500 characters is cut by `descriptionCopy`, and you warn with your own
  `description_cut`, worded at `info`.
- **Domains.** `domainHint(value, config.domainNames)` reads the tool's value through the
  source's domain names. A member's own valid domain wins over its group's. A group whose tool
  names no domain warns `missing_domain`; a value that is not a domain id warns
  `invalid_domain` and gives no hint, so a member with such a value takes its group's domain, if
  any. If the tool copies a group's value onto its members, warn once, on the group.
- **Synonyms.** `synonymsOf` trims them, keeps each once whatever its case, and keeps at most 20.
- **Value types.** The tool's own word, from a list you know. Anything else is null.
- **Records built on records.** Hash an input once and put its digest in what is built on it,
  rather than nesting its meaning: a shared input nested at each use grows without limit, and a
  file an administrator commits must not stall a read. Sort warnings as well as definitions.

**Unknown, not guessed.** Your connector only says what the tool says. When the tool does not
name a domain, the definition has `areaHint: null` and `domainSource: 'none'`, and the read warns
`missing_domain` on the group; an administrator maps it. When the tool names something that is
not a Heed domain id, warn `invalid_domain` and give no hint. When you cannot tell a value type,
send `null`, never a default such as `string`. When a record depends on something the input does
not hold, leave it out, warn with your own code, and end the read with `complete: false`: a
partial read keeps everything Heed already knew, so a broken input never flags an item or loses a
ref. Never invent a group, a domain or a name to fill a gap.

**Marks are meaning.** The change mark is the SHA-256 of what the definition means, built with
`meaningMark`. Put in the calculation (with the meanings of the records it is built from, so a
change underneath flags what sits on top), the type, the title and the description. Leave out the
domain and the synonyms (a change to them informs owners and never flags an item), file paths,
ordering, formatting, and anything that names the environment the tool was built for (a database
or schema). If the tool has two shapes for the same meaning, normalise them before you hash: a
migration in the tool must not flag every item. `meaningMark` leaves out empty values (null,
false, empty text, lists and objects), so an absent key and an empty one hash the same. When you
change how you compute marks, bump `markVersion`. (Cube and the static list pass
`{ keepEmpty: true }`: their marks were first computed that way, and stay as they were.)

**Nothing that is a calculation crosses.** A definition is a closed list of fields and the core
refuses unknown keys, but text fields are yours to fill: never put SQL, a filter or an expression
in `title`, `descriptionCopy`, `valueType` or a warning target. Give the kit every piece of SQL in
your fixture as `calculation`.

**Words on screen come from your manifest.** Every word that names the tool comes from `tool`.
If you find yourself writing your tool's name anywhere outside your folder, stop: that is a core
bug to fix, not a line to add.

## Fixtures

- **Invented only.** No real names, addresses, data, warehouses or credentials. A key the tests
  need is invented when they start, never committed.
- **Rebuildable.** When the input is a tool's output, `REBUILD.md` gives the exact commands and
  versions to make it again, and how environment names were made neutral (a database or schema
  becomes `example_db`, `example_schema`). A hand-written input says so.
- **Planted.** Keep the tool's calculations in the fixture on purpose: they are what the kit
  checks never crosses. A secret the tests use is planted the same way.
- **Every way in.** A connector that reads its input by several routes runs the kit once per
  route (the third argument of `describeConnector` names it), against the same `definitions.json`.
- **Expected.** `definitions.json` is the read of the fixture, definitions and warnings, as the
  kit writes it. It is the connector's golden file: a change to the mapping shows in it, in
  review.
- **No live calls.** The test Git host (`tests/server/connectors/git-server.ts`) serves a
  repository built from the fixture; a fake of an API runs on the machine (`drive-server.ts`), and
  so does an object store that checks each signature (`object-server.ts`).

## The kit

`describeConnector(module, fixture)` (`tests/server/connectors/kit.ts`) runs the conformance kit
(CON-108) through the core, as Integrations and the pipelines do. Its tests switch on by what the
manifest declares and by the hooks the fixture gives:

| Hook            | What the kit proves                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `folder`        | The manifest is valid, its README is there and names its title                                    |
| `good`          | The form takes it, the check passes, refs are prefixed and once, marks are stable                 |
| `refused`       | A secret the tool refuses is for an administrator to fix                                          |
| `unreachable`   | A host that cannot be reached fails, and says so                                                  |
| `invalid`       | Each setting the form must refuse is refused on its field                                         |
| `serverFolder`  | A folder on the machine holding the good input: the read through it gives the same refs and marks |
| `partial`       | Input with a record it cannot read gives a partial read with a warning                            |
| `calculation`   | None of these strings (every planted calculation) is in any definition or warning                 |
| `expected`      | The read of `good` gives exactly the definitions and warnings of `definitions.json`               |
| `reformat`      | The same meaning in another form (order, layout, environment) gives the same refs and marks       |
| `meaningChange` | One changed calculation moves exactly the refs you name: it and what is built on it               |
| `wrongFormat`   | Input of another format is refused by the form, or fails with a worded `config` or `source` code  |
| `planted`       | The secret is in no check, record or warning                                                      |

For every definitions connector, whatever the hooks, every name has a group, a definition without
a hint says `none`, one with a hint says `source` or `override`, and every warning code is worded.

Reading a failure: the test's name says the rule, and the assertion names the ref or code that
broke it. A mark that moves under `reformat` means the mark hashes form, not meaning. Too many refs
under `meaningChange` means an input's label or description is in the marks built on it; too few
means an input's calculation is not.

## Common mistakes

- Naming a member without a dot. It is in no group, and Integrations will not list it.
- Hashing the tool's raw payload. Every formatting change, environment change or tool migration
  then flags items.
- Taking a domain from a key the tool drops in its output.
- Putting a guessed value type such as `string` on a dimension the tool calls only
  `categorical`.
- Treating a measure, an entity or a join key as a definition.
- Reading a file over the Git cap (2 MB a file) and failing silently: it is `unreadable_file`.
- Fetching a file with no `maxBytes`: the core's cap of 20 MB is for APIs, not for one file.
- Putting a signed link in a setting, or its path in a warning's target. Settings go in the
  history log.
- Giving a `visibleIf` field a `required` with no thought for stored sources: a source saved
  before the field came has no value for it, and a migration has to give it one.
- Committing a fixture built against a real warehouse or with real names.
- Writing a test that calls the tool's live API.
- Adding the tool's name to web copy.

## Review checklist

- [ ] Copied from `_template/`; the folder is listed twice; `describeConnector` has `good`,
      `refused`, `unreachable`, `invalid`, `partial`, `calculation` (every planted
      calculation), `planted`, `expected`, `reformat`, `meaningChange` and `wrongFormat`, and
      `serverFolder` when the manifest declares it.
- [ ] `mapping.ts` is pure, and `definitions.json` reads right.
- [ ] The fixture is invented, `REBUILD.md` rebuilds it, and environment names are neutral.
- [ ] Every warning code is worded in the manifest, and no screen word outside the folder names
      the tool.
- [ ] The access lines say the least access, and egress names every host.
- [ ] The README has its sections: what it reads, setup in the tool, settings, warnings, limits,
      and what its marks see.
- [ ] No vendor name added to `src/server`, `src/web` or `src/domain`.

## Worked example

The template (`src/connectors/_template/`, with `tests/fixtures/template/`) is the worked example
for an invented tool: its metrics file read from Git, every mapping rule above, and every kit
hook. [dbt MetricFlow](../../src/connectors/dbt-metricflow/README.md), built by following this
guide, is the worked example for a real tool: a pure mapping of a tool's built artifact with two
shapes for one meaning (`mapping.ts`), `tests/fixtures/dbt-metricflow/` with its `REBUILD.md`, its
kit block, and `tests/server/connectors/dbt-metricflow.test.ts` for its own mapping tests.

## Publishing as a package

Not yet: connectors are built in only. Loading them from packages is designed and waits on the
licence ([Connectors as packages](packaging.md)).
