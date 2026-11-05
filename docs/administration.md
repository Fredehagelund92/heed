---
title: Administer the service
line: Change settings, read the history log, import items, export an edition and use the heed command.
group: Run the service
order: 6
reviewed: 2026-11-05
---

Change settings, read the history log, and move items in and out. Most of this is for admins, through the API under `/api/v1` or the `heed` command. For how to call the API, see the [HTTP API overview](reference/http-api.md).

## Change a setting

`GET /settings` lists the current version of each limit, threshold, retention period, review time and model.

`PUT /settings/{key}` takes the version you read, the new value and a reason. A stale version answers 409, and a value the setting does not accept answers 422.

```json
{
  "version": 3,
  "value": { "person": 600, "ip": 300 },
  "reason": "A busy office behind one address"
}
```

A change applies at once, and the history log keeps it with who made it.

| Setting                          | What it limits                                |
| -------------------------------- | --------------------------------------------- |
| `limits.api_rate_per_minute`     | Requests to the API, by person and by address |
| `limits.mcp_requests_per_minute` | Agent calls, by person and by client label    |
| `limits.mcp_rate_per_minute`     | Agent calls to each tool                      |
| `limits.agent_drafts`            | Drafts one person's agents can save           |
| `limits.undo_seconds`            | How long a decision can be undone             |
| `privacy.min_count`              | The smallest count shown                      |
| `retention.delivery_days`        | How long what agents asked about is kept      |

## Switch a tool off for every agent

`POST /tools/{tool}` takes `{ enabled, reason }`. To do it for one agent, use [its Details](help/connect-an-agent.md#the-tools-each-agent-may-call).

## Set a policy for a client label

These have no screen in the web app. `GET /clients` lists the client labels, and `PUT /clients/{label}` adds or changes one:

| Field              | What it does                                         |
| ------------------ | ---------------------------------------------------- |
| `displayName`      | Its name                                             |
| `toolsAllowed`     | Its tools. Null means every tool that is switched on |
| `ratePerMinute`    | Its rate. Null means the default client rate         |
| `maxResponseBytes` | The largest reply, 1,000 to 100,000                  |
| `enabled`          | Whether it may call at all                           |
| `reason`           | Why, for the history log                             |

A label is never removed. Switch it off instead.

## Create a domain

`POST /areas` creates one with an `id` that never changes, its name, hue, review time in working days (1 to 30), owners and a reason. It is served from the start.

Owners and admins change a domain's `summary` and `description` with `PUT /areas/{id}/description`. Both operations need an `Idempotency-Key`.

To change who looks after a domain, use `/assignments/grant` and `/assignments/revoke`, which have no screen in the web app.

## Read the history log

Admins and auditors can read it. Reading or exporting it is not itself logged.

| Operation           | What it does                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /audit`        | Searches newest first, 50 at a time, by `action`, `actorId`, `areaId`, `subjectType`, `subjectId`, `from` and `to` |
| `GET /audit/export` | Writes JSON Lines, or CSV with `format=csv`, oldest first, up to 10,000 entries a call                             |
| `GET /audit/verify` | Checks the log's hash chain                                                                                        |

`action` takes a full name, such as `setting.changed`, or a prefix, such as `proposal`.

## Import items

`POST /imports` takes a YAML or JSON item file, up to 5,000 items. Nothing is ever published by an import: an import makes suggestions for owners to review.

- A dry run is the default, and changes nothing. Each entry gets the checks of the form.
- An entry with an `id` suggests a change to that item, and an entry equal to what is live proposes nothing.
- To apply, send `Idempotency-Key`. It makes suggestions only when no entry has an error and there are at most 500 to make.
- `submit: false` keeps them as drafts.

The [templates](templates) have an item file and a test question file to start from.

## Export an edition

`GET /editions/{label}/export` gives the edition as one document, for owners and admins: every served item with its digest, the vocabulary, the domains, and the digest it was sealed with.

An item the reader may not see is listed by id and digest only, so the edition's digest still checks. `heed verify` recomputes every digest offline. An export reads back as an import.

## Read the item format

`GET /schema/item` publishes the JSON Schema of the item format. It needs no sign-in.

## The heed command

`heed` talks to the service and signs in as a person from the dev people file, so it works with the dev or demo sign-in and not with company sign-in.

```sh
npm run heed -- validate lessons.yaml                                     # no service needed
npm run heed -- import lessons.yaml --as per_maria@example.test           # dry run
npm run heed -- import lessons.yaml --apply --as per_maria@example.test   # suggestions, for review
npm run heed -- draft item.yaml --as per_maria@example.test               # one draft
npm run heed -- import-tests questions.yaml --as per_maria@example.test   # test questions, dry run
npm run heed -- export --out edition.json --as per_maria@example.test     # the live edition
npm run heed -- verify edition.json                                       # recompute the digests
npm run heed -- audit --format csv --as per_ravi@example.test
```

| Option     | Setting       | Default                                                     |
| ---------- | ------------- | ----------------------------------------------------------- |
| `--as`     | `HEED_EMAIL`  | None                                                        |
| `--url`    | `HEED_URL`    | `http://127.0.0.1:3000`                                     |
| `--origin` | `HEED_ORIGIN` | The first of `HEED_WEB_ORIGINS`, else the service's default |

`--json` prints the result as JSON, for scripts and coding agents. The exit status is 0 when done, 1 when the file has problems or the service refused, and 2 for wrong usage.
