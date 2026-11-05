# Documentation

Everything written about Heed, in one place. If you are new, start with the product page.

## Product and design (Heed v1)

The web app leads: these pages say what it does. They were first written from the approved Heed v1 mockup, which is now a reference in git history, under the tag `mockup-archive`. Read them in this order.

The mockup is a clickable version of every screen and state as it was designed, with demo data and no backend. The app has since moved past it in places on purpose, such as Overview holding the topics and Conflicts being a filter of the Context list, and the mockup is not changed to follow.

| Page                                            | What it says                                                                                                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Product](product.md)                           | The job, the people, the promise, every screen and its address, the six answer states, the kinds, the roles, privacy, the glossary, and the acceptance reference |
| [Design contract v2](design/design-contract.md) | The look and the rules: tokens, the three radius rules, bars, widths, the shell, patterns, guard rails, and what Draft 1 rules it withdraws                      |
| [Motion](design/motion.md)                      | Three tiers, the duration and easing tokens, reduced motion, loading                                                                                             |
| [Copy](design/copy.md)                          | Neutral wording, plain English, the vocabularies and the banned words                                                                                            |
| [Accessibility](design/accessibility.md)        | The checklist and the gates                                                                                                                                      |
| [Components](design/components.md)              | The inventory, with the mockup file each part comes from                                                                                                         |
| [Requirements](requirements.md)                 | What Heed must do. Each requirement has a status (kept, changed, withdrawn, new) against the mockup                                                              |
| [Domain core](domain/core.md)                   | What `src/domain` holds and may not depend on                                                                                                                    |

Older design pages that still apply:

| Page                               | What it says                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| [Voice guide](design/voice.md)     | The earlier voice guide, for the service's own sentences. [Copy](design/copy.md) is the web app's |
| [Demo world](design/demo-world.md) | Larchwood Outdoor, the invented company that all demo text tells                                  |
| [Logo](design/logo.md)             | The two-blade logo and how to use it                                                              |

## Use Heed

| Page                                               | What it says                                                      |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| [Get started](help/get-started.md)                 | From an empty workspace to a first answer, in about ten minutes   |
| [Write context](help/write-context.md)             | What a context item is and what to put in it                      |
| [Connect an agent](help/connect-an-agent.md)       | One prompt for Claude, Cursor or another agent                    |
| [Review a suggestion](help/review-a-suggestion.md) | The quick view, the review, and publishing or returning           |
| [All help pages](help/README.md)                   | The documentation, which is also the app's Docs and the docs site |

## Run Heed

The docs site publishes these, and their words follow the [reader check](../apps/docs/README.md#ready-for-readers).

| Page                                                    | What it says                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| [Where to run Heed](where-to-run.md)                    | Docker Compose, a cloud host or container platform, and the demo       |
| [Self-host Heed on one computer](self-hosting.md)       | Install, back up, restore, upgrade and roll back, for local evaluation |
| [Run and operate the service](operations.md)            | Run it, check it, run it in production, its jobs, limits and metrics   |
| [Service settings](configuration.md)                    | Every setting the service reads when it starts                         |
| [Set up company sign-in](company-sign-in.md)            | OpenID Connect, and who may sign in                                    |
| [Administer the service](administration.md)             | Settings, the history log, import, export and the `heed` command       |
| [Security, scanning and the restore drill](security.md) | What is scanned and how to prove a backup restores                     |
| [Run the demo on Vercel and Neon](vercel.md)            | For the demo only: the service as a function, and the data on Neon     |

## Connect Heed

Published on the docs site too.

| Page                                                     | What it says                                         |
| -------------------------------------------------------- | ---------------------------------------------------- |
| [MCP and API reference](reference.md)                    | Which page to read, for agents and scripts           |
| [Connect an agent by hand](reference/connect-by-hand.md) | The MCP address, the commands and the limits         |
| [The agent tools in detail](reference/agent-tools.md)    | What each tool takes and gives back                  |
| [Sign in your own agent](ai-sign-in.md)                  | How an agent signs in, and its settings and keys     |
| [HTTP API overview](reference/http-api.md)               | How to call the API, and what it covers              |
| [OpenAPI description](api/openapi.json)                  | Every operation, generated from the contract         |
| [Connectors](connectors.md)                              | What a connector is, and what a read may change      |
| [The Cube connector](connectors/cube.md)                 | Reading definitions from a Cube model                |
| [Connector security](connectors/security.md)             | What a connector may reach, and how that is enforced |
| [Build a connector](connectors/authoring.md)             | The guide for people and coding agents               |

## Build Heed

For contributors, in the repository only.

| Page                                                                | What it says                                                         |
| ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [Internals](contributing/internals.md)                              | Where the requirement ids, reasons and source paths of each page are |
| [The tools and the API in detail](contributing/api.md)              | Every tool and operation, with its requirements                      |
| [Sign-in: how it works](contributing/sign-in.md)                    | The flows, the threat notes and the limits                           |
| [The connector contract](contributing/connector-contract.md)        | What a connector declares and what the core does with it             |
| [Connector security and egress](contributing/connector-security.md) | The rules, with the code that enforces them                          |
| [The Cube connector: internals](contributing/cube-connector.md)     | Compilation, marks and tests                                         |
| [Connectors as packages](connectors/packaging.md)                   | How a connector could ship on its own, later                         |
| [The database](../db/README.md)                                     | Roles, grants, migrations and the data each feature keeps            |
| [Templates](templates/)                                             | Item and test-question files, and prompts that turn notes into items |
| [Evaluations and the golden set](evaluations.md)                    | How answers are tested                                               |
| [Develop Heed](development.md) and [its tests](testing.md)          | The repository, the commands and the tests                           |
| [The public docs site](../apps/docs/README.md)                      | Which pages are published, and how, one version at a time            |
| [Release Heed](releasing.md)                                        | One version number, the release pull request and the tag             |
| [The rename checklist](rename-checklist.md)                         | Everything that follows the product name                             |
| [Contributing](../CONTRIBUTING.md)                                  | How to send a change, and the rules for people and agents            |
| [Working with coding agents](agents.md)                             | Where an agent reads first, and what it may and may not do           |

## The order of authority

1. The web app, as its job specs in `tests/e2e` check it.
2. [Product](product.md) and the [design contract v2](design/design-contract.md), which say what it does and are changed with it.
3. The [requirements](requirements.md), which are changed to match both.

The Heed v1 mockup, in git history, under the tag `mockup-archive`, is a reference for the design ([Product](product.md#14-the-acceptance-reference)). Where the app and the mockup differ, the app and these documents are right.
