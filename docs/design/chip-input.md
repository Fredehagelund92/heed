# Decision: how the chip-aware inputs are built

Status: decided, 8 October 2026 (front end plan, slice W2, spike E1).

## Question

Contract 9.6 allows chips and mentions in three short inputs and leaves the library open: Tiptap,
ProseMirror decorations, or a combobox alone. The pass criteria are the contract's: the input works
by keyboard only, a screen reader reads a chip as "Net revenue, metric", 100 paste and undo cycles
lose nothing, it works at 360 pixels, and the lazy chunk stays at or under 120 KB gzipped.

## Options

| Option                                  | Chips while typing | Lazy chunk (gzip)                | Verdict                       |
| --------------------------------------- | ------------------ | -------------------------------- | ----------------------------- |
| Tiptap (core, Mention, undo)            | yes                | 108 KB before any code of ours   | Too close to the budget       |
| ProseMirror, atoms rendered by React    | yes                | 64 KB for the whole editor chunk | **Chosen for the summary**    |
| A combobox that writes tokens into text | no                 | none                             | **Chosen for scope and body** |

Sizes were measured with esbuild (minified, gzipped) and, for the chosen editor, from the
production build (`summary-editor` chunk). ProseMirror is what Tiptap is built on; without Tiptap's
extension layer we keep the same document model, undo history and input handling and write about
200 lines of our own.

## Decision

- **Where it applies** (`ScopeInput`) is a combobox with chips, no editor: chips are separate from
  the text, so a plain input and a listbox meet every rule.
- **What happened** (`SummaryInput`) is a one-paragraph ProseMirror editor with mention atoms,
  loaded as its own chunk. Each atom renders the shared `MentionChip` through a React portal, so the
  chip in the editor is the chip on the item page. The stored form is the markup of
  `src/domain/mentions.ts`; `summary-doc.ts` converts to and from it and holds no view code, so the
  editor can be replaced without touching storage.
- **The Markdown body** was first a plain text field (`MentionTextarea`): `@` opens the same list
  and a pick writes the `@[words](target)` token through the browser's own editing. Since the page
  editor (FR-119 as changed on 9 October 2026) the item form's body is the same ProseMirror as the
  summary (`components/editor`), with the subset rendering as it is typed; `MentionTextarea` stays
  for plain text fields.

- **The question in Ask** (`AskEditor`, Heed composer stage 2, 15 October 2026) is the same kind of
  ProseMirror paragraph, in a chunk of its own (`ask-editor`, 9 KB gzipped beside the ProseMirror
  the summary already loads), with a chip for a metric, a value, a dimension, an accepted item or a
  domain, and one for the question's dates. `@` opens the picker item text uses (since 17 October
  2026, with items and domains too) and the dates the words after it name as its last row; people
  are never offered in the question. Words the service reads as a name or a period (the question
  reading's `spans`) are underlined and offered as a chip, which Tab or a click takes, never made
  one by themselves; a dates chip opens the dates panel. A chip keeps the words it stands for, so the question is sent and copied as a
  sentence, and the chips' scope goes with it as get_context's fields (`ask-doc.ts`,
  `lib/ask-draft.ts`); its items and domains go with it as `about`, which the assistant is told
  about but no tool call is bound to. A screen reader hears a chip as "metric Net revenue, remove".

The mention inputs share one target list (`useMentionTargets`, MiniSearch over the vocabulary with
other names, the library index and the domains), one picker (`useMentionPicker` in
`mentions/mention-picker.tsx`: the search for the types a place allows, the active row, the keys
and the count for a screen reader) and one listbox (`MentionList`). A place sets the types it
offers; `person` is held for proposal comments and discussion and offers nothing yet. Since a scope can
name a dimension with any value (FR-126, 10 October 2026), "Where it applies" searches on the
service instead (`vocabulary.search`, `src/domain/scope-search.ts`), because a dimension can hold
thousands of values: its own list (`ScopeList`) shows per dimension "Any value", a count and a few
values, pages inside one dimension, and a pasted list is matched with `vocabulary.match`.

## What the spike found

- **The chip must be an inline box.** A flex box (the chip's first form) turns each part into a block,
  and Chromium then gives the text field the value "in\nNorway\n, dimension value": a screen
  reader would read the chip as lines of its own. The `mention-chip` utility is now `display: inline`
  with the mark on `vertical-align`, and the spoken type is hidden in the flow (`sr-inline`), not
  absolutely placed (`sr-only` also broke the line). The field's value now reads "Online sales stopped in
  Norway, dimension value on 4 August."
- **Copy must carry the markup in HTML.** Chromium drops a clipboard type of our own on paste; the HTML
  flavour survives. A copy writes the words as text and the markup in an attribute of the HTML, so a
  cut and paste inside the field keeps its chips, while a paste from anywhere else stays plain text.
- **The editor must not trust its selection for keys.** The browser reports a caret it moved itself
  (arrows, Home, End) through `selectionchange`, which can arrive after the next key. Before handling a
  key the editor reads the real caret (`posAtDOM`), so an arrow selects a chip instead of jumping over
  it and Backspace never acts on an old position. Select all is handled in the editor's own state for
  the same reason.
- **Each chip edit is one undo step.** Picking, removing and unpicking a chip, and a paste, close the
  undo group, so undo takes back exactly that and not the typing around it.
- **The list never scrolls.** axe reports a scrolling listbox whose focus stays in the field. The list
  shows at most eight rows; a longer query reaches the rest.

## Results against the pass criteria

| Criterion                  | Result                                                                                                                                                     | Where                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Keyboard only              | Pass: type `@`, move, pick, Backspace removes a chip whole, Delete turns it back into words, undo and redo, `#` for values, Escape, scope add and remove   | `tests/e2e/mentions.spec.ts`                |
| "Net revenue, metric"      | Pass in Chromium's accessibility tree: the chip's name and the field's value carry the type and any state                                                  | `tests/e2e/mentions.spec.ts` (`accessible`) |
| 100 paste and undo cycles  | Pass: 100 real clipboard pastes with undo in Chromium, and 20 generated runs of 100 cycles on the document model                                           | e2e and `tests/unit/mentions.test.ts`       |
| 360 pixels                 | Pass: no sideways scroll with a list open; the list stays inside the field                                                                                 | `tests/e2e/mentions.spec.ts`                |
| axe                        | Pass with the lists open, light and dark                                                                                                                   | `tests/e2e/mentions.spec.ts`                |
| Lazy chunk at most 120 KB  | Pass: 64 KB gzipped                                                                                                                                        | `npm run build`                             |
| VoiceOver and NVDA by hand | **Not done in this slice.** No screen reader was run; the checks above are Chromium's accessibility tree. It stays on the release checklist (contract 11). | Release checklist, sweep slice              |

The Ask composer is held to the same criteria in Chromium (`tests/e2e/ask-chips.spec.ts`: keyboard
only, the spoken value, plain paste, 100 real paste and undo cycles, input method composition, 390
pixels, axe in light and dark) and on its document (`tests/unit/ask-doc.test.ts`). VoiceOver, NVDA,
iOS Safari and Android keyboards by hand are still owed, as for the summary.

Firefox and Safari were not run; the project's browser tests run in Chromium.

## Fallback

The Ask composer falls back by itself: the plain box of stage 1, with its scope picker, stands in
while the editor's chunk loads and stays if it cannot load or breaks (an error boundary), so
asking never stops.

If the hand pass with a screen reader fails on the editor, the summary falls back to
`MentionTextarea`: the same list and the same stored markup, with chips in Preview only. Nothing that
stores or serves the summary changes.
