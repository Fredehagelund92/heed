---
title: Where to run Heed
line: Docker Compose, a cloud host or container platform, or Vercel for the demo, and what each one asks of you.
group: Run the service
order: 1
reviewed: 2026-11-03
---

Heed has three parts: the service, the web app and a PostgreSQL 18 database. There are three ways to
run them. Docker Compose is the default, and the [Quick start](../README.md#quick-start) uses it.
To run Heed for your own team, run the same images on a host you choose. Vercel with Neon is only
for the demo.

|                          | Docker Compose                                                  | A cloud host or container platform                                                  | Vercel with Neon                                                        |
| ------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| What it is for           | Trying Heed on one computer                                     | Running Heed for your own team, on AWS, Railway, Fly or another host                | The demo, and nothing else                                              |
| What you run             | `docker compose up`: PostgreSQL 18, the service and the web app | The service image, the web image and a managed PostgreSQL 18, behind an https proxy | A Vercel project with the service as a function, and a database on Neon |
| What you manage yourself | The computer, Docker, and the backups                           | The database, the https proxy, the keys, sign-in, backups and upgrades              | The demo's snapshot, its roles and its settings                         |
| What has been tested     | CI starts it with the demo                                      | CI boots the images in production mode. No named host has been tested               | Tests build the function and call it, without deploying it              |

## Docker Compose

[Self-host Heed on one computer](self-hosting.md) says how to install it, back it up, restore it,
upgrade it and roll an upgrade back. `compose.yaml` sets `NODE_ENV` to `development`, which turns on
the demo's people picker, so keep both ports on this computer.

## A cloud host or container platform

This is the way to run Heed for real people. It asks three things of a host: it runs containers,
keeps a folder between restarts, and ends https in front of them.

> **Not tested on a named host.** CI boots both images in production mode, against a stand-in
> sign-in provider and a PostgreSQL 18 container (`tests/image/production-boot.sh`). The project has
> not tested them on AWS, Railway, Fly or a managed PostgreSQL, so this page gives no steps for any
> of them. Expect to work out the host's own part yourself.

[Run the image in production mode](operations.md#run-the-image-in-production-mode) has the steps and
the settings, [the database guide](../db/README.md) says how to set up the roles, and
[How AI sign-in works](ai-sign-in.md) has every sign-in setting.

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

This runs Heed's demo only. [Run the demo on Vercel and Neon](vercel.md) has the whole setup. It is
not a way to run Heed for your own team.
