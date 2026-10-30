---
title: Answer lines
line: The six lines an answer starts with, and what each one asks of you.
group: How it works
order: 2
minutes: 2
reviewed: 2026-10-30
---

Every answer, in the app and in your own agent, starts with one of six lines. Each says what the answer rests on, and what it asks of you.

## The six lines

<!-- include answer-lines -->

| The line                                      | What it means                                                                                                  | What you do                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Checked: This is written down and checked.    | Based on checked context. Context applies, and its owner published it with a source and a check date.          | Nothing to do.                                  |
| Partial: Only part of this is written down.   | Covers part of it. Context covers part of the question, or the dates were assumed. The answer says which part. | Write the missing part, or tell the owner.      |
| Not found: Nothing is written about this yet. | Nothing written down. Nobody has written anything down for this. It does not mean there is no explanation.     | Write context, or tell the owner.               |
| Conflict: Two items say different things.     | Context disagrees. Two items that apply say different things. Agents give both and say so.                     | An owner keeps one, narrows one, or keeps both. |
| Outdated: Some of this may be old.            | May be out of date. An item's check date has passed, or a definition it relies on changed.                     | The owner checks it: Still true, or Edit.       |
| Not checked: The check did not run.           | Could not check. The check could not run just now. It is not the same as Not found.                            | Ask again in a minute.                          |

<!-- /include -->

A question that names no metric and no market is not looked up, so its answer has none of the six lines. Ask says "Nothing was looked up", says why, and offers two questions it can answer. Not found is only for a question that was looked up and found nothing.

A question about the context itself, such as "what was created in the last 24 hours?", "what is due for a check in Sales?" or "who owns Orders?", gets an answer from the records instead. It starts with a Records chip, not one of the six lines: it counts what you can see in Context, and agents never read it.

## Words

<!-- include words -->

- Context item: One thing agents should know about the numbers: an event, a warning, a rule or a guide. It has a source and a check date.
- Domain: An area of the business, such as Sales or Marketing. Every context item belongs to one.
- Owner: The person who publishes and checks a domain's context. Agents read only what an owner has published.
- Suggestion: A change someone else sends to an owner, from the editor or through their agent. Nothing changes until the owner publishes it.
- Definition: A metric, a dimension or a term, and what it means here. Metrics and dimensions come from your definitions source; terms are written here.
- Synonym: Another name for a metric or a dimension, such as GMV for Gross sales. Agents read it as that definition.
- Not found: A question agents asked several times and found nothing written down for. Its card brings a draft.
- Reported: Someone said a context item is wrong or unclear. The owner sees it in the Inbox.
- Due for a check: A context item whose check date has passed. The owner confirms it is still true, or edits it.
- Don't conclude: A line on a context item that stops an agent from reading a cause into it.

<!-- /include -->

> **One list.** Help in the app shows the same lines and words, from the same source. If one changes, both change.
