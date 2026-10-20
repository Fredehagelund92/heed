# Turn existing lessons into Heed items

A prompt for Claude Code that turns text you already have (a list of dated lessons, a rule such as
"data before a set date is not comparable", the business caveats in a BI tool's or Cube's instruction
file) into an item file Heed can import. Run it in your own session, in the folder where you may
read that text. Heed never reads those files itself.

## Before you start

- The vocabulary has the terms the lessons are about: Administration › Sources › **Propose terms
  for these members**, accepted (see [Use your own data](../../README.md#use-your-own-data)).
- Give Claude Code three things: this file, [the item template](items.yaml), and the live term
  keys. Editions › **Export JSON** on the live edition holds every term with its key
  (`metric:...`, `dim:...`, `val:<dimension>/<value>`); `npm run heed -- schema` prints every
  field of an item.

## The prompt

Paste this into Claude Code, then point it at the text to convert.

```text
Turn the lessons and caveats below into a Heed item file in YAML, in the format of
docs/templates/items.yaml (read its comments: they list every field).

Rules:
- One item per caveat or lesson, in plain words: what a person or an agent should know when they
  read the number. Write the summary yourself; do not paste the source text.
- Leave out anything that tells a tool how to query, filter or choose data. That belongs in Cube or
  your BI tool, not in Heed.
- Never write partner or customer names, personal data, revenue or other figures, contract terms
  or secrets. If a lesson needs one to make sense, leave the lesson out and list it at the end.
- Scope each item with the live term keys only (metric:..., dim:..., val:<dimension>/<value>). Prefer
  named values to a dimension with any value. If no key fits, leave the item out and list it.
- kind: issue for a problem with a window (give its start and end), event for something that
  happened on a day, note for a standing caveat (no end, so a reviewDate).
- validity.start is the day it began to apply. Use the date the source gives; never guess one.
- evidence: the source's link, one sentence copied from it, and today's date as the day you read
  it. No link means no item: list it at the end instead.
- notToConclude: what not to conclude from it, in one or two plain sentences, such as "Lower
  orders after 4 August do not mean fewer customers." Start with "It doesn't tell you ...",
  "Don't use this for ..." or "Check with ...". Leave it out when there is nothing to add.
- riskLevel low unless the lesson is about money or a legal matter; then normal.

Write the file as lessons.yaml. After it, list the lessons you left out, each with why.
```

## Then

1. Read the file. Fix any wording that is not yours, and remove anything the data rule forbids.
2. Check it: Administration › Import facts, paste it and choose **Check the file** (or
   `npm run heed -- import lessons.yaml --as <your email>`). Fix what it names.
3. **Make proposals** (or `--apply`). Each item waits for its domain's owner; nothing is
   accepted by an import.
