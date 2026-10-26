# Documentation

Everything written about Heed, in one place. If you are new, start with the product page.

## Product and design (Heed v1)

The approved Heed v1 mockup is the acceptance specification for the web app. These pages are written from it. Read them in this order.

The mockup itself lives in [apps/mockup](../apps/mockup/README.md): a clickable version of every screen and state, with demo data and no backend. It is the acceptance reference for the new web app, which is changed to match it ([how it is checked](../apps/mockup/ACCEPTANCE.md)). To run it, from the repository root: `npm --prefix apps/mockup ci` once, then `npm run mockup:dev` and open http://localhost:5192.

| Page                                            | What it says                                                                                                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Product](product.md)                           | The job, the people, the promise, every screen and its address, the six answer states, the kinds, the roles, privacy, the glossary, and the acceptance reference |
| [Design contract v2](design/design-contract.md) | The look and the rules: tokens, the three radius rules, bars, widths, the shell, patterns, guard rails, and what Draft 1 rules it withdraws                      |
| [Motion](design/motion.md)                      | Three tiers, the duration and easing tokens, reduced motion, loading                                                                                             |
| [Copy](design/copy.md)                          | Neutral wording, plain English, the vocabularies and the banned words                                                                                            |
| [Accessibility](design/accessibility.md)        | The checklist and the gates                                                                                                                                      |
| [Components](design/components.md)              | The inventory, with the mockup file each part comes from                                                                                                         |
| [Requirements](requirements.md)                 | What Heed must do. Each requirement has a status (kept, changed, withdrawn, new) against the mockup                                                              |

Older design pages that still apply:

| Page                               | What it says                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| [Voice guide](design/voice.md)     | The earlier voice guide. [Copy](design/copy.md) replaces it for the new web app |
| [Demo world](design/demo-world.md) | Larchwood Outdoor, the invented company that all demo text tells                |
| [Chip input](design/chip-input.md) | How the old front end builds chip-aware inputs                                  |
| [Logo](design/logo.md)             | The two-blade logo and how to use it                                            |

## Use Heed

| Page                                                     | What it says                                  |
| -------------------------------------------------------- | --------------------------------------------- |
| [What is Heed](help/what-is-heed.md)                     | The idea in a few minutes                     |
| [A five-minute tour](help/tour.md)                       | A first walk through the app                  |
| [Add your first context](help/add-your-first-context.md) | Write a first item                            |
| [Set up an agent](help/connect-an-agent.md)              | Connect an agent over MCP                     |
| [Common questions](help/common-questions.md)             | Short answers                                 |
| [All help pages](help/README.md)                         | The help pages, which are also the app's Docs |

## Run and build Heed

| Page                                                       | What it says                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| [Run and operate the service](operations.md)               | Setup and settings                                          |
| [MCP and API reference](reference.md)                      | The tools and the API                                       |
| [How AI sign-in works](ai-sign-in.md)                      | Agents signing in                                           |
| [Connectors](connectors.md)                                | What a connector is. [Writing one](connectors/authoring.md) |
| [Evaluations and the golden set](evaluations.md)           | How answers are tested                                      |
| [The demo](demo.md)                                        | The walkthrough                                             |
| [Develop Heed](development.md) and [its tests](testing.md) | The repository, the commands and the tests                  |
| [Security, scanning and the restore drill](security.md)    | What is scanned and how to restore                          |
| [The rename checklist](rename-checklist.md)                | Everything that follows the product name                    |
| [Contributing](../CONTRIBUTING.md)                         | The rules for people and for coding agents                  |

## The order of authority

1. The approved Heed v1 mockup, in [apps/mockup](../apps/mockup/README.md) (its commit is recorded in [Product](product.md#14-the-acceptance-reference)).
2. [Product](product.md) and the [design contract v2](design/design-contract.md), which are written from it.
3. The [requirements](requirements.md), which are changed to match both.

If a document and the mockup differ, the document changes.
