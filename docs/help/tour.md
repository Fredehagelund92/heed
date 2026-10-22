---
title: 'A five-minute tour: Norway, from gap to answer'
short: A five-minute tour
kind: tour
section: start
order: 3
summary: Follow one fact from a gap to an answer, on demo data.
audience: [everyone]
minutes: 5
owner: Product team
reviewed: 2026-10-19
screens: [/gaps, /try-it, /library/new, /proposals, /editions]
related: [what-is-heed, add-your-first-context, review-a-proposal]
---

## Goal

See the whole loop once: an AI agent finds nothing, a person writes the missing fact, the owner accepts it, and the next answer has it. You play two people from the demo data: Maria, who writes, and Jon Abara, who owns Sales.

You need a demo install for this tour, because it uses **Switch demo person** in the menu under your name. On real data, follow the same path with your own colleagues.

## Steps

1. In the sidebar, open **Gaps**, then open _Orders in Norway_.

   A gap is a topic where agents asked and found no fact. We count the questions, never who asked them.

2. On **Home**, choose **Try a question**. Pick the metric Orders, the market Norway and the month of October 2026.

   You see what an agent gets today: nothing about what happened in Norway. On the show's demo data, the page says **No match**: nothing at all is written down there yet.

3. Go back to the gap and choose **Start a draft**.

   The **Add context** form opens with the topic filled in.

4. Write the fact. Pick the kind **Event** and the domain Sales. Give it a title, such as _Online sales to Norway stopped on 4 August 2026_. Under **When it applies**, set **From** to 4 Aug 2026 and leave **Until** empty. Under **Where this comes from**, add a link and one sentence copied from the source. Under **What not to conclude**, write _Lower orders in Norway after 4 August don't mean fewer customers._

5. Open the **What agents get** tab. It shows what an agent will get once the fact is accepted. Then choose **Send for review**.

6. Open the menu under your name and choose **Switch demo person**. Sign in as Jon Abara, who owns Sales.

7. Open **Proposals**, then **To review**. Open your proposal, read the checks, and choose **Accept**. Give a short reason.

8. Open **Editions**. The newest entry, at the top, lists your fact. Choose **What changed** to see what was added and by whom.

9. Choose **Try a question** again with the same metric, market and dates. The note now shows, with its source, what not to conclude, and a line that says Jon Abara accepted it today. An agent reads the same line with the role: the owner of Sales.

   If you've connected Claude Code, ask it the same question: _How did orders in Norway change in October 2026?_

## What you learned

- A gap shows where people ask and find no fact.
- Anyone can write the missing fact. The owner of its domain checks it before anyone relies on it.
- Once the owner accepts it, agents get the fact at once.
- **Try a question** shows what an agent gets, without asking any AI.

## Next pages

- [What is an MCP, and how it all connects](mcp.md)
- [Add your first fact](add-your-first-context.md)
- [Review a proposal](review-a-proposal.md)
