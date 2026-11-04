# dbt MetricFlow definitions

The definitions connector for a dbt project's semantic layer
([how a connector is built](../../../docs/connectors/authoring.md)). It reads one file dbt writes,
`semantic_manifest.json`, from wherever your pipeline puts it, and gives Heed each metric and
dimension under `dbt:`. It takes the definitions only. It never runs dbt or reads the project's
YAML, and never reaches dbt Cloud, a warehouse or data. It keeps no calculation and no value, and
has no figures. A read only flags the items that rely on a definition that changed or left: it
never changes an item and never publishes (I-2).

## Setting it up

`dbt parse` writes `target/semantic_manifest.json`. It needs an adapter installed, but reaches no
warehouse. Most projects ignore `target/`, so your pipeline puts the file somewhere Heed can read
it. Step 2 of connecting asks where, and each place shows its own recipe:

| Place          | What you give                                          | Best for                                                                                  |
| -------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Address        | An https link, kept as a secret                        | A public file, a signed link, an internal artifact server                                 |
| Object storage | The object's address and a read-only key               | A pipeline that uploads to S3, an S3-compatible store, Google Cloud Storage or Azure Blob |
| Git repository | A repository, a branch and a read-only token           | A project that commits the file                                                           |
| Server folder  | Nothing here: whoever runs the server names the folder | A pipeline that drops the file on the machine that runs Heed                              |

**An address.** Upload the file and make a link to it. A link is read as it is, with no key added,
so it holds whatever it needs. A signed link is as good as a key: it goes in the secret store, is
shown only as set, and a failure names its host and never its path or signature. Links signed by S3
or Google Cloud Storage last 7 days at most, so a source that lasts needs Object storage, or a link
that does not expire. Test connection says when a link stops working, and warns in its last 14
days. An artifact server on a private network has to be allowed by name by whoever runs the
server (`HEED_EGRESS_PRIVATE_HOSTS`, [Operations](../../../docs/operations.md)).

**Object storage.** Upload the file, then give the object's https address and a key that can read
that object and nothing else.

```yaml
# A step of your CI, after dbt parse. Use your project's adapter in place of dbt-duckdb.
- run: pip install dbt-core dbt-duckdb
- run: dbt parse --profiles-dir .
- run: aws s3 cp target/semantic_manifest.json s3://your-bucket/dbt/semantic_manifest.json
```

| Service              | File address                                                   | Credential                                                                                  |
| -------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Amazon S3            | `https://your-bucket.s3.eu-west-1.amazonaws.com/dbt/file.json` | An access key whose policy allows only `s3:GetObject` on that object                        |
| S3-compatible store  | `https://storage.example.com/your-bucket/dbt/file.json`        | A key that reads that object. Region: the one it signs for, or empty                        |
| Google Cloud Storage | `https://storage.googleapis.com/your-bucket/dbt/file.json`     | An HMAC key of a service account with only Storage Object Viewer on that bucket             |
| Azure Blob Storage   | `https://youraccount.blob.core.windows.net/dbt/file.json`      | A shared access signature with read permission only (`sp=r`). One that may write is refused |

All but Azure sign each request with Signature Version 4 (`object-storage.ts`): the key stays in the
secret store and the signature goes to that address alone. Google Cloud Storage takes the same
signature from an HMAC key at its S3-compatible address. Azure Blob has no such API: a shared access
signature is the read-only credential it offers, as an account key can do everything. Heed can see
what a shared access signature may do, and cannot see what an S3 key may do, so least access there
is yours to set.

**A Git repository.** In CI, on each change to the project, commit the file to a folder of the
repository or to a branch of its own:

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

Your Git host's CI may need a token of its own to push. Then make a token that can read this
repository and nothing else, and add the source in Integrations, with Folder `semantic`.

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

| Field                   | What it is                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Where the file lives    | Address, Object storage, Git repository, or Server folder, which is set where the server runs. The rest follows it.   |
| File address (secret)   | Address: the https address of the file. Kept in the secret store, never in the settings.                              |
| Storage service         | Object storage: Amazon S3, an S3-compatible store, Google Cloud Storage or Azure Blob Storage.                        |
| File address            | Object storage: the object's https address, with no signature or query.                                               |
| Region                  | An S3-compatible store: the region it signs for. Empty means `us-east-1`. S3's address names its own.                 |
| Access key, Secret key  | S3, S3-compatible stores and Google Cloud Storage: a read-only key, kept in the secret store.                         |
| Shared access signature | Azure Blob Storage: read permission only, kept in the secret store.                                                   |
| Repository              | The https address of the Git repository that holds the file.                                                          |
| Branch, tag or commit   | Where the file is read. The branch your CI commits it to; `main` to start with.                                       |
| Folder                  | The folder that holds the file; empty for the top.                                                                    |
| File                    | The file in that folder, `semantic_manifest.json` by default.                                                         |
| User name               | The user name sent with the token, for hosts that ask for one.                                                        |
| Domain names            | The domain each `meta.domain` value means, when it is not a domain id (`Customer Care` to `customer_care`).           |
| Read-only token         | A secret, kept in the server's secret store and sent only to the repository's address. Empty for a public repository. |

## What a read does

1. Takes the one file. From an address or an object store, one GET through `ctx.fetch`
   ([security](../../../docs/connectors/security.md#http-interface-3)), with the ETag and date of
   the last read: when the store says the file has not changed, nothing is read and Heed keeps what
   it knows. From Git, the one commit the ref names, read only, through `ctx.git`
   ([security](../../../docs/connectors/security.md#git)). Or the server's folder (`ctx.folder`).
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
   `meta.synonyms` and a domain, then ends with the commit as its version and its cursor (for the
   other places, a digest of the file, and for an address or an object the file's marks as its
   cursor). Every read that takes the file is a full listing. A change to the source's settings,
   or a new version of this connector, reads the file again whatever the store says of it.

**Domains.** A definition's own valid `meta.domain` wins. A dimension otherwise takes its semantic
model's, as a metric does; a `_shared` metric takes the one domain all its semantic models agree
on, or none. A missing domain is never guessed: an administrator maps it.

**What a mark sees.** The calculation, with the calculations of the metrics and measures it is
built from, the type, the label and the description. A metric's mark moves when anything it is
built on is worked out differently, and never for an input's label. It never sees the domain, the
other names, or the database and schema the project was built for. The same meaning gives the same
mark under both YAML specs. The two fixture projects were written by hand: `dbt-autofix` itself has
not been run on them. `modelFile` is null: the file does not say where a definition was written.

**Moving between places.** A source moves between Address, Object storage and Git in Change
settings, keeping its refs. The secrets of the place it leaves are forgotten, and the new place
needs its own. Moving a project from a server folder to a source added in Integrations is not
supported yet: a server source that is taken out of the configuration keeps its refs, so one added
later cannot take them.

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
| `dbt-metricflow.not_read_only`           | The read fails: a shared access signature may do more than read. Make one with `sp=r`.                                                       |

A file over the cap, compressed or not UTF-8 fails with `unreadable_file`, and one that is not there
with `not_found`. A refused key or an expired link is `unauthorized`; S3 also says this for a file
that is not there, to a key that may not list the bucket. A redirect to another host, or more than
three, is `redirect_refused`, and a host that is not public `private_address`.

## Schedule and limits

Read every hour by default, at most every 15 minutes, out of date after 6 hours. A read takes at
most 90 seconds and 100,000 definitions. The file is at most 2 MB (2,000,000 bytes) wherever it
lives, the largest file a Git read hands over: about 2,400 definitions at the size dbt writes
them. An address or an object over it is refused by the length the host says, or as soon as that
much has arrived. A metric moved to another semantic
model gets a new ref. dbt's own query names (`customer__region`) are not read as names.

The fixture was built with dbt Core 1.12.6 and MetricFlow 0.213.0. dbt v2 (Fusion) has not been
tried.

## Tests

The conformance kit runs against it three times in `tests/server/connectors/conformance.test.ts`,
through Git and a server folder, an address and object storage, with the invented shop in
`tests/fixtures/dbt-metricflow/` (both YAML specs, and `REBUILD.md`).
`tests/server/connectors/dbt-metricflow.test.ts` checks the mapping on both specs, and
`dbt-metricflow-remote.test.ts` the address and storage routes and the rules of `ctx.fetch` against
an object store on the machine (`object-server.ts`), which checks each signature with code of its
own. `tests/integration/dbt-sources.test.ts` takes a source through the API and the definitions
pipeline, and proves a read never publishes; `dbt-remote-sources.test.ts` does so for a signed link
and a key, and proves they stay in the secret store. `tests/integration/server-folders.test.ts`
reads the file from a folder on the server. The signing has been checked against the real `aws`
command and the fake store, and not against a live S3, Google Cloud Storage or Azure account.
