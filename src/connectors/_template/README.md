# Example metrics file in a Git repository

The template of a definitions connector, to copy into `src/connectors/<id>/`
([how](../../../docs/connectors/authoring.md)). As it is, it reads an invented tool's metrics file
and passes the conformance kit. Replace every TODO below with your tool's words: a test refuses a
listed connector whose README still has one, or lacks one of these sections.

TODO: one paragraph on what the connector reads, from where, and what it never reads or keeps.

## Setting it up

TODO: the least a team does in the tool so the connector can read it: the file to commit, the
token to make and its access.

## Settings

| Field                 | What it is                                                       |
| --------------------- | ---------------------------------------------------------------- |
| Repository            | The https address of the Git repository that holds the file.     |
| Branch, tag or commit | Where the file is read. TODO: say what your tool's teams use.    |
| Folder                | The folder that holds the file; empty for the top.               |
| File                  | The metrics file in that folder, `metrics.json` by default.      |
| User name             | The user name sent with the token, for hosts that ask for one.   |
| Domain names          | The domain each name the file gives means, when it is not an id. |

## What a read does

TODO: what becomes a definition and what is left out; the refs (`example:<group>.<name>`); where
the domain comes from; what the change mark sees (the calculation with the metrics it is built
from, the type, the title and the description) and what it never sees (the domain, the other
names, the environment); and each warning, with what an administrator does about it.

## Schedule and limits

Read every hour by default, at most every 15 minutes, out of date after 6 hours. A read takes at
most 90 seconds and 100,000 definitions; the file is at most 2 MB, the largest file a Git read
hands over. TODO: any limit of your own.

## Tests

The conformance kit runs against it in `tests/server/connectors/conformance.test.ts`, with the
invented fixture in `tests/fixtures/template/`. TODO: your connector's own tests.
