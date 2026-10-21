---
title: Glossary
kind: glossary
section: reference
order: 1
summary: Every word the app uses, in one sentence each.
audience: [everyone]
minutes: 6
owner: Product team
reviewed: 2026-10-19
screens: []
related: [what-is-heed, mcp, common-questions]
---

The words on the screens and in these pages, grouped by theme, with a sentence or two each. At the end, you'll find older words you may still see, and what we call them now.

## Facts

### Fact

A short, checked statement about your numbers: what happened, where, when, and how we know.

### Kind

The type of a fact: an Event, a Note, a Guide, an Example or an Issue.

### Event

A fact about something that happened on a date, such as a market closing.

### Note

A fact with a lasting remark on how to read a number, such as "Net revenue excludes test accounts".

### Guide (kind of fact)

A fact that says how to look into a question. Not to be confused with a guide in these pages, which is a page of steps.

### Example

A fact with a checked question and its right answer.

### Issue

A fact about a short-lived problem with the data, such as a tracking outage.

### Library

All the facts you can read.

### Where it applies

The metrics and markets a fact is about. AI apps get the fact when a question is about these.

### When it applies

From a date, until a date, or still going on. The last day is included.

### Where this comes from

A link and one sentence copied from it, with the day it was read, so the owner can check the fact.

### What not to conclude

A line on what someone might wrongly conclude from a fact, or who to ask first. AI apps get it with the fact and are told not to draw that conclusion. It's optional.

### Cause not proven

A fact says what happened, not why a number changed, unless its source says so. AI apps read every fact this way, even without a line on what not to conclude.

### Risk level

Low, normal or high. A high-risk fact, such as one about law or financial reporting, needs an approver too.

### Who can see it

Everyone, or only the groups named.

## Proposals and checks

### Draft

A fact you haven't sent for review yet. Only you work on it. Find your drafts on Home, under **Your drafts**, or in **Proposals**, in **Mine**, under **Draft, not submitted**.

### Proposal

A new fact, or a change to one, that waits for the owner of its domain. AI apps get it only once it's accepted.

### Check

A test we run on a proposal before the owner accepts it: is it complete, does it find the right questions, and do answers stay right.

### Check date

The day by which the owner checks a fact again. On a fact, it reads "Check again by 31 January 2027".

### Needs checking

The check date has passed, or the source a fact is based on changed. AI apps still get the fact, and they're told it may be out of date until the owner checks it.

### Source changed

A Cube definition that a fact points to has changed, so the fact needs checking.

### Source missing

A Cube definition that a fact points to has disappeared, so the fact needs checking.

### Archive

AI apps stop getting the fact. You can still read it and its history.

### Bin

Where an admin moves facts out of the library, with a reason. AI apps stop getting them at once, and no list, search or count shows them. An admin can open a fact in the Bin to read it, then restore it as it was. A fact whose domain was deleted comes back in another domain instead: archived, with a proposal for that domain's owners.

## People and roles

### Domain

A part of the business with its own data and people, such as Sales. Every fact belongs to one, and each domain has a short description of what it covers that people, the assistant and AI apps read. Not to be confused with a way to split a number, such as market.

### Owner

The person who looks after a domain and accepts its facts. Every domain has an owner, and a domain can have several. One person can be the owner of several domains.

### Approver

The person who gives a second yes before AI apps get a high-risk fact.

### Admin

The person who sets up domains, people and which AI apps can connect. An admin can also stop what AI apps get.

### Data team

The team that runs the company's data tools and answers data questions.

## What AI apps get

### What AI apps get

The facts an AI app gets when it asks about a metric, a market or a period: every accepted fact that applies, and nothing archived or stopped.

### Edition

A saved set of every accepted fact at one moment, numbered by its date. It never changes. You see them on the Editions page. See [Editions and the stop switch](editions.md).

### Stop switch

An admin's control that stops AI apps getting one fact, one domain or everything at once.

### Gap

A question that AI apps or people asked and no fact could answer. We count it without recording who asked.

## AI apps and MCP

### AI app

A program such as Claude or ChatGPT that answers questions. It can check these facts before it answers.

### MCP

The connection AI apps use to check these facts. MCP is a standard for it, like a plug that fits many devices. See [What is an MCP](mcp.md).

### Tool

One thing an AI app can ask over MCP, such as Get facts for a question.

### Access key

What an AI app uses to connect when it can't sign in.

### Connect an AI app

Let Claude or another AI app check these facts before it answers.

### Try a question

See what an AI app gets for a question, before anyone asks it. It shows the facts for a metric, a market and dates, without asking any AI.

### Assistant

The helper built into the app. It finds and explains facts, and drafts new ones for you to check and send. It answers how the app works from these pages. See [The assistant](assistant.md).

### Review stamp

The line under every fact that AI apps get: who accepted it, on which day, and that its checks passed. An AI app reads the role, such as the owner of Sales, never a person's name. In the app, the line names the person too.

### Gateway (MCP)

The place in Administration where admins choose which AI apps may connect and which tools they get. Not to be confused with the gateway for the assistant.

### Gateway (AI)

The service the assistant and test runs use to reach the AI behind them. Not to be confused with the gateway for AI apps.

## Data and quality

### Cube

The tool that defines the metrics and the ways to split them, and returns the numbers.

### Catalogue

The list of Cube's metrics and the ways to split them, with a copy of each description and the facts about it.

### Definition changed

The definition of a metric or a way to split it changed where it comes from. Facts written before the change wait for a check. Point at the status to read where and when it changed, such as "Changed in Cube, 7 Oct 2026".

### Names

The metrics, markets and products we know by name, with their other names. Net sales, for example, is another name for Net revenue.

### Dimension

A way to split a number, such as market, product or brand. You see the word only in the Catalogue and Administration; elsewhere we write the dimension's own name, such as the market.

### Test question

A question with a known right answer. We ask it to check that a change doesn't make answers worse.

### Hidden test question

A test question that the people who write facts, and the assistant, never see. It shows how good answers really are.

### Health

The page where owners and admins see how well AI apps answer with each domain's facts. See [Read Health](read-health.md).

## Words you may have seen

Older words that some screens and pages still use, and what we call them now.

### Item

What we now call a [fact](#fact).

### Steward

What we now call the [owner](#owner) of a domain.

### Administrator

What we now call an [admin](#admin).

### Retire

What we now call [archive](#archive).

### Re-check due

The fact is past its [check date](#check-date). We now say it [needs checking](#needs-checking).

### Live edition

What we now call [what AI apps get](#what-ai-apps-get) today.

### Vocabulary

What we now call the [names](#names) we know: the metrics, markets and products themselves.

### Audience

What we now call [who can see it](#who-can-see-it).

### Agent

An AI app that uses tools to answer. We say [AI app](#ai-app).

### Model

A language model: the AI behind an AI app or the assistant. We say [AI app](#ai-app), and the assistant says "I".

### Try it

What we now call [Try a question](#try-a-question).
