---
title: 'Connectors: security and egress'
line: 'The rules every connector follows to reach a tool, keep its credentials and hand over its output.'
group: Connectors
order: 4
reviewed: 2026-11-04
---

The rules every connector follows to reach a tool, keep its credentials and hand its output to
the core. They hold in every interface version (the [invariants](../connectors.md#invariants)),
and the core enforces them: a connector does not have to remember them. Requirements: CON-102
(read only), CON-105 (secrets in a store), CON-106 (least access), CON-107 (output is untrusted),
CON-113 (declared hosts only) and CON-114 (its own secrets only).

## Where connector code runs

| Level | Where                                                                                                                                                                                                                                                         | Who                                                                    | Status          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------- |
| T0    | In the server's process, reviewed in this repository. With interface 3, all HTTP goes through `ctx.fetch` and all Git through `ctx.git`.                                                                                                                      | Built-in connectors                                                    | Now             |
| T1    | Built-in, with risky parsing in a child process under Node's permission model (`ctx.worker`): no network, no writes, no child processes, reads only the service's code and dependencies, input over IPC.                                                      | The Cube compiler ([Compilation](cube.md#compilation-and-stored-data)) | Now             |
| T2    | Out of process: a child process per run that speaks the runtime's messages as JSON lines, has no network of its own and reads only its own package. Its only way out is an egress proxy over IPC that enforces the manifest's hosts and attaches credentials. | Verified connectors from packages ([Packaging](packaging.md))          | Designed, later |
| T3    | A container or micro-VM per run: read-only root, no ambient credentials, egress forced through the proxy.                                                                                                                                                     | Code nobody reviewed                                                   | Only if needed  |

Node's own documentation calls its permission model a seat belt that does not give security
guarantees against malicious code: symbolic links and inherited file descriptors get past it,
and `--allow-net` is all or nothing, with no list of hosts. So T1 is failure isolation for
reviewed code, T2 is for verified code, and code nobody reviewed needs T3.

A built-in connector reaches T1 through `ctx.worker(input)`: the core forks the worker its
module names (`src/connectors/<id>/worker.ts`, `src/server/modules/connectors/worker.ts` runs
it) with a heap limit, the read's time limit and no environment of the server's but `PATH`,
sends it the input over IPC and takes its one answer, which the runtime checks before it sends a
record. The worker gets what the runtime read through `ctx.git` or `ctx.folder` as data, so it
reads no folder of the tool, only the service's code, its dependencies and the package file.
What it prints is dropped. A worker may load the packages it parses with; it imports nothing of
the service (`eslint.boundaries.js`). `node:vm` and worker
threads are not security boundaries. Node denies the network to a process started with
`--permission` from version 26 on; `package.json` requires it and `.npmrc` refuses an install on
an older one, but the server does not yet check the Node it runs on.

## Egress

A connector reaches only the hosts its manifest declares, over https, on public addresses
(CON-113). In production, plain http, an address that names this machine, and a private,
link-local, shared or documentation network are refused. Development and tests may use a host on
this machine.

Whoever runs the server may let `ctx.fetch` reach hosts on a private network by name
(`HEED_EGRESS_PRIVATE_HOSTS`, [Operations](../operations.md)), for an internal artifact server. It
is a list in the server's own settings, not in the app: an administrator in the app cannot
open the private network, and Git and figures do not take it. An allowed host is still https only,
and still has to be one the manifest declares.

### Git

In production the repository must be on a public address: an address that names this machine, a
private, link-local or shared network, or plain http is refused with the settings, and a name
that resolves to such an address is refused before git runs (`private_address`), and git is
pinned to the very address that was checked (`http.curloptResolve`), so it cannot be told another
one in between, and so an
administrator cannot make the server reach services that are not meant to be reached from
outside; that includes the prefixes that carry an IPv4 address (NAT64, Teredo, 6to4) and the
documentation networks. The address is kept, checked and given to git in one form (the WHATWG
URL), and one with a backslash, a space or a control character is refused, so git cannot read
another host from it than the check did. Development and tests may use a Git host on this
machine.

Each read fetches one commit into a folder of its own and removes it afterwards. Git runs with no
system or global configuration, no credential helper and no prompt, https only, without following
redirects (so the token never reaches another host), with symbolic links checked out as plain
files, and within 60 seconds. The token goes to git as an `Authorization` header through its
environment: never in its arguments, which other users of the machine may list, nor in the
address, which git may print. Git's own output is read for a reason code and then dropped. The
code is `src/server/modules/connectors/git.ts`; nothing in it is specific to Cube.

An interface 3 connector reaches Git only through `ctx.git` (`egress-git.ts`): it names a
repository by the settings field that holds it, and the core fetches it only when the manifest
declares `egress.git` and a host from that field, sends a secret only when that secret is bound to
the field, and hands the connector a read-only view of one commit (its folders, its files and
their text, nothing outside it, links as plain files) that is removed when its work ends.

### HTTP (interface 3)

Connectors that call an HTTP API get `ctx.fetch`, built on the same address rules as Git. It
allows:

- https only (plain http only to this machine, outside production);
- only the hosts the manifest declares: a fixed name, the host of a settings field
  (`{ fromField: 'repository' }`), or the host of an address kept as a secret
  (`{ fromSecret: 'fileAddress' }`);
- GET and HEAD only, except a POST with its body to a host the manifest declares for signing in
  (`signIn: true`), where a connector trades its credential for a short-lived token; it writes
  nothing to the tool (built);
- public addresses only, with the same block list as Git, the name resolved once and the
  connection pinned to the address that was checked (`pinned-fetch.ts`), or a host whoever runs
  the server allows;
- redirects checked hop by hop, on the same host only and at most three, and refused otherwise
  (`redirect_refused`), so a signature or a key never reaches another host;
- answers capped at 20 MB, or at the less a connector asks for (`maxBytes`), by the length the
  host says and by what arrives; over it, the read of the body fails with `unreadable_file`;
- a timeout from the manifest's limits;
- no request or address in a log or an error: what the network says of a failure is dropped, and
  a failure names a host at most (`unreachable`).

There is no rate limit of the core's yet: `limits` in a manifest has none. A connector passes on
what a host says in `Retry-After` through `SourceError.retryAfter`.

A connector never calls the platform's `fetch`, opens a socket or starts a program itself.

### Figures (CON-612)

A definitions connector that declares the figures capability reads one figure for Ask through its
own fetch, apart from `ctx.fetch`: GET only, to the data endpoint's origin alone (its scheme, host
and port: the declared host), https to a public host in production, the host's name looked up
once and the connection pinned to an answer that is public, so the name cannot be looked up again
and rebound (built, `pinned-fetch.ts`). It never follows a redirect, has 4 seconds and caps what it
reads. The endpoint's token is kept in the secret store as the source's secrets are, sent only to
that origin, and forgotten when the scheme, host or port changes. No person's identity goes with
the request, and nothing it returns is kept. Try a figure (`POST /api/v1/figures/{id}/try`,
administrators only) goes through the same fetch with the saved endpoint and token, never ones
typed in for the try, skips the figures cache and keeps nothing; its answer is the value or a
failure code, never what the tool said.

## Secrets

### The secret store

`HEED_SECRETS_DIR` names the local secret store: a folder outside the repository that only the
server's user may open (mode 0700; the server refuses to start with a folder others may read). Each
added source's secrets are one file in it (mode 0600), named by a random id the database keeps as
`local:<id>`; a name that is not of that form never becomes a path. A replaced secret is written
under a new name and the old file is removed once the change commits; a refused change removes the
new one. Unset, the server keeps no secret, and a source that needs one cannot be added (the form
says so). A hosted service with several servers moves to a managed store behind the same
interface (`SecretStore` in `secrets.ts`).

A secret goes in once and comes out only to the source's reader, and only toward the address it
was given for: a connector names the settings each secret is bound to (`boundTo` in its
manifest; Cube's token is bound to the repository). A change to one of them forgets the stored secrets unless new ones are
given with it (the history log says `removed`), and a test at another address does not use them,
so an administrator cannot send a token they never saw to a host of their choosing. The API never returns it, the
history log and snapshots never hold it, the service never logs it, and it never reaches the
browser bundle: the form sends it with the request and forgets it. `tests/integration/sources.test.ts`
checks every answer, row, history entry, retry record and log line of a run for it.

A secret may be the address itself. A signed link, such as a pre-signed S3 address, is as good as
a key, so a connector keeps it in a secret slot and not in a setting, and declares its host with
`{ fromSecret: <slot> }`. It is kept and shown as any other secret: only as set, in no answer, row
or log. A failure names its host, never its path or query. It carries its own destination, so it
is bound to the setting that says it is in use, and a move away from it forgets it.

### What interface 3 adds

- A connector declares its secret slots in its manifest, each with the settings it is bound to
  (`boundTo`, today's `secretsBoundTo` per secret). A secret key is never also a settings field.
- The runtime gets a secret only through `ctx.secret(key)`, for its own source (CON-114). The
  core reads the store; the connector never does.
- Prefer narrow, short-lived credentials: a read-only token or a GitHub App installation token
  for one repository, a service account shared on one folder, a metadata-only token.
- A service account key (Google Drive, built) is a secret like a token: it goes into the store
  when an admin adds the source, the source's page shows it only as set, and it is bound to both
  addresses it is used at (the API and the sign-in address), so a change to either forgets it. A
  read signs a request with it and sends that request, never the key, to the declared sign-in
  host, for an access token that can only view (`drive.readonly`) and lives in memory for that
  read only. The account sees only the folders shared with it: no domain-wide delegation, no
  impersonation, and who may read a document is not copied (CON-610).
- Later, for sign-in with OAuth: a refresh token is a secret, an access token lives only in
  memory, the manifest lists the scopes and Integrations shows them before connecting, and only read
  scopes are allowed.
- Later, out of process (T2): the egress proxy attaches the credential to requests for the
  declared hosts, so the connector's process never holds the token.

## Output

The core treats everything a connector returns as untrusted data (CON-107):

- every record is checked against a strict schema before the core uses it; unknown keys are
  refused, so a definition can carry no calculation, query or SQL (CON-207);
- records are capped in size and count;
- warnings are codes and targets only, never raw text from the tool;
- document text is data, never instructions: it is never put into an agent's instructions or a
  tool description, text that reads like instructions is flagged, and the reviewed draft is the
  human checkpoint (CON-603, CON-608);
- no whole document is stored: per document, its id, link, date, change mark and a quote of at
  most 500 characters (CON-605).

## Rules for connector code

- No raw network: HTTP through `ctx.fetch`, Git through `ctx.git`.
- No reading the environment, the secret store or files outside what the core hands over
  (`ctx.git`, `ctx.folder`).
- No writing files, and no starting programs: a parser or compiler of the tool's files runs in
  the connector's worker (`ctx.worker`), which the core starts.
- No logging content or secrets: `ctx.log` takes codes and targets.
- Honour `ctx.signal`: a read stops when the core aborts it.
- Nothing is written to the tool (CON-102), and the access a connector asks for is the least it
  needs, said before anything is given (CON-106).
