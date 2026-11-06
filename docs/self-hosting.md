---
title: Self-host Heed on one computer
line: Run it with docker compose on one computer, back it up, restore it, upgrade it and roll an upgrade back.
group: Run the service
order: 2
reviewed: 2026-11-05
---

Run it with `docker compose` on one computer, back it up, restore it, upgrade it and roll an upgrade back. To run it anywhere else, see [Where to run Heed](where-to-run.md).

> **For local evaluation, not for production use.** Anyone who reaches this setup can sign in as an admin, the database trusts every connection in its container network, and nothing is encrypted in transit. Keep both ports on this computer, as `compose.yaml` does, and put no company data in it that this computer may not hold.

## Install

You need Docker Engine 25 or later with Compose v2: Docker Desktop, Colima or Docker on Linux.

```sh
git clone https://github.com/Fredehagelund92/heed.git && cd heed
docker compose up -d --wait   # builds the images, prepares the database, waits until all is ready
```

Then open http://localhost:8080. The first start takes a few minutes, as it builds both images and loads the demo.

To check it, `docker compose ps` shows each part `healthy`, and `docker compose logs heed` shows what the start did.

| Setting          | Default | What it does                                                                                  |
| ---------------- | ------- | --------------------------------------------------------------------------------------------- |
| `HEED_WEB_PORT`  | `8080`  | The web app's port on this computer                                                           |
| `HEED_PORT`      | `3000`  | The service's port on this computer, where agents connect (`/mcp`)                            |
| `SEED_DEMO`      | `on`    | Loads the demo into a new, empty database                                                     |
| `CUBE_MODEL_DIR` | Unset   | Your own Cube model's folder, read only ([Use your own data](../README.md#use-your-own-data)) |

## What runs

| Part   | What it is                                                                | Address                  |
| ------ | ------------------------------------------------------------------------- | ------------------------ |
| `db`   | PostgreSQL 18, with all the data, in the volume `heed_db`                 | None outside the network |
| `heed` | The API, the MCP server for agents and the jobs, with keys in `heed_keys` | http://localhost:3000    |
| `web`  | The web app, served by nginx, which forwards `/api/v1` to the service     | http://localhost:8080    |

A third volume, `heed_no-model`, stays empty. It stands where your own model's folder goes when you name none.

## If the start goes wrong

- **Your own model's folder arrives empty.** When Docker cannot read the folder, the service refuses to start and says so in `docker compose logs heed`. On a Mac, Docker Desktop shares only the folders under Settings, Resources, File sharing, and Colima shares your home folder unless told otherwise.
- **The demo is half loaded.** The start stops with `The demo is half loaded` and the cause. The demo is not retried: run `docker compose down --volumes`, then `docker compose up` again.

## What to back up

| What                                  | Where                               | Why                                                                                       |
| ------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------- |
| The database                          | The volume `heed_db`                | Everything people wrote and decided, the history log, agents' access and the settings     |
| The keys                              | The volume `heed_keys`              | Without them every connected agent must sign in again, and sealed drafts cannot be opened |
| The secret store, when it is set      | The folder `HEED_SECRETS_DIR` names | The tokens of sources added in Settings. `compose.yaml` sets none                         |
| Your own Cube model, when you use one | The folder `CUBE_MODEL_DIR` names   | It is only read here. It is yours, and lives wherever you keep it                         |

The keys and the secret store are secrets, so keep their backups where only you can read them. Never copy the database volume's files while it runs.

## Back up

With everything running, from the clone's folder:

```sh
docker compose exec -T heed sh -c 'pg_dump --format=custom --dbname="$DATABASE_URL_MIGRATE"' > heed.dump
docker compose exec -T heed tar -C /var/lib/heed -cf - . > heed-keys.tar
```

`heed.dump` is the whole database, taken in one consistent snapshot while the service keeps running. `heed-keys.tar` holds the three key files. Copy both off this computer.

### Prove the backup restores: the restore drill

```sh
docker compose exec heed npm run db:restore-drill
```

It takes a backup the same way, restores it into a scratch database, and proves the copy is the same. It then drops the copy and ends with `PASSED` or `FAILED`. See [what it checks](security.md#the-restore-drill).

It takes about a minute on the demo and changes nothing in your database. Run it before every upgrade, and now and then on its own.

## Restore

To bring back a backup, onto this computer or a new one with the same version checked out:

```sh
docker compose down --volumes            # only when replacing what is there: this deletes it
docker compose up -d --wait db
docker compose run --rm --no-deps -e SEED_DEMO=off heed npm run db:migrate   # makes the roles
docker compose exec -T db dropdb -U postgres heed
docker compose exec -T db createdb -U postgres --owner=context_layer_owner --template=template0 heed
docker compose exec -T db pg_restore -U postgres --dbname=heed --single-transaction --exit-on-error < heed.dump
docker compose run --rm --no-deps -T heed tar -C /var/lib/heed -xf - < heed-keys.tar
docker compose up -d --wait
```

The third line makes the database roles, which a dump does not carry. The next three lines replace the empty database with the backup.

On the next start, `docker compose logs heed` says `applied 0 migrations`, and no demo is loaded. Whoever was signed in still is, and agents stay connected, because the keys came back too.

## Upgrade

Database migrations only go forward, and an older version refuses a database a newer one has migrated. So an upgrade starts with a backup that is known to restore.

1. Read the release notes of every version between yours and the new one.
2. [Back up](#back-up) the database and the keys, and run the [restore drill](#prove-the-backup-restores-the-restore-drill). Go on only when it says `PASSED`.
3. Get the new version and start it:

   ```sh
   git fetch --tags && git checkout <new version>
   docker compose build
   docker compose up -d --wait
   ```

4. Check `docker compose logs heed`, which says how many migrations it applied. Open the web app and see your data.

The service applies new migrations before it serves, each in a transaction of its own. If one fails, the service stops with the reason. That migration's changes are not kept, and the ones before it are. Fix the cause and start again, or [roll back](#roll-back).

## Roll back

Rolling back means going back to the backup from step 2 of the upgrade. Anything written since is lost, so roll back soon or not at all.

```sh
git checkout <previous version>
docker compose build
```

Then [restore](#restore) `heed.dump` and `heed-keys.tar` from before the upgrade. Without a restore, the previous version stops with `Migration history differs at ...`, on purpose.

## Running from source instead

With [`npm run dev:server`](operations.md#run-the-service-locally) the same parts live elsewhere:

| Part             | Where it is                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| The database     | The one `DATABASE_URL_MIGRATE` names in `.env.local`                                                         |
| The keys         | The files `MCP_DEV_KEY_FILE`, `HEED_MCP_STATE_KEY_FILE` and `HEED_OAUTH_SIGNING_KEY_FILE` name, in the clone |
| The secret store | The folder `HEED_SECRETS_DIR` names, when it is set                                                          |

Back up the database and prove the backup with these, which need PostgreSQL 18's tools on `PATH`:

```sh
pg_dump --format=custom --dbname="$DATABASE_URL_MIGRATE" > heed.dump
npm run db:restore-drill
```

## The web image

What the `web` image does for a browser:

| What             | How                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| Compression      | Every text file ships gzipped at the highest level, and the service's JSON is gzipped on the way |
| Security headers | A Content-Security-Policy that runs only the app's own scripts, and no framing                   |
| HSTS             | Only when a proxy in front ended TLS and says so with `X-Forwarded-Proto: https`                 |
| Missing files    | A missing file is a real 404. Every other address opens the app                                  |
| For robots       | `robots.txt` keeps search engines out. `llms.txt` gives an agent the documentation as text       |
