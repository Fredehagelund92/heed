---
title: Editions and the stop switch
kind: concept
section: concepts
order: 1
summary: The dated sets of accepted facts that AI apps get, and how to stop or go back.
audience: [owner, administrator]
minutes: 4
owner: Product team
reviewed: 2026-10-19
screens: [/editions, /editions/compare]
related: [review-a-proposal, what-is-heed, glossary]
---

## In one minute

An edition is a saved set of every accepted fact at one moment, numbered by its date, such as 2026-10-07.2. AI apps get the newest one. An edition never changes: each acceptance makes a new one. So the same question gets the same answer, and you can see what changed between two editions. An admin can go back to an earlier edition, or stop AI apps getting a fact at once.

## Why editions exist

- _The same question gets the same answer._ AI apps read one fixed set of facts, not a list that changes while they read it.
- _You can see what changed._ Every edition says what it added, changed or archived, and who accepted it.
- _You can go back._ If an edition is wrong, an admin can make an earlier one live again in two steps, and nothing is deleted.

![Editions on a line: each accepted proposal makes a new numbered edition, the newest is live and AI apps get it, an admin can go back to an earlier edition, and the stop switch holds facts back from AI apps.](images/editions-line.svg 'Each acceptance makes a new edition. AI apps get the live one.')

## When a new edition is made

We make a new edition when an owner accepts a proposal. We also make one when the names we read from Cube change, such as new metric names. Each edition says why it was made and who accepted it.

In the demo data, for example, edition 2026-10-03.1 added the fact _Tracking outage in the Spain app_ to Sales. Ravi Kapoor proposed it and Jon Abara accepted it.

## What live means

The live edition is the one AI apps read now. Once a fact is accepted, AI apps get it in the next edition, in every domain, for everyone who can see it. **Editions** shows it at the top, under **What AI apps get today**, and Health names its day too.

## What changed

Choose **What changed** to compare two editions: the facts added, changed and archived. You can pick the last 7, 30 or 90 days, or any two editions.

## Going back

An admin can make an earlier edition live again with **Go back to this edition**. It takes two steps and asks why. Nothing is deleted: we make a new edition with the earlier facts, and the history log keeps the reason.

## The stop switch

The stop switch lets an admin stop AI apps getting one fact, one domain or everything, at once. On **Editions**, it's **Stop sharing** in the menu of **What AI apps get today**. While the stop switch is on:

- AI apps don't get what was stopped.
- Everyone signed in sees a banner that says what was stopped and why.
- The history log keeps who stopped it and why.

To start again, an admin switches it off with **Start again** on the same card. The button shows for as long as the stop is on.

## Export

**Export JSON** saves an edition as a file, for a record kept elsewhere.

## What it is not

An edition isn't a backup, and it isn't a draft. It holds only accepted facts, and it never changes once it's made.

## Go deeper

- [Review a proposal](review-a-proposal.md): how a proposal becomes part of an edition
- [Glossary](glossary.md#edition): edition, stop switch and what AI apps get, in one sentence each
- What changed between two editions is also a tool AI apps can use: see [What is an MCP](mcp.md#what-your-ai-app-can-ask)
