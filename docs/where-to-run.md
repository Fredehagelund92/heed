# Where to run Heed

Heed has three parts: the service, the web app and a PostgreSQL 18 database. There are three ways to
run them. Docker Compose is the default, and the [Quick start](../README.md#quick-start) uses it.
To run Heed for your own team, run the same images on a host you choose. Vercel with Neon is only
for the demo.

|                            | Docker Compose                                                  | A cloud host or container platform                                                  | Vercel with Neon                                                        |
| -------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| What it is for             | Trying Heed on one computer                                     | Running Heed for your own team, on AWS, Railway, Fly or another host                | The demo, and nothing else                                              |
| What you run               | `docker compose up`: PostgreSQL 18, the service and the web app | The service image, the web image and a managed PostgreSQL 18, behind an https proxy | A Vercel project with the service as a function, and a database on Neon |
| What you manage yourself   | The computer, Docker, and the backups                           | The database, the https proxy, the keys, sign-in, backups and upgrades              | The demo's snapshot, its roles and its settings                         |
| The setting people trip on | `NODE_ENV`                                                      | `HEED_TRUSTED_PROXIES`                                                              | `DATABASE_URL`                                                          |
| What has been tested       | CI starts it with the demo                                      | CI boots the images in production mode. No named host has been tested               | Tests build the function and call it, without deploying it              |

## Docker Compose

[Self-host Heed on one computer](self-hosting.md) says how to install it, back it up, restore it,
upgrade it and roll an upgrade back.

The setting to know is `NODE_ENV`. `compose.yaml` sets it to `development`, which turns on the
demo's people picker: anyone who reaches Heed can sign in as anyone, an administrator included.
That is why both ports stay on this computer. Do not open them to a network. To run Heed for other
people, use the next way, where the image's own default, `production`, applies.

## A cloud host or container platform

This is the way to run Heed for real people. It asks three things of a host: it runs containers,
keeps a folder between restarts, and ends https in front of them.

> **Not tested on a named host.** CI boots both images in production mode, against a stand-in
> sign-in provider and a PostgreSQL 18 container (`tests/image/production-boot.sh`). The project has
> not tested them on AWS, Railway, Fly or a managed PostgreSQL, so this page gives no steps for any
> of them. Expect to work out the host's own part yourself.

### What you run

- **The service**, `ghcr.io/fredehagelund92/heed`. It listens on port 3000 (`PORT`). Each start
  applies new migrations, then serves. `/health/ready` answers once it reaches the database.
- **The web app**, `ghcr.io/fredehagelund92/heed-web`. It listens on port 8080. Set `HEED_API_URL`
  to the address where it reaches the service.
- **PostgreSQL 18**, from whichever provider you choose.
- **An https proxy**, your host's or your own. Send `/api/v1/`, `/mcp`, `/oauth/` and
  `/.well-known/oauth-*` to the service directly, and the rest to the web image.

Name a version, such as `0.1.0`, rather than `latest`, so an upgrade is a step you take.

[Run the image in production mode](operations.md#run-the-image-in-production-mode) has the steps,
and [How AI sign-in works](ai-sign-in.md) has every sign-in setting.

### The database

Without a superuser's address the image does not make Heed's roles or its database, so make them
first. As an administrator of the server:

```sql
create role context_layer_owner login password '<password>' nosuperuser nocreaterole noinherit nobypassrls createdb;
create database heed owner context_layer_owner;
create role context_layer_api login password '<password>' nosuperuser nocreaterole noinherit nobypassrls nocreatedb;
create role context_layer_serve login password '<password>' nosuperuser nocreaterole noinherit nobypassrls nocreatedb;
create role context_layer_readonly login password '<password>' nosuperuser nocreaterole noinherit nobypassrls nocreatedb;
```

Check that the provider gives these roles nothing more: a runtime role must not be a superuser or
bypass row security, and the service does not check that when it starts ([db/README.md](../db/README.md)).

The migrations need no superuser. They add two extensions, `btree_gist` and `pg_trgm`, which
PostgreSQL lets a database's owner add where the provider offers them.

### The settings

| Setting                                   | Value                                                                                                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL_MIGRATE`                    | `context_layer_owner`, on a direct address: migrations take a session lock. Unset, it is a local address                                                                |
| `DATABASE_URL`                            | `context_layer_api`, on a direct address too: the service keeps a session open to hear of new changes                                                                   |
| `DATABASE_URL_SERVE`                      | `context_layer_serve` with its own password. Unset, it is `DATABASE_URL` with the user changed and the password dropped                                                 |
| `HEED_OIDC_ISSUER`, `HEED_OIDC_CLIENT_ID` | Your OpenID Connect provider and this app's client id there. Production refuses to start without them                                                                   |
| `MCP_RESOURCE_URL`                        | The https address of the MCP server, such as `https://heed.example.com/mcp`. Unset, it is on localhost, and production refuses to start on an address that is not https |
| `HEED_WEB_ORIGINS`                        | The web app's address on the same host, such as `https://heed.example.com`. A change from any other address is refused                                                  |
| `HEED_TRUSTED_PROXIES`                    | The proxy in front, as [the next part](#the-proxy-in-front) says                                                                                                        |

Leave `NODE_ENV` as the image sets it, `production`. Leave `DATABASE_URL_BOOTSTRAP` unset, and
`SEED_DEMO` off: production refuses the demo data.

Production makes no keys of its own. Run `node src/server/create-keys.ts` once, in a folder that
outlasts the container and that the image's user, `node`, may write to: `/var/lib/heed` by default.
Back that folder up with the database ([What to back up](self-hosting.md#what-to-back-up)). If you
run several instances, each needs the same keys, and each counts request limits on its own.

### The proxy in front

`HEED_TRUSTED_PROXIES` is the setting people trip on. It names the addresses the proxy connects
from: addresses, ranges such as `10.0.0.0/8`, or `loopback`, `linklocal` and `uniquelocal`,
comma-separated. Your host's documentation says which ones apply.

Left unset, the service sees the proxy as the only caller and http as the only protocol:

- Every caller shares one request limit before sign-in, 120 a minute, so one caller can lock
  sign-in for everyone else.
- The session cookie is not marked `Secure`.

Name only what the proxy connects from. Anything else that can connect from an address you name
can say it is any caller, and so get around the limit.

The web image's nginx does not help here. It overwrites `X-Forwarded-For` and `X-Forwarded-Proto`
with what it sees, so behind another proxy it hides the caller's address and the https. That is why
`/api/v1/` goes to the service directly.

## Vercel with Neon

This runs Heed's demo. It leaves out the scheduled jobs, the MCP server and the login server for
agents, so it is not a way to run Heed for your own team.
[Run the demo on Vercel and Neon](vercel.md) has the whole setup, and the settings only it uses.

The setting to know is `DATABASE_URL`, which goes on Neon's pooled address, while the restore and
the migrations take the direct one.

The function also sets `HEED_TRUSTED_PROXIES=vercel` for itself. That value believes whoever
connects, so never use it on another host.
