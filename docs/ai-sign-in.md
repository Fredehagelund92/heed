---
title: Sign in your own agent
line: How a person adds the MCP address to their own agent and signs in as themselves, and how an admin looks after it.
group: Reference
order: 5
reviewed: 2026-11-05
---

Add the MCP address to your own agent and sign in as yourself, with no key to copy. The agent then reads what you may read, and nothing else.

## Connect your agent

The quickest way is the prompt in [Connect an agent](help/connect-an-agent.md). By hand, the steps are:

1. Add an MCP server with the service's address. In Claude Code:

   ```sh
   claude mcp add --transport http heed http://localhost:3000/mcp
   ```

2. In Claude Code, run `/mcp` and choose Authenticate. Other agents open the sign-in by themselves.
3. Your browser opens. Sign in, read which app asks and what it may do, then choose Allow or Deny.
4. The browser goes back to the agent, and its tools work as you.

On a computer running the demo, sign-in means choosing a person from the demo's people.

> **Agents that cannot sign in.** An agent needs a client ID metadata document or dynamic client registration. One with neither uses an access key: see [the page on connecting by hand](reference/connect-by-hand.md#a-bot-or-a-scheduled-job).

## What a sign-in lasts

| What              | Lasts                                     | Setting                                               |
| ----------------- | ----------------------------------------- | ----------------------------------------------------- |
| An access token   | 10 minutes, renewed by the agent          | None                                                  |
| A refresh token   | Until 7 days unused. Each use replaces it | `HEED_OAUTH_REFRESH_IDLE_HOURS`                       |
| A connection      | 30 days after sign-in                     | `HEED_OAUTH_CONNECTION_DAYS`                          |
| A browser session | 12 hours unused, or 7 days after sign-in  | `HEED_SESSION_IDLE_HOURS` and `HEED_SESSION_MAX_DAYS` |

When a connection ends, the agent asks you to sign in again.

## See and end connections

Settings, Agents and access, lists every agent by name. You see your own, and an admin sees everyone's.

- **Disconnect** ends one of your own at once.
- **Revoke** ends every connection of that agent for that person. An admin gives a reason, which the history log keeps and the person does not see.
- Removing a person from the workspace ends their connections in the same step.

An admin switches each tool on or off for each agent, in its Details. A switch acts at the agent's next request and never gives more than the person allowed at sign-in: see [the tools each agent may call](help/connect-an-agent.md#the-tools-each-agent-may-call).

## What the agent can do

The sign-in screen names three scopes, in plain words:

| Scope      | What it allows                               |
| ---------- | -------------------------------------------- |
| `read`     | Read published context                       |
| `feedback` | Send a report, after the person says yes     |
| `propose`  | Send a suggestion, after the person says yes |

An agent always reads what is published now, never drafts or comments. It publishes only where an owner lets it [publish without review](help/publish-without-review.md). The request log keeps which family of app called and never who it acted for.

## The login server settings

The service runs its own login server for agents. These are the settings, for whoever runs the service:

| Setting                           | Default                                                         | What it does                                                                                     |
| --------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `HEED_LOGIN_SERVER`               | `builtin`                                                       | `builtin` runs it here, `external` trusts another login server, and `off` leaves only dev tokens |
| `HEED_OAUTH_ISSUER`               | The origin of `MCP_RESOURCE_URL`                                | The issuer of its tokens. It must be that origin                                                 |
| `HEED_OAUTH_CONSENT_URL`          | `/connect/approve` on the first web origin on the issuer's host | The consent page. It must be on an allowed web origin, on the issuer's host                      |
| `HEED_OAUTH_SIGNING_KEY_FILE`     | `.heed-oauth-key.pem`                                           | The key that signs tokens. Made for you outside production, and required in production           |
| `HEED_OAUTH_PREVIOUS_KEY_FILES`   | None                                                            | Earlier keys, comma-separated, that still verify after a rotation                                |
| `HEED_OAUTH_DYNAMIC_REGISTRATION` | `on` outside production, `off` in production                    | Allows dynamic client registration, which Claude Code uses                                       |
| `HEED_OAUTH_REFRESH_IDLE_HOURS`   | `168`                                                           | A refresh token unused this long expires                                                         |
| `HEED_OAUTH_CONNECTION_DAYS`      | `30`                                                            | A connection ends this many days after sign-in                                                   |
| `MCP_AUTH_ISSUER`                 | None                                                            | With `external`: whose tokens the MCP server accepts                                             |
| `MCP_AUTH_JWKS_URL`               | None                                                            | With `external`: where their keys are                                                            |
| `HEED_MCP_STATE_KEY_FILE`         | `.heed-mcp-state.key`                                           | The key that seals the questions `suggest_context` asks in the agent                             |

Addresses must be https, or http on the same computer only.

## Make the keys

For production, this makes both keys, readable by their owner only, and keeps a key that exists:

```sh
npm run keys:create
```

To make the signing key yourself:

```sh
openssl genpkey -algorithm ed25519 -out heed-oauth-key.pem && chmod 600 heed-oauth-key.pem
```

The service refuses a key file others may read. Keep it out of the repository, the images and the logs.

The key that seals the questions is at least 32 bytes of hex, and every instance needs the same file. Without it in production, `suggest_context` lists its questions with a link to the draft instead of asking in the agent.

```sh
openssl rand -hex 32 > heed-mcp-state.key && chmod 600 heed-mcp-state.key
```

## Rotate the signing key

1. Create a new key, and point `HEED_OAUTH_SIGNING_KEY_FILE` at it.
2. List the old file, or its public key, in `HEED_OAUTH_PREVIOUS_KEY_FILES`. Make the public key with the command below.

   ```sh
   openssl pkey -in old.pem -pubout
   ```

3. Restart the service. New tokens use the new key, and tokens signed by the old one work until they expire, ten minutes at most.
4. Take the old key off the list.

Connections survive a rotation, because refresh tokens are not signed.

> **If a key leaks.** Rotate without listing the old key. Every access token it signed is refused at once, and agents get new ones with their refresh tokens.

## Known limits

- Rate counts live in one process.
- Agents signed in through another login server, and dev tokens, are not listed in Agents and access.
