# Cube

The first definitions connector (connector interface 3.0, [the contract](../../../docs/connectors.md)).
It reads the YAML model files of a Cube project and gives Heed each public member as a definition
under `cube:`, so context can be checked against the metrics and dimensions that exist. It reads
files only, offline: never a Cube server, a warehouse or data, and it keeps no calculation. A read
only flags the items that rely on a member that changed or left: it never changes an item and
never publishes (I-2). How to set up a model for it, the demo model and its marks are in
[The Cube connector](../../../docs/connectors/cube.md).

## Settings

An admin adds a Cube model in a Git repository with:

| Field                   | What it is                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Repository              | The https address of the repository. Plain http only to this machine, outside production.                             |
| Branch, tag or commit   | What is read. A tag or a commit holds still; a branch moves with each change. `main` to start with.                   |
| Model folder            | The folder of model files in the repository. Empty for the top.                                                       |
| User name for the token | Sent with the token; `x-access-token` when empty. Most hosts accept any.                                              |
| Model folder address    | The folder in the host's web view, so each view links to its file. Never opened.                                      |
| Domain names            | The model's `meta.domain` value to the domain it means, for a model whose names differ from the domain ids.           |
| Read-only token         | A secret, kept in the server's secret store and sent only to the repository's address. Empty for a public repository. |

Whoever runs the server may also point it at a model folder on the server (`CUBE_MODEL_DIR`), which
the same runtime reads as `ctx.folder` ([configuration of the server's model](../../../docs/connectors/cube.md#configuration-of-the-servers-model)).

## What a read does

1. Fetches the one commit the ref names, read only, through `ctx.git`
   ([security](../../../docs/connectors/security.md#git)), or takes the server's folder.
2. Lists the model folder's files. Only YAML is read: any other file is left out with
   `unsupported_file`, and a file over 2 MB, past 20 MB in all, a link or not text with
   `unreadable_file`. Either makes the read partial, so it marks nothing missing. More than 1,000
   files fail the read.
3. Hands the files to its worker (`ctx.worker`, T1): a child process of its own under Node's
   permission model, with no network, no writes and no programs, that reads no folder at all. The
   worker leaves out templates (`unsupported_file`) and files that are not YAML
   (`unreadable_file`), compiles the rest with the pinned compiler and answers with each public
   member, its domain hint and its change mark, or a fixed code: `no_model_files`,
   `compile_error` or `compiler_unavailable`. A compile past its time limit is `compile_timeout`.
4. Sends each member as a definition, with the domain the model gives it (the domain names
   applied), and ends with the commit as its version and its cursor (for the server's folder, a
   digest of its files). Every read is a full listing.

## Schedule and limits

Read every hour by default, at most every 15 minutes. A source not read for six hours is out of
date. A read takes at most three minutes: a minute to fetch, and two to compile, or what the server
sets (`CUBE_COMPILE_TIMEOUT_SECONDS`, `CUBE_COMPILE_MEMORY_MB`).

## Tests

The conformance kit runs against it in `tests/server/connectors/conformance.test.ts`, with a Git
host on the machine. `tests/server/connectors/cube.test.ts` reads the server's folder,
`tests/server/connectors/git.test.ts` a repository with every failure, and
`tests/integration/cube-sources.test.ts` takes a source through the API, its schedule and the
definitions pipeline, and proves a read never publishes.
