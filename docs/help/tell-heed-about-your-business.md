---
title: Tell {{product}} about your business
kind: guide
section: guides
order: 4
summary: Write the short background the assistant and AI apps get, so they know what the business is and what its words mean.
audience: [administrator]
minutes: 3
owner: Product team
reviewed: 2026-10-20
screens: [/admin?section=business]
related: [what-is-heed, mcp, glossary]
---

## Before you start

- You'll: write a short text about what the business is and the words people use, so the assistant and AI apps don't start from nothing.
- Who: an admin.
- You need: a few minutes, and the words your colleagues use that an outsider would misread.

The assistant gets the text with every question. An AI app, such as Claude Code, gets it when it connects through MCP, the connection AI apps use to check these facts. You start with a neutral text about an outdoor-gear retailer. You can keep it, change it, empty it, or have {{product}} write a first version from what it already knows.

## Steps

1. Open **Administration**, then **About our business**.

2. Read the note at the top. It says what the text is for and what it never does.

3. Under **The text**, read what the box asks for, then write it. The box says it in two parts, so you never have to leave the screen:
   1. _What the company does._ One or two sentences: what it sells, to whom and where.
   2. _Words an outsider would misread._ One per line, as the word, a colon and what it means, such as _First-time buyer: a customer whose first paid order falls in the period._

   It also says what to leave out: numbers, deals, dates and what happened in a market, legal conclusions, and secrets or personal data. Leave the box empty and the assistant and AI apps get no background.

   The text shows headings, lists and links as you type. Start a line with `-` for a list, or type `/` to choose a block. Select words to make them bold or a link. The counter under the text shows how many characters you have left. The limit is 1,200.

   To start from a draft, choose **Write a first version for me**. {{product}} writes it from your domains and from the metrics and markets your definition source describes, and puts it in the box. It can't know what your company sells, so check the first lines and change what's wrong. Nothing is saved until you choose **Save new version**. If you don't like the draft, choose **Put back my text**. If an AI writes it, the names and descriptions it works from go to the AI provider, as a question would.

4. Read **What the assistant and AI apps get**. It's exactly what they'll be given, with the lines we put around your text. It follows what you type.

5. To start again from the starter text, choose **Reset to the starter text**. Nothing changes until you save.

6. Under **Why**, say why you changed it, for the history log.

7. Choose **Save new version**.

   **History** shows the new version, with your name, the time and your reason.

## What makes a good text

- _Short._ What the business is, then the words. The assistant and AI apps read it with every question. Keep room in the 1,200 for the sentences about what the company does: a first version stops at 1,000 characters.
- _Words, not facts._ Explain what first-time buyer, gross margin, marketplace commission or return mean here. Leave out numbers, deals, dates and what happened in a market: those belong in facts, which their owners check.
- _No legal conclusions._ Explain what a market and a selling country are. Don't say what's allowed where. A fact with its source says that.
- _No secrets or personal data._ The text goes to the AI provider with every question, like the question itself.

## What it is not

The text is background. The assistant never cites it, and it never counts as a source. AI apps don't get it as a fact for a question, and no check reads it. When a fact or a definition says something else, the fact or the definition wins.

## What happens next

- The assistant uses the new text from the next question anyone asks.
- An AI app gets it the next time it connects. One that's already connected keeps the text it was given until it connects again.
- Every version stays in **History** and in the history log, so you can see who changed the text, when and why.

## If something goes wrong

- _It says another admin saved a new version._ Their text shows now. Read it, then make your change again.
- _The counter is red._ The text is over 1,200 characters. Shorten it, and keep the words that are misread most.
- _It says it has nothing to write a first version from._ {{product}} writes it from your domains and your definition source, so add a domain or connect a source first, or write the text yourself.
- _The assistant still gets a word wrong._ Check that the word has its own line, then ask again in a new chat.
