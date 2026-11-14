# Heed front end: design contract v2

|             |                                                                                                                                                                                                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status      | v2, written from the approved Heed v1 mockup. It replaces Draft 1 (2026-10-07)                                                                                                                                                                                 |
| Date        | 2026-10-25                                                                                                                                                                                                                                                     |
| Applies to  | The React front end: Vite single-page app, shadcn on Base UI, Tailwind 4, Tiptap                                                                                                                                                                               |
| Written for | Engineers and coding agents that build screens, and the people who review them                                                                                                                                                                                 |
| Governs     | How screens look, are laid out and behave. [The product page](../product.md) says what the product is. [The requirements](../requirements.md) say what it must do. Where they differ from this page, the app decides, and the document that differs gets a fix |
| Companions  | [Motion](motion.md), [Copy](copy.md), [Accessibility](accessibility.md), [Components](components.md)                                                                                                                                                           |

## 0. One page summary

**The look.** A quiet neutral app on shadcn's neutral theme. One accent, Heed blue, for the main button, focus, the selected place, checked controls and links. Flat cells divided by hairlines. The sidebar sits on the page background. Colour carries meaning only, and always with an icon or a word.

**The three radius rules.**

1. **Containers are square.** Cards, dialogs, popovers, the palette, empty states, alerts, items, panels, tables, callouts, sheets and the editor frame use `--radius-frame` (0).
2. **Conversational surfaces are a control's corner.** A question bubble, a suggestion chip and the comment box use `--radius-surface` (8 px). The Ask composer, the one box a chat is typed in, uses `--radius-composer` (14 px), the one soft thing.
3. **Small controls are round** on four corners: 4 px (`rounded-xs`) for the smallest marks, a checkbox and a review mark; 6 px (`rounded-sm`) for a chip, a key, a logo tile and a switch's segment; 8 px (`rounded-md`) for buttons, inputs, selects, toggles, menus, tooltips and badges; the pill (`rounded-full`) for avatars, switches and dots. Nothing lies between them.

**The numbers to remember.**

| Topic     | Decision                                                                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bars      | One bar height, 48 px (`--spacing-bar`): the page header, the sidebar's logo row and user block, and every bottom bar. The editor toolbar is a 40 px row (`--spacing-tool`) |
| Rows      | 36 px at one density. The header band of a table is 36 px and sticky. There is no density preference                                                                        |
| Widths    | Document sheet 56rem with a 60ch prose measure. Lists, Inbox and Settings use an 80rem frame. The Ask thread is 44rem. The palette is about 640 px                          |
| Shell     | Sidebar 16rem, resizable from 200 to 360 px, rail 3rem. Dock 480, 560 or 720 px, resizable from 400 to 960                                                                  |
| Scroll    | One scroll owner per view                                                                                                                                                   |
| Chip      | One chip: 24 px, 6 px radius, the type's icon, tinted by what it names                                                                                                      |
| Type      | Six sizes, one line height each: 12/16, 14/20, 16/24, 20/28, 24/30 and 30/38 px. Two greys of text, ink and muted                                                           |
| Colour    | One colour per meaning: blue to act, green checked, amber look at this, red broken. A soft fill is the colour at 8 percent                                                  |
| Switching | No tabs anywhere. Four small components, one per job (section 5.9)                                                                                                          |
| Focus     | A border in the ring colour plus a 3 px ring at 50 percent                                                                                                                  |
| Touch     | Every target under a finger is 44 px                                                                                                                                        |
| Motion    | Tokens only: 90, 150 and 220 ms for explained change, three tiers, no page transitions, one reduced-motion block                                                            |
| Words     | One product-name constant, never inside a sentence. Plain English for people who read it as a second language                                                               |

**What changed from Draft 1.** Section 11 lists the rules this version withdraws, and section 12 maps the old section numbers to the new ones.

## 1. Authority and how to change this page

**The web app leads, and the mockup is a reference.** The mockup is the Heed v1 mockup, in git history, under the tag `mockup-archive`. The app's Playwright job specs in `tests/e2e` and its unit tests are the golden checks (section 9). If this page differs from the app, this page is wrong and gets a fix in the same change. [The product page](../product.md) records the reference and lists the specs.

**The order of authority.** The app, then this contract and the product page, then the requirements specification. The requirements carry a status per id (kept, changed, withdrawn, new) so a reader knows which still stand.

**Changing the contract.** A change to a token, a scale, a layout or a rule is one reviewed pull request that edits this file, the token file and the tests together. A screen pull request never changes a scale on its own.

**Requirement words.** Must, should and may mean what they mean in the requirements specification.

**The product's name.** One constant holds it (`PRODUCT` in the web app's `lib/brand.ts`; `productName` in the service). A sentence never contains it: copy says "it", "agents", "your workspace" or "the checked context". The name appears only where it is the brand: the logo's label, sign-in and the page title. Addresses, the MCP server name, the command line and the Drive service account follow the constant. A rename or a white label is a one-line change. A lint rule reports a hand-written name. [Copy](copy.md) has the rest.

## 2. Tokens

All values live in one file, `src/web/styles/tokens.css`. A component depends on a name, never on a value. Names follow shadcn. A test (`tests/lint/web-tokens.test.ts`) guards the file and recomputes every contrast pair.

### 2.1 Colour

The theme is shadcn's neutral theme with these changes only:

- the primary, the ring and the sidebar primary are Heed blue: `#2c5dbd` in light, `#7aa2f0` in dark;
- muted text is `#666666` in light and `#a3a3a3` in dark, so it keeps 4.5:1 on the muted surface;
- input borders are `#8f8f8f` in light and `#6b6b6b` in dark, so fields, checkboxes and radios keep 3:1 on the page.

**Two greys of text.** Text is the ink (`--foreground`) or muted (`--muted-foreground`). shadcn's other text colours (card, popover, secondary, accent, sidebar and sidebar accent) are the ink. Text never fades by opacity. A switched-off control keeps its text muted at full strength and loses its fill (`components/ui/button.tsx`).

**One colour per meaning.** `--destructive` is red: broken, removed, cannot be undone. `--good` is green: checked and in force. `--caution` is amber: look at this. Each is text at 4.5:1 on every surface, so one colour draws the words, the icon, the rule and the line of its meaning: the review marks' added, removed and link lines and the Text diff's inks are these three. A soft fill behind one is the colour at 8 percent, by rule and never a second name (`bg-caution/8`, `bg-good/8`): a Conflict answer in the quick view's answers sits on `bg-caution/8` (section 5.3), where the answer line, the words and the caution ink keep their contrast.

**One band.** `--band` (`#fafafa` in light, `#171717` in dark) is the sidebar, table heads, captions and bars. The row under the pointer and a selected place are `--muted`.

Beyond shadcn's set, the file adds the review marks (`--mark-add`, `--mark-del`, `--mark-fmt`, `--mark-link`, `--mark-move`, each with a `-line` colour). The chips' hues come from one place (section 5.7).

```css
/* tokens.css: the values from the approved mockup, folded to one grey of ink and one colour per meaning */
:root {
  color-scheme: light;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: #2c5dbd;
  --primary-foreground: #ffffff;
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.145 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: #666666; /* 4.5:1 on muted */
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.145 0 0);
  --destructive: oklch(0.5 0.2 27); /* red */
  --good: oklch(0.5 0.14 150); /* green */
  --caution: oklch(0.501 0.133 49.7); /* amber */
  --border: oklch(0.922 0 0);
  --input: #8f8f8f; /* 3:1 for field borders */
  --ring: #2c5dbd;
  --mark-add: oklch(0.94 0.06 150);
  --mark-add-line: var(--good);
  --mark-del: oklch(0.94 0.04 25);
  --mark-del-line: var(--destructive);
  --mark-fmt: oklch(0.95 0.04 300);
  --mark-fmt-line: oklch(0.5 0.2 295);
  --mark-link: oklch(0.95 0.07 85);
  --mark-link-line: var(--caution);
  --mark-move: oklch(0.96 0.01 250);
  --mark-move-line: oklch(0.55 0.03 250);
  --chart-1: oklch(0.87 0 0);
  --chart-2: oklch(0.556 0 0);
  --chart-3: oklch(0.439 0 0);
  --chart-4: oklch(0.371 0 0);
  --chart-5: oklch(0.269 0 0);
  --band: oklch(0.985 0 0);
  --sidebar: var(--band);
  --sidebar-foreground: oklch(0.145 0 0);
  --sidebar-primary: #2c5dbd;
  --sidebar-primary-foreground: #ffffff;
  --sidebar-accent: oklch(0.97 0 0);
  --sidebar-accent-foreground: oklch(0.145 0 0);
  --sidebar-border: oklch(0.922 0 0);
  --sidebar-ring: #2c5dbd;
}
.dark {
  color-scheme: dark;
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: #7aa2f0;
  --primary-foreground: #0a0a0a;
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: #a3a3a3;
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.8 0.13 22);
  --good: oklch(0.78 0.15 150);
  --caution: oklch(0.8 0.13 75);
  --border: oklch(1 0 0 / 10%);
  --input: #6b6b6b;
  --ring: #7aa2f0;
  --mark-add: oklch(0.34 0.07 150);
  --mark-del: oklch(0.34 0.07 25);
  --mark-fmt: oklch(0.33 0.07 300);
  --mark-fmt-line: oklch(0.72 0.14 295); /* lifted from the mockup's 0.5 0.2 295, see below */
  --mark-link: oklch(0.36 0.07 80);
  --mark-move: oklch(0.3 0.015 250);
  --mark-move-line: oklch(0.7 0.03 250);
  --band: oklch(0.205 0 0);
  --sidebar-foreground: oklch(0.985 0 0);
  --sidebar-primary: #7aa2f0;
  --sidebar-primary-foreground: #0a0a0a;
  --sidebar-accent: oklch(0.269 0 0);
  --sidebar-accent-foreground: oklch(0.985 0 0);
  --sidebar-border: oklch(1 0 0 / 10%);
  --sidebar-ring: #7aa2f0;
}
```

The chart tokens are the same in light and dark. One value differs from the mockup on purpose: the dark `--mark-fmt-line` is lifted to about `oklch(0.72 0.14 295)`. The mockup's `oklch(0.5 0.2 295)` is too dark on the dark surface. This is a contrast fix, not a design change, and the contrast test checks it.

**Contrast.** Text is 4.5:1 or better. Controls, field borders, icons that carry meaning and the review marks are 3:1 or better. Both themes. The test recomputes every pair from the token file.

**Colour rules.**

- Colour is never the only sign. Every mark has an icon, a shape or a word as well (section 5 of [Accessibility](accessibility.md)).
- The logo, the chrome's surfaces, counts and badges never take the accent.
- Kinds have no hue. A kind shows as a neutral icon.
- Charts: blue for checked context, amber for what to look at, greys for the rest, a hatch for Not found, so every state also differs by shape.
- Marked text uses one component (`components/heed/mark.tsx`) and four roles. The colour rides on the ink, the weight and an underline, never on a fill:

  | Role               | Used for                                  | Looks                                                   |
  | ------------------ | ----------------------------------------- | ------------------------------------------------------- |
  | Needs you          | The one thing to do or look at            | Amber ink (`--caution`), a triangle, semibold           |
  | Differs or changed | Words that differ between two texts       | Semibold with a 2 px amber underline (`--caution`)      |
  | Wrong              | Something that failed                     | Red ink (`--destructive`), an icon, and the word Failed |
  | Good               | Something that worked, where that is news | A check and the word, in `--good`                       |

  In an Ask answer, the sentences from two items that disagree are not marked word by word: they sit together behind a 2 px amber rule (`--caution`) at their start, the words plain. The rule says nothing alone: the answer's Conflict badge names the two items in its card, and a screen reader hears that each sentence says something different from another item.

  A name or a term is a chip, not a mark. Edits in a review keep their own marks (added, removed, formatting). Mark only text the app wrote from a known place, never words found by searching a person's text; never a document body or anything agents read; never kinds, domains, counts or badges. Mark the exceptions: one Needs you per card or row, about three marks in a block at most, and none when every row of a list would carry the same one. A number's move says its direction with an arrow and words; amber there means "look here", not "worse".

- A raw palette colour (`bg-red-500`), a numeric z-index, an arbitrary colour, a faded grey of text (`text-foreground/75`) and a soft fill at any strength but 8 percent are reported by lint. The token test finds every amber, green and red in the token file and fails on a second one.

### 2.2 Radius

```css
--radius-frame: 0px; /* containers */
--radius-xs: 4px; /* a checkbox, a review mark */
--radius-sm: 6px; /* a chip, a key, a logo tile, a switch's segment */
--radius-md: 8px; /* buttons, fields, menus, tooltips, badges */
--radius-full: calc(infinity * 1px); /* avatars, switches, dots */
--radius-surface: var(--radius-md); /* conversational surfaces */
--radius-composer: 14px; /* the Ask composer, the one soft thing */
```

Five corners and nothing between them: the token file clears Tailwind's own scale (`--radius-*: initial`), so `rounded-lg` is not a class, and lint names the five. The hand-written stylesheets use the same tokens. One token per rule, so the whole app can change a rule in one line.

### 2.3 Type

The font is Nunito Sans (variable) for all text. The wordmark is outlined in the logo's SVG, so no second font loads. There are six sizes, each a role with its own line height:

| Role                                                              | Class       | Size / line |
| ----------------------------------------------------------------- | ----------- | ----------- |
| Meta: captions, chips, counts, hints, table heads, code in a row  | `text-xs`   | 12 / 16 px  |
| Interface: controls, rows, the sidebar, fields, titles in bars    | `text-sm`   | 14 / 20 px  |
| Reading: prose in a document, a docs page, card titles            | `text-base` | 16 / 24 px  |
| A section: a dialog, a pane heading, a lead paragraph in the docs | `text-xl`   | 20 / 28 px  |
| A page: a document or review heading, a big figure                | `text-2xl`  | 24 / 30 px  |
| A document title from `sm` up, a docs page title                  | `text-3xl`  | 30 / 38 px  |

Nothing lies between them: the token file clears Tailwind's own scale (`--text-*: initial`), so `text-lg` or a 13 px size is not a class, and lint names the six. The hand-written stylesheets use the same six. Code is a step below the text around it: 12 px in a row or a comment, 14 px in a document.

Weights are 400 (text), 500 (labels, buttons), 600 (titles, headings) and 700 (document titles). The page title in the header is 14 px. Prose is set at a 60ch measure.

**Ask.** A question and an answer are `text-base` on 26 px lines (`leading-chat`), as the chat apps people know set theirs. An answer's words keep the 60ch measure (`max-w-reading`) inside the 44rem thread, about 76 characters a line.

### 2.4 Spacing

Tailwind's default spacing scale, including half steps (`gap-1.5`, `px-2.5`). A parent sets the gaps between its children; avoid margins on children. The Draft 1 lint that refused every off-scale value is withdrawn. What stays: no arbitrary values outside a short allowlist of named tokens, and a value that repeats becomes a token.

### 2.5 Bars, widths and layers

```css
--spacing-bar: 3rem; /* header, sidebar logo row, user block, every bottom bar */
--spacing-tool: 2.5rem; /* the editor toolbar row, fixed under the header */
--container-reading: 60ch; /* prose */
--container-sheet: 56rem; /* a document; never grows with the window */
--container-wide: 80rem; /* Inbox, Settings, Context and Definitions lists */
```

Layers use the named `z-*` utilities, never a number. Lowest first: `z-base`, `z-raised` (a sticky table header or total row, a raised control), `z-header` (the page header, pane handles), `z-site-header` (the docs site's header), `z-dock` (the dock on a phone), `z-overlay` (dialogs, sheets, popovers, menus, tooltips) and `z-skip` (the skip link). The values are the mockup's: 0, 10, 20, 30, 40, 50 and 60.

### 2.6 Motion, focus, elevation

Motion tokens are in [Motion](motion.md). **Focus** is shadcn's: the control's border takes the ring colour and a 3 px ring at 50 percent shows (`focus-visible:ring-3 ring-ring/50`). Fields take a calmer soft ring. A skip link comes first on every page. **Elevation** is mostly flat hairlines; a menu, a popover and a toast use shadcn's shadows (`shadow-md`, `shadow-sm`, `shadow-lg`).

### 2.7 Icons and avatars

Icons come from Lucide at its default stroke (2), through one module. No Heed marks for kinds or states, and no second icon set. The kinds are Event (lightning), Warning (triangle), Rule (ruler) and Guide (route). The definition types are sigma (metric), split (dimension), whole-word (term) and equals (synonym).

Avatars are a soft pastel tint picked from the person's name (dark initials, 6.4:1 or better, the same in dark mode). Sizes are 16, 20, 28 and 32 px (28 in lists). Initials are 12 px, at 28 and 32 px; a 16 or 20 px avatar has no room for them and shows its tint, with the name in its title. The Ask chat has no avatars: a question is its bubble on the right, and an answer starts with its state. The hash input in the real app stays the person's id.

## 3. Shell and layout

### 3.1 The shell

- **Sidebar.** 16rem, resizable from 200 to 360 px, folding to a 3rem icon rail (Command B, and a toggle in every header). It sits on the page background, divided by a hairline. Four places (Inbox, Ask, Context, Definitions), a search field at the top (a lone magnifier in the rail and on a phone's top bar), and at the foot Help, Observability and Settings. Help opens a small menu. The user menu is the last block.
- **Header.** 48 px. The way back, a 14 px title (cut with an ellipsis, in full on hover or focus), then the page's actions and, at the right end, the theme menu (light, dark, system).
- **Area menus.** Settings and Observability swap the sidebar for their own menu, with Back to app on top. Both lead back to the app, never to a workspace's name.
- **Phone.** Below 768 px the sidebar is a sheet. Lists, detail and the dock are each a full screen. Bottom bars carry the decision.

### 3.2 The dock

One right panel. It takes the detail pane's place, so there are never two right panels. It is a region beside the page, not a dialog. Its content lives in the address (`?dock=kind.id`), so Back closes it and every state has a link. Kinds: `review`, `context`, `def`, `ask`, `try`, `topic`, `share`, `where`.

| Dock                                                    | Width |
| ------------------------------------------------------- | ----- |
| Ask, a context or definition peek, Try it, Share, Where | 480   |
| The answer panel of a topic                             | 560   |
| A review's quick view                                   | 720   |

Resizable from 400 to 960 px, and the page keeps at least 360 px. The width is kept for the browser session. On a phone it is full screen. The review itself is a full-screen page with the sidebar folded to its rail.

### 3.3 Panel anatomy

Every right-hand panel (the editor's What agents get, the context page's side panel, the review's Try it and decision, Settings help, the quick view docks) has one anatomy: a title bar with a close or fold, **one scrolling body**, and a footer for what must stay in reach (Ready, the decision). The bar and the footer never scroll away. A long block in a panel (a live preview) is clamped with Show all, never boxed. A side panel scrolls only when its content is genuinely long, and is folded on edit pages unless it has something to say.

### 3.4 Scroll rules

- **One scroll owner per view.** The page body (or the document canvas) owns the scrolling. The header, the toolbar and every footer are fixed rows outside it.
- A long list inside a page never scrolls on its own. It shows its first few and a Show more button ("Show 10 more (24 not shown)"). History, Comments, Related, synonyms and connected agents all work this way.
- Every scroll bar is the same: thin, always visible so a list that runs on says so, at 3:1 against the page, darker under the pointer.
- Keyboard focus is never hidden behind a sticky part.

### 3.5 Widths

| Layout         | Width                                                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document sheet | 56rem (`max-w-sheet`). Prose inside it is 60ch (`max-w-reading`)                                                                                          |
| Frame          | 80rem (`max-w-wide`): the Inbox, Settings, Context and Definitions lists. Centred with side borders when the pane is wider. Its head and foot stay sticky |
| Ask thread     | 44rem                                                                                                                                                     |
| Palette        | About 640 px, in the upper part of the screen                                                                                                             |

### 3.6 Breakpoints

Viewport variants are allowed in pages (`md`, `lg`, `max-sm`). Anything that can sit in the dock reads its **container** width instead, because the dock changes the room a component has. Pane-width rules are named: the scope column steps aside under 960 px of pane, the review queue folds to a slim rail under 80rem of pane, and the quick view's answers stand side by side from 560 px of pane (`--container-pane-split`, the `@pane-split` variant) and one above the other below it.

### 3.7 Density

One density. Rows are 36 px, the table header band is 36 px and sticky. There is no Comfortable option and no density preference. On a phone a list row folds to two lines.

### 3.8 The five layouts

1. **Frame.** An 80rem square frame with a 24 px gutter, a header row per section divided by hairlines, and tables edge to edge with the thin header band. Settings, Integrations, the Inbox list and Observability use it (`components/heed/frame.tsx`).
2. **Document editor shell.** The page header, the formatting toolbar as a fixed 40 px row, the tinted canvas with the 56rem sheet as the only scroller, an optional side panel, and one footer bar. The context editor, the term editor, About our business and a domain all use it (`document-shell.tsx`).
3. **Inbox mail layout.** A list in the middle and a detail pane at the right, resizable. The dock takes the pane's place.
4. **Ask thread.** A 44rem thread with history on the left (a sheet on a phone) and the composer docked under a hairline, on the empty thread too. The composer is one surface: the words, then a 44 px row with @ on the left and a 32 px Send on the right, with no hairline between and no keys written in it (they are in Send's tooltip). Stop takes Send's place until the last word of an answer shows. Under each answer, its sources are numbered chips with what was looked up beside them, then one row of icons (Copy, Good, Bad, Ask again on the last answer, and More with Something wrong?, Save question and Share), always on the last answer and on hover or focus for the earlier ones. Suggestion chips show only on the empty thread, before the first message; once a message is sent, nothing in the thread suggests a question to ask.
5. **Full-screen review.** The queue, the change, and the decision and Try it on the right, inside the app with the sidebar folded.

## 4. Components

[Components](components.md) lists the shadcn primitives in use, the parts built for Heed and the mockup file each one comes from. Rules:

- Reuse before you build. Name what you reused in the pull request. A new part goes into the inventory first.
- shadcn parts stay as shadcn ships them. They live in `components/ui` and the shared lint skips them.
- Only the product's own parts (`components/heed`, `components/obs`) are held to the copy rules.
- Lucide icons are imported only in the icon module.
- A second component base (`@radix-ui/*`), `vaul`, `framer-motion` and decorative animated sets are not used.

**The chip.** One chip for everything that names a thing: 24 px high, a 6 px radius, the type's icon, tinted by what it names. A metric, a dimension, a market, a term and each domain has its own hue (the hues are in `lib/tones.ts` and the `--chip-h-*` tokens). Colour is never alone: the icon and the words stay. A mention chip never breaks across lines. A dashed chip means its target is gone (archived or deleted) and keeps the author's words. A synonym shows as a tag. A domain shows as a dot plus its name. Tags in the editor, Details, the list's Scope column, filters and mentions all use the same chip.

**The fold.** The section folds, Details, the panels' groups and the inline toggles open from one trigger (`components/heed/fold.tsx`). Three folds still have their own toggle: the list's group header rows, Overview's month rows in the topic table, and an integration's More settings. A section's fold is a full-width row at least 44 px tall, inside its heading where it has one: what it holds in 14 px at weight 500, a muted summary only while it is closed, and the chevron at the end, pointing down and turning half a turn as it opens. Hover is `bg-band-soft` and the focus ring is drawn inside the row. A toggle in a line of text (Ask's look-up, a figure's query, the Text diff's unchanged lines) keeps its size, with the same chevron and a 44 px area under a finger. A section header's fold is its chevron, with the whole header row as its target.

## 5. Patterns

### 5.1 Lists (Context and Definitions)

Design B, at one density. A filter bar (Filter with a live count per value, Sort with its direction in words and both ways on offer, Group by domain or metric, and search on `/`), then a 36 px sticky header band, then rows.

| Column  | Content                                                                          |
| ------- | -------------------------------------------------------------------------------- |
| Kind    | The kind as an icon before the title                                             |
| Title   | The title alone                                                                  |
| Scope   | Muted text, in its own 190 px column; it steps aside under 960 px of pane        |
| Status  | A circle icon (dashed draft, check live, alert needs checking, minus archived)   |
| When    | A glyph and a short date (infinity always, arrow ongoing, since, until, a range) |
| Checked | One dot: filled up to 30 days, half up to 90, hollow after that                  |

Every mark gives its exact value on hover. The Context and Checked headers sort (Name and Context in Definitions, Topic and Asked in Observability's topics): a click on another column starts it its own way (A to Z, newest first, most first), a second click on the same column flips it, and the arrow and the header's sort state follow. A ranking (Best match, Coverage) has one way only. Observability's Overview keeps the sort and its direction in the address, as it keeps its filters. Filters that are on read as sentences under the bar ("Domain is any of Sales, Marketing") with Clear all. A totals row stays at the foot. Opening a peek keeps the search, filters, ticked rows and scroll. The peek steps with J and K, and Escape closes it first. Definitions rows show the type tile, the name with its other names as "Also called" tags (the first three, then +N), the domain at wide widths, the count of context, a flag only when something needs a look, and the source (a lock for read-only, the author's avatar for a term).

**Observability's Overview** is this pattern over topics, with what they add up to above them, in one frame and one state in the address. Under the title and the range: the views (built in and the workspace's own) as a `TextSwitch` with counts, folding into one menu on a narrow page, then the filter bar, four number cells, questions per day, and the topics with Sort and Group on their section's header. **Its filters are chips** in the bar, in the order they were put in, each still read as a sentence ("Market is not Norway", "Answer is any of Not found, Partial") by its words and to a screen reader: is, is any of, is not, is none of, and a topic's words ("Topic has"). A type-ahead in the bar adds one (`F` opens the fields, `/` starts typing, arrows and Enter choose, Esc closes, Backspace in the empty box takes the last chip off). A chip opens an editor: is or is not, a search over the field's values with what each counts, the values to tick, and Move left and right; a chip also moves by a drag or by Alt and the arrows. Clear all from two. The **facets** sit beside the numbers, the chart and the topics (folding away, remembered on the device; a sheet on a narrow page): every field's values with what each counts, counted without the field's own chip so the other values stay in sight; a tick adds the value, a count looks at only that value. The whole view is in the address, each change a step that Back undoes. Every part follows the same state. A topic row is one line at 36 px: the name with its months and its flags (one mark with a tooltip where the row has no room), the domain, Asked, the answer bar (its words a point away, and read out), the status. On a phone a row folds to two lines and the domain, status and flags go under the name. Counts follow the disclosure rules: "Fewer than 5", "13+", and "-" for a count hidden to keep another safe; a count is only ever the disclosed counts added up, and one the service keeps no count for (a kind of agent, with the topics narrowed) says "Not shown" rather than being worked out in the browser. Its numbers count to a new value and its bars move to theirs ([motion](motion.md)). Native selects and checkboxes are not used: the menus, the switch and the chips are the shared parts.

### 5.2 Selection and the bulk bar

One selection model for every list with checkboxes (`hooks/use-selection.ts`, rules in `lib/selection.ts`): a checkbox ticks one row and makes it the anchor; Shift and a click ticks the run from the anchor in the order on screen, across groups; Cmd or Ctrl and a click ticks one row; Shift and Up or Down extends; X ticks the row under the cursor; Cmd or Ctrl and A ticks every row shown; Esc clears; Delete or Backspace asks the same way the Delete button does: it opens the delete confirmation, or opens nothing and says why when no ticked row can be deleted, and it never deletes by itself. The anchor is kept by id. A screen reader hears "3 selected" and "Selection cleared".

**One bulk bar in its own band under the list**, never over rows. It holds the count, Clear, and the list's actions. On a phone it is a bar along the bottom, its buttons as icons. A change acts on what it may and leaves the rest ticked, with "2 skipped: owned by Sales" above the bar. A partial failure says "3 of 4 archived, 1 failed" with Retry. A button that cannot act says why before it is pressed. Delete opens one confirmation, which holds the rows it was opened with even if the list refreshes under it: titles and count, what it means, the published items it leaves alone (Archive instead), the number to type above ten, Cancel focused, and the only red text. Then a toast with Undo for 10 seconds.

### 5.3 The review

The quick view, in the Inbox pane and the dock, opens on the card's head: its state as the chip (Suggestion, Conflict, Not found and the other card kinds), the domain, the title at the review heading's size (24 px, 600; 20 px in a pane under 448 px), the summary, then a short line on who sent it. Under it the quick view shows Try it before and after: a band with the question (for a Not found card, what agents asked about and how often, never their words), then **Agents say today** and **After you publish** (**If you publish as it is** for a suggestion that clashes with live context, **After you archive** for one that archives an item), each with its answer line. The after side has a 3 px rule in its state's colour, a Conflict answer sits on `bg-caution/8`, and the words that change carry the Differs mark. The pair is the suggestion's Try it; a Not found card's after answer comes from its draft. Then what needs care, never folded, and the evidence folded until it is wanted: What changes (what moved and the most important change) and the sender's note. A card with no Try it pair (an alert, a check date, a report, a Not found card with no draft yet) keeps the same head and foot, with its point and its evidence folded. The context item such a card is about folds to the Context list's row: its kind, its title and what it is in words, then its status, when and freshness from 560 px of pane; opened, what it applies to, its text, what not to conclude, and Open the context item to its page, left out where the card's decision already says it. The foot holds one primary button named for the decision it opens (Review, Decide how they relate, Check the draft) with Enter beside it, the card's other decisions as labelled buttons beside it, and a few words that say what follows ("12 questions a week would get the new answer", "Publishing waits until you say how they relate"), never with a zero count. Previous and next sit in the pane's 48 px bar with where you are in the list. It never publishes. The review shows:

- the **queue** of waiting suggestions, grouped by sender, with a dot for where you are, a tick when done and a warning when it needs care;
- the **change** in the middle: one sentence on what changes, then what must be decided or known (a withdrawal, the item to archive, a synced document, the claim check, the clash gate), which no view ever hides, then the **source**, which is the review: a **Fields** table (title, kind, domain, owner, applies to, when, check date, source, don't conclude), each row changed or the same with its value now and suggested and the unchanged rows folded into one line, and a **Text** diff of the stored text in the app's own font, with line numbers, removed lines before added ones, the changed words marked across a changed block (a paragraph split, joined or reworded keeps its unchanged words plain) only when at least half of the block's shorter side stays, and unchanged stretches folded with three lines kept around each change. N and P step through the changes. A quiet "Preview" toggle shows the suggested version as the item's Context page will show it once published (the same item view, with the day it was checked saying it is set when you publish); an archive has no suggested version, so it says so. Publishing takes the whole change;
- **threads on the source**: a comment hangs on a line of the Text diff or a row of the Fields table. A "+" beside a line on hover, C on the line or field in focus (the arrows move between them), and on a touch screen a Comment button under the one tapped start one. The thread hangs under its line, its left rule in the accent while open and grey once resolved, its state in words beside an icon ("Resolved by Jon Abara, today, 10:40"); a resolved thread folds to that line. Anyone who may read the suggestion resolves or reopens it. Replies, mentions and reactions are the comment box's own. The thread names the two versions it was read against, so it stays on its line after a reload; one written on an earlier version of the suggestion is shown under the change with the other comments, saying so, and is resolved or reopened there the same way. The rail sums them up ("2 open, 1 resolved") as they change, lists the open ones to go to, and says that open threads never hold Publish, which they don't;
- **marks that are never colour alone**: added words are underlined, removed words struck through, formatting has a dotted underline and names itself, a link shows its old and new address, a moved step says where it came from;
- **Try it**: what agents say before and after, as Draft or Published, then "Agents now say" once published;
- the **Ready line**, which never says more than was checked: a new number or date without a source says "not checked against a source", and only then;
- **Overlaps** and a **clash gate**: a clash with live context cannot publish until the owner says how the two relate (replaces, disagrees with, unrelated);
- the **decision**: Publish, Edit, Return with a note, or Archive (which always asks first);
- "**Publish the N you've read**": only plain changes whose end was on screen for 1.5 to 8 seconds by its length (or marked as read) are published together. A change that needs its own look (a claim, an overlap, a retirement, an unchecked value, a new link) stays out. Its toast has Undo that puts back exactly those.

After a decision the outcome shows in place with Undo for 6 seconds and a short countdown bar, then the next suggestion opens. A letter key moves on at once; the pointer or focus on the outcome holds it; with reduced motion it waits for Next. After the last decision the review says "All N handled" with Undo for the last one. Focus moves to the change's heading after J, K or a decision, and the new suggestion is announced. On a phone the decision bar says the state in words, "8 of 12" with previous and next, and its actions are 44 px.

### 5.4 The document editor and the properties list

One document editor (Tiptap) for long text. Markdown goes in and out. Under the title the **properties are a calm list, not a form**: a muted icon and label on the left, the value shown as what it is on the right, no border at rest, a soft fill on hover and a soft ring on focus, in three groups divided by a hairline:

1. What it is: Domain (a dot), Kind (an icon chip), Status (only when it needs attention), Owner (avatar chips).
2. When and where: Applies to (tag chips with + Add), When (one date-phrase chip).
3. Where it comes from: Source (a link chip), Don't conclude (edited in place), Checked.

An empty value is a muted Add placeholder; a needed one has a quiet dot. The list is for editing: a published item reads its properties as Details (5.5), not as this list. One popover each (a bottom sheet on a phone). Up and Down move between properties, Enter opens, Esc closes, typing filters, Backspace removes the last tag. The editor header keeps to the way back, the title, Saved, one Write / Try it toggle and the one primary action. Draft from text, What agents get, search on a phone and the theme sit in one More menu. The side panel (What agents get, Overlaps) appears only when the item overlaps another. Owners publish their own item in one step; otherwise "Send to the owner of X".

### 5.5 Peeks

The quick view of a context item or a definition is a note and one closed Details row, 480 wide. A few bands cut by full-width hairlines: the title once and the words; domain, owner and when it was checked, and the source, in two quiet lines; Details (closed); for a context item a quiet toolbar under it (Try it, History, Comments), shown with Details open or shut, each action 44 px under a finger. A count of nothing is left out, so a draft says History. A context item's Details are one body wherever they open (the peek, the item's page, the review's Preview, the Inbox's item fold), and each place leaves out what it shows already or what its own page has. The body is lines in words, each with its icon: what agents use it for with its chips, the date, Don't conclude, the kind. Then the quote as a source block with "Copied from" and its source, then Related in two groups, Links to and Linked from, one line per link: an owner's relation when there is one (Replaces, Replaced by, Disagrees with), the chip, and Archived only when the target is archived. Related says more only when a workspace has switched link following off. Status is not in Details: the lines above it say it. When something needs a decision (a flag, an overlap, an overdue check, a word that means two things) one attention line with one button says so. The quick view shows the item at once and reads nothing else to say it: while the item's read is unanswered a conflict's warning is drawn with placeholders that hold their space, and its settle buttons stay off. If the read fails or gets no answer in 8 seconds, the line says Not checked, with Try again, and the settle buttons stay off. The bar says only "Context" or "Definition", with previous, next, an expand icon and close. What agents get is not in the peek.

### 5.6 Mentions and emoji

One `@` picker for Ask, the document editors and comments: a Command list under the caret (a sheet on a phone), grouped Domains, Definitions, Context items, Markets and People, with type icons, recent first. Each place offers its own kinds. Comments tag people, which marks the Inbox and brings the card back to Needs you (in the app only). In what `get_context` gives an agent, a mention is only its words. `:` alone opens the emoji list (what was used lately and the common reactions, narrowed as letters follow) in comments, the Return note and the Ask composer; context, definitions, titles, search and filters take none (agents read that text, so an emoji pasted there gets a quiet note).

### 5.7 Comments and reactions

A thread under each suggestion in the review and inside each context item's page. Five reactions, each with one meaning: 👍 Agree, 👀 Looking, ✅ Done, 🤔 Not sure, 🙏 Thanks. A count shows from two, and the tooltip names who. Anyone signed in can comment; people edit and delete their own. "Return with a note" keeps its name and the note becomes the first comment. A reply brings the card back to Needs you. The heading says "Comments are not part of what agents get". The box is flat: no card, hairlines between threads, a hairline stem for replies. It loads on its own so the editor stays out of the first load.

### 5.8 State line, loading, empty, failed, offline

- **The state line** starts every answer: one answer line (section 6 of [the product page](../product.md)) with its icon and tint, and one sentence under it unless Checked. Hover gives the long form. A click opens a card saying what it means and what to do.
- **In the Ask chat the state is the badge, its meaning is the card.** An answer in the chat starts with its badge alone: the state's one or two words with its icon and tint, and no sentence beside or under it. The badge is a button. On hover (after 120 ms, gone 100 ms after the pointer leaves), on keyboard focus and on a tap, it opens a card, 280 px wide and 8 px away, that never covers the words it explains: beside the words when the thread has room to their right for all of it, above the badge when it fits there, and otherwise in the thread under the badge, moving the words down (an answer at the very top of the view, and a phone). The card holds the state in plain words, what it means, what to do, and for a Conflict the two items that disagree, as chips that open them. Escape closes it and focus stays on the badge.
- **A definition question leads with the definition.** When a question asks what a metric is or means and the definitions source describes it, the source's words are the answer's first words, at the answer's size (`text-base` on `leading-chat`, `max-w-reading`), with a 14 px muted caption under them, "From Cube, Discount cost", whose name opens the definition. A model never writes them. With context written about it, the state's badge, the words and the sources follow as for any answer. With none, a neutral **Definition** mark (`bg-muted`, the Definitions icon, the same size as a state's badge, with the same card) takes the badge's place above the definition, and one 14 px muted line follows it: "Nothing else is written about Discount cost yet.", then the look-up line and Write context. The engine's state is unchanged and the card says it is Not found. A question about the data ("What is churn rate in Norway?") keeps its badge first and the definition in a small card beside the words.
- **Loading.** Nothing shows before 150 ms. Then the page's own shape (a skeleton of rows, a sheet) is held at least 300 ms. Content fades in. A button shows a spinner in its icon slot after 150 ms. See [Motion](motion.md).
- **Empty.** shadcn Empty with what it means and the next step. A new install shows a setup checklist. An absence is not an empty list: a question with nothing written down says Not found in the state line.
- **Failed.** One calm line and Retry. A save that fails keeps the text ("Couldn't publish. Your text is kept.").
- **Offline.** One line under the header. Drafts say "Saved on this device". Publish is held until the connection is back and its button says why.

### 5.9 Switches: no tabs

One shared component per job (`components/heed/switches.tsx`):

| Component     | Job                                                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ViewToggle`  | Another view of the same thing, usually an advanced one: a quiet icon button (the review's Preview).                                                        |
| `TextSwitch`  | A list filter or a two-way option: words with counts and a sliding 2 px underline (Needs me / All, Definitions views, Overview's views, Draft / Published). |
| `ChoiceGroup` | A decision with a few answers: outline buttons in a radio group (how an overlap relates).                                                                   |
| Property menu | A property of a document (a term's Another name for).                                                                                                       |

No pill tabs, no segmented tracks, no line tabs. Each section of a settings area has its own address and a breadcrumb.

### 5.10 Toasts and Undo

Toasts use sonner, at the bottom right, above the decision, never over the change. **Undo for 6 seconds on decisions, 10 seconds after a delete.** The outcome of a decision also stays on the page, so a missed toast loses nothing. Inbox decisions and bulk changes are optimistic with a rollback if the save fails; Archive always asks first. Undo puts back exactly what one decision did, and a returned note comes back as a draft. The short wait after a decision is drawn as a bar that empties, never as a number.

### 5.11 Keys

Every button's tooltip shows its key. Single-key shortcuts belong to the page only while nobody is typing (never in a field, an editor, an open list, a menu or a dialog).

| Scope    | Keys                                                                                                                                                                                                                                                                                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anywhere | Cmd K search; Cmd B sidebar; `?` the keys; Esc close or go back                                                                                                                                                                                                                                                                                                                                |
| Lists    | J and K move; Enter opens; X selects; Shift and Down selects a run; `/` searches the list                                                                                                                                                                                                                                                                                                      |
| Overview | `F` opens the filter fields; `/` types a filter; Backspace in the empty box takes the last chip off; Alt and Left or Right moves a chip; `B` goes to the chart, where Left and Right move between bars, Up and Down between their answers, Enter looks at only the answer (or selects the bar), Shift and Left or Right select a run of days, Alt and Left or Right move it, and Esc clears it |
| Review   | J and K next or previous suggestion; N and P next or previous change; arrows and C comment on a line; Cmd Enter publishes when ready; Esc closes the note and keeps it                                                                                                                                                                                                                         |
| Ask      | `/` starts a question; Option H shows or hides history                                                                                                                                                                                                                                                                                                                                         |

The Draft 1 command registry stays as a rule for the app: one registry feeds the palette, the keys sheet and the tooltips, and a test fails when two commands claim one key in one scope. The `g` chords of Draft 1 are withdrawn (the mockup has none).

### 5.12 The theme

Light, dark and system, from a small menu at the right end of every header. `theme=light` or `theme=dark` in an address forces one. Switching eases the colours across (220 ms); with reduced motion it switches at once.

## 6. Motion

[Motion](motion.md) is part of this contract. Three tiers (instant, explained change, staged work), one token set, one reduced-motion block, and a list of what is banned.

## 7. Copy

[Copy](copy.md) is part of this contract: neutral wording, the product-name constant, plain English for people who read it as a second language, and the vocabularies.

## 8. Accessibility

[Accessibility](accessibility.md) is part of this contract: the checklist and the gates. The bar is WCAG 2.2 AA everywhere, with axe clean and Lighthouse accessibility at 100 on every screen that was audited.

## 9. Guard rails

| Guard              | Checks                                                                                                                                                                                                                                                                                                                                  | Fails when                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Golden job specs   | The app's Playwright specs in `tests/e2e`. Every spec runs on the mock build, and those whose screens are wired also run against the real service. They are the acceptance specification of this contract                                                                                                                               | A job fails in a mode it runs in                              |
| Unit tests         | Copy rules read through the TypeScript syntax tree (no product name by hand, banned words, the six labels, the four kinds), the motion guard rails, agent reply, bulk, selection, connect timers, observability sums                                                                                                                    | A rule is broken                                              |
| Class rules (lint) | A text size, a grey of text or a corner off the lists of section 2, a soft fill at any strength but 8 percent, raw palette colours, numeric z-index, raw durations, `transition-all`, `ease-in`, `scale-0`, `ease-[...]`, arbitrary values outside the allowlist; viewport variants are banned inside anything that can sit in the dock | Any violation                                                 |
| Token test         | Every token exists in light and dark; every pair meets 4.5:1 for text and 3:1 for controls and marks; six text sizes, two greys of text, five corners and one amber, green and red, in the token file and the hand-written stylesheets                                                                                                  | A token is missing, a ratio is low or a value is off the list |
| Plain words        | The glossary in `src/domain/words.ts` (v2) and the product-name rule. The old-words baseline starts at zero for the web app                                                                                                                                                                                                             | A banned word or a hand-written name                          |
| axe                | `@axe-core/playwright` on every route at 390 and 1440 px, light and dark                                                                                                                                                                                                                                                                | A serious or critical violation                               |
| Lighthouse         | Accessibility 100 on the audited screens (by hand per slice until it is automated)                                                                                                                                                                                                                                                      | A score under 100                                             |
| Layout             | The left edges of the header, toolbar and content are equal; no horizontal page scroll at any width, including 360                                                                                                                                                                                                                      | An edge or a width rule is broken                             |
| Screenshots        | Baselines are taken once from the web app, in CI, at 1440, 1024 and 390 px, light and dark, and reviewed by eye. A baseline changes only in a pull request that says why                                                                                                                                                                | A difference above the threshold                              |
| Bundle             | First load within the recorded budget; the editor, the review, charts and integrations load on demand                                                                                                                                                                                                                                   | The budget is exceeded                                        |
| Dependencies       | No Radix, `vaul` or animation library; the icon import rule                                                                                                                                                                                                                                                                             | A banned import                                               |

**The pull request checklist.** Every answer must be yes.

1. I started from one of the five layouts and the shared parts, and named what I reused.
2. Lint passes with no suppression. I added no raw value; a repeated value became a token.
3. Containers are square, conversational surfaces soft, small controls round.
4. Rows are 36 px, bars are 48 px, and there is one scroll owner.
5. A list has loading, empty, failed and offline states, and a story or a spec for each.
6. Colour is never the only sign. Every mark has an icon, a shape or a word.
7. The screen works by keyboard, focus is visible and nothing is hover only. Targets under a finger are 44 px.
8. Decisions are optimistic with Undo, and Archive and Delete ask first.
9. Text follows [Copy](copy.md): no product name in a sentence, plain English, the glossary's names.
10. Motion uses the tokens and nothing moves that the person did not ask for. Reduced motion and dark mode were checked.
11. The golden specs that touch this screen pass.

## 10. Open questions

1. **Tiptap in the first load.** The editor loads on demand (the comment box, the Ask composer and the document editors). Whether the Ask composer's editor can load later still, and what the first-load budget becomes if it does, is decided when the bundle is measured.
2. **Virtual lists.** The mockup renders whole lists. The app virtualises past 200 rows against the pane scroller. This changes no pixels, and the rows and the keyboard cursor must behave the same.
3. **Chip hues as tokens.** Settled: the chip tint and its ink are `bg-chip` and `text-chip-foreground`, drawn from the chip's own `--chip-h`. The hues of metric, dimension, market, term and warn are `--chip-h-*` tokens; a domain's hue is its data. The token test checks every hue from 0 to 359 at 4.5:1 in both themes, so any domain hue is safe.
4. **Right-to-left and other languages.** Out of scope for v1. Every vocabulary lives in one place per list so a later translation is possible.

## 11. Rules of Draft 1 that v2 withdraws

| #   | Draft 1 said                                                                                                                      | v2 says                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | Controls and cards are 4 px (squared R4); badges and dialogs 6; the docked panel 0                                                | Containers 0; marks 4, chips 6, controls and conversational surfaces 8, the pill; the Ask composer 14   |
| 2   | Heed blue in dark mode used the brand ink `#94b8f8` as the ring                                                                   | Primary and ring `#7aa2f0` in dark                                                                      |
| 3   | A custom neutral set (`--ink`, `--selected`, `--scrim`, `--border-subtle`)                                                        | shadcn's neutral set; muted text, input border and marks as in section 2.1                              |
| 4   | Five kinds (Event, Note, Guide, Example, Issue) each with its own hue and a drawn mark                                            | Four kinds (Event, Warning, Rule, Guide), icon only, neutral                                            |
| 5   | Fourteen item statuses with shaped marks                                                                                          | Four statuses (Draft, Live, Needs checking, Archived) and a freshness dot                               |
| 6   | The status badge family: md 24, sm 20, soft, outline, bare, solid                                                                 | One chip                                                                                                |
| 7   | Type roles caption to display; weights 400 and 700 only; Tailwind `text-*` removed                                                | Tailwind's scale as roles; weights 400, 500, 600, 700                                                   |
| 8   | Spacing steps 4 to 64 only, no half steps, no margins, enforced by lint                                                           | Tailwind's default scale; no arbitrary values outside the allowlist; "parents set gaps" is a should     |
| 9   | Header 48 (56 on phones), toolbar 44                                                                                              | Bar 48 everywhere, tool row 40                                                                          |
| 10  | Widths: full, overview 1120, reading 720, prose 68ch                                                                              | Sheet 56rem, frame 80rem, reading 60ch                                                                  |
| 11  | Below 1280 the sidebar becomes the rail on its own                                                                                | The rail is the person's choice, and it folds by itself when a dock opens                               |
| 12  | Docked panel 480; assistant 400, resizable from 320 to 560; docks from 1,224                                                      | One dock: 480, 560 or 720, resizable from 400 to 960; no separate assistant panel                       |
| 13  | Page rail 320, flat column                                                                                                        | One panel anatomy for every right panel                                                                 |
| 14  | List pages scroll the list; document pages scroll the page                                                                        | One scroll owner per view                                                                               |
| 15  | Rows 40, 48 and 64; a density preference                                                                                          | 36 px, one density                                                                                      |
| 16  | Library columns: Title, Domain, Status, Valid until, Owner; Title never below 440                                                 | Design B: Kind, Title, Scope, Status, When, Checked                                                     |
| 17  | Line tabs (Read, Source, History, Links; Changes, Checks, Overlaps, Activity)                                                     | No tabs anywhere; four switch components                                                                |
| 18  | The selection bar floats at the bottom on an ink surface                                                                          | One bulk bar in its own band under the list                                                             |
| 19  | Base UI toast, one at a time, 5 or 10 seconds                                                                                     | sonner, bottom right; Undo 6 s on decisions, 10 s after a delete                                        |
| 20  | Optimistic only for reversible actions; governance actions wait and ask for a reason                                              | Decisions are optimistic with Undo and rollback; Archive asks first                                     |
| 21  | Motion 100, 150, 200 ms; ease-out (0.22, 1, 0.36, 1) and in-out; skeleton may loop                                                | The mockup's tokens and three tiers; nothing loops while nothing loads                                  |
| 22  | Focus: 2 px outline with an offset, never a fill                                                                                  | Border in the ring colour and a 3 px ring at 50 percent                                                 |
| 23  | Two shadows, raised and overlay                                                                                                   | Mostly flat; shadcn's shadows where a layer floats                                                      |
| 24  | Icons at stroke 1.5 (1.75 under 14 px), with Heed marks for kinds and states                                                      | Lucide at stroke 2, no Heed marks                                                                       |
| 25  | Avatars: eight pastel pairs from the id; sizes 20, 28, 32, 36, 40                                                                 | A pastel tint from the name; sizes 16, 20, 28, 32; no avatars in the Ask chat                           |
| 26  | An empty library has no start block                                                                                               | A setup checklist on a new install                                                                      |
| 27  | Templates: list, document, overview, first-run, workbench                                                                         | The five layouts of section 3.8; the workbench is withdrawn                                             |
| 28  | Viewport variants only for the shell; container queries inside pages                                                              | Viewport variants allowed in pages; container queries inside anything that can sit in the dock          |
| 29  | An item is a "fact"; Try it is "Try a question"; Edition only on its page                                                         | "Context item"; Try it; no edition in success copy                                                      |
| 30  | `g` chords, an assistant launcher in the corner, a docked assistant with Ask and Try it tabs                                      | Ask is a place in the sidebar and a dock; Try it is in the editor and the review                        |
| 31  | The product's name may appear in a sentence where it needs it ("Sign in to Heed")                                                 | Never inside a sentence; sign-in, the logo and the page title only                                      |
| 32  | One page gutter of 24 px (16 below 768) on `Page`, `PageToolbar` and `PageContent` regions, and a left-edge rule for every region | The frame and the document shell of section 3.8. The frame has a 24 px gutter. The left-edge test stays |

What stays from Draft 1: the order of authority idea and the change process (section 1), contrast at 4.5:1 and 3:1, colour never alone, the six states of a list, one icon module, no second component base, one primary action on a screen, the command registry as an app rule, the rule that a screen pull request never changes a scale, and the screenshots and left-edge tests.

## 12. Where Draft 1 went

Draft 1 is in the git history (`git show 0cb7b42:docs/design/design-contract.md`). Code comments may still cite its section numbers. This map says where each went.

| Draft 1 section                                                                                      | Now                                                                                  |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 0 Summary                                                                                            | 0                                                                                    |
| 1 Authority, words, vocabulary                                                                       | 1, and [Copy](copy.md)                                                               |
| 2 Departures from the prototypes                                                                     | Withdrawn; the mockup, under the tag `mockup-archive`, is the reference              |
| 3 Spacing and its lint (3.3)                                                                         | 2.4, and the class rules in 9                                                        |
| 4 Layout (shell, breakpoints, widths, gutter, density)                                               | 3                                                                                    |
| 5 Page templates                                                                                     | 3.8                                                                                  |
| 6 Tokens (colour, radius, type, controls, elevation, focus, motion, layers, icons, badges)           | 2, [Motion](motion.md), 4 (the chip)                                                 |
| 7 Component inventory                                                                                | 4 and [Components](components.md)                                                    |
| 8 Written decisions (list, row, bars, tabs, selection, empty, badges)                                | 5.1, 5.2, 5.9, 5.8                                                                   |
| 9 Interaction rules (commands, keys, updates, undo, states, item text, diff, assistant, forms, back) | 5.3, 5.4, 5.8, 5.10, 5.11                                                            |
| 10 Motion                                                                                            | [Motion](motion.md)                                                                  |
| 11 Accessibility                                                                                     | [Accessibility](accessibility.md)                                                    |
| 12 Review checklist and guard rails                                                                  | 9                                                                                    |
| 13 Open questions                                                                                    | 10                                                                                   |
| Appendices A to C                                                                                    | Withdrawn with the old lint; the new class rules have their own samples in the tests |
