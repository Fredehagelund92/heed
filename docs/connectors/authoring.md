---
title: Build a connector
line: Add a connector for your tool, by hand or with a coding agent, from the template to a passing kit.
group: Connectors
order: 4
reviewed: 2026-11-05
---

Add a connector for a tool you use. Follow this page from top to bottom, or hand it to a coding agent. A definitions connector needs no change to the app: only its folder, two list lines and a test fixture.

A connector is a **manifest** (data) and a **runtime** (code) in a folder of its own. A **definitions** connector says which metrics and dimensions exist. A **content** connector reads documents that become suggestions. This page covers definitions; content connectors follow the same steps, with [Markdown in Git](../../src/connectors/git-markdown/README.md) as their example.

## Hand it to a coding agent

Paste this into your agent, in a clone of the repository:

```text title="A prompt for your coding agent"
Build a definitions connector for <tool> in this repository.

Find the documentation page called Build a connector and follow it from top to bottom. Copy the template, do not invent. Use invented fixtures only, and make no live calls to the tool in a test. Change nothing outside the places the page names. Say which checks you ran, and show me what failed.
```

## The contract in one screen

- [ ] **Definitions stay canonical.** A definition is the closed list of fields below. Never a calculation, a query or a data row.
- [ ] **Definitions only flag.** A change you report flags the items that rely on it, and a failed read changes nothing.
- [ ] **Secrets stay in the store.** They reach your runtime only, toward the settings they were given for. Never log or return one.
- [ ] **Domains are explicit.** You pass the domain the tool names, and an admin maps the rest. A hint never creates a domain.
- [ ] **Read only.** Reach declared hosts only, and say the least access you need first.
- [ ] **Your output is untrusted.** Every message is checked, and unknown keys are refused.
- [ ] **No vendor in the core.** Your tool's name lives in your folder, nowhere else.

A definition has these fields ([the schema](../../src/domain/connector-runtime.ts)):

| Field             | What you put there                                                            |
| ----------------- | ----------------------------------------------------------------------------- |
| `ref`             | `<refPrefix>:<group>.<name>`, stable for good. The prefix belongs to the tool |
| `kind`            | `metric` or `dimension`                                                       |
| `name`            | `<group>.<name>`, the ref without its prefix                                  |
| `title`           | The tool's label, or null                                                     |
| `descriptionCopy` | `descriptionCopy(text).copy`: the first 500 characters, or null               |
| `valueType`       | The tool's own word for the type, or null when it says none                   |
| `visibleGroups`   | Always null                                                                   |
| `areaHint`        | The domain id the tool names, from `domainHint`, or null                      |
| `domainSource`    | `source` with a hint, `none` without one                                      |
| `modelFile`       | The file that defines it, relative to the folder you read, or null            |
| `synonyms`        | `synonymsOf(value)`: the other names the tool lists                           |
| `baseName`        | The member's own name when the tool joins it under a prefix, or leave it out  |
| `changeMark`      | `meaningMark(meaning)`: the SHA-256 of what it means                          |

A read yields three kinds of message:

- `warning`, with a code and a target;
- `definition`, one for each definition;
- `end`, once, with a `version`, whether it is `complete`, and a `cursor`.

A failure throws a `SourceError` with a code, a target and a class:

| Class       | Who fixes it                    | Example         |
| ----------- | ------------------------------- | --------------- |
| `config`    | An admin                        | A refused token |
| `transient` | Nobody: it is tried again later | A timeout       |
| `source`    | Whoever owns the tool's content | A broken model  |

A code is one of [the service's own](../../src/contract/operations.ts), or yours, worded in the manifest and sent as `<id>.<code>`.

## Decide before you write

- **Id, tool word and ref prefix.** The id is your folder's name and stays for good. `tool` is how people say the tool. The ref prefix is the tool's, for good: a second connector for the same tool writes the same prefix.
- **Where the input comes from.** A file in a Git repository (`ctx.git`), a folder on the server (`ctx.folder`), or an https address or API (`ctx.fetch`).
- **What to read.** Prefer the tool's own built output to its source files, and never run the tool. A built file usually lives where a pipeline uploads it, so offer object storage first.
- **Which routes to offer.** [dbt MetricFlow](../../src/connectors/dbt-metricflow/README.md) reads one file from an address, an object store, Git or a server folder, with one `radio` field and `visibleIf` on the rest.
- **What may read it unchanged.** A file read over https may have an ETag or a date. Send them back, and end with `unchanged: true` on a `304`, and the last read is kept. Put your mapping's version in the cursor.
- **Whether an address is a secret.** A signed link is a credential. Keep it in a secret slot and declare its host with `{ fromSecret: <slot> }`. Name only its host in a step.
- **Whether it can read a folder on the server.** If `read` works from `ctx.folder` with no settings, declare `capabilities.serverFolder: true`. Leave it out for an API or a live service.
- **What a group is.** The part of a name before the last dot. Admins map each group to a domain, and a name without a dot cannot be listed.
- **What is left out.** Join keys, inputs people never query, hidden members and saved queries.
- **Whether same-named dimensions are one.** `mergeDimensions: 'by-name'` when views share their dimensions, as in Cube. `'never'` when each group's is its own, as in dbt.
- **Least access and hosts.** The access lines an admin reads before giving anything, and every host you reach.

## Steps

1. **Copy the template.** Copy the [template folder](../../src/connectors/_template/README.md) to a new folder beside it, named after your id. It is a working connector that passes the kit, and each step below changes it into yours.
2. **Fill in the [manifest](../../src/connectors/_template/manifest.ts).** Each field has a comment saying what goes there. Change every value, and word every warning code you send. The service does not start with a bad manifest, and the error names each problem.
3. **Write the [mapping](../../src/connectors/_template/mapping.ts).** It is a pure function from the tool's format to definitions and warnings, with no Git, no folder and no clock. Check the input at its edge with `zod/mini`, use [the shared helpers](../../src/domain/definition-helpers.ts), and follow the [mapping rules](#mapping-rules).
4. **Write the [runtime](../../src/connectors/_template/runtime.ts) around it.** `check` reaches the input and says what it found, step by step, in your tool's words. `read` gets the input, maps it, and yields the warnings, then the definitions, then `end`.
5. **Handle failures.** Throw a `SourceError`. `ctx.fetch` throws one itself for a host it refuses or cannot reach, and for an answer over its cap: only a status is yours to turn into one.
6. **Use only what the context hands you.** Lint refuses `fetch`, `process`, files and the rest: see [the rules for connector code](security.md#rules-for-connector-code). A parser you would not run in the service goes in a worker, `ctx.worker`, as [Cube's compiler](../../src/connectors/cube/worker.ts) does.
7. **Record the [fixture](#fixtures)** in a folder of your id under [the test fixtures](../../tests/fixtures).
8. **List the connector twice.** Add its manifest to [the web app's list](../../src/connectors/manifests.ts), and `defineConnector(manifest, runtime)` to [the service's list](../../src/connectors/index.ts). A test fails when a folder is not listed, or when the two lists differ.
9. **Name it in two tests.** Add it to the lists in [the platform test](../../tests/server/connectors/platform.test.ts), twice, and in [the sources test](../../tests/integration/sources.test.ts).
10. **Add a `describeConnector` block** to [the conformance test](../../tests/server/connectors/conformance.test.ts), with the hooks of [the kit](#the-kit). Copy the template's block, at the end of that file.
11. **Write the README**, with the manifest's `title` as its heading, the sections the [review checklist](#review-checklist) names and no TODO left. A test refuses a listed connector's README otherwise.
12. **Run the checks.**

    ```sh
    npx vitest run --project server connectors -u   # once, to write the expected file; then read it
    npx vitest run --project server connectors
    npm test
    npm run typecheck
    npm run lint
    npm run test:integration
    ```

    With the README not written yet, the kit's README test fails on the first run, and the file is still written.

Nothing else in the app changes: the Integrations cell, the connect form and every word on screen come from the manifest.

Three small things are optional:

- A logo: add the tool's to `logos` in [the integrations model](../../src/web/model/integrations.ts), keyed by your id. Without one, the cell shows the manifest's `icon`.
- A Soon cell: if [the catalogue](../../src/web/model/catalogue.ts) shows your tool as Soon, remove it, as the manifest replaces it.
- Words: the lead of its page and the name of its domain setting go in `words`, in the same file.

## Mapping rules

Every definitions connector follows these, and the template does each of them.

- **Refs and groups.** The same member gives the same ref on every read, whatever the order of the input. Send each ref once. When two members of a group can have one name, keep one and warn with your own code. A ref never moves to another member.
- **Titles and descriptions.** The tool's label and description as they are, or null. `descriptionCopy` cuts a long description, and you warn with your own `description_cut`, worded at `info`.
- **Domains.** `domainHint(value, config.domainNames)` reads the tool's value through the source's domain names. A member's own valid domain wins over its group's.
- **Domain warnings.** A group that names no domain warns `missing_domain`. A value that is not a domain id warns `invalid_domain` and gives no hint. If the tool copies a group's value onto its members, warn once, on the group.
- **Synonyms.** `synonymsOf` trims them, keeps each once whatever its case, and keeps at most 20.
- **Value types.** The tool's own word, from a list you know. Anything else is null.
- **Records built on records.** Hash an input once and put its digest in what is built on it. Sort warnings as well as definitions.

### Unknown, not guessed

Your connector only says what the tool says. Never invent a group, a domain or a name to fill a gap.

| When                                     | Do                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------- |
| The tool names no domain                 | `areaHint: null`, `domainSource: 'none'`, and warn `missing_domain`   |
| It names something that is not a domain  | Warn `invalid_domain`, and give no hint                               |
| You cannot tell a value type             | Send `null`, never a default such as `string`                         |
| A record depends on what the input lacks | Leave it out, warn with your own code, and end with `complete: false` |

A partial read keeps everything already known, so a broken input never flags an item or loses a ref.

### Marks are meaning

The change mark is the SHA-256 of what the definition means, built with `meaningMark`.

| Put in                                                  | Leave out                                               |
| ------------------------------------------------------- | ------------------------------------------------------- |
| The calculation, with the meanings of what it builds on | The domain and the synonyms                             |
| The type                                                | File paths, ordering and formatting                     |
| The title and the description                           | Anything that names the environment, such as a database |

If the tool has two shapes for one meaning, normalise them before you hash: a migration in the tool must not flag every item.

`meaningMark` leaves out empty values, so an absent key and an empty one hash the same. When you change how you compute marks, bump `markVersion`.

### Nothing that is a calculation crosses

A definition is a closed list of fields, but text fields are yours to fill. Never put SQL, a filter or an expression in `title`, `descriptionCopy`, `valueType` or a warning target. Give the kit every piece of SQL in your fixture as `calculation`.

### Words on screen come from your manifest

Every word that names the tool comes from `tool`. If you find yourself writing the tool's name outside your folder, stop: that is a bug in the core to fix, not a line to add.

## Fixtures

- **Invented only.** No real names, addresses, data, warehouses or credentials. A key the tests need is invented when they start.
- **Rebuildable.** When the input is a tool's output, `REBUILD.md` gives the exact commands and versions, and how environment names were made neutral. A hand-written input says so.
- **Planted.** Keep the tool's calculations in the fixture on purpose: they are what the kit checks never crosses. A secret the tests use is planted the same way.
- **Every way in.** A connector that reads its input by several routes runs the kit once per route, against the same `definitions.json`.
- **Expected.** `definitions.json` is the read of the fixture, as the kit writes it. A change to the mapping shows in it, in review.
- **No live calls.** A test Git host serves a repository built from the fixture, and a fake of an API runs on the same computer.

## The kit

`describeConnector` runs the [conformance kit](../../tests/server/connectors/kit.ts) through the service, as Integrations does. Its tests switch on by what the manifest declares and the hooks you give:

| Hook            | What the kit proves                                                                  |
| --------------- | ------------------------------------------------------------------------------------ |
| `folder`        | The manifest is valid, and its README is there and names its title                   |
| `good`          | The form takes it, the check passes, refs are prefixed and once, marks are stable    |
| `refused`       | A secret the tool refuses is for an admin to fix                                     |
| `unreachable`   | A host that cannot be reached fails, and says so                                     |
| `invalid`       | Each setting the form must refuse is refused on its field                            |
| `serverFolder`  | A folder holding the good input gives the same refs and marks                        |
| `partial`       | Input with a record it cannot read gives a partial read with a warning               |
| `calculation`   | None of these strings is in any definition or warning                                |
| `expected`      | The read of `good` gives exactly `definitions.json`                                  |
| `reformat`      | The same meaning in another form gives the same refs and marks                       |
| `meaningChange` | One changed calculation moves exactly the refs you name                              |
| `wrongFormat`   | Input of another format is refused, or fails with a worded `config` or `source` code |
| `planted`       | The secret is in no check, record or warning                                         |

To read a failure, the test's name says the rule, and the assertion names the ref or code that broke it.

- A mark that moves under `reformat` means the mark hashes form, not meaning.
- Too many refs under `meaningChange` means an input's label or description is in the marks built on it.
- Too few means an input's calculation is not.

## Common mistakes

- Naming a member without a dot.
- Hashing the tool's raw payload, so that every formatting change flags items.
- Taking a domain from a key the tool drops in its output.
- Putting a guessed value type such as `string` on a dimension the tool calls only `categorical`.
- Treating a measure, an entity or a join key as a definition.
- Reading a file over the Git cap of 2 MB and failing silently: it is `unreadable_file`.
- Fetching a file with no `maxBytes`: the cap of 20 MB is for APIs, not for one file.
- Putting a signed link in a setting, or its path in a warning's target. Settings go in the history log.
- Giving a `visibleIf` field a `required` with no thought for stored sources, which have no value for it.
- Committing a fixture built against a real warehouse or with real names.
- Writing a test that calls the tool's live API.
- Adding the tool's name to web copy.

## Review checklist

- [ ] Copied from the template, the folder is listed twice, and `describeConnector` has every hook above. `serverFolder` is there when the manifest declares it.
- [ ] The mapping is pure, and `definitions.json` reads right.
- [ ] The fixture is invented, `REBUILD.md` rebuilds it, and environment names are neutral.
- [ ] Every warning code is worded in the manifest, and no screen word outside the folder names the tool.
- [ ] The access lines say the least access, and egress names every host.
- [ ] The README has its sections: what it reads, setup in the tool, settings, warnings, limits, and what its marks see.
- [ ] No vendor name was added to the service, the web app or the domain code.

## Worked examples

- **The template** reads an invented tool's metrics file from Git, with every mapping rule and every kit hook.
- **[dbt MetricFlow](../../src/connectors/dbt-metricflow/README.md)**, built by following this guide, is the example for a real tool: a pure mapping of a built file with two shapes for one meaning, its fixture and its own tests.

For the full contract, see [the connector contract](../contributing/connector-contract.md). Connectors are built in only for now: [packages](packaging.md) are a design, not built.
