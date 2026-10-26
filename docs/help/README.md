# The help pages

These Markdown files are the product's docs. The app shows them in its Docs area, at `/docs`, in the app's own design, and GitHub shows the same files here. The assistant and AI agents over MCP answer questions about how the product works from the same pages, with the tool `search_help`, and link the page they used. A page changes in the same pull request as the screen, word or tool it describes.

Start with [What is {{product}}](what-is-heed.md).

## The pages

| Page                                                                     | Kind     | Section           |
| ------------------------------------------------------------------------ | -------- | ----------------- |
| [What is {{product}}](what-is-heed.md)                                   | concept  | Start here        |
| [What is an MCP, and how it all connects](mcp.md)                        | concept  | Start here        |
| [A five-minute tour](tour.md)                                            | tour     | Start here        |
| [Editions and the stop switch](editions.md)                              | concept  | Concepts          |
| [The assistant](assistant.md)                                            | concept  | Concepts          |
| [Add your first piece of context](add-your-first-context.md)             | guide    | Guides            |
| [Review a proposal](review-a-proposal.md)                                | guide    | Guides            |
| [Read Health](read-health.md)                                            | guide    | Guides            |
| [Tell {{product}} about your business](tell-heed-about-your-business.md) | guide    | Guides            |
| [Add a connector](add-a-connector.md)                                    | guide    | Guides            |
| [Set up an agent](connect-an-agent.md)                                   | guide    | Connecting agents |
| [Glossary](glossary.md)                                                  | glossary | Reference         |
| [Common questions](common-questions.md)                                  | faq      | Questions         |

## How a page is made

A page is one file named by its slug, which is also its address in the app: `mcp.md` opens at `/docs/mcp`. Pictures are SVG files in `images/`. The page starts with front matter:

```yaml
---
title: What is an MCP, and how it all connects
short: What is an MCP # optional: a long title cut to 32 characters for the docs' tree
kind: concept # concept | guide | reference | tour | glossary | faq
section: start # start | concepts | guides | connect | reference | questions
order: 2 # its place in the section
summary: What an MCP is, and how {{product}}, Cube and your agent work together.
audience: [everyone] # everyone | owner | approver | administrator | auditor | operator
minutes: 5 # reading time
owner: Product team
reviewed: 2026-10-15 # the day someone last checked it against the app
screens: [/settings?section=connect] # the app's screens it describes
related: [connect-an-agent] # slugs shown under Related
---
```

The title comes from the front matter, so the body has no `#` heading. Sections are `##` headings, and `###` below them.

Where a sentence names the product, write `{{product}}`: the app puts in the product's name (`CL_PRODUCT_NAME`, `src/domain/brand.ts`) as it reads the page, the front matter and the pictures included, so a rename is one setting. Name it only where the sentence needs it: a title, a heading or a link that works without it goes without it. A heading never holds the token, because its words are the address a link points at (`glossary.md#gap`).

The kind decides the layout:

- **concept**: explains one idea in 300 to 700 words. It opens with `## In one minute`, 40 to 80 words that answer the title on their own. Then three to six sections, one picture and one example from the demo data, `## What it is not` and `## Go deeper`. No steps and no settings.
- **guide** and **tour**: the title starts with a verb, or names the tour. `## Before you start` says what you will do, who it is for and what you need. `## Steps` is one numbered list of at most 12 steps, one action each, with the result under the step. Then `## What happens next` and `## If something goes wrong`, with two to four cases.
- **reference**, **glossary** and **faq**: one line on what the page covers, then the entries. A glossary term or a common question is a heading, so a link can point at it (`glossary.md#edition`).

## Writing rules

1. Lead with the answer. The first 80 words answer the title's question.
2. One idea per sentence, about 15 words. Plain words: "start", not "initiate".
3. Explain every abbreviation the first time on each page, and link the glossary.
4. One word per thing, the screen's word, from the glossary in `src/domain/words-v1.ts`: "fact", "owner", "agent", "domain", "where it applies", and "edition" only for the Editions page and the review stamp. Write "AI agent" where the page first mentions the agent and "agent" after that, since a reader who meets the bare word may take it for a person (the docs check tests it). `docs/design/voice.md` says how to write with them. Name the product only where the sentence needs it.
5. Use the demo data for every example: Norway, Orders, Sales, Jon the owner, Maria the contributor.
6. Bold is only for the words of a screen, exactly as the screen writes them: **Send for review**. Use italics for any other emphasis.
7. One action per step, where before what: "Under **Where it applies**, add Orders."
8. Say what it is not.
9. Never promise what is not built, and never write "soon".
10. No numbers that change weekly: name the screen instead.
11. Write for readers whose first language is not English: no idioms, sentence-case headings, and the words of a picture repeated in the text.
12. Plain hyphens, no em dashes, and British spelling, as the app uses.

## Pictures

A picture is an SVG file in `images/`, linked as `![what it shows](images/name.svg 'caption')`. The alt text says everything the picture says. Draw it at the width it shows (at most 640), with text of at least 13, and colour it with the app's tokens and a fallback, `fill: var(--foreground, var(--hf-ink))`, so it follows the app's light and dark and still reads on GitHub. No scripts, no links and no `id`s.

## Help in context

A screen links to the page that answers the question people have there, in their words, with `HelpLink` (`src/web/components/help/help-link.tsx`): `<HelpLink to="mcp">What is an MCP?</HelpLink>`. It opens a card beside the link, a sheet on a phone, with the page's kind and reading time, a few lines and **Read the whole page**, so the person stays where they were. The few lines are a concept's answer in one minute, a guide's first section, or the words under a heading: `to="glossary#gap"` opens the glossary's sentence on a gap. Every place a screen links to is listed in `src/web/lib/help.ts`; add it there first. An empty state says what it means in one sentence, then links to the page that says more.

## The docs check

`tests/unit/docs.test.ts` runs with the unit tests and fails when:

- front matter is missing a field or has a value outside the lists above
- a concept page has no `## In one minute`, or it is not 40 to 80 words
- a page has no answer at its top for `search_help` to return, or it is not 12 to 150 words: a concept's `## In one minute`, or else the words above the first heading, or else the first section
- a guide has more than 12 steps
- a link to another page, a heading on it, a picture or a screen of the app does not exist
- a help link on a screen points at a page or a heading that does not exist
- a bold word is not on any of the app's screens
- a page has an em dash or a `#` heading
- a page names the product by hand instead of with `{{product}}`, or a heading holds the token
- a page's first mention of the agent is not "AI agent"
- a picture has a script, a link, an event handler or an `id`
