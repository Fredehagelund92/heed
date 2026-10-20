---
title: Add a connector
kind: guide
section: guides
order: 5
summary: Choose a tool for {{product}} to read, fill in its settings, test them and add it.
audience: [administrator]
minutes: 4
owner: Product team
reviewed: 2026-10-19
screens: [/admin?section=sources, /admin?section=sources&add=true]
related: [glossary, common-questions]
---

## Before you start

- You will: connect a tool {{product}} reads from, such as a semantic layer, so it knows which metrics exist and how they split, such as by market.
- Who: an admin.
- You need: the tool's settings, such as a repository's address, and a read-only access key when the tool asks for one.

A connector reads one tool, and only reads it. A **Definitions** connector says which metrics exist and how they split: {{product}} checks facts against them and never changes them. Each connector you add becomes a source on the list under **Sources**.

## Steps

1. In **Administration**, open **Sources** and choose **Add a connector**.

   The list shows each connector this server has, grouped by what it syncs. A connector marked **Experimental** may still change.

2. Choose the connector for your tool.

   Its page says what it syncs, how often it reads, which hosts it reaches and the least access it needs. Read this before you give it anything.

3. Under **Name**, give the source a name people know, such as Finance metrics.

4. Fill in its settings. The ones most people leave as they are wait under **More settings**.

   An access key has a field of its own. {{product}} keeps it in the server's secret store and never shows it again.

5. Choose **Test connection**.

   {{product}} runs the connector's check step by step, then reads the tool once and keeps nothing. It says what it would hold, such as 12 metrics, and any warnings.

6. Under **Why**, say why you add it. The history log keeps it with the change.

7. Choose **Add connector**.

   {{product}} reads it at once. Its page opens and shows the read within a minute.

## What happens next

{{product}} reads the source on its schedule, every hour for most connectors. Its page shows its status, its last read, what it holds and anything that needs checking. **Read again** reads it now, and **Change settings** opens the same form, filled in. An access key left empty there keeps the one {{product}} holds.

A changed definition never changes a fact. The facts that rely on it are marked as needing checking, and the owners of their domain hear about it.

## If something goes wrong

- _The test says it can't read the tool._ Its words name what to fix, such as an address or an access key. Fix that setting and choose **Test connection** again. Nothing was saved.
- _A step of the test has a warning._ You can still add the source. The step says what would make it better, such as a domain for each metric.
- _A field says what is wrong when you add the source._ {{product}} checks every setting again when you add it. Fix the field it names, then choose **Add connector** again.
- _No connector on the list reads your tool._ Connectors are part of the server. Ask whoever runs {{product}}.
