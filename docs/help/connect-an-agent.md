---
title: Connect an agent
line: One prompt for Claude, Cursor or another agent, and what approving does.
group: Start
order: 2
minutes: 3
reviewed: 2026-10-29
open:
  label: Open Agents and access
  href: /settings/agents
---

Connect Claude, Cursor or another agent, so it reads your published context before it answers a question about the numbers.

## Before you start

You need to be signed in. Anyone in the workspace can connect their own agent. It reads only context an owner has published, never drafts or comments.

## Paste the prompt

1. Open **Settings**, then **Agents and access**.
2. Press **Copy prompt** and paste it into your agent.
3. Let the agent run it. It adds the connection, writes one line into the project's instructions file (CLAUDE.md if there is one, otherwise AGENTS.md), and tells you how to sign in. It never asks for a key.

<!-- include prompt -->

```text title="The prompt, exactly as the app shows it"
Connect this agent to our team's checked context, so it checks it before it answers about company numbers.

1. Add a remote MCP server at https://heed.example.com/mcp, over HTTP, in your own way of doing that. In Claude Code, run:

claude mcp add --transport http heed https://heed.example.com/mcp

2. Add this line to the instructions file this project uses: CLAUDE.md if it exists, otherwise AGENTS.md, which you can create:

Before you answer a question about company data, call get_context first and use what it returns.

3. Then tell me how to sign in. A browser window opens once, and I approve the connection there. Never ask me for a key or a token. Change nothing else.
```

<!-- /include -->

## Approve it once

Your browser opens a screen that names the agent and what it can do: read published context, and send a report or a suggestion after you say yes. Choose Allow. The page says Connected, with the agent's name and yours, and it joins Connected agents.

> **Cursor and VS Code.** They have one-click install links on the same page. Claude's app and ChatGPT take the address as a connector; their steps are under Prefer to do it by hand.

## If nothing signs in

The page checks every few seconds. After two minutes it shows what usually helps, and after ten it stops, with Check again:

<!-- include checks -->

- Paste the prompt into your agent and press Enter.
- Say yes when the agent asks to run the command.
- Approve the connection in the browser, or ask your agent how to sign in.
- If it says the server already exists, ask it to remove the old one and try again.

<!-- /include -->

> **Revoking.** Revoke an agent from Connected agents. It signs out at once, and you can connect it again.

## What each agent may do

Connected agents lists every agent by its name, with who it works for and what it may do. Open Details on a row to read the list: read context, report what is missing or wrong, and, for Read and suggest, send suggestions that an owner checks before anything changes. No agent ever publishes. Details also lists the suggestions it sent lately.

Admins choose what each agent may do in Details: Read and suggest, Read only or No access. It acts at the agent's next request, and it never lets an agent do more than the person allowed when they connected it. Every change is in the history log, with who made it.

A suggestion an agent sends names it in the Inbox and the review, as "Claude Code, with Kofi's OK".

## A bot or a scheduled job

A job that runs on its own, with nobody there to approve a sign-in, uses an access key. Admins make them.

1. In Agents and access, open Tools and access keys.
2. Press **Create an access key**, give it a name, such as what the job does, then Copy. The key is shown once: keep it where the job keeps its secrets.
3. Give the job the MCP address, with the key as its bearer token.

A key reads published context and sends feedback. It names no person, so it never sends a suggestion. It shows in Connected agents by its name, with who made it and when it was last used, until you **Revoke** it, which ends it at once. Rename it, or set it to No access for a while, in its Details.
