---
title: The Cube connector
line: Reading definitions from Cube model files, in a Git repository or a folder on the server.
group: Connectors
order: 2
reviewed: 2026-11-05
---

Read metrics and dimensions from Cube model files, in a Git repository or a folder on the server. A read needs no running Cube server, no database and no warehouse access, and it never stores SQL or a calculation.

## What your model needs

1. A folder of **YAML** model files. JavaScript, Python and Jinja templates are skipped, and a symbolic link is never followed.
2. It compiles with Cube **1.7.39**, the version the connector is pinned to.
3. At least one **public view** or public cube. Only public members are listed.

Recommended in the model:

| Key             | Where              | What it does                                                                  |
| --------------- | ------------------ | ----------------------------------------------------------------------------- |
| `title`         | Each public member | Its name on screen                                                            |
| `description`   | Each public member | What it means                                                                 |
| `meta.domain`   | Each view          | Its domain, exactly as a domain id. A member's own `meta.domain` overrides it |
| `meta.synonyms` | A member           | A list of other names people use, such as `[geo, market]`, each for one term  |

## Connect a model in Git

An admin adds it in Settings, Integrations:

| Field                   | What it is                                                                       |
| ----------------------- | -------------------------------------------------------------------------------- |
| Repository              | The https address of the repository, without credentials                         |
| Branch, tag or commit   | What is read. A tag or a commit holds still, and a branch moves with each change |
| Model folder            | The folder of model files in the repository. Empty for the top                   |
| Read-only token         | Kept in the secret store. Empty for a public repository                          |
| User name for the token | Sent with the token, `x-access-token` when empty. Most hosts accept any          |
| Model folder address    | The folder in the host's web view, for links to each model file                  |
| Domain names            | Each `meta.domain` value and the domain it means, when the two differ            |

**Test connection** reaches the repository, counts the model files, then reads the model once and keeps nothing.

Each read fetches one commit and removes it afterwards. See [how Git is reached](security.md#git).

A domain name applies before a domain is checked. With the line `paid_media → area_paid_media`, a view whose `meta.domain` is `paid_media` has the domain `area_paid_media`. A name without a line stays as the model says it.

## Read a model on the server

Whoever runs the service sets these, and Integrations shows them read only:

| Setting                 | What it does                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `CUBE_MODEL_DIR`        | The folder to read. Unset, the service reads two invented definitions                         |
| `HEED_DOMAIN_OVERRIDES` | A JSON file outside the model folder: view to domain, for views the model names no domain for |
| `CUBE_RENAMES_FILE`     | A JSON file of renamed members, old id to new id                                              |

To read a folder now, without changing it:

```sh
CUBE_MODEL_DIR=/path/to/cube/model npm run connectors:sync
```

The command reads `.env.local`, prints what it found and flagged, and exits with 1 on a failed read.

### Domain overrides

```json
{ "sales_analytics": "finance", "campaign_analytics": "paid_media" }
```

Keys are exact public view or cube names. A valid `meta.domain` in the model wins over this file. A value that is not a domain id is reported, and a domain is never created.

### Renames

```json
{ "cube:growth_analytics.revenue": "cube:expansion_analytics.revenue" }
```

A rename is used only when the old member is gone and the new one is there. Any other entry is reported. Items that rely on the old member are flagged, with the new id named.

## Links to model files

Set the model folder's address to link each view to its file. On the Cube source's page, set **Model folder address**, for example:

```text
https://github.com/acme/analytics/blob/main/model
```

The service never calls the Git host: it only builds the address. Moving a member to another file flags nothing.

## Limits

| Limit                     | Value                                                |
| ------------------------- | ---------------------------------------------------- |
| One file                  | 2 MB                                                 |
| All the files             | 20 MB                                                |
| Files in the model folder | 1,000                                                |
| Compile time              | 120 seconds, set with `CUBE_COMPILE_TIMEOUT_SECONDS` |
| Compile memory            | 1,024 MB, set with `CUBE_COMPILE_MEMORY_MB`          |

A model of 10,000 members takes about 45 seconds. An empty or unreadable model folder fails the read rather than removing definitions.

## Warnings

| Code               | What it means                             |
| ------------------ | ----------------------------------------- |
| `missing_domain`   | A public view or cube names no domain     |
| `invalid_domain`   | A domain is not a domain id               |
| `invalid_rename`   | A rename does not apply                   |
| `unsupported_file` | A file is not YAML                        |
| `unreadable_file`  | A link, a file over the limit or not text |
| `folder_missing`   | The model folder is not there             |
| `too_many_records` | The folder holds too many files           |

## Figures in Ask

Off by default. With it on, Ask shows one figure read from Cube, and keeps it nowhere. No MCP server is needed.

1. On Cube's page in Integrations, press **Set up figures**. Give the address of Cube's REST API, such as `https://cube.example.com/cubejs-api/v1/load`, and a read-only token. The token is sent only to that address's origin.
2. Press **Try a figure**. It reads one measure for the last 7 days with the settings as saved, and says what came back.
3. Name a **Data contact**.
4. Switch on **Show figures in Ask**.

The figure comes from the integration that defines the metric, and the query is a fixed template, never words a person or a model wrote. There is no figure when more than one integration defines the metric, or when its view has no time dimension.

### Which date

A view with one time dimension reads its figures by it. A view with several reads them by the one the model names, in this order:

1. `meta.default_time_dimension` on the measure.
2. `meta.default_time_dimension` on its view.
3. The server's figure settings, below.

The name is the view's own (`invoice_day`) or in full (`sales.invoice_day`). A name the view does not have is skipped. When nothing names one, Ask shows no figure, lists the view's dates and asks which one figures use: the date is never guessed. The query in words says the date used, such as "by invoice day".

```yaml
views:
  - name: sales
    meta:
      default_time_dimension: invoice_day
```

### Figure settings on the server

For a model you cannot change, whoever runs the service sets `HEED_FIGURE_OVERRIDES` to a JSON file. It is by integration id, then by view or measure. A measure's own setting wins over its view's, and the model wins over both:

```json
{ "cube": { "sales": { "date": "invoice_day" } } }
```

| Setting | What it does                            |
| ------- | --------------------------------------- |
| `date`  | The date the days apply to, by its name |

The file is read when the service starts. A file that is not JSON, or holds a setting not in this table, stops the start.

The value is written as the model says: `format: currency` with `meta.currency` for money, and `format: percent` for a share. "Data as of" is Cube's `lastRefreshTime`.

No person's identity is passed to Cube. A refused token, a host that cannot be reached and a slow query each say so in Ask, within 4 seconds.
