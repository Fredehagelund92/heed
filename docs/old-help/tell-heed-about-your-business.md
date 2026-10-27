---
title: Tell {{product}} about your business
kind: guide
section: guides
order: 4
summary: Write the short background the assistant and agents get, so they know what the business is and what its words mean.
audience: [administrator]
minutes: 3
owner: Product team
reviewed: 2026-10-27
screens: [/admin?section=business]
related: [what-is-heed, mcp, glossary]
---

## Before you start

- You'll: write a short text about what the business is and the words people use, so the assistant and AI agents don't start from nothing.
- Who: an admin.
- You need: a few minutes, and the words your colleagues use that an outsider would misread.

The assistant gets the text with every question. An agent, such as Claude Code, gets it when it connects through MCP, the connection AI agents use to check these facts. A new workspace starts with no text, so they get no background until you write one. A worked example, about an outdoor-gear retailer, is there to start from.

## Steps

1. Open **Administration**, then **About our business**.

2. Read the note at the top. It says what the text is for and what it never does.

3. Under **The text**, read what the box asks for, then write it. The box says it in two parts, so you never have to leave the screen:
   1. _What the company does._ One or two sentences: what it sells, to whom and where.
   2. _Words an outsider would misread._ One per line, as the word, a colon and what it means, such as _First-time buyer: a customer whose first paid order falls in the period._ A word that already has a definition in the Catalogue doesn't need to be repeated here, because this list is for the words people misread in everyday talk.

   It also says what to leave out: numbers, deals, dates and what happened in a market, legal conclusions, and secrets or personal data. Leave the box empty and the assistant and agents get no background.

   The text shows headings, lists and links as you type. Start a line with `-` for a list, or type `/` to choose a block. Select words to make them bold or a link. The counter under the text shows how many characters you have left. The limit is 1,200.

4. Read **What the assistant and agents get**. It's exactly what they'll be given, with the lines we put around your text. It follows what you type.

5. To start from the worked example, an outdoor-gear retailer, choose **Reset to the starter text**, then make it yours. Nothing changes until you save.

6. Under **Why**, say why you changed it, for the history log.

7. Choose **Save new version**.

   **History** shows the new version, with your name, the time and your reason.

## What makes a good text

- _Short._ What the business is, then the words. The assistant and agents read it with every question.
- _Words, not facts._ Explain what first-time buyer, gross margin, marketplace commission or return mean here. Leave out numbers, deals, dates and what happened in a market: those belong in facts, which their owners check.
- _No legal conclusions._ Explain what a market and a selling country are. Don't say what's allowed where. A fact with its source says that.
- _No secrets or personal data._ The text goes to the AI provider with every question, like the question itself.

## What it is not

The text is background. The assistant never cites it, and it never counts as a source. Agents don't get it as a fact for a question, and no check reads it. When a fact or a definition says something else, the fact or the definition wins.

## What happens next

- The assistant uses the new text from the next question anyone asks.
- An agent gets it the next time it connects. One that's already connected keeps the text it was given until it connects again.
- Every version stays in **History** and in the history log, so you can see who changed the text, when and why.

## If something goes wrong

- _It says another admin saved a new version._ Their text shows now. Read it, then make your change again.
- _The counter is red._ The text is over 1,200 characters. Shorten it, and keep the words that are misread most.
- _The assistant still gets a word wrong._ Check that the word has its own line, then ask again in a new chat.
