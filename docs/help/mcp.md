---
title: What is an MCP, and how it all connects
short: What is an MCP
kind: concept
section: start
order: 2
summary: What an MCP is, and how the facts, Cube and your agent work together.
audience: [everyone]
minutes: 5
owner: Product team
reviewed: 2026-10-19
screens: [/settings?section=connect, /admin?section=gateway]
related: [connect-an-agent, what-is-heed, glossary]
---

## In one minute

MCP stands for Model Context Protocol. It's the connection AI agents use to check these facts, and to use tools in other systems. Think of it as a standard plug: any agent that has it, such as Claude Code, Cursor or ChatGPT, can connect to any system that offers one. {{product}} offers one. Add its address to your agent and sign in, and the agent can check the facts behind a number.

## Three words to know

Three words do most of the work:

- _Agent_: the program you talk to, such as Claude Code or Cursor. The AI inside it writes the answer.
- _MCP server_: a system that offers tools to agents. {{product}} is one. Your data tool can be another.
- _Tool_: one thing an agent can ask a server to do, such as "get the facts for orders in Norway in August".

![The plug: agents such as Claude Code, the Claude app, Cursor and ChatGPT on the left, MCP in the middle, and on the right the systems that offer tools: {{product}}, your data tool and other systems.](images/mcp-plug.svg 'One plug shape. Any agent that has it can use any system that offers it.')

Before MCP, every agent needed its own connector for every system. With MCP, {{product}} offers one address, and every agent that uses MCP can connect to it. Your agent decides when to call a tool, from your question and our instructions. You can see each call in the agent.

## How it is all connected

Follow one question through:

![One question, five steps: you ask your agent; the agent asks Cube for the number; the agent asks {{product}} for the facts; {{product}} returns a note with its source and what not to conclude; the agent answers with the number and the note.](images/mcp-one-question.svg 'One question, from you to the answer, with Cube and {{product}} each doing their part.')

1. You ask your agent: _How did orders in Norway change in August 2026?_
2. The agent asks your data tool for the number. Cube defines what "orders" means and returns the figure.
3. The agent asks {{product}} with the tool Get facts for a question: orders, Norway, August 2026.
4. We find the fact that applies: a note that online sales to Norway stopped on 4 August 2026. The agent gets the note with its source, its domain, and one line on what not to conclude: _lower orders after 4 August don't mean fewer customers_. It also gets who checked it: _accepted on 5 August 2026 by the owner of Sales_.
5. The agent answers with the number and the note, names the source, and can say that the owner of Sales checked the note before agents got it.

Behind step 4, Maria wrote the note, and Jon, who owns Sales, accepted it. From then on, agents got it. Your agent is told the role that accepted it, never the person's name. In the app, the line under the fact names Jon. If no fact applies, we say so and add one to the count for that topic. That count is a gap.

## What your agent can ask

These are the tools, as the page where you connect an agent names them:

| Tool                     | What it does                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| Get facts for a question | Finds the checked facts that apply to a question, with their sources.                                  |
| Find facts by name       | Finds facts by the words people use, such as Net sales or Spain, and what each metric means.           |
| Search facts             | Finds facts by their title and summary.                                                                |
| Read a fact              | Reads one fact in full, with its source.                                                               |
| Describe a domain        | Says what a domain covers, who owns it and what needs checking.                                        |
| See what changed         | Lists the facts that were added, changed or archived.                                                  |
| Improve a question       | Checks the dates, metrics and markets in a question. No AI is used.                                    |
| Search help              | Answers how-to questions from the help pages.                                                          |
| Report something missing | Tells the owners that an agent found nothing written down for a question. It doesn't record who asked. |
| Say if it helped         | Records whether the facts in an answer helped.                                                         |

Two more tools, Follow links and Save a draft, stay off until an admin turns them on. Save a draft saves a draft for you to check and send. It never sends it. That page shows which tools are on.

## Which model does what

A model is the AI inside an agent: the part that writes.

- _Your agent's own AI_ writes the answers you read. Your agent chooses it.
- _No AI picks the facts._ Rules decide what applies: the metrics, the markets and the dates. The same question gets the same facts until someone accepts a change. **Try a question** shows you exactly that.
- _The assistant and the test runs use an AI_ that your admin chooses.

## What stays with you

- Your agent works as you. The first time, it opens the sign-in page in your browser. You sign in and allow it. It reads only what you can read.
- You see and disconnect your agents under **Your connected agents**, on the page where you connect an agent. A disconnected agent stops at once.
- We never keep the words of your question or who asked. We keep counts by topic.

## What it is not

An MCP isn't an agent, or the AI inside one. It's only the plug between agents and other systems. And {{product}} isn't your data tool: it holds no numbers, and the figure always comes from Cube.

## Go deeper

- [Set up an agent](connect-an-agent.md) (guide, 3 min)
- [Glossary](glossary.md): agent, MCP, tool and the other words on this page
- [How AI sign-in works](../ai-sign-in.md), for engineers
- [The MCP specification](https://modelcontextprotocol.io), at modelcontextprotocol.io
