---
title: Common questions
kind: faq
section: questions
order: 1
summary: Short answers to what people ask most.
audience: [everyone]
minutes: 4
owner: Product team
reviewed: 2026-10-19
screens: []
related: [what-is-heed, connect-an-agent, glossary]
---

The questions people ask most, each with a short answer and a page to read next.

## Why didn't my agent use the facts?

Your AI agent decides when to use a tool. Check that it shows under **Your connected agents**. Then add the line under **Ask first** to its instructions, name the metric and the dates in your question, or ask it to check the facts first. We tell agents to use Get facts for a question before they answer, but each agent follows that in its own way. See [Set up an agent](connect-an-agent.md).

## Does it keep my questions?

No. We never store the words of a question or who asked. We keep counts by topic, and hide any count below 5. See [What is an MCP](mcp.md#what-stays-with-you).

## A fact is wrong. What do I do?

Open it and choose **Suggest a change**, or tell the owner of its domain. If it's urgent, an admin can stop agents getting it at once. See [Editions and the stop switch](editions.md#the-stop-switch).

## What does "Needs checking" mean?

The fact is past its check date, or its source changed. Agents still get it, and they're told it may be out of date until the owner checks it. See the [glossary](glossary.md#needs-checking).

## Who can see what I write?

Your draft is yours until you send it. Then the owners of its domain review it. Once it's accepted, everyone who can see it, and their agents, can read it. See [Add your first fact](add-your-first-context.md).

## Why was nothing found?

No accepted fact applies to the metric, the market and the dates of the question. The answer says so, and that doesn't prove there's nothing to know. The question counts towards a gap. See the [glossary](glossary.md#gap).

## Can my agent change facts?

No. If an admin allows it, your agent can save a draft for you to check and send. It never sends, accepts or changes a fact. See [What is an MCP](mcp.md#what-your-agent-can-ask).

## Which AI is used?

None, to find the facts: rules decide which facts apply. The assistant and the test runs use an AI that your admin chooses. Your agent uses its own. See [What is an MCP](mcp.md#which-model-does-what).

## Is this the place for metric definitions?

No. Cube holds them. If it's a number with a formula, it belongs in Cube. If it explains why a number moved, or how to read it, it's a fact and belongs here. See [What is {{product}}](what-is-heed.md#what-it-holds-and-what-it-doesnt).

## Why is a metric missing from Where it applies?

We read every metric Cube has, but people and agents find only the ones we know by name. An admin adds them in **Administration**, under **Sources**, with **Propose names**. An owner of each one's domain, or an admin, then accepts them. See [Review a proposal](review-a-proposal.md).

## Why does a metric need a domain?

A metric's domain says who looks after it. When you add a fact about the metric, it goes in that domain, and its owner reviews it. You can still pick a metric without a domain under **Where it applies**. But then we can't choose the fact's domain from it, and no owner hears when the metric changes.

Cube gives a metric the domain of its view. When a view has none, an admin can name one in Cube (`meta.domain`) or in the server's domain names, then read the source again. Or they choose a domain for each metric under **Metrics without a domain** while they add the names.

## How do I delete a domain?

An admin chooses **Delete** beside the domain in **Administration**, under **Domains**. One dialog lists everything that goes with the domain: each fact, name, proposal, draft and role. It says what happens to each one, and nothing has to be moved first. To confirm, type the words `permanently delete`. Until you do, **Delete domain** stays off. Then, in one step:

- its accepted facts move to the **Bin**, and agents stop getting them at once;
- the names it holds are archived, and their metrics lose the domain. A name another domain still uses stays, without a domain;
- its open proposals are withdrawn with the reason "Domain deleted", and the people who wrote them are told;
- its drafts stay with the people who wrote them, marked "Domain deleted", to send to another domain or discard;
- the roles of its people end;
- its history stays, with the domain's name.

A domain that held nothing is deleted for good, and you can create it again at once. Any other domain can come back. An admin restores it from **Deleted domains**, below the domains, at any time. It comes back with its people's roles and its names, and its facts come back from the **Bin**. Nothing deletes the facts for good, and nothing is erased from the history.

To keep one fact of a deleted domain without the domain, choose **Restore** beside it in the **Bin**, then choose another domain. The dialog lists what the new domain changes in the fact, such as its owner, the names that went with the old domain, and a check date that has passed. The fact comes back archived, with a proposal in the new domain for its owners to review. Agents get it again once they accept it.

## How do I run it on my own computer?

With Docker. In a copy of the app's code, run `docker compose up` and open `http://localhost:8080`. It starts with the demo: invented people, domains and facts. To run it on your own Cube instead, name the folder of your Cube files in `CUBE_MODEL_DIR` when you start it. It then starts empty, and an admin adds the domains and the names. For the people who set it up, the README's Quick start has the details.

## How do I become an owner?

Ask an admin. They choose a domain's owners and approvers in **Administration**, under **People**, or on the domain's **Team** tab in **Health**. See the [glossary](glossary.md#owner).

## What happens when I disconnect an agent?

It stops working at once. To connect it again, add the address and sign in. See [Set up an agent](connect-an-agent.md#disconnect-an-agent).

## Why are some counts hidden?

A count below 5 could tell people who asked or who rated. So we show "fewer than 5", or hide the count. See [Read Health](read-health.md#the-work-list).
