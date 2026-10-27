---
title: Agent tools
line: The six tools an agent can call, with what each takes and returns.
group: Reference
order: 1
minutes: 3
reviewed: 2026-10-27
---

The six tools an agent can call. All read, apart from the two that send something to an owner after the person says yes.

<!-- include tools -->

### get_context

The context that applies to a question, with one sentence to relay.

- Takes: The question, or a metric, markets and dates.
- Returns: The answer line, the context items that apply, and one sentence to relay.

### find_context

A word search over names, titles and summaries.

- Takes: A few words.
- Returns: Matching context items and definitions, titles only.

### read_context

One context item in full.

- Takes: A context item.
- Returns: Its text, source, check date and don't conclude line.

### report

Tell the owner something is missing, wrong or unclear.

- Takes: What is wrong, after the person says yes.
- Returns: That it was sent, and to which owner.

### suggest_context

Send a suggestion to the owner, after the person says yes.

- Takes: The suggested text and what it applies to.
- Returns: That it waits in the owner's Inbox.

### get_related

Follow a link between context items, definitions and domains, one step at a time.

- Takes: A context item, a definition or a domain.
- Returns: What it links to and is linked from, without changing what an answer includes.

<!-- /include -->

> **Switching tools off.** Admins switch tools off in Agents and access, Tools and access keys. Following links has its own switch.
