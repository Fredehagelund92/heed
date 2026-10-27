# Static list of definitions

The smallest definitions connector (connector interface 3.0, [the contract](../../../docs/connectors.md)):
metrics and dimensions an admin writes in the form, as JSON. It reads nothing outside its own
settings, needs no host and no secret, and proves the whole path of the interface on its own: the
manifest, the form, the check, the read and the definitions pipeline. Useful for a trial, or for a
team without a semantic layer yet. Experimental.

## Settings

| Field        | What it is                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Definitions  | A JSON list. Each entry has a kind (`metric` or `dimension`) and a name, and may have a title, a description, a type and a domain. |
| Domain names | Where an entry names its domain differently from your domains, the domain it means.                                                |

## What a read does

Each entry becomes a definition under the `static:` prefix, marked by its meaning (kind, name,
title, description, type and domain), so moving it in the list changes nothing. A description
longer than 500 characters is cut, with a warning.

## Tests

The conformance kit runs against it in `tests/server/connectors/conformance.test.ts`.
