---
title: HTTP API overview
line: How to call the service from a script, and where each part of the API is described.
group: Reference
order: 6
reviewed: 2026-11-05
---

Everything the web app does goes through the same HTTP API, under `/api/v1`. This page says how to call it. Every operation, with its fields, is in the generated [OpenAPI description](../api/openapi.json).

## Sign in

The API uses the web app's session. Sign in as a person, then send with each change:

| What          | Why                                                |
| ------------- | -------------------------------------------------- |
| The cookie    | The session, for every call                        |
| `Origin`      | One of the allowed web origins, `HEED_WEB_ORIGINS` |
| `x-heed-csrf` | The session's token, on every change               |

To script against it with the dev or demo sign-in, use the [`heed` command](../administration.md#the-heed-command), which handles all three. It cannot sign in through company sign-in.

`GET /api/v1/auth/methods` says how this install signs people in, and `GET /api/v1/install` whether it is the demo and the label naming it (`HEED_PROFILE_LABEL`).

## Safe retries

Changes that take an `Idempotency-Key` header can be sent twice. The key is 8 to 128 printable characters and belongs to the person for 24 hours.

| You send                                | You get                  |
| --------------------------------------- | ------------------------ |
| The same request with the same key      | The first response again |
| Other content with the same key         | 422                      |
| The same key while the first is running | 409                      |

## Stale writes

Reads give a `revision`, and changes send it back. If someone changed the record in between, the answer is 409, and for a suggestion it carries the current record. Read it again, then retry.

## Undo

A decision that can be taken back answers with an `undo` token. Send it to `POST /api/v1/decisions/undo`, as the same person, within 15 seconds (the setting `limits.undo_seconds`).

## Answers that say no

| Status | What it means                                             |
| ------ | --------------------------------------------------------- |
| 400    | The request is not in the right form                      |
| 401    | Nobody is signed in                                       |
| 403    | The person may not do this                                |
| 404    | Not found, or the person may not read it                  |
| 409    | The record moved, or the key is in use                    |
| 412    | What the request depends on does not exist yet            |
| 422    | The content was refused. The answer says what is wrong    |
| 429    | Over a limit. `Retry-After` says how many seconds to wait |

## Limits

Each person may send 600 requests a minute, and each address 120 before sign-in. Admins change this with `limits.api_rate_per_minute`. `/health`, `/health/ready` and `/metrics` are not limited.

## What the API covers

| Part            | Paths under `/api/v1`                                                    | What it is for                                       |
| --------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| Context         | `/library`, `/items`, `/context`, `/drafts`, `/search`                   | Read, change, publish and restore context items      |
| Suggestions     | `/proposals`                                                             | Save, send and withdraw suggestions                  |
| Review          | `/review`, `/decisions`                                                  | Read a suggestion, publish it or return it           |
| Inbox           | `/inbox`, `/setup`                                                       | The cards each person sees, and the setup checklist  |
| Domains         | `/areas`, `/assignments`                                                 | Create domains and say who looks after them          |
| People          | `/members`, `/invites`, `/roles`                                         | Who is in the workspace, and their roles             |
| Comments        | `/comments`, `/reactions`                                                | Threads under a suggestion or a context item         |
| Reports         | `/reports`                                                               | Named reports from Ask                               |
| Conflicts       | `/conflicts`                                                             | Read and settle pairs that disagree                  |
| Definitions     | `/catalogue`, `/terms`, `/definitions`                                   | Metrics, dimensions, terms and synonyms              |
| Ask             | `/ask`, `/figures`, `/try-it`                                            | Answers, Asked this week and figures                 |
| Saved questions | `/saved-questions`                                                       | Keep and check questions for a domain                |
| Alerts          | `/alerts`                                                                | Alert rules, mutes and what they raised              |
| Observability   | `/observability`                                                         | What agents asked and what they got, as counts       |
| Integrations    | `/sources`                                                               | Connect, test, read and disconnect a tool            |
| Agents          | `/connect`, `/agents`, `/connections`, `/access-keys`, `/agent-policies` | Connected agents, tools, access keys and policies    |
| Administration  | `/settings`, `/audit`, `/editions`, `/imports`, `/operations`            | Settings, the history log, imports, exports and jobs |

Some operations have no screen in the web app. [Administer the service](../administration.md) lists the common ones.
