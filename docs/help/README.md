# The documentation

These Markdown files are the documentation of the new web app (`src/app`). The same files make the app's Docs area, at `/docs`, and the static docs site that `npm run docs:build` writes to `dist/docs`, with its search and its index for agents, `llms.txt`. A page changes in the same pull request as the screen, word or tool it describes.

The old web app (`src/web`) and its assistant read their own pages, in [`docs/old-help`](../old-help/README.md), until the new app replaces them.

## The pages

| Page                                                    | Group            |
| ------------------------------------------------------- | ---------------- |
| [Get started](get-started.md)                           | Start            |
| [Connect an agent](connect-an-agent.md)                 | Start            |
| [Write context](write-context.md)                       | Write and review |
| [Review a suggestion](review-a-suggestion.md)           | Write and review |
| [Definitions and synonyms](definitions-and-synonyms.md) | Write and review |
| [Domains and owners](domains-and-owners.md)             | Set up           |
| [Integrations](integrations.md)                         | Set up           |
| [How agents use it](how-agents-use-it.md)               | How it works     |
| [Answer lines](answer-lines.md)                         | How it works     |
| [Privacy](privacy.md)                                   | How it works     |
| [Agent tools](tools.md)                                 | Reference        |
| [What's new](changelog.md)                              | (its own page)   |

## How a page is made

A page is one file named by its slug, which is also its address: `privacy.md` opens at `/docs/privacy`. It starts with front matter:

```yaml
---
title: Connect an agent # at most 40 characters
line: One prompt for Claude, Cursor or another agent, and what approving does. # at most 120
group: Start # Start | Write and review | Set up | How it works | Reference
order: 2 # its place in the group
minutes: 3 # reading time
reviewed: 2026-10-27 # the day someone last checked it against the app
open: # optional: the screen the page is about, opened from beside its title
  label: Open Agents and access
  href: /settings/agents
---
```

The title comes from the front matter, so the body has no `#` heading. The body opens with one paragraph, the lead, shown under the title. Sections are `##` headings, which the page's "On this page" list shows, and `###` below them.

The docs draw only what the pages use, and refuse the rest when the app is built:

- Paragraphs, lists, tables, **bold**, _italics_ and `code`. A numbered list shows as steps.
- A note: a quote whose first words are its title in bold, with a full stop: `> **Revoking.** Revoke an agent from Connected agents.`
- A code block that says what it is: ` ```text title="The prompt, exactly as the app shows it" `.
- Links to another page, as `write-context.md` or `write-context.md#the-four-kinds`; to a screen of the app, as `/settings/agents`; or to a web address, as `https://...`. A link to a page or a heading that does not exist fails the build.

No pictures and no HTML, other than an include.

## Includes: the app's own lists

Where a page shows one of the app's own lists, it names it with an include, so a change in the app changes the page:

```markdown
<!-- include answer-lines -->

| The line | What it means | What you do |
| ...

<!-- /include -->
```

The Docs area and the docs site draw the list from its source in the app. What stands between the two markers is the same list as Markdown, for GitHub and for agents (`llms-full.txt`). Never edit it by hand: `npm run docs:sync` writes it, and the docs check fails when it is not current.

| Include              | What it shows                              | Its source                    |
| -------------------- | ------------------------------------------ | ----------------------------- |
| `setup-steps`        | The setup checklist's five steps           | `src/app/lib/setup.ts`        |
| `prompt`             | The prompt that connects an agent          | `src/app/lib/agents.ts`       |
| `checks`             | What to check when nothing signs in        | `src/app/lib/agents.ts`       |
| `kinds`              | The four kinds of context, with their hint | `src/app/model/items.ts`      |
| `word: Context item` | One of the ten words, with its sentence    | `src/app/lib/help-content.ts` |
| `answer-lines`       | The six answer lines                       | `src/app/lib/help-content.ts` |
| `words`              | The ten words                              | `src/app/lib/help-content.ts` |
| `tools`              | The six agent tools                        | `src/app/lib/agents.ts`       |

Help in the app (`/help`) shows the same answer lines and words, from the same lists.

## What's new

`changelog.md` lists the changes people notice, newest first. Each change is a `##` heading in plain words, then its day on a line of its own (`2026-10-23`), then a sentence or two on what changed. It is not the release changelog, which is made from the commits.

## Writing rules

The words follow [Copy](../design/copy.md), the same rules as the screens:

1. Lead with the answer. One idea per sentence, in plain words, for readers whose first language is not English: no idioms, no contractions in labels.
2. One word per thing, the screen's word, from the glossary (`src/domain/words.ts`): "context item", "owner", "suggestion", "domain", "agent".
3. Bold is only for the words of a screen, exactly as the screen writes them: **Copy prompt**. The docs check fails when a bold phrase is not in the app.
4. Never name the product in a sentence: write "it", "agents" or "your workspace". Commands and addresses keep their names.
5. Never promise what is not built, and never write "soon".
6. Plain hyphens, never an em dash, and British spelling.

## The docs check

`tests/app/docs.test.ts` runs with the unit tests and fails when:

- a page cannot be read: front matter missing a field or with a value outside the lists above, a `#` heading, no lead, a note without its title, a code block without its title, a picture or HTML
- a page or What's new is missing, or a page is not one of the mockup's eleven
- a link points at a page, a heading or a screen that does not exist
- an include's Markdown is not the app's list as it is now (`npm run docs:sync` mends it)
- a bold phrase is not on any of the app's screens
- a page uses a word the glossary retires, names the product, has an em dash or says "soon"
- `llms.txt` misses a page, or the search does not find a page by its words

## Build and preview the docs site

```sh
npm run docs:build     # the site in dist/docs: one HTML file per page, llms.txt and llms-full.txt
npm run docs:preview   # serves dist/docs at http://localhost:4176/docs/
```

Every page is drawn ahead of time, so it reads with no script; the script adds the search (Command and K) and the copy buttons. Two settings, when it is built:

- `DOCS_BASE`: the path it is served under, `/docs` by default. `DOCS_BASE=` serves it at the root of its own host.
- `VITE_DOCS_APP_URL`: where the app is, for the links to its screens, when the site is hosted apart from it (`https://context.example.com`). By default the links stay on the site's own host, as when it is served beside the app.

`CL_PRODUCT_NAME` and `CL_SUPPORT_EMAIL` work as for the app ([Run and operate the service](../operations.md)). Any static host serves the result; a page is `privacy.html` for the address `/docs/privacy`, which GitHub Pages, Netlify and `vite preview` find by themselves (nginx: `try_files $uri $uri.html =404`).
