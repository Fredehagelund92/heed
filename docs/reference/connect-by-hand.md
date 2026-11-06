---
title: Connect an agent by hand
line: The MCP address, the command for each kind of client, and the limits on what it may send.
group: Reference
order: 3
reviewed: 2026-11-05
---

Add the MCP server to an agent yourself, or give a bot or a script its own way in. For a person's agent, the [prompt](../help/connect-an-agent.md) does all of this for you.

## The address

The MCP server is at `/mcp` on the service's address, the setting `MCP_RESOURCE_URL`. With `docker compose up` it is `http://localhost:3000/mcp`.

Settings, Agents and access, shows the address of your workspace.

## A person's agent

For Claude Code:

```sh
claude mcp add --transport http heed http://localhost:3000/mcp
```

Then run `/mcp` in Claude Code and choose Authenticate. The agent signs in as you, with no token: see [Sign in your own agent](../ai-sign-in.md).

Cursor and VS Code have one-click install links in Agents and access. Claude's app and ChatGPT take the address as a connector. Any other agent adds a remote MCP server over HTTP in its own way.

## A bot or a scheduled job

A job with nobody there to approve a sign-in uses an access key. An admin makes one in [Agents and access](../help/connect-an-agent.md#a-bot-or-a-scheduled-job).

The job calls the MCP address and sends the key as its bearer token:

```text
Authorization: Bearer hak_...
```

A key can read and send reports. It names no person, so it never sends a suggestion. It lasts until it is revoked, and it keeps working after the person who made it leaves, so revoke it when the job ends.

## On your own computer, with a dev token

Running the service from source with `npm run dev:server`, you can skip sign-in with a dev token:

```sh
claude mcp add --transport http heed http://localhost:3000/mcp \
  --header "Authorization: Bearer $(npm run --silent token:dev)"
```

- A token lasts eight hours. Make a new one when it ends.
- `--client <label>` makes one for another client label, which works once an admin has added and enabled that label.
- The first run makes a signing key, `.heed-dev-key.pem`, which git ignores.
- Production refuses dev tokens.

## What a request needs

| Rule            | What happens                                                                  |
| --------------- | ----------------------------------------------------------------------------- |
| Method          | POST to `/mcp`. `GET` and `DELETE` answer 405                                 |
| Bearer token    | Every request needs one                                                       |
| Host and origin | They must name this computer or the MCP address's own host. Others answer 403 |
| Batches         | An array of calls answers 400, so each call meets its own limits              |
| Sessions        | None. The server keeps nothing between calls                                  |

The server speaks the two latest revisions of the MCP protocol.

## Limits

Over a limit, the answer is 429 with `Retry-After` in seconds.

| Limit                                   | Default a minute |
| --------------------------------------- | ---------------- |
| Calls by one person                     | 30               |
| Calls by one client label               | 120              |
| `get_context` calls by one client label | 120              |
| `report` calls by one client label      | 20               |

Admins change these with the settings `limits.mcp_requests_per_minute` and `limits.mcp_rate_per_minute`, and a change applies at the next request: see [Administer the service](../administration.md#change-a-setting). Each instance counts on its own.
