---
title: The agent tools in detail
line: What each of the six tools takes and gives back, and how to read a reply.
group: Reference
order: 4
reviewed: 2026-11-05
---

What each tool takes and gives back, for anyone building on them. For a shorter list, see [Agent tools](../help/tools.md).

## The six tools

| Tool              | What it does                                 | Takes                                                                       | Gives back                                              |
| ----------------- | -------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------- |
| `get_context`     | Finds the context that applies to a question | `question`, or `metrics`, `dimension_filters` and `window`                  | `status`, `say`, `context` and `reply_id`               |
| `find_context`    | Searches names, titles, summaries and text   | `query`, and `domain`, `kind`, `window` and `limit` if you want them        | Titles and summaries under `context`, and definitions   |
| `read_context`    | Reads one context item in full               | `id`, the item's id                                                         | Its text, every source, who checked it and its links    |
| `report`          | Tells the owner something is off             | `kind`, the `reply_id`, a `context_id` for one item, and a short note       | That it was sent, and who sees it (`to`)                |
| `suggest_context` | Sends a suggestion to the owner              | `text`, at most 2,000 characters, and hints such as `title`, `kind`, `area` | One of the statuses below, with a link                  |
| `get_related`     | Follows links, one step at a time            | `id`: an item id, `metric:orders`, `term:<id>` or `area:finance`            | Neighbours with titles and summaries, and `next_cursor` |

`report` and `suggest_context` run only after the person says yes. An admin can [switch any tool off](../help/tools.md).

## Read a get_context reply

A short reply looks like this, cut down here to the main fields:

```json
{
  "status": "matched",
  "say": "Checked. 1 fact applies to Orders in Norway in August 2026. Only that was checked.",
  "asked": "Orders in Norway in August 2026",
  "context": [
    {
      "id": "itm_norway01",
      "title": "Norway closure",
      "summary": "Online sales stopped on 4 August.",
      "kind": "event",
      "applies": "Orders in Norway.",
      "not_to_conclude": "cause not proven",
      "url": "/context/itm_norway01"
    }
  ],
  "reply_id": "0f8fad5b-d9cb-469f-a165-70867728950e"
}
```

Pass on `say`, which starts with the [answer line](../help/answer-lines.md). If the reply has `next`, follow it: it is the step for the agent. Keep `reply_id` to send a `report`.

| `status`           | Answer line | What it means                                                           |
| ------------------ | ----------- | ----------------------------------------------------------------------- |
| `matched`          | Checked     | Context covers the question                                             |
| `partial`          | Partial     | No item covers all of it, or a question with no dates was read at today |
| `no_match`         | Not found   | Nothing applies                                                         |
| `conflict`         | Conflict    | Two items that apply disagree                                           |
| `stale`            | Outdated    | An item's check date passed, or its source changed                      |
| `check_failed`     | Not checked | The checks could not run                                                |
| `need_more_detail` | None        | The question could not be read, so nothing was looked up                |

## Other fields you may see

- `definitions`: on a question about what a metric means.
- `terms`: the words a person defined that the question uses, up to five. Read the words by them, and never give a term as a checked source.
- `options`: on a word with two meanings. Ask the person which they mean, using `say`, and pass the choice in `metrics`.
- `may_be_out_of_date` and `disagrees_with`: on an item, when they hold.
- `about`: on a reply about several metrics, the ones an item is about. Never give them as one figure.

Set `response_format` to `full` for each item's body, every source, owner and links, and for how the dates were read.

## Dates and size

Dates in `window` include both ends: `window.from` and `window.to`. A question with no dates is read at today.

`max_items` is 20 by default and 50 at most. `max_bytes` limits the whole result, 100,000 by default, with links cut before items, and the reply lists the items it cut. Search and link cursors end when what agents read changes.

## Send a report

`kind` says what the person reports:

- `missing`: the context has nothing on it.
- `wrong`: what the context says is wrong.
- `unclear`: the person could not tell what it means.
- `helped`: it did the job.

What else you send depends on what the report is about:

- About a `get_context` reply, send its `reply_id`.
- About one item, add `context_id`.
- Something missing with no reply takes `question`, `metrics`, `dimension_filters` and `window`.

The note is checked for sensitive text, and the report never keeps who asked.

## Send a suggestion

Only a person's own agent may call it. An access key or a dev token names no person, so it is refused.

| `status`               | What happened                                                                     |
| ---------------------- | --------------------------------------------------------------------------------- |
| `suggestion_sent`      | It waits in the owner's Inbox. `policy.waits_because` says why, if a policy is on |
| `suggestion_published` | An owner's policy covered it, so it went live                                     |
| `draft_saved`          | The review checks refused it. `blocking` says why, with a link to the draft       |

- `possible_duplicate` means live items look alike. Ask the person, then call again with `item_id` or `new_item: true`.
- `needs_area` means the words do not point to one domain. Ask the person which, and pass `area`.
- Text that looks like personal data or a secret is refused, and nothing is saved.
- One person's agents can save 10 drafts in 24 hours, with 20 waiting unsent. Admins change this with `limits.agent_drafts`.

An agent that can show forms asks up to four of its open questions there first. An agent that cannot gets a link and the list of questions.

## Follow links

It gives each neighbour once, at its shortest distance, and never changes what `get_context` delivers.

| Option      | What it does                                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `depth`     | `2` follows two steps. The default is one                                                                             |
| `max_nodes` | How many on a page: 20 by default, 50 at most                                                                         |
| `relations` | The kinds to follow: `replaces`, `replaced_by`, `conflicts_with`, `applies_to`, `mentions`, `mentioned_by`, `in_area` |
| `window`    | The dates of neighbouring items                                                                                       |

By default it follows every kind but `in_area`. `links_withheld` counts neighbours the caller may not see.
