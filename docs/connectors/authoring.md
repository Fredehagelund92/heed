# Writing a connector

A guide for whoever writes a connector, inside this repository or, later, as a package. The
steps below name what interface 3.0 asks for; [what is built](../connectors.md#what-is-built)
says which parts this build has. The static list of definitions (`src/connectors/static-definitions/`)
is the smallest example written to interface 3. The Cube connector is still written to
[interface 2](../connectors.md#interface-2-what-cube-is-written-to) and runs through the adapter.

Read first: the [contract](../connectors.md) (the two kinds, the invariants, the manifest and the
runtime) and [Security and egress](security.md) (the rules the core enforces on your code).

## Before you start

- **Pick the kind.** A **definitions** connector says what exists in a semantic layer or a
  catalogue: metrics, dimensions and groups, never a calculation. A **content** connector reads
  documents that become drafts for owners to review. A connector is one or the other.
- **Pick the tool's name and the id prefix.** `tool` is how people say the tool ("Cube"). A
  definitions connector writes refs under the tool's prefix (`cube:`), which belongs to the tool,
  not to your connector (CON-117): two connectors for the same tool share it.
- **Say the least access** the connector needs, in words an administrator can check before
  giving it (CON-106). Read only, always (CON-102).
- **List the hosts** it connects to (CON-113).

## Steps

1. **Make its folder** `src/connectors/<id>/` and list it twice: its manifest in
   `src/connectors/manifests.ts`, which the web app reads, and its manifest with its runtime in
   `src/connectors/index.ts`, which only the server reads. A test fails when a folder is not
   listed, or when the two lists differ. _To come:_ a template to copy, `src/connectors/_template/`.
2. **Write the manifest** (`manifest.ts`, pure data, with `defineManifest`): id, version,
   interface range, kind, tool, title and summary, the form as a list of fields, secret slots
   with what they are bound to, access, egress, capabilities, schedule, limits, warnings with
   their words, and the mark version (CON-112). The [manifest
   reference](../connectors.md#the-manifest) lists every field, and [what is
   built](../connectors.md#what-is-built) how the form is written today. `checkManifest` says
   every problem with it, and the server does not start with one.
3. **Write the runtime** (`runtime.ts`, server only, with `defineRuntime`): `check` and `read`,
   and `parse` for rules on the settings the manifest cannot say, using only what the context
   hands you: `ctx.config`, `ctx.scopes`, `ctx.cursor`, `ctx.secret`, `ctx.fetch`, `ctx.signal`
   and `ctx.log`. `discover` and `ctx.git` come with the next slices. A connector may import
   `zod/mini`, the domain and its own files only, and has no `fetch` or `process` of its own:
   lint refuses the rest. See [the runtime](../connectors.md#the-runtime-and-its-messages).
4. **Record fixtures** (`fixtures/`): a Git repository served by the test Git host, or recorded
   HTTP answers. No live calls in tests, and no real names, addresses or data.
5. **Run the conformance kit** (`conformance.test.ts`, CON-108). _To come with interface 3:_ the
   kit checks the manifest, the form, the check, reads, cursors and deletions, egress and limits,
   and plants a secret that must appear nowhere.
6. **Write the README** (`README.md`): what it reads and the minimal setup in the tool, its
   fields, its warnings, its limits and what its change marks see. The tables come from the
   manifest. [The Cube connector](cube.md) is today's example.

## Rules your code follows

The full list, and why, is in [Security and egress](security.md#rules-for-connector-code). In
short: no raw network, no environment, no files written, no content or secrets logged, honour
the abort signal, and return only records the contract allows.

## Review checklist

_To fill in with the first connector written to interface 3._ At least:

- [ ] The kit passes, including the secret canary and the planted SQL fixture (definitions).
- [ ] Every warning code has words, and no screen word names a vendor outside the manifest.
- [ ] The access lines say the least access, and the egress names every host.
- [ ] The README has its required sections.
- [ ] A content connector never writes anything but documents to the core.
