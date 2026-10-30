# Components: the inventory

Part of the [design contract](design-contract.md). It lists every part a screen is built from, and the file of the approved mockup it comes from. Paths are relative to the mockup's `mockup/src` folder. In the app (`src/web`) the same paths hold, except the demo world: the mockup's `data/` is the app's mock binding (`api/mock`), with its types and pure rules in `model/`, and the app reads it through its API (`api/`).

Rules:

- **Reuse before you build.** Look here first, then in shadcn's registry. Name what you reused in the pull request.
- **A new part goes into this list first**, in the same pull request that adds it.
- **shadcn parts stay as shadcn ships them** (`components/ui`). Only these changes are made to them: the theme's tokens, the radius rules (frames use `--radius-frame`), the field fill that matches the 3:1 border, and the loading state of the button.
- **Heed's own parts** are in `components/heed`, `components/obs` and the root of `components`. They are small, and each does one job.
- The editor (`components/editor`) and the static renderer are third-party code in a trimmed form. They are not held to the copy rules.
- **Icons** come from Lucide through one module in the app. The mockup imports Lucide directly; that moves into the module on import.

## 1. shadcn primitives in use

All in `components/ui`, built on Base UI. The ones marked * are not shadcn's own and were added for Ask.

| Primitive          | File                   | Used for                                                                   |
| ------------------ | ---------------------- | -------------------------------------------------------------------------- |
| Alert              | `alert.tsx`            | A callout (square)                                                         |
| Avatar             | `avatar.tsx`           | A person's face (tinted from the name); see `heed/bits.tsx`                |
| Badge              | `badge.tsx`            | A count or a quiet label (the chip is separate)                            |
| Breadcrumb         | `breadcrumb.tsx`       | Settings and Observability trails                                          |
| Bubble *           | `bubble.tsx`           | A question in Ask (soft)                                                   |
| Button             | `button.tsx`           | Buttons, with `loading`; sizes xs 24, sm 28, default 32, lg 36; icon sizes |
| Calendar           | `calendar.tsx`         | The date pickers                                                           |
| Card               | `card.tsx`             | An Inbox card, a cell (square)                                             |
| Checkbox           | `checkbox.tsx`         | Row picking                                                                |
| Collapsible        | `collapsible.tsx`      | Details, folds                                                             |
| Command            | `command.tsx`          | The palette, the `@` and `:` pickers                                       |
| Dialog             | `dialog.tsx`           | Confirmations, Connect an agent, Report a problem (square)                 |
| Dropdown menu      | `dropdown-menu.tsx`    | Row menus, More, the user and theme menus                                  |
| Empty              | `empty.tsx`            | Empty states with the next step                                            |
| Field              | `field.tsx`            | Label, hint and error of a form field                                      |
| Input              | `input.tsx`            | Text fields                                                                |
| Input group        | `input-group.tsx`      | A field with an icon or a button                                           |
| Item               | `item.tsx`             | A row with media, title and actions (square)                               |
| Kbd                | `kbd.tsx`              | A key, at 4.5:1                                                            |
| Label              | `label.tsx`            | Field labels                                                               |
| Message *          | `message.tsx`          | One turn of Ask                                                            |
| Message scroller * | `message-scroller.tsx` | Ask's thread scroll, pinned to the newest turn                             |
| Popover            | `popover.tsx`          | Pickers and small cards (square)                                           |
| Radio group        | `radio-group.tsx`      | `ChoiceGroup`                                                              |
| Resizable          | `resizable.tsx`        | The dock, the Inbox panes, History                                         |
| Scroll area        | `scroll-area.tsx`      | Thin scroll areas                                                          |
| Select             | `select.tsx`           | Small choices                                                              |
| Separator          | `separator.tsx`        | Hairlines                                                                  |
| Sheet              | `sheet.tsx`            | Phone sheets, the agent transcript                                         |
| Sidebar            | `sidebar.tsx`          | The shell's sidebar (sidebar-07), its rail and its sheet on a phone        |
| Skeleton           | `skeleton.tsx`         | Loading, in the page's shape                                               |
| Sonner             | `sonner.tsx`           | Toasts, bottom right                                                       |
| Switch             | `switch.tsx`           | On and off settings                                                        |
| Table              | `table.tsx`            | Tables edge to edge with the thin header band                              |
| Textarea           | `textarea.tsx`         | Long plain text                                                            |
| Tooltip            | `tooltip.tsx`          | Names and long forms; shows the key                                        |
| Trace *            | `trace.tsx`            | Ask's look-up line that opens into its steps                               |

Unused primitives in the mockup (about seven) are not imported.

## 2. The shell

| Part               | File                                                                                  | Job                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| App and routes     | `App.tsx`                                                                             | The shell, the resizable page and dock, the routes                                     |
| Router             | `lib/router.ts`                                                                       | A small hash router (the app uses TanStack Router with typed search params)            |
| Sidebar            | `components/app-sidebar.tsx`                                                          | Four places, search, Help, Observability, Settings, the draggable rail, the user block |
| Site header        | `components/site-header.tsx`                                                          | The way back, the title, actions, the theme menu, the sidebar toggle                   |
| Settings menu      | `components/settings-nav.tsx`                                                         | The sidebar's replacement inside Settings                                              |
| Observability menu | `components/obs/obs-nav.tsx`                                                          | The sidebar's replacement inside Observability                                         |
| Dock               | `components/dock.tsx`, `lib/dock.ts`                                                  | The one right panel; its content in the address; the peek's bar                        |
| Resizable aside    | `components/resizable-aside.tsx`                                                      | A side pane whose edge can be dragged and moved by keyboard                            |
| Panel              | `components/heed/panel.tsx`                                                           | The one anatomy of a right-hand panel: title bar, one scrolling body, footer           |
| Command palette    | `components/command-palette.tsx`                                                      | Search and go anywhere (Cmd K), 640 wide                                               |
| Help menu          | `components/help-menu.tsx`                                                            | The small menu from the sidebar's foot                                                 |
| Shortcuts sheet    | `components/shortcuts-dialog.tsx`, `lib/help-content.ts` (`SHORTCUTS`)                | The keys, from one list                                                                |
| User menu          | `components/nav-user.tsx`                                                             | Connect an agent, Sign out                                                             |
| Report a problem   | `components/report-dialog.tsx`                                                        | One box; the page address travels with it                                              |
| Error boundary     | `components/error-boundary.tsx`                                                       | A broken screen shows what happened and a way back                                     |
| Theme              | `lib/theme.tsx`, `lib/theme-context.ts`                                               | Light, dark, system; the easing across                                                 |
| Brand              | `lib/brand.ts`, `components/heed/logo.tsx`                                            | The one product-name constant; the two-blade logo, in the text's ink, never the accent |
| Frame              | `components/heed/frame.tsx`                                                           | The square hairline frame: sections, tables, key-value bands, cells                    |
| Document shell     | `components/heed/document-shell.tsx`                                                  | Header, 40 px toolbar row, tinted canvas with the 56rem sheet, side panel, footer bar  |
| Truncated title    | `components/heed/truncated.tsx`                                                       | A title cut with an ellipsis that shows in full when it is cut                         |
| Show more          | `components/heed/show-more.tsx`                                                       | "Show 10 more (24 not shown)", the one way a long list asks for more                   |
| Loading states     | `components/heed/load-state.tsx`, `lib/loading.ts`, `components/obs/obs-skeleton.tsx` | Skeleton in the page's shape, a failed load with Retry, offline                        |
| Presence           | `lib/presence.ts`                                                                     | Rows that leave and arrive                                                             |

## 3. Heed parts by role

### Chips, marks and identity

| Part             | File                                           | Job                                                                  |
| ---------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| Tag chip         | `components/heed/tag-chip.tsx`, `lib/tones.ts` | The one chip: 24 px, 6 px radius, type icon, tinted by what it names |
| Mention chip     | `components/heed/mention-chip.tsx`             | A mention with its type icon; dashed when the target is gone         |
| Avatars and bits | `components/heed/bits.tsx`                     | People, soft tint from the name, domain dot, small shared pieces     |
| Kind icons       | `components/heed/kind-icons.ts`                | Event, Warning, Rule, Guide                                          |
| Definition marks | `components/heed/definition.tsx`               | Sigma, split, whole-word and equals tiles                            |
| Tool logo        | `components/heed/tool-logo.tsx`                | An integration's real logo in a white tile                           |
| Changed value    | `components/heed/changed.tsx`                  | A number that changed while you watched, with a fading tint          |

### The state line and Ask

| Part            | File                                                   | Job                                                                                                   |
| --------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Answer          | `components/heed/answer.tsx`                           | One turn: the state line, the words with citation markers, sources, What agents get, Something wrong? |
| State help      | `components/heed/state-help.tsx`                       | The answer line's card: what it means and what to do                                                  |
| Answer lines    | `lib/help-content.ts` (`ANSWER_LINES`)                 | The six labels, sentences and long forms, from one list                                               |
| Reading         | `components/heed/reading.tsx`, `lib/stages.ts`         | The staged look-up where an agent works                                                               |
| Figure          | `components/heed/answer-figure.tsx`                    | One figure, apart from the context, never changing the state                                          |
| Asked this week | `components/heed/asked-week.tsx`, `data/asked-week.ts` | Topics with their state now and a count                                                               |
| Where           | `components/heed/where-panel.tsx`, `lib/where.ts`      | "Show me where it says that"                                                                          |
| Share           | `components/heed/share-answer.tsx`, `lib/share.ts`     | A Slack message or a card, with state and sources                                                     |
| Composer        | `pages/ask-composer.tsx`, `lib/surfaces.ts`            | The soft input surface shared with the comment box                                                    |
| Ask page        | `pages/ask.tsx`, `lib/threads.ts`                      | The thread, history, search, the empty page                                                           |
| Agent reply     | `lib/agent-reply.ts`                                   | The reply an agent gets, built from published context only                                            |

### Editor, properties and documents

| Part              | File                                                                                                    | Job                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Editor            | `components/editor/*`                                                                                   | The trimmed toolbar editor (no bubble menu, no code blocks, no embeds), markdown in and out |
| Doc toolbar       | `components/heed/doc-toolbar.tsx`, `lib/doc-extensions.ts`                                              | The toolbar of the one document editor                                                      |
| Editor header     | `components/heed/editor-header.tsx`                                                                     | Way back, title, Saved, Write / Try it, the primary action, More                            |
| Property controls | `components/heed/field-controls.tsx`                                                                    | The calm properties list under the title                                                    |
| Document          | `components/heed/doc.tsx`                                                                               | A context item as a read-only document                                                      |
| Context editor    | `pages/editor.tsx`, `lib/draft.ts`                                                                      | New, edit and suggest, with What agents get and Overlaps                                    |
| About editor      | `pages/about-editor.tsx`                                                                                | About our business in the document shell                                                    |
| Mentions          | `components/heed/mention-picker.tsx`, `suggest-list.tsx`, `lib/mention-extension.ts`, `lib/mentions.ts` | The `@` and `:` pickers                                                                     |
| Emoji             | `lib/emoji.ts`, `lib/emoji-note.ts`                                                                     | About 150 common emoji, no skin tones                                                       |

### Peeks, docks and pages of one thing

| Part              | File                                                                                          | Job                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Peek              | `components/heed/peek.tsx`                                                                    | The quick view frame: note, one closed Details                                          |
| Context peek      | `components/heed/fact-peek.tsx`                                                               | The context item quick view                                                             |
| Definition peek   | `components/heed/definition-peek.tsx`                                                         | The definition quick view                                                               |
| Context page      | `pages/fact.tsx`                                                                              | A context item as a document with Details, History, Related, comments                   |
| Version history   | `components/heed/version-history.tsx`                                                         | One line until opened, then rows by month, with a read-only diff and Restore for owners |
| Related           | `components/heed/related.tsx`, `lib/links.ts`, `hooks/use-related.ts`                         | What `get_related` can follow, shown as chips                                           |
| Definitions pages | `pages/definitions.tsx`, `definition-page.tsx`, `definition-editor.tsx`, `lib/definitions.ts` | The list, a page and the term and synonym editor                                        |
| Domain page       | `pages/domain-page.tsx`, `lib/domains.ts`                                                     | A domain as its own document                                                            |

### Lists and bulk

| Part               | File                                          | Job                                                                              |
| ------------------ | --------------------------------------------- | -------------------------------------------------------------------------------- |
| List parts         | `components/heed/list.tsx`                    | The filter bar, the thin header row, rows of one line at one density, the cursor |
| Sorting            | `lib/sort.ts`                                 | A key and a direction; `SortMenu` and `SortTh` in the list parts flip it         |
| Columns            | `components/heed/columns.tsx`                 | Design B: kind icon, scope, status icon, when, freshness dot                     |
| Context list       | `pages/context.tsx`                           | The Context list                                                                 |
| Selection          | `hooks/use-selection.ts`, `lib/selection.ts`  | One picking model for every list                                                 |
| Bulk bar           | `components/heed/bulk-bar.tsx`, `lib/bulk.ts` | The one bar in its own band, with skips and reasons                              |
| Context actions    | `components/heed/context-bulk.tsx`            | Archive, Delete, Change domain, kind, owners, Mark as checked, Export            |
| Definition actions | `components/heed/definitions-bulk.tsx`        | Terms only; synced items are left alone                                          |
| Delete dialog      | `components/heed/delete-dialog.tsx`           | The one confirmation before a delete                                             |
| Suggest list       | `components/heed/suggest-list.tsx`            | The one list a text box offers while typing                                      |
| Switches           | `components/heed/switches.tsx`                | `ViewToggle`, `TextSwitch`, `ChoiceGroup`                                        |

### The Inbox and the review

| Part           | File                                                                              | Job                                                     |
| -------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Inbox          | `pages/inbox.tsx`, `lib/inbox-rows.ts`, `data/inbox.ts`                           | List, groups, cards, quick view, setup checklist        |
| Review         | `pages/review-page.tsx`, `pages/review.tsx`, `data/review.ts`                     | The full-screen review and the quick view               |
| Review parts   | `components/heed/review-parts.tsx`, `change-icons.ts`                             | Change blocks, marks, the Ready line (the Preview)      |
| Source review  | `components/heed/source-review.tsx`, `lib/line-diff.ts`, `model/review-fields.ts` | Fields table and Text diff, each fed two sides          |
| Try it         | `pages/ask.tsx` (`TryIt`, in the dock), `pages/review-page.tsx` (`TryItPanel`)    | What agents say before and after, as Draft or Published |
| Saved line     | `components/obs/saved-line.tsx`                                                   | "N of N still answer the same" in a review              |
| Comment box    | `components/templates/comment-box/*`                                              | Flat threads, five reactions, replies, the composer     |
| Comments model | `lib/comments.ts`, `data/comments.ts`, `components/heed/guide-link.tsx`           | Threads, read state, "Read the guide"                   |

### Settings, integrations and agents

| Part             | File                                                                    | Job                                                              |
| ---------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Settings pages   | `pages/settings.tsx`, `pages/people.tsx`, `lib/people.ts`               | General, Domains and owners, People, Agents and access, Advanced |
| Connect an agent | `components/connect-agent.tsx`, `data/agents.ts`, `lib/connect.ts`      | The prompt, the live line, one cell per agent                    |
| Agent transcript | `components/agent-preview.tsx`                                          | How the same answers look inside a person's own agent            |
| Integrations     | `pages/integrations.tsx`, `data/integrations.ts`, `lib/integrations.ts` | Rows, cells, one page per integration, the five-step connect     |

### Observability

| Part            | File                                                                                              | Job                                                      |
| --------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Pages           | `pages/observability/*`                                                                           | Overview, Questions, Quality, Feedback, Usage, Alerts    |
| Controls        | `components/obs/controls.tsx`                                                                     | Range, domain, agent, kept in the address                |
| Charts          | `components/obs/charts.tsx`                                                                       | Small SVG on the tokens, with a table for screen readers |
| Topic table     | `components/obs/topic-table.tsx`, `data/observability.ts`, `lib/obs.ts`, `lib/obs-views.ts`       | Topics as rows, in three groupings                       |
| Answer panel    | `components/obs/answer-panel.tsx`, `lib/replay.ts`                                                | A replay of a topic, now or before the last publish      |
| Saved questions | `components/obs/save-question.tsx`, `result.tsx`, `data/saved-questions.ts`, `lib/saved-check.ts` | Save question and a result's shape and words             |
| Alerts          | `data/alerts.ts`                                                                                  | Eight rules, each one sentence                           |

### Help and documentation

| Part          | File                                                         | Job                                                           |
| ------------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| Help page     | `pages/help.tsx`, `lib/help-content.ts`, `lib/help-aside.ts` | The answer lines, ten words, how agents use it                |
| Documentation | `pages/docs.tsx`                                             | Its own site: eleven pages and What's new, search, `llms.txt` |
| Sign-in       | `pages/signin.tsx`                                           | The demo person picker (demo mode only in the app)            |

## 4. Fixtures and rules in code

The mockup keeps its demo world in `data/` (Larchwood Outdoor: 22 context items, 18 Inbox cards, 12 reviews, 12 saved questions, 10 topics, 8 alert rules, 22 metrics, 5 dimensions, 13 terms and 14 people). In the app it is the mock binding (`src/web/api/mock`) of one typed interface, `HeedApi` (`src/web/api/client.ts`); no page reads it directly. Where the API contract has a counterpart, its shapes are typed and tested against it (`tests/web/mock/contract.test.ts`). Pure rules live in `lib/` with their unit tests (agent reply, bulk, selection, connect timers, replay, saved check, line diff, links, motion and copy).
