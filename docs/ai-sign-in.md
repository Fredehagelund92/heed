# AI sign-in: connect your own agent to Heed

A person adds the Heed MCP address to their own agent (Claude, ChatGPT, Cursor and others). The
app finds out how to sign in, the person signs in to Heed as themselves, approves a short consent
screen, and from then on the app calls Heed's tools with exactly that person's audience and
scopes. This page covers FR-401 to FR-406, FR-408, FR-410, FR-411, FR-414 and NFR-022 for the
first build, which runs on one computer (FR-413).

## How a person connects

1. In the agent, add an MCP server with the address `http://localhost:3000/mcp` (the
   `MCP_RESOURCE_URL` of the service). For Claude Code:
   `claude mcp add --transport http heed http://localhost:3000/mcp`, then `/mcp` and
   Authenticate (Claude Code registers itself, so it needs dynamic registration on).
2. The app opens a browser at Heed. Sign in (locally: choose who you are from the dev people),
   read which app asks and what it may do, and choose **Allow** or **Deny**.
3. The browser returns to the app. Its tools work as you. On **Connect an agent** (user
   menu, Home and the assistant panel) you see every app connected as you, and **Disconnect** ends
   one at once.

An administrator sees every person's connections in Administration, MCP and gateway,
**Connections** (`aiConnections.list`): the person, the agent's own name and where it came from, its
scopes, when it connected, last refreshed and ends. **Disconnect** there ends one connection, or
every connection of one person in one step (`aiConnections.disconnect`,
`aiConnections.disconnectPerson`), through the same revocation as the person's own: the refresh
tokens end and the MCP server refuses the access tokens at their next request. A reason is required
and kept in the history log; the person does not see it.

An app needs either a client ID metadata document (preferred by the MCP specification) or
dynamic client registration, which is on by default outside production and requires an explicit
opt-in in production (see the settings). An app
that supports neither cannot sign in, and its people keep using `npm run token:dev`.

## How it works

```text
AI agent                Heed MCP server         Heed login server            Browser (person)
  | POST /mcp (no token)        |                        |                          |
  |---------------------------->| 401, WWW-Authenticate: resource_metadata=...      |
  | GET /.well-known/oauth-protected-resource/mcp  -> authorization_servers         |
  | GET /.well-known/oauth-authorization-server --->|                                |
  | POST /oauth/register (fallback) or https client_id (metadata document)         |
  | open /oauth/authorize?...&code_challenge (S256)&resource ------------------------>|
  |                             |   302 to the consent page, browser cookie set    |
  |                             |   person signs in, Allow (session + CSRF token)  |
  |<------------------- redirect_uri?code&state&iss ---------------------------------|
  | POST /oauth/token (code + code_verifier) ------>| access token (10 min), refresh token
  | POST /mcp, Bearer access token ->| checks signature, issuer, audience, expiry, scope itself
```

- **Discovery.** `/.well-known/oauth-protected-resource/mcp` (RFC 9728) names the login server.
  `/.well-known/oauth-authorization-server` (RFC 8414) lists its addresses, `S256` as the only
  PKCE method, `none` as the only client authentication, and `iss` in the answer (RFC 9207).
- **Clients.** A client ID metadata document is an https address with a path, read at every
  sign-in: at most 5 KB, within five seconds, no redirects, public addresses only. Such an app is
  stored only once a signed-in person allows it; a sign-in in progress carries the app's name for
  ten minutes, so anyone naming addresses fills nothing. Dynamic registration (RFC 7591) is the
  fallback; a registration nobody connected with goes after a day, one whose connections have all
  ended after 30 days unused. There is no cap that could lock other apps out: the rates bound what
  is stored. Every client is public: no
  secret, PKCE on every sign-in. A registration that asks for a secret is registered without one.
- **Redirect rules.** https, or http on this computer (`localhost`, `127.0.0.1`, `[::1]`) for
  desktop apps. No wildcard, fragment, credentials or other scheme. A requested address must equal
  a registered one exactly; only a loopback address may change its port (RFC 8252). An unknown
  client or address gets a page, never a redirect.
- **Consent.** The authorize request is stored for ten minutes and tied to the browser that made
  it by a cookie (`heed_oauth_browser`, HttpOnly, SameSite=Lax); the consent page lives on the web
  app (`/connect/approve`), answers only to that browser, needs the person's session, the page
  origin and the session's CSRF token, and is answered once. It names the app as it names
  itself, where it is described or registered from, where it sends the person back, and each
  scope in plain words. It refuses to work inside a frame.
- **Tokens.** A sign-in code works once, within a minute, for the client, redirect address and
  PKCE verifier it was issued with; any failed use uses it up, and a second use revokes the
  connection it made. Access tokens are `at+jwt` JWTs (RFC 9068), Ed25519, ten minutes, with the
  MCP address as audience, the person as `sub`, the connection as `sid`, the scopes and the
  person's audience groups. Refresh tokens rotate on every use; a used one presented again, or
  one presented by another client, revokes the whole connection (reuse detection). By default,
  refresh tokens expire after 7 days idle and connections end 30 days (720 hours) after sign-in.
- **The MCP server checks every token itself** (FR-402), choosing the verifier by the token's
  issuer: dev tokens with the dev key, the built-in login server's tokens with its own public
  keys (no network call), another login server's tokens with its key set. It checks signature,
  issuer, audience, expiry, a lifetime of at most one hour and the claims, and refuses the tokens
  of a connection disconnected in this process at once. Dev tokens keep working unchanged.
- **Who and what.** The person's scopes are `read`, `feedback` and `propose` (FR-414); `edition`
  is never granted, so a person's app always reads the live edition (FR-412). Audience groups come
  from the identity connector at every sign-in and refresh (FR-405); the dev connector has none,
  and groups are parked, so a person reads the items for everyone, as in the web app. The token
  is never passed on (FR-406).
- **Records and logs.** Every app a person signs in with shares the client label `signed-in` in
  the MCP request log, deliveries and client policies (FR-410): never the person. The request log
  also keeps the app's family from a fixed list (`claude_code`, `claude_ai`, `chatgpt`, `codex`,
  `cursor`, `vscode_copilot`, `windsurf`, `gemini_cli`, `goose`, `heed`, else `other`, or
  `unknown` when it names none), mapped from the name it sends; that name and its version are
  never kept. Health counts the families by the week, small counts hidden. An administrator can switch it off or give it a rate on the MCP and gateway page. The
  per-person rate (FR-408) counts by person across their apps and refreshed tokens. Sign-in lines
  (`event: ai_sign_in`) and token failures (`MCP token rejected`) carry a result, a reason code and
  the client label only (FR-411). The history log records `ai_client.connected`,
  `ai_client.disconnected` and `ai_client.revoked` with the reason code (`disconnected` by the
  person, `disconnected_by_admin`, `refresh_reuse`, `code_reuse`, `revoked_by_client`,
  `person_inactive`). An administrator's disconnect names them as the actor and keeps their reason
  in the entry's reason column; the connections of one person ended together share a batch id.
- **Drafts.** With the `propose` scope, a person's app may call `draft_context` (FR-121), once an
  administrator has switched it on: it saves an unsubmitted draft owned by the person, who checks
  and submits it in the web app. It is the only MCP call that names the person, as the proposer,
  on the proposal and its history; the request log still keeps only `signed-in`. A dev token names
  no person, so it is refused. When the app can show forms, the tool asks its open questions there
  first, in a request state bound to the person and the app (`CL_MCP_STATE_KEY_FILE`, below).
- **Rates.** Per caller address and minute: discovery 120, registration 10, authorize 30, token
  60, revocation 30; the web API's own limits cover the consent operations. Failed token requests
  count per client and caller address, 30 a minute; successful code exchanges and refreshes never
  count against the client, so one client's people are not locked out by junk sent under its public
  ID from another address. One connection refreshes at most 5 times a minute.

## Settings

| Variable                               | Default                                                                    | Meaning                                                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `CL_LOGIN_SERVER`                      | `builtin`                                                                  | `builtin` runs the login server here; `external` trusts another one; `off` leaves only dev tokens. Tools and items never change. |
| `CL_OAUTH_ISSUER`                      | the origin of `MCP_RESOURCE_URL`                                           | The issuer of its tokens. It must be that origin, which serves the login server.                                                 |
| `CL_OAUTH_CONSENT_URL`                 | the first `CL_WEB_ORIGINS` origin on the issuer's host, `/connect/approve` | The consent page. It must be on an allowed web origin, on the issuer's host.                                                     |
| `CL_OAUTH_SIGNING_KEY_FILE`            | `.heed-oauth-key.pem`                                                      | The Ed25519 signing key (PKCS #8 PEM, owner-only). Created outside production when missing; required in production.              |
| `CL_OAUTH_PREVIOUS_KEY_FILES`          | none                                                                       | Earlier keys, comma separated, that still verify after a rotation.                                                               |
| `CL_OAUTH_DYNAMIC_REGISTRATION`        | `on` outside production; `off` in production                               | `on` allows dynamic client registration; an explicit `on` or `off` overrides the default.                                        |
| `CL_OAUTH_REFRESH_IDLE_HOURS`          | `168`                                                                      | A refresh token unused this long expires (7 days).                                                                               |
| `CL_OAUTH_CONNECTION_DAYS`             | `30`                                                                       | A connection ends this many days after sign-in (720 hours).                                                                      |
| `MCP_AUTH_ISSUER`, `MCP_AUTH_JWKS_URL` | none                                                                       | With `CL_LOGIN_SERVER=external`: whose tokens the MCP server accepts, and where their keys are.                                  |

Addresses must be https, or http on this computer only.

`CL_MCP_STATE_KEY_FILE` (default `.heed-mcp-state.key`) holds the key that signs the draft tool's
question rounds: at least 32 bytes as hex (`openssl rand -hex 32 > heed-mcp-state.key && chmod 600
heed-mcp-state.key`), readable by its owner only. Every instance needs the same file, because an
app may send the answers to another one. Outside production a missing file is created; in
production a missing file turns the questions in the app off, and the tool lists them with the
draft link instead.

## Keys

Generate a signing key, readable by its owner only (the service refuses any other):

```sh
openssl genpkey -algorithm ed25519 -out heed-oauth-key.pem && chmod 600 heed-oauth-key.pem
```

Keep it out of the repository (`.heed-oauth-key*.pem` is ignored), out of images and out of logs;
at the hosting stage it comes from the secret store as a file. Its key id (`kid`) is its RFC 7638
thumbprint, and `/oauth/jwks` publishes the public keys only.

To rotate: create a new key, point `CL_OAUTH_SIGNING_KEY_FILE` at it, list the old file (or its
public key, `openssl pkey -in old.pem -pubout`) in `CL_OAUTH_PREVIOUS_KEY_FILES`, and restart. New
tokens use the new key; tokens signed by the old one keep working until they expire, at most ten
minutes. After that, remove the old key from the list. Refresh tokens are not signed, so
connections survive a rotation. If a key leaks, rotate without listing the old key: every access
token it signed is refused at once, and apps get new ones with their refresh tokens.

## Threat notes

- **Stolen code.** Useless without the PKCE verifier; one use; a second use revokes.
- **Stolen refresh token.** Rotation and reuse detection: the first time both the thief and the
  app use it, the connection ends for both, and the person sees the app gone.
- **Malicious app, consent phishing.** Every sign-in shows the consent screen; it names where the
  app is described or registered from and where it sends the person, and warns to allow only an
  app they just asked to connect. The app's name is its own claim and is shown as such.
- **Login CSRF, leaked consent links.** The consent answer needs the browser cookie of the
  sign-in, the person's session, the page origin and the CSRF token.
- **Open redirects.** Redirects go only to a registered address checked twice, never to an
  address taken from the request alone; errors before that point are a page.
- **Server-side request forgery.** Metadata documents are read over https from public addresses
  only, checked again for every resolved address, without redirects, with size and time limits.
- **Clickjacking.** The consent page refuses to work in a frame; the login server's answers send
  `X-Frame-Options: DENY` and `frame-ancestors 'none'`.
- **Token misuse.** Audience is the MCP address only; the lifetime is checked; the signature
  algorithm is fixed; tokens of another issuer, `alg: none` and unknown key ids are refused.
- **Timing.** Proofs and handles are compared in constant time or by their SHA-256 digests;
  codes, refresh tokens and request handles are stored only as digests.
- **Errors.** Answers say what is wrong in general words (`invalid_grant`) and never why a
  specific token failed; logs carry reason codes, never tokens, codes, people or addresses.

Known limits of the first build: disconnecting refuses access tokens at once only in the process
that disconnected (one process today; several instances need a shared list, or they wait out the
ten minutes); rate counts live in one process; a deactivated person's access token works until it
expires (at most ten minutes), and their refresh fails. After a restart the service reads the
disconnects of the last eleven minutes; until it has, it refuses every access token issued before
it started (apps get new ones with their refresh tokens), and it tries again every 30 seconds.

## Out of scope

A company identity provider (OpenID Connect) as the identity connector; the Connect page's
content; hosting and reach from the internet over public HTTPS (FR-413, OQ-4); private-use URI
schemes for redirects; confidential clients and `private_key_jwt`; token introspection;
per-app scopes or tools beyond the shared `signed-in` client policy.
