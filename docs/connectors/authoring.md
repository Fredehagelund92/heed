# Writing a connector

A guide for whoever writes a connector, inside this repository or, later, as a package. The
steps below name what interface 3.0 asks for; [what is built](../connectors.md#what-is-built)
says which parts this build has. The static list of definitions (`src/connectors/static-definitions/`)
is the smallest example written to interface 3, Markdown in Git (`src/connectors/git-markdown/`)
the first content connector, and Cube (`src/connectors/cube/`) the first definitions connector
for a real tool, with a worker for its compiler.

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
   hands you: `ctx.config`, `ctx.scopes`, `ctx.cursor`, `ctx.secret`, `ctx.fetch`, `ctx.git`,
   `ctx.folder`, `ctx.worker`, `ctx.signal` and `ctx.log`, and `discover` for a content
   connector, which lists the scopes an administrator may choose, each with a suggested domain.
   A connector may import `zod/mini`, the domain and its own files only, and has no `fetch` or
   `process` of its own: lint refuses the rest. See
   [the runtime](../connectors.md#the-runtime-and-its-messages).
4. **Hand risky parsing to a worker**, if the tool's files need a parser or a compiler you would
   not run in the server: a `worker.ts` in the folder, named with `defineConnector(manifest,
runtime, { worker })` in `src/connectors/index.ts`. The runtime calls `ctx.worker(input)`, and
   the core runs the worker in a child process of its own under Node's permission model (T1,
   [where connector code runs](security.md#where-connector-code-runs)): it gets the input over
   IPC, answers once, and may load the packages it parses with, never the service. Its answer is
   untrusted: check it before you send a record. Built-in connectors only. Cube's compiler is the
   example.
5. **Record fixtures** (`fixtures/`): a Git repository served by the test Git host, or recorded
   HTTP answers. No live calls in tests, and no real names, addresses or data.
6. **Run the conformance kit** (CON-108): add the connector and its fixture to
   `tests/server/connectors/conformance.test.ts`: settings that work, a secret the tool refuses,
   settings the form refuses, a host that cannot be reached, and the secret to look for; for a
   definitions connector, settings whose read meets a file it cannot read and a calculation in
   the tool's content; and how long a test may take when a worker compiles. The kit
   (`tests/server/connectors/kit.ts`) checks the manifest and the README, the form and its
   defaults, the check, the reads (each record once, the same marks for the same input, a partial
   read when a file cannot be read, no calculation in a definition, documents in the chosen
   scopes with https links) and that the secret appears in nothing the connector returns. _To
   come:_ cursors and deletions, egress and limits, which the core's own tests check today.
7. **Write the README** (`README.md`): what it reads and the minimal setup in the tool, its
   fields, its warnings, its limits and what its change marks see. The tables come from the
   manifest. [Cube's](../../src/connectors/cube/README.md) is today's example, with
   [The Cube connector](cube.md) for the setup in the tool.

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
