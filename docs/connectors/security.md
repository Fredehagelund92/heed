---
title: Connector security
line: What a connector may reach, how its credentials are kept, and how its output is treated.
group: Connectors
order: 3
reviewed: 2026-11-05
---

The rules every connector works under. The service enforces them, so a connector does not have to remember them, and they hold for every connector.

## What a connector may do

| It may                                        | It may not                                            |
| --------------------------------------------- | ----------------------------------------------------- |
| Read from the hosts its manifest declares     | Write anything to the tool                            |
| Use the secrets of its own source             | Read the environment, the secret store or other files |
| Say which access it needs, before you give it | Open a socket, or start a program                     |
| Run a parser in a worker the service starts   | Log content or secrets                                |

Connectors run inside the service and are reviewed with it. A risky parser, such as Cube's compiler, runs in a child process with no network, no writes and no secrets. That isolates failures of reviewed code: it is not a sandbox for code nobody reviewed.

## What a connector may reach

Only the hosts its manifest declares, over https, on public addresses. In production these are refused:

- plain http;
- an address that names this computer;
- a private, link-local, shared or documentation network.

Development and tests may use a host on the same computer.

To let connectors reach an internal server, such as an artifact server, whoever runs the service names it in `HEED_EGRESS_PRIVATE_HOSTS`. An admin in the app cannot open the private network. An allowed host is still https only, the manifest must still declare it, and Git and figures do not take this list.

## Git

- Each read fetches one commit into a folder of its own, and removes it afterwards.
- Git runs with no system configuration, no credential helper and no prompt, within 60 seconds.
- It follows no redirects, so a token never reaches another host.
- Symbolic links are checked out as plain files.
- The address is checked when it is saved and again before each read, and git is pinned to the address that was checked.
- The token goes to git through its environment, never in its arguments or the address.

## HTTP

Requests go through a guarded fetch:

| Rule      | What it allows                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------- |
| Hosts     | A fixed name, the host of a setting, or the host of an address kept as a secret                          |
| Methods   | GET and HEAD. POST only to a host declared for signing in, to trade a credential for a short-lived token |
| Addresses | The name is looked up once, and the connection is pinned to the address that was checked                 |
| Redirects | The same host and port only, three at most                                                               |
| Answers   | 20 MB at most, or less if the connector asks                                                             |
| Time      | The limit in the connector's manifest                                                                    |

No request or address goes in a log or an error. A failure names a host at most.

## Figures

A connector that reads figures for Ask has its own stricter fetch: GET only, to the data endpoint's origin alone, with no redirects, and 4 seconds to answer.

The endpoint's token is sent only to that origin, and forgotten when the scheme, host or port changes. No person's identity goes with the request, and nothing it returns is kept.

## Secrets

`HEED_SECRETS_DIR` names a folder outside the repository that only the service's user may open (mode 0700). The service makes it if it isn't there, and refuses to start with a folder others may read. `compose.yaml` sets it to `/var/lib/heed/secrets`, in the `heed_keys` volume. Unset, no secret is kept: connecting says so at its first step, before anything is filled in, and Test connection refuses a source that needs one.

- A secret goes in once, and comes out only to its own source's reader. The API never returns it.
- The history log and the reads never hold it, the service never logs it, and it never reaches the browser.
- A connector binds each secret to the settings it was given for. Change one of those settings and the secret is forgotten, so nobody can send a token they never saw to a host of their choosing.
- A signed link is as good as a key, so it is kept as a secret too. A failure names its host, never its path or query.

Give the narrowest credential that works: a read-only token for one repository, a service account shared on one folder, or a token that reads metadata only.

A Google Drive service account key is kept like a token. A read signs a request with it, and gets a view-only token that lives in memory for that read alone. The account sees only the folders shared with it.

## What comes back

Everything a connector returns is untrusted data:

- Every record is checked against a strict schema, and unknown keys are refused, so a definition can carry no calculation, query or SQL.
- Records are capped in size and count.
- Warnings are codes and targets only, never raw text from the tool.
- Document text is data, never instructions. It never reaches an agent's instructions, text that reads like instructions is flagged, and the owner's review is the human checkpoint.
- No whole document is stored: only its id, link, date, change mark and a quote of at most 500 characters.

## Rules for connector code

- Reach the network only through `ctx.fetch` and `ctx.git`.
- Read only what the service hands over: `ctx.git` and `ctx.folder`.
- Write no files, and start no programs. A parser of the tool's files runs in the connector's worker, `ctx.worker`.
- Log codes and targets only, through `ctx.log`.
- Honour `ctx.signal`: a read stops when the service aborts it.
- Write nothing to the tool, and ask for the least access you need.
