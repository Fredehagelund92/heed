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
3. The browser returns to the app. Its tools work as you. On **Connect an agent** (the user
   menu, or Settings) you see every app connected as you, and **Disconnect** ends one at once.

An administrator sees every person's connections in Administration, MCP and gateway,
**Connections** (`agentConnections.list`): the person, the agent's own name and where it came from, its
scopes, when it connected, last refreshed and ends. **Disconnect** there ends one connection, or
every connection of one person in one step (`agentConnections.disconnect`,
`agentConnections.disconnectPerson`), through the same revocation as the person's own: the refresh
tokens end and the MCP server refuses the access tokens at their next request. A reason is required
and kept in the history log; the person does not see it. In the new app it is Settings, Agents and
access, where **Revoke** ends every connection of that agent for that person.

While Connect an agent waits for the person's own agent, its live line asks the service every 3
seconds (`connect.pending`, FR-418) for the newest of two things since the wait began: the agent
collected its tokens (connected), or the person chose **Deny** on the consent screen (declined).
Both are named by the agent's own name for itself. Allowing alone is not yet a connection: the
agent still has to exchange its code. A **Deny** is kept for an hour, for that person alone, as
who said it, the app's name and when (`auth.oauth_declines`, migration 0018); nothing else of the
sign-in is kept, and the history log is not told, as nothing changed.

An app needs either a client ID metadata document (preferred by the MCP specification) or
dynamic client registration, which is on by default outside production and requires an explicit
opt-in in production (see the settings). An app
that supports neither cannot sign in: an administrator gives it an access key (below), and
locally its people can keep using `npm run token:dev`.

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
- **Suggestions.** With the `propose` scope, which a sign-in grants by default and the consent
  page names, a person's app may call `suggest_context` (FR-121), on by default: after the person
  says yes, it saves the suggestion as the person and sends it for review, so it waits for the
  owner of its domain, who checks it and publishes it. If the review checks refuse it, it stays the
  person's draft. `draft_context`, its deprecated id, saves an unsubmitted draft as before. It is
  the only MCP call that names the person, as the proposer, on the proposal and its history; the
  request log still keeps only `signed-in`. A dev token names no person, so it is refused. When the
  app can show forms, the tool asks its open questions there first, in a request state bound to the
  tool, the person and the app (`CL_MCP_STATE_KEY_FILE`, below).
- **Rates.** Per caller address and minute: discovery 120, registration 10, authorize 30, token
  60, revocation 30; the web API's own limits cover the consent operations. Failed token requests
  count per client and caller address, 30 a minute; successful code exchanges and refreshes never
  count against the client, so one client's people are not locked out by junk sent under its public
  ID from another address. One connection refreshes at most 5 times a minute.

## Access keys for bots and scheduled jobs

A bot or a scheduled job that can't sign in uses an access key. An administrator creates one in
Settings, Agents and access, **Tools and access keys**, **Create an access key**
(`accessKeys.create`). The job sends it as its bearer token to the MCP address, as an agent sends
its access token.

- **Shown once.** The key is in the answer that made it, and only there: the page offers to copy
  it, and it is never shown again. The service keeps its SHA-256 only, and that answer is never
  kept for a retry. A key is `hak_` and 43 random characters (256 bits).
- **No person.** A key acts as a service with the `read` and `feedback` scopes. It names no person,
  so `suggest_context` refuses it, as it refuses a dev token, and it reads the live edition. Every
  key shares the client label `access-key` in the MCP request log, deliveries and client policies
  (FR-410), where an administrator can switch it off or give it a rate; the per-person rate counts
  each key on its own.
- **Listed and revoked.** Connected agents lists each key as **Access key**, by who made it, since
  when and when it was last used (to the minute), in `agentConnections.list`. **Revoke** there
  (`agentConnections.disconnect`, with a reason the history log keeps) ends it at once: the MCP
  server asks the database about the key at every request, through one function the serving role
  may call (`serving_access_key`), and reads no key. A key lasts until it is revoked; one whose
  maker leaves keeps working until an administrator revokes it.
- **Logs.** The history log records `access_key.created` and `access_key.revoked`, by the
  administrator, never with the key or its digest. A refused key is logged as `MCP token
rejected` with a reason code (`unknown_key`, `revoked`, `malformed`) and the client label only.

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
- **Leaked access key.** It names no person and can only read context and give feedback;
  revoking it refuses it at the next request, in every process, since each request asks the
  database. Only its digest is stored, so a copy of the database holds no working key.
- **Errors.** Answers say what is wrong in general words (`invalid_grant`) and never why a
  specific token failed; logs carry reason codes, never tokens, codes, people or addresses.

Known limits of the first build: disconnecting refuses access tokens at once only in the process
that disconnected (one process today; several instances need a shared list, or they wait out the
ten minutes); rate counts live in one process. Removing a person from the workspace ends their
connections in the same step (`person_inactive`), so their access tokens are refused at once. After a restart the service reads the
disconnects of the last eleven minutes; until it has, it refuses every access token issued before
it started (apps get new ones with their refresh tokens), and it tries again every 30 seconds.

## Signing in to the web app with your company's provider (OIDC)

People sign in to the web app with the company's OpenID Connect provider (FR-416): Okta, Microsoft
Entra ID, Google, Keycloak, Auth0 or any other that publishes a discovery document. There is no
provider-specific code. SAML providers work through an OIDC broker (Keycloak, Dex, or the
provider's own OIDC bridge); Heed speaks OIDC only. The agent sign-in above then signs a person in
through the same web session.

### Set it up

1. At the provider, register a web application: the authorization code flow, the redirect address
   `https://<your Heed address>/api/v1/auth/oidc/callback` (or the one in `CL_OIDC_REDIRECT_URL`),
   and the scopes `openid email profile` (add the provider's groups scope for group mapping).
   Either a public client (PKCE, no secret) or a confidential one with a secret.
2. Set `CL_AUTH=oidc` (the default in production), `CL_OIDC_ISSUER` and `CL_OIDC_CLIENT_ID`. For a
   confidential client, write the secret to a file only the service's user may read and name it:
   `printf %s "$SECRET" > oidc-secret && chmod 600 oidc-secret`, then
   `CL_OIDC_CLIENT_SECRET_FILE=oidc-secret`. The service refuses a file others may read, and never
   reads the secret from an environment value.
3. Invite the first admin: `DATABASE_URL_MIGRATE=<the owner's address> npm run heed -- invite
you@company.example --admin` prints a link that works for a week. Or map an admin group
   (`CL_OIDC_ADMIN_GROUPS`). After that, admins invite everyone else in Settings, People.
4. Serve the web app and this service on the same host (one origin behind your proxy is simplest):
   the session cookie the callback sets belongs to that host.

| Variable                     | Default                                                        | Meaning                                                                                                            |
| ---------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `CL_AUTH`                    | `oidc` in production; `dev` elsewhere                          | `oidc`, or the picker from `CL_DEV_PEOPLE_FILE`: `dev` locally, `demo` for demos. Production refuses both pickers. |
| `CL_OIDC_ISSUER`             | none (required for `oidc`)                                     | The provider's issuer, exactly as its discovery document names it.                                                 |
| `CL_OIDC_CLIENT_ID`          | none (required for `oidc`)                                     | This app's client id at the provider.                                                                              |
| `CL_OIDC_CLIENT_SECRET_FILE` | none: a public client                                          | An owner-only file (mode 0600) with a confidential client's secret.                                                |
| `CL_OIDC_REDIRECT_URL`       | the origin of `MCP_RESOURCE_URL`, `/api/v1/auth/oidc/callback` | The redirect address registered at the provider.                                                                   |
| `CL_OIDC_SCOPES`             | `openid email profile`                                         | What to ask for; `openid` is required.                                                                             |
| `CL_OIDC_GROUPS_CLAIM`       | `groups`                                                       | The ID token claim that lists the person's groups.                                                                 |
| `CL_OIDC_ADMIN_GROUPS`       | none                                                           | Groups whose members may sign in without an invite, as an Admin. Comma-separated.                                  |
| `CL_OIDC_MEMBER_GROUPS`      | none                                                           | Groups whose members may sign in without an invite, as a Member. Comma-separated.                                  |
| `CL_OIDC_NAME`               | "your company account"                                         | The provider's name on the sign-in button, such as Okta.                                                           |
| `CL_SESSION_IDLE_HOURS`      | `12`                                                           | A browser session ends after this many hours unused.                                                               |
| `CL_SESSION_MAX_DAYS`        | `7`                                                            | A browser session ends this many days after sign-in, used or not.                                                  |

### Who may sign in

- A person whose account at the provider is linked to them: the link is made at their first
  sign-in and found by the provider's issuer and subject afterwards, so a changed address at the
  provider still signs in the same person. Someone an admin removed is refused, until an admin
  invites their address again: the invite, by the verified address, brings back the same person
  on the same link.
- An active person, or an address with an open invite, by an email address the provider says it
  has verified (`email_verified`). The invite is accepted then: the person is made, with its role
  and domains (Settings, People; FR-417).
- A member of a mapped group: they join as a Member, or an Admin for the admin group. An Admin
  role the admin group gave ends at a sign-in outside the group, unless no other admin would be
  left; an Admin role given any other way is not the group's to end. Someone an admin removed does
  not come back through a group, only on an admin's invite.

Anyone else is sent back to the sign-in screen with one plain answer (`not_allowed`), the same
whether the address is unknown, removed, or already linked to another account. People who
signed in with the dev picker keep their rows and roles: their first OIDC sign-in by a verified
address that matches links their account.

### How a sign-in goes

`GET /api/v1/auth/oidc/start?returnTo=<path>` reads the provider's discovery document (kept an
hour), stores the sign-in for ten minutes (the SHA-256 of a random `state`, a random `nonce`, a
PKCE verifier, the path to go back to) tied to this browser by the cookie `heed_oidc_browser`
(HttpOnly, SameSite=Lax, on the callback's path, ten minutes), and sends the browser to the
provider with `S256` as the PKCE method. The callback takes the stored sign-in by its state and
deletes it whatever happens next, checks the browser cookie, the provider's `iss` (RFC 9207),
exchanges the code with the verifier (and the secret, in the Authorization header, for a
confidential client), and checks the ID token: its signature by the provider's published keys
(RSA, RSA-PSS, ECDSA or EdDSA; never `none` or a shared-secret algorithm), the issuer, the audience
(this client), the authorized party when there are several audiences, the expiry and issue time
(a minute of clock skew), and the nonce. It then makes a new session, ends the one the browser had,
and sends the browser to the path it started from on the first `CL_WEB_ORIGINS` origin, or to
`/#/signin?error=<reason>` with `cancelled`, `expired`, `unavailable`, `failed`,
`email_unverified` or `not_allowed`.

`GET /api/v1/auth/methods` tells the sign-in screen which way this install signs in;
`GET /api/v1/invites/lookup?token=` tells it what an invite link says (the address, the role, the
domains), and answers every other link alike.

### Threat note: company sign-in

- **Stolen or replayed authorization code.** Useless without the PKCE verifier, which never leaves
  the server; the provider takes a code once. The callback's address, which holds the code, sends
  no referrer and is never cached; logs drop query strings.
- **Login CSRF and a sign-in finished in someone else's browser.** The stored sign-in is found by
  its random state and must come back to the browser that started it (its cookie's SHA-256); it is
  deleted at first use, so a replay, a link sent to someone else or a second tab is refused.
- **Token substitution and replay.** The nonce in the ID token must be the one stored for this
  sign-in; the audience must be this client and, with several audiences, the authorized party too.
- **Mix-up attack.** The provider's `iss` with the code must be the configured issuer, and is
  required when the provider says it sends one.
- **Forged ID token.** Only keys from the provider's key set (read again once when a token names
  an unknown key), only asymmetric algorithms the provider lists; `alg: none`, HMAC, a foreign key,
  another issuer and an expired token are refused.
- **Session fixation.** Every sign-in makes a new session token and CSRF token and ends the
  session the browser had; a session id planted before sign-in is worth nothing after it.
- **Session theft.** The session cookie is HttpOnly, SameSite=Strict, Secure when the redirect
  address is https, and kept only as its SHA-256. A session ends after the idle limit and at its
  absolute end, and at once when the person is removed; every change still needs the session's
  CSRF token and an allowed origin.
- **Account takeover by email.** An address is trusted only when the provider says it is verified,
  and once an account is linked the person is found by the provider's subject, never by address
  again; another account with the same address is refused.
- **Who is invited, who is in (enumeration).** Every refused person gets the same answer; an
  invite link's lookup answers the same for every token that does not open an invite; invites are
  accepted only by the verified address they name.
- **Privilege from stale invites and groups.** An invite gives only what its sender may still give
  when it is accepted; an Admin role from the admin group ends when the person leaves the group.
- **Open redirect.** The callback goes back only to a path on the first web origin; anything else
  goes to `/`.
- **Secret handling.** The client secret is read from an owner-only file at start and never
  logged; an operator invite needs the database owner's credential. Sign-in log lines
  (`event: web_sign_in`) carry the result and a reason code only, never a code, a token, a state,
  an address or an account.
- **Server-side request forgery.** The service calls only the configured issuer's discovery
  document and the addresses it names, over https (http on this computer only, for tests), without
  redirects, with a time limit.

Known limits: signing out ends the Heed session, not the session at the provider; the provider's
groups are read from the ID token only (not the userinfo endpoint), so a provider that sends them
elsewhere needs a claim mapping there; a provider that never says an address is verified (some
directories leave `email_verified` out of the ID token) signs nobody in, because Heed links no
account by an unverified address, and trusting such a provider's addresses would be a setting to
add; audience groups for items (FR-405) are not read from the provider yet.

## Out of scope

The Connect page's content; hosting and reach from the internet over public HTTPS (FR-413, OQ-4); private-use URI
schemes for redirects; confidential clients and `private_key_jwt`; token introspection;
per-app scopes or tools beyond the shared `signed-in` client policy.
