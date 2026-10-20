# Design note: connectors as packages

Status: **designed, not built.** Heed loads connectors only from this repository. Loading
connectors from packages is built when the license is decided (OQ-16, OSR-107); until then this
note is the design, so that nothing built now closes it off. Requirement: CON-111 (Later).

## Why later

A plugin contract is hard to change once others build on it. Products that run connector
ecosystems opened external loading only after their contract had served several connectors of
each kind, and kept a test suite as the definition of "compatible". Interface 3.0 has not yet
served a content connector. So it is proven in this repository first, on Cube and on Markdown in
a Git repository, and its conformance kit runs on every built-in connector from the start.

## What stays the same

A connector in a package is the same manifest and runtime as a built-in one. Moving it out of the
repository is a change of where it is loaded and how its messages travel, not of the contract:

- the manifest is read without running code, so Sources can list and describe a packaged
  connector before it runs;
- the runtime's messages are plain serializable objects, so in-process iteration becomes JSON
  lines over a pipe with no change to their shape;
- the invariants and the security rules are enforced by the core, so a package cannot weaken
  them.

## How an operator installs one

1. The operator installs the package with npm, with install scripts off.
2. The operator names it in the server's configuration. Nothing is installed from the browser.
3. At start, Heed reads the manifest from the package's `heed.connector` field in
   `package.json`, checks it like a built-in manifest, checks that the interface range is one this
   build supports, and checks the support level against what the operator allows.
4. Heed runs it out of process (T2 in [Security and egress](security.md#where-connector-code-runs)):
   a child process per run, no network of its own, only an egress proxy that enforces the
   manifest's hosts and attaches credentials, and read access only to its own package.

The operator may narrow the built-in connectors in the same configuration (for example
`HEED_CONNECTORS=cube-files,git-markdown`).

## Support levels

| Level       | What it means                                                                                           | What Sources shows                     |
| ----------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `core`      | In this repository, reviewed with Heed.                                                                 | Built in                               |
| `verified`  | Passes the conformance kit, published with npm provenance, follows the security rules. Can be delisted. | Verified                               |
| `community` | Anything else. Runs only when the operator explicitly allows it.                                        | Community, with "Not reviewed by Heed" |

Code nobody reviewed needs a stronger boundary than a child process: a container or micro-VM per
run (T3).

## What gets published

- `@heed/connector-kit`: the manifest schema, the runtime and message types, `ctx` and the
  conformance kit (`@heed/connector-kit/testing`), versioned with the interface, not with Heed.
- A validator for CI that checks a package's manifest, README and kit run.
- An interface changelog, with the date each major stops being supported (CON-109).

## Licensing

The license is not decided (OQ-16), and nothing here assumes one (OSR-107). What held up through
other projects' relicensing, and is the recommendation for when the decision is made:

- the connector kit, the manifest schema and the message protocol under a permissive license
  (Apache-2.0), with a public promise not to change it, whatever the core's license is;
- built-in connectors under the kit's license, so they are examples anyone can copy;
- contributions under a Developer Certificate of Origin; a contributor license agreement only if
  dual licensing is a real plan, said openly;
- no limit on who may host a registry of connectors.

## Not in this design

- A marketplace, signing and installing from the browser.
- Connectors in other languages.
- MCP servers as connectors: they have no change feed, no deletions and no service identity.
- Chat and identity connectors, which have other shapes (CON-304, CON-401).
