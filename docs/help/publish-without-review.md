---
title: Publish without review
line: Let one agent publish low-risk new items in your domain, as your decision, and turn it off.
group: Write and review
order: 4
minutes: 4
reviewed: 2026-10-31
open:
  label: Open Agents and access
  href: /settings/agents
---

An owner can let one named agent publish some of its suggestions in their domain without a review round. Each one is published as the owner's own decision, under their name, and anyone who owns the domain can undo it from its history. It is off until an admin switches it on.

## What it publishes, and what it never does

A suggestion from that agent publishes at once only when all of this is true:

- It is a new context item. A change to a live item, or archiving one, always waits for an owner.
- It is low risk. An agent never sets the risk level, so its suggestion keeps the default for its kind: a Rule starts at low risk, and an Event, a Warning or a Guide at normal risk. Today that means Rules only.
- It clashes with nothing live, has no claim to check, and nothing in it needs care, such as words that may mean a legal or financial matter.
- Every check passes, as it must for any publish.
- The agent has not reached the most it may publish in a day. That cap is 10 unless the owner chooses another number from 1 to 50. Over it, the rest of the day's suggestions wait for review, and publishing starts again as the day's count falls.
- The owner who set it is still an owner of the domain, and the agent may still send suggestions.

Anything else waits in the owners' Inbox as usual. The agent's reply says it waits, and why.

It never expires. It stays on until someone turns it off.

## Switch it on for the workspace

Admins only.

1. Open **Settings**, then **Agents and access**.
2. Open Publish without review and switch on **Let owners choose agents that publish without review**.

Switching it off again turns off every agent that publishes without review, at once. Their suggestions wait for review again, and owners choose again once it is back on.

## Let an agent publish in your domain

Owners of the domain only. An admin who does not own the domain cannot set one.

1. Open **Settings**, **Domains and owners**, then your domain.
2. Under Without review, choose **Let an agent publish without review**.
3. Choose the agent. The list has the agents that sent suggestions to the domain in the last 90 days, with how many were published.
4. Choose the most it may publish in a day, and say why. The history log keeps your reason.
5. Choose **Let it publish**.

Setting it again for the same agent and domain replaces what you set before.

## Turn it off

Turn off is beside it on the domain page, and in the agent's Details in Agents and access. Whoever set it, any owner of the domain, an admin, and the person the agent works for can turn it off. It acts at once: the agent's next suggestions wait for review. Revoking the agent, or the person disconnecting it, turns it off too.

## Who decided, and how to undo it

The item's history says who sent it and whose decision it was: "Published by Claude Code for Kofi under Jon's policy". The history log says the same, and keeps the owner as the one who decided. The owner finds it under Done in their Inbox, as Published under your policy.

Nobody read it before agents got it, so an owner of the domain or an admin can undo it at any time while the item is as it was published: open the item, open its version in History, and choose Undo this publish. Agents stop getting it, and the suggestion waits for review like any other.

> **Why it is safe to try.** It only ever adds a new item that clashes with nothing, and every one can be undone. An owner who wants to read each suggestion first simply never turns it on.
