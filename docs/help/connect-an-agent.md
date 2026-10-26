---
title: Set up an agent
kind: guide
section: connect
order: 1
summary: Paste one prompt into Claude Code, sign in once, and ask your first question.
audience: [everyone]
minutes: 3
owner: Product team
reviewed: 2026-10-19
screens: [/settings?section=connect, /try-it]
related: [mcp, common-questions, what-is-heed]
---

## Before you start

- You'll: set up your AI agent to check the facts before it answers a question about company data.
- Who: anyone who can sign in.
- You need: Claude Code on the same computer as {{product}}, and its address.

The address is under **The address** on [Connect an agent](/settings?section=connect), the page where you connect. You can also open that page from the menu under your name, or press G then Y.

Today, Claude Code is the agent that connects, and the page lists it. Other agents that use MCP, such as the Claude app, Cursor or ChatGPT, need {{product}} at an address on the internet. This one runs on your own computer.

## Steps

1. On the page, choose **Copy prompt** on the card at the top, and paste it into Claude Code.

   The prompt asks Claude Code to add {{product}}, to put the line from [Ask first](#ask-first) in `CLAUDE.md`, and to tell you how to sign in. Claude Code asks you before it runs anything. To do each step yourself, use **Set it up by hand** under the card. The first step is this line, to run in a terminal:

   ```sh
   claude mcp add --transport http heed http://localhost:3000/mcp
   ```

2. Start Claude Code again, run `/mcp`, choose heed, then choose Authenticate.

3. Your browser opens the sign-in page. Sign in, read what the agent asks for, and choose **Allow**.

   From now on, the agent checks the facts as you. It reads only what you can read. The card on the page says **Connected** and names the agent.

4. Go back to Claude Code and ask a question about company data, for example: _How did orders in Norway change in August 2026?_

   When the agent checks the facts, it calls Get context for a question first. Then it answers with the number and the facts that apply.

## The skill file

Beside the prompt, the card has a button to download `SKILL.md`. It's a skill for agents that write code, such as Claude Code, Codex and Cursor. It tells the agent to check the facts first, and how to read each reply: `matched`, `need_more_detail` or `no_match`. It also has the setup line for each of the three.

Save it in your project as `.claude/skills/heed/SKILL.md` for Claude Code, or as `.agents/skills/heed/SKILL.md` for Codex and Cursor. Like the line under Ask first, a skill makes the agent check more often. It can't make it check every time.

## Ask first

Your agent decides when to call a tool. Add this line to its instructions so it checks more often.

For `CLAUDE.md` or `AGENTS.md` in your project, which Claude Code and other agents that write code read when they start:

```text
Before you answer a question about company data, call get_context first and use what it returns.
```

For the instructions a data tool gives its own built-in AI, when that AI is connected to {{product}}:

```text
When someone asks why a number moved, or before you trust a number, ask {{product}} with get_context for the events, caveats and definitions that apply.
```

Both lines are on the page, under **Ask first**, with a copy button.

## Check that it works

- On the page, the card says **Connected**, and the agent shows under **Your connected agents**.
- To see what the agent was told, choose **Try a question** with the same metric, market and dates. It shows the same facts, without asking any AI.

## Disconnect an agent

On the page, under **Your connected agents**, choose **Disconnect** beside the agent. It stops working at once. To connect it again, follow the steps above.

An admin can disconnect your agents too, for example when a laptop is lost. They do it in **Administration**, under **MCP and gateway**, **Connections**, and give a reason. The agent then stops working, and you connect it again the same way.

## If something goes wrong

- _The agent can't sign in._ Ask the data team for an access key. Then follow the setup for an agent that can't sign in, in **Set it up by hand**.
- _Claude Code says heed already exists._ An older entry points somewhere else. Run `claude mcp remove heed`, then step 1 again.
- _The agent doesn't check the facts._ Your agent decides when to call a tool. Check that the line from [Ask first](#ask-first) is in its instructions, and name the metric and the dates in your question. Or ask it to check the facts first. See [Common questions](common-questions.md#why-didnt-my-agent-use-the-facts).
- _The browser doesn't open._ Run `/mcp` in Claude Code again and choose Authenticate.
