# Self-host Heed on one computer

How to run Heed with `docker compose` on one computer, back it up, restore it, upgrade it and roll
an upgrade back.

> **For local evaluation, not for production use.** This setup signs people in with the demo's
> people picker, so anyone who reaches it can be an administrator. The database trusts every
> connection inside its container network, and nothing is encrypted in transit. Keep both ports on
> this computer, as `compose.yaml` does, and put no company data in it that this computer may not
> hold. Company sign-in with OpenID Connect is in [How AI sign-in works](ai-sign-in.md).

## What runs

`docker compose up` ([compose.yaml](../compose.yaml), [Dockerfile](../Dockerfile)) starts three
containers and keeps two volumes:

| Part   | What it is                                                                                                 | Address                  |
| ------ | ---------------------------------------------------------------------------------------------------------- | ------------------------ |
| `db`   | PostgreSQL 18, with all of Heed's data, in the volume `db`                                                 | none outside the network |
| `heed` | The service: the API, the MCP server for agents and the scheduled jobs, with its keys in the volume `keys` | http://localhost:3000    |
| `web`  | The web app, served by nginx, which forwards `/api/v1` to the service                                      | http://localhost:8080    |

Compose names the volumes after the project, which is the folder's name unless you set one:
`heed_db` and `heed_keys` for a clone in a folder called `heed` (`docker volume ls` lists them).

Both containers run as unprivileged users (`node` and `nginx`), and each has a health check, so
`docker compose ps` says when it is ready. The base images are pinned by digest.

## Install

You need Docker Engine 25 or later with Compose v2 (Docker Desktop, Colima or Docker on Linux).

```sh
git clone https://github.com/Fredehagelund92/heed.git && cd heed
docker compose up -d --wait   # builds the images, prepares the database, waits until all is ready
```

Then open http://localhost:8080. The first start takes a few minutes: it builds both images and
loads the demo. Settings for `docker compose up`:

| Variable         | Default          | What it does                                                                                  |
| ---------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `HEED_WEB_PORT`  | `8080`           | The web app's port on this computer                                                           |
| `HEED_PORT`      | `3000`           | The service's port on this computer, where agents connect (`/mcp`)                            |
| `SEED_DEMO`      | `on`             | Loads the demo into a new, empty database                                                     |
| `CUBE_MODEL_DIR` | `./db/seed/cube` | Your own Cube model's folder, read only ([Use your own data](../README.md#use-your-own-data)) |

Check it: `docker compose ps` shows each part `healthy`, and `docker compose logs heed` shows what
the start did, such as `applied 33 migrations`.

## What to back up

| What                                  | Where                                        | Why                                                                                                                                                                                                                                                                                    |
| ------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The database                          | the volume `db`                              | Everything people wrote and decided, the history log, agents' access and the settings. Back it up with `pg_dump`, never by copying the volume's files while it runs.                                                                                                                   |
| The keys                              | the volume `keys`, `/var/lib/heed` in `heed` | The keys the service made on its first start: `oauth-key.pem` signs agents' access, `mcp-state.key` seals the questions an agent's draft carries, `mcp-dev-key.pem` signs local MCP tokens. Without them every connected agent must sign in again, and sealed drafts cannot be opened. |
| The secret store, when it is set      | the folder `CL_SECRETS_DIR` names            | The tokens of the sources added in Settings ([connector security](connectors/security.md)). `compose.yaml` sets none, so in containers no source with a token can be added; running from source, back this folder up with the database.                                                |
| Your own Cube model, when you use one | the folder `CUBE_MODEL_DIR` names            | Heed only reads it. It is yours and lives wherever you keep it.                                                                                                                                                                                                                        |

The keys and the secret store are secrets: keep their backups where only you can read them.

## Back up

With Heed running, from the clone's folder:

```sh
docker compose exec -T heed sh -c 'pg_dump --format=custom --dbname="$DATABASE_URL_MIGRATE"' > heed.dump
docker compose exec -T heed tar -C /var/lib/heed -cf - . > heed-keys.tar
```

`heed.dump` is the whole database in PostgreSQL's custom format, taken in one consistent snapshot
while Heed keeps running. `heed-keys.tar` holds the three key files. Copy both off this computer.

### Prove the backup restores: the restore drill

```sh
docker compose exec heed node src/server/run-restore-drill.ts
```

The [restore drill](security.md#security-scanning-and-the-restore-drill) takes a backup the same
way (`pg_dump --format=custom`), restores it into a new scratch database in one transaction,
proves the copy is the same database (every table's rows, every sequence, every edition's digest,
every item's content digest and the history log's hash chain), drops the copy and ends with
`PASSED` or `FAILED`. It takes about a minute on the demo and changes nothing in Heed's database.
Run it before every upgrade, and now and then on its own, so a backup is known to restore before
you need one.

## Restore

To bring back a backup, onto this computer or a new one with the same version of Heed checked out:

```sh
docker compose down --volumes            # only when replacing what is there: this deletes it
docker compose up -d --wait db
docker compose run --rm --no-deps -e SEED_DEMO=off heed node db/prepare.ts   # Heed's roles
docker compose exec -T db dropdb -U postgres heed
docker compose exec -T db createdb -U postgres --owner=context_layer_owner --template=template0 heed
docker compose exec -T db pg_restore -U postgres --dbname=heed --single-transaction --exit-on-error < heed.dump
docker compose run --rm --no-deps -T heed tar -C /var/lib/heed -xf - < heed-keys.tar
docker compose up -d --wait
```

`db/prepare.ts` makes Heed's database roles, which a dump does not carry, and an empty database,
which the next two lines replace with the backup's. On the next start the service applies no
migration (`applied 0 migrations` in `docker compose logs heed`) and loads no demo, because the
database holds data. People's sessions are in the database, so whoever was signed in still is,
and agents stay connected because the keys came back with it.

## Upgrade

Heed's database migrations only go forward: there are no down migrations, and an applied
migration is never changed (`db/README.md`). An older version refuses a database a newer one has
migrated. So an upgrade starts with a backup that is known to restore.

1. Read the release notes of every version between yours and the new one.
2. [Back up](#back-up) the database and the keys, and run the [restore drill](#prove-the-backup-restores-the-restore-drill). Go on only when it says `PASSED`.
3. Get the new version and start it:

   ```sh
   git fetch --tags && git checkout <new version>
   docker compose build
   docker compose up -d --wait
   ```

4. Check `docker compose logs heed`: the start says how many migrations it applied. Open the web
   app and see your data.

The service applies the new migrations when it starts, before it serves, each in a transaction of
its own. If one fails, the service stops with the reason: that migration's changes are not kept,
and the ones before it are. Either fix the cause and start again, or [roll back](#roll-back).

## Roll back

Because migrations only go forward, rolling back means going back to the backup from step 2 of
the upgrade. Anything written since that backup is lost, so roll back soon or not at all.

```sh
git checkout <previous version>
docker compose build
```

Then [restore](#restore) `heed.dump` and `heed-keys.tar` from before the upgrade. Starting the
previous version on the upgraded database without a restore does not work: the service stops with
`Migration history differs at ...`, and that is on purpose.

## Running from source instead

With `npm run dev:server` ([Run the service locally](operations.md#run-the-service-locally)) the
same parts live elsewhere:

- the database is the one `DATABASE_URL_MIGRATE` in `.env.local` names. Back it up with
  `pg_dump --format=custom --dbname="$DATABASE_URL_MIGRATE" > heed.dump` and prove it with
  `npm run db:restore-drill` (both need PostgreSQL 18's `pg_dump` and `pg_restore` on `PATH`);
- the keys are the files `MCP_DEV_KEY_FILE`, `CL_MCP_STATE_KEY_FILE` and
  `CL_OAUTH_SIGNING_KEY_FILE` name, `.heed-*.pem` and `.heed-mcp-state.key` in the clone by
  default;
- the secret store is the folder `CL_SECRETS_DIR` names, when it is set.

## The web image

What the `web` image does for a browser, checked by `scripts/check-web-image.ts` in CI:

- **Compression.** Every script, style and text file ships gzipped at the highest level beside
  the original, and the service's JSON is gzipped on the way. The app's first load is about a
  third of its raw size on the wire.
- **Security headers.** A Content-Security-Policy that runs only the app's own scripts and the
  one inline script that sets the theme (by its hash), and allows no framing;
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin` and a
  `Permissions-Policy` that turns off the camera, microphone and location. The service sets its
  own on what it answers, on port 3000 too.
- **HSTS only behind HTTPS.** The image serves plain http and sends
  `Strict-Transport-Security` only when a proxy in front of it ended TLS and says so with
  `X-Forwarded-Proto: https`. Over plain http it never sends it, since that would pin every other
  local app on `localhost` to https.
- **Real 404s.** A missing file, such as `/assets/old.js` or `/sitemap.xml`, is a 404. Every other
  address opens the app, which knows its own pages.
- **robots.txt and llms.txt.** `robots.txt` keeps search engines out. `llms.txt` and
  `/docs/llms-full.txt` give an agent the documentation as text ([llmstxt.org](https://llmstxt.org)).
