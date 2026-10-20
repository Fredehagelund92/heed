---
title: The assistant
kind: concept
section: concepts
order: 2
summary: What the assistant does, where its answers come from, and what it never does.
audience: [everyone]
minutes: 3
owner: Product team
reviewed: 2026-10-20
screens: [/assistant]
related: [what-is-heed, mcp, add-your-first-context]
---

## In one minute

The assistant is the helper built into the app. Ask it in your own words which facts apply to a metric, what a word means, what changed, or how the app works. It answers from what's written down: the accepted facts, their sources and these help pages. It names each fact or links the page it used, so you can check. It can draft a fact with you, but you send it and the owner accepts it.

## What you can ask

- _What applies._ Which facts apply to Orders in Norway last week, and why others don't.
- _What a word means._ What a metric means, where its definition comes from, and what the facts add to it.
- _What a domain holds._ What a domain covers, which of its facts need checking, and what changed lately.
- _How it works._ What an MCP is, what the stop switch does, or how to review a proposal.
- _Its last answer._ Say _what do you mean?_, _say it simpler_, _shorter_ or _why?_. It answers from the chat: it looks nothing up, carries nothing over from your last question and assumes no date.
- _A draft._ Paste what happened, or a link to where you read it, and it drafts a fact for you to check. The draft comes on a card with every field and where each one came from. A line beside a field marks what it filled in itself. Nothing is saved until you choose **Create draft**.

## Where its answers come from

Above each answer, the assistant lists the steps it took, such as _Read the overview of Sales_ or _Looked up facts · 4 checked, 2 apply_. Once the answer is done, the steps fold into one line. Open it to see each one.

- _Facts_ come from what AI apps get today, through the same tools your AI app uses. The assistant names each fact it uses, and you can open it. Each one shows its whole title, what kind of fact it is, its domain and its date, then what it says. The facts that don't apply are folded under _Facts that don't apply_, apart from the ones that do.
- _A change or its cause._ The facts are written notes, not the numbers. Asked whether a number dropped, or why, the assistant starts by saying what the facts can't show, then names only the facts that could be related. It never says one of them caused it unless a fact says so. When you give no dates, it says which day it read at. In the demo, the date is fixed, so it calls it the demo's date.
- _How it works_ comes from these help pages. The assistant searches them, answers from the page it found and links that page. So a question such as _What is an MCP?_ gets the same answer here, in the Docs and in your AI app. MCP (Model Context Protocol) is the connection AI apps use to check these facts.
- _A sentence it can't back up_ with what it read is removed before you see it. A quote must be copied exactly from what it read, or from your own message.
- _About our business_, the background an admin writes, helps it understand your words. It's never a source: the assistant doesn't cite it or quote it. See [Tell {{product}} about your business](tell-heed-about-your-business.md).

![One help page in three places: the page is written once, in the Docs; the assistant answers from it with a link; your AI app answers from it over MCP with a link. Each place gives the same answer.](images/one-page-three-places.svg 'A page is written once. The assistant and your AI app answer from it and link it.')

## An example

In the demo data, Jon Abara has just become an owner of Sales. He asks the assistant: _How do I review a proposal?_ The assistant searches the help pages and finds [Review a proposal](review-a-proposal.md). It replies that an owner of the domain decides, and links the guide. Jon opens the guide for the steps.

## What it never does

- It never sends, accepts, shares or archives anything. A person does that in the app.
- It never changes roles or settings.
- We don't store your conversation. We keep only the drafts you confirm. When you mark an answer **Good answer** or **Something was wrong**, we keep only the count.

## What it is not

The assistant isn't your AI app, and it only answers questions about your facts and this app. It's not your data tool either: it holds no numbers, and the figure comes from your data tool, such as Cube.

## Go deeper

- [What is an MCP](mcp.md): how your own AI app asks the same questions
- [Add your first fact](add-your-first-context.md): write a fact by hand or with the assistant
- [Glossary](glossary.md#assistant): the assistant and the other words on these pages
