---
title: Integrations
line: Connect where metrics are defined and where documents live, and what is read.
group: Set up
order: 2
minutes: 4
reviewed: 2026-10-29
---

Connect where metrics are defined and where documents live, and what is read from each.

## Definitions

Metric and dimension names arrive from the tool where they are defined, and stay read-only. When a definition changes there, the context that relies on it comes back to its owners to check.

## Documents

A folder shared with a service account, or Markdown in a repository. A read never publishes: each document becomes a suggestion in its owners' Inbox.

## Connect one

Five steps on one page: pick the tool, connect it and **Test connection**, choose the views or folders to read, map each to a domain, and say why it is added. A folder's documents go to its domain's owners; a view left without a domain stays shared. Only admins connect a tool.

**Change settings** goes through the same steps, filled in. A token or a key left empty stays as it is. **Disconnect** stops reading the tool and forgets its key: its open suggestions are withdrawn, and what owners published stays.

## Figures in Ask

Off by default. Switched on per integration, Ask shows one figure, read when asked and kept nowhere, with its source, how fresh it is, and the data contact who hears about a figure that looks wrong.

An admin sets it up on the integration's page, with the data endpoint and a read-only token, which is sent only to that address and never shown again. **Replace** gives it a new token, and a new address needs its token again. Then name the **Data contact** and switch on **Show figures in Ask**.

The metric's definition decides which integration answers. When someone says in Ask that a figure doesn't fit a context item, the figure and the item show side by side until the owner or the data contact has a look. Nothing picks one of them.
