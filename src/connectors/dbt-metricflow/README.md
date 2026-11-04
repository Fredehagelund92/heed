# dbt MetricFlow definitions in a Git repository

The definitions connector for a dbt project's semantic layer
([how a connector is built](../../../docs/connectors/authoring.md)). It reads one file dbt writes,
`semantic_manifest.json`, from a Git repository at a set branch, tag or commit, or from a folder on
the server, and gives Heed each metric and dimension under `dbt:`. It takes
the definitions only. It never runs dbt or reads the project's YAML, and never reaches dbt Cloud, a
warehouse or data. It keeps no calculation and no value, and has no figures. A read only flags the
items that rely on a definition that changed or left: it never changes an item and never publishes
(I-2).

## Setting it up

Most dbt projects ignore `target/`, so the file has to be put where Heed can read it. `dbt parse`
writes it and needs an adapter installed, but reaches no warehouse. In CI, on each change to the
project, commit it to a folder of the repository or to a branch of its own:

```yaml
# A step of your CI, on the branch that holds the project.
- run: pip install dbt-core dbt-duckdb
- run: dbt parse --profiles-dir .
- run: |
    mkdir -p semantic
    cp target/semantic_manifest.json semantic/semantic_manifest.json
    git add semantic/semantic_manifest.json
    git diff --cached --quiet || git commit -m "Update the semantic manifest"
    git push
```

Use the adapter your project uses, in place of `dbt-duckdb`. Your Git host's CI may need a token of
its own to push. Then make a token that can read this repository and nothing else, and add the
source in Integrations, with Folder `semantic`.

**Where `meta` goes.** The domain and the other names come from `config.meta`, and the place
depends on your YAML spec. dbt drops them anywhere else, without saying so, and every view then
shows no domain.

| What              | Legacy spec                            | Latest spec                                  |
| ----------------- | -------------------------------------- | -------------------------------------------- |
| A model's domain  | `semantic_models[].config.meta.domain` | `models[].semantic_model.config.meta.domain` |
| A dimension's own | `dimensions[].config.meta`             | `columns[].dimension.config.meta`            |
| A metric's own    | `metrics[].config.meta`                | `metrics[].config.meta`                      |
| Not read: dropped |                                        | `models[].config.meta`                       |

```yaml
# Latest spec: on the semantic model, not on the model.
models:
  - name: orders
    semantic_model:
      enabled: true
      config:
        meta:
          domain: sales
```

```yaml
# Either spec: other names, and a domain of its own, on a metric.
config:
  meta:
    domain: sales
    synonyms: ['purchases', 'order count']
```

**A folder on the server.** When your CI drops the file on the machine that runs Heed, skip the
commit: whoever runs the server names the folder, and the connector reads `semantic_manifest.json`
in it (`ctx.folder`). It is then one of the server's own sources, with no settings, token or Git.
The server's domain map (`HEED_DOMAIN_OVERRIDES`) gives a semantic model with no domain its domain.
[Configuration](../../../docs/operations.md) has the rest.

```sh
HEED_SERVER_FOLDERS='{"dbt-metricflow":"/srv/dbt/target"}'
```

## Settings

| Field                 | What it is                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Repository            | The https address of the Git repository that holds the file.                                                          |
| Branch, tag or commit | Where the file is read. The branch your CI commits it to; `main` to start with.                                       |
| Folder                | The folder that holds the file; empty for the top.                                                                    |
| File                  | The file in that folder, `semantic_manifest.json` by default.                                                         |
| User name             | The user name sent with the token, for hosts that ask for one.                                                        |
| Domain names          | The domain each `meta.domain` value means, when it is not a domain id (`Customer Care` to `customer_care`).           |
| Read-only token       | A secret, kept in the server's secret store and sent only to the repository's address. Empty for a public repository. |

## What a read does

1. Fetches the one commit the ref names, read only, through `ctx.git`
   ([security](../../../docs/connectors/security.md#git)), or takes the server's folder
   (`ctx.folder`), and reads the one file.
2. Maps it, in plain code with no worker:
   - **A semantic model is a group**, which Integrations lists and maps to a domain.
   - **Every dimension is a definition**, `dbt:<semantic model>.<dimension>`, with `categorical` or
     `time` as its type. Dimensions of one name stay apart: `dbt:orders.status` is not
     `dbt:customers.status` (`mergeDimensions: 'never'`, CON-201).
   - **Every metric that is not hidden is a definition**, `dbt:<semantic model>.<metric>`, under the
     one semantic model all its inputs come from, or `dbt:_shared.<metric>` when they span more
     than one. Its type is its aggregation (`sum`, `count`) when it is simple, and otherwise its
     own (`ratio`, `derived`, `cumulative`, `conversion`).
   - **Left out:** measures, entities, saved queries and time spines. They are inputs, join keys
     and plumbing, not what people ask about.
3. Gives each one its label and description (500 characters at most), the other names in
   `meta.synonyms` and a domain, then ends with the commit as its version and its cursor (for
   the server's folder, a digest of the file). Every read is a full listing.

**Domains.** A definition's own valid `meta.domain` wins. A dimension otherwise takes its semantic
model's, as a metric does; a `_shared` metric takes the one domain all its semantic models agree
on, or none. A missing domain is never guessed: an administrator maps it.

**What a mark sees.** The calculation, with the calculations of the metrics and measures it is
built from, the type, the label and the description. A metric's mark moves when anything it is
built on is worked out differently, and never for an input's label. It never sees the domain, the
other names, or the database and schema the project was built for. The same meaning gives the same
mark under both YAML specs, so running `dbt-autofix` flags nothing. `modelFile` is null: the file
does not say where a definition was written.

**Warnings.**

| Warning                                  | What it means, and what to do                                                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `missing_domain`                         | A semantic model, or a `_shared` metric, names no domain. Map it, or set `meta.domain`.                                                      |
| `invalid_domain`                         | A `meta.domain` is not a domain id, so it gives no domain. Add it to Domain names.                                                           |
| `dbt-metricflow.description_cut`         | A description is over 500 characters. Only the first 500 are kept.                                                                           |
| `dbt-metricflow.unknown_type`            | A type this version does not know. The definition is kept with no type, never a guessed one.                                                 |
| `dbt-metricflow.same_name`               | A metric and a dimension of a semantic model share a name. Only the metric is kept. Rename one.                                              |
| `dbt-metricflow.unresolved_metric`       | A metric is built on something the file does not hold. It is left out and the read is in part, so what Heed knew stays. Commit a whole file. |
| `dbt-metricflow.not_a_semantic_manifest` | The read fails: the file is not this one, often `manifest.json`. Point File at the right one.                                                |

A file over the cap fails with `unreadable_file`, and one that is not there with `not_found`.

## Schedule and limits

Read every hour by default, at most every 15 minutes, out of date after 6 hours. A read takes at
most 90 seconds and 100,000 definitions. The file is at most 2 MB, the largest file a Git read
hands over: about 2,400 definitions at the size dbt writes them. A metric moved to another semantic
model gets a new ref. dbt's own query names (`customer__region`) are not read as names.

The fixture was built with dbt Core 1.12.6 and MetricFlow 0.213.0. dbt v2 (Fusion) has not been
tried.

## Tests

The conformance kit runs against it in `tests/server/connectors/conformance.test.ts`, with the
invented shop in `tests/fixtures/dbt-metricflow/` (both YAML specs, and `REBUILD.md`).
`tests/server/connectors/dbt-metricflow.test.ts` checks the mapping on both specs, and
`tests/integration/dbt-sources.test.ts` takes a source through the API and the definitions
pipeline, and proves a read never publishes. `tests/integration/server-folders.test.ts` reads the
file from a folder on the server.
