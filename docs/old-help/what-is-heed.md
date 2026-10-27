---
title: What is {{product}}
kind: concept
section: start
order: 1
summary: The facts behind your numbers, and who keeps them right.
audience: [everyone]
minutes: 3
owner: Product team
reviewed: 2026-10-19
screens: [/]
related: [mcp, add-your-first-context, connect-an-agent]
---

## In one minute

{{product}} is where your company writes down what the numbers don't show. A market closed. A tool changed how it counts. A partner's data came in late. People know these facts, but an AI agent that answers questions about your data can't see them. Here, anyone can write a fact down. The owner of that part of the business checks it. Then agents such as Claude read the checked facts before they answer.

## Why it exists

Company data shows what happened to a number. It rarely shows why. The reasons live in chats, documents and people's heads, where an agent can't read them. So the agent guesses, and a guess can sound sure of itself.

Say orders in Norway fell by 70% in August.

- _Without the facts_, an agent says: "This might come from weaker marketing. I suggest checking the campaign budget."
- _With them_, it says: "A note says online sales to Norway stopped on 4 August 2026, with a link to the customs notice. That may explain the fall, but the note doesn't prove it. Compare Norway with other markets before and after 4 August."

Norway is made up. It's the example that runs through these pages and the demo data.

## How it works, in five steps

![The loop: anyone writes a fact, the owner checks it, agents get it at once, agents read it before answering, and a question that found nothing counts as a gap that people fill.](images/heed-loop.svg 'Write, review, share, use and learn: the loop that keeps the facts current.')

1. _Write._ Anyone writes a short fact: what happened, where it applies, from when, and how we know. The form or the assistant helps.
2. _Review._ The owner of its domain checks it. We test the change first, so it doesn't make answers worse.
3. _Share._ Once the owner accepts it, agents get it at once. We keep a dated record of every change, so an admin can always go back.
4. _Use._ Your agent checks the facts before it answers a data question. It gets the facts that apply, each with its source and what not to conclude.
5. _Learn._ When no fact applies to a question, we count it as a gap, without recording who asked. People write the missing fact, and the loop starts again.

## What it holds, and what it doesn't

The library holds facts. Each fact is one of five kinds:

| Kind    | What it is                               | From the demo library                                               |
| ------- | ---------------------------------------- | ------------------------------------------------------------------- |
| Event   | Something that happened on a date        | Payment provider switched in the United Kingdom on 12 June 2026     |
| Note    | A lasting remark on how to read a number | Net revenue excludes test accounts                                  |
| Guide   | How to look into a question              | How to investigate a drop in Churn rate in Spain                    |
| Example | A checked question with its right answer | Comparing Units per order between the Netherlands and other markets |
| Issue   | A short-lived problem with the data      | Tracking outage in the Spain app                                    |

Every fact belongs to one domain, such as Sales or Marketing. Each domain has a short description of what it covers, which people, the assistant and agents all read. Once a fact is accepted, agents can get it, in every domain.

The numbers stay where they are. Cube defines the metrics and returns the figures, and a fact points to them. We keep a link and one sentence from a source, never the whole document. We never store the words of a question or who asked. And nothing reaches agents on its own: a person accepts every change.

## Who does what

| Who        | What they do                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Everyone   | Reads the library, writes facts, follows their proposals, and says what's missing.                                                 |
| Owner      | Looks after a domain: reviews proposals, keeps its facts current, and writes test questions.                                       |
| Approver   | A role from before: a high-risk fact no longer needs a second yes, so an approver reads proposals but decides none.                |
| Admin      | Sets up domains and roles, chooses which agents can connect, and can stop what agents get.                                         |
| Auditor    | Reads the history of every change.                                                                                                 |
| Your agent | Checks the facts before it answers. If an admin allows it, it can save a draft for you to check. It never sends or changes a fact. |

## What it is not

It's not a data tool: it holds no numbers and runs no queries. It's not a wiki either: every fact is short, has a source, and its owner checks it. And it doesn't watch people: it counts questions by topic, not by person.

## Where to start

- Write a fact down: [Add your first fact](add-your-first-context.md) (guide, 5 min)
- Use the facts from your agent: [Set up an agent](connect-an-agent.md) (guide, 3 min)
- See how the parts fit: [What is an MCP, and how it all connects](mcp.md) (concept, 5 min)
- See the whole loop on demo data: [A five-minute tour](tour.md) (tour, 5 min)
