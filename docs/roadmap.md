# Roadmap

Where Heed is going, in plain words. Heed is pre-1.0, so this is a direction and not a promise: there are no dates, the order can change, and an item can move up if people ask for it. To argue for something, open an issue (see [Contributing](../CONTRIBUTING.md#finding-something-to-work-on)).

The idea stays the same throughout: a library of checked context that AI agents read before they answer questions about your data. People write what the numbers do not show, the owner of each domain checks and publishes it, and agents get only what was published, each item with its source. Heed never records who asked.

## What exists today

**Write and review**

- Context items of four kinds (Event, Warning, Rule and Guide), with a source, a scope, dates and a line on what not to conclude.
- An Inbox for owners. A review shows what changes: a table of the fields and a line-by-line text diff with changed words marked, with a rich preview. Reviewers leave comments on a line and mark them resolved. The review checks the claims against the source and shows how a suggestion overlaps live context.
- Suggestions from people, from agents (over MCP) and from connected sources.

**Ask and read**

- Six tools for agents over MCP, and six answer lines (Checked, Partial, Not found, Conflict, Outdated, Not checked) on every answer.
- Ask: a page where anyone puts a question to the same engine agents use and sees exactly which items applied. Ask can also answer questions about the library's own records, and show a figure when an admin has switched figures on for a source.
- Definitions and synonyms, and links between items.

**Run and watch**

- Gaps: questions that found nothing, counted by topic, become cards in the owner's Inbox.
- Saved questions that are checked again after every publish, and alerts when an answer gets worse.
- Observability with six pages in counts only, a Summary page over fixed calendar periods, and a monthly digest that prints on one sheet. Weekly counts are kept for good.
- Connectors: Cube for figures and definitions, Markdown in Git and Google Drive for content. [Writing a connector](connectors/authoring.md) is open to everyone.
- Sign-in with OpenID Connect, invites, Admin and Member roles, domain owners, access keys for bots, and a demo sign-in for trying it out.
- `docker compose up` for a demo, a mock mode with no database, and a command-line tool.

## What is next

Roughly in this order. Each item is a direction, and its details are settled in its issue.

1. **A clearer view of a clash.** When a suggestion overlaps live context, show the two statements side by side and let the reviewer say how they relate, using the same parts as the text review.
2. **Honest numbers for leaders.** Observability already counts how many questions were checked, partial or not found. Next: how long a gap takes to close, what Heed caught (answers that went out with a warning, saved questions that changed after an edit), each shown separately and never added together. Sharing a Summary with someone who has no account is a separate, later decision.
3. **Dimension values.** The picker for the values a context item applies to (markets, product lines or channels) is back. Next: add a missing value together with the suggestion that needs it, and a "did you mean" search over the governed list.
4. **Editable settings.** Advanced settings are read-only today and say so. Safe settings become editable by an admin, with a required reason and a history of who changed what.
5. **Agents that write.** Today an agent can only suggest, and a person publishes. The first step is clarity: name every key and connection, show for each agent what it may read and what it may suggest, and show the agent's name in the Inbox instead of "An agent". A later step lets a domain owner choose a rule under which an agent they name may publish on its own. That changes the trust promise, so it needs its own design, an opt-in per domain, and a careful security review before it ships.
6. **A release process.** Tagged releases, a changelog and upgrade notes.
7. **A public docs site and a hosted read-only demo,** built from the mock mode, so you can try Heed without installing anything.

## What is not planned

- **Custom alert rules.** The Alerts screen shows the "Add a rule" button as coming soon. Heed ships the alerts it has and waits to see which others people need.
- **A "wrong answers prevented" number.** Heed cannot know that an answer would have been wrong, so it will not claim to. It counts what it caught and says so.
- **Counting people.** Heed counts questions by topic and never by person. Fewer than five asks show as "Fewer than 5".
- **Email digests.** The monthly digest is a page you open or print.
- **Storing your numbers.** Heed holds context, not data. Figures come from your own semantic layer when asked, and are kept nowhere.
- **Databases other than PostgreSQL 18.**
- **Telemetry.** Heed sends nothing to its authors.
- **Letting a model choose what applies.** Rules choose which items apply to a question, so the same question gets the same items until an owner publishes a change. A model may help write words, never choose context.

## How to help

Start with an issue labelled `good first issue` or `help wanted`, or pick anything under "What is next" and say you would like to take it. [Working with coding agents](agents.md) covers using an agent to do so.
