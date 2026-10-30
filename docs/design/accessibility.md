# Accessibility: the checklist and the gates

Part of the [design contract](design-contract.md). The bar is **WCAG 2.2 level AA on every screen**. The approved mockup scores 100 in Lighthouse accessibility on every screen that was audited (16 screens, at 1440 and 390 px, in light and dark), with one known exception: 97 at 1440 px while any Base UI menu is open. The app must not score lower.

Use the checklist while you build. The gates at the end are what CI and the reviewer check.

## 1. Contrast

- Text is 4.5:1 or better against its surface. Muted text is `#666666` in light and `#a3a3a3` in dark so it keeps 4.5:1 on the muted surface.
- Controls, field borders, checkboxes, radios, icons that carry meaning and the review marks are 3:1 or better. Input borders are `#8f8f8f` in light and `#6b6b6b` in dark.
- Avatar initials are 6.4:1 or better on every tint, in both themes.
- Scroll bar thumbs keep 3:1 against the page.
- The token test recomputes every pair from the token file, in light and dark.

## 2. Colour is never the only sign

Every mark has an icon, a shape or a word as well.

- Answer lines: a word, an icon and a tint. Charts: blue, amber, greys and a hatch for Not found, with a table of the numbers for screen readers.
- Item status and kind: an icon with a tooltip that gives the exact value. Freshness is a filled, half or hollow dot with a value on hover.
- Review marks: added words are underlined, removed words struck through, formatting has a dotted underline and names itself, a link shows its old and new address, a moved step says where it came from.
- Saved question results: a check (Same), two arrows (Changed), a triangle (Needs a look).
- Chips are tinted by what they name, and always carry the type's icon and words.
- A domain is a dot and its name.
- Selected rows show a check as well as a fill.

## 3. Keyboard

- Every flow works without a mouse, in visual order, with no trap. A **skip link** comes first on every page.
- Lists have a keyboard cursor (J, K, Enter, X, Shift and arrows). Each control's tooltip shows its key.
- Single-key shortcuts are off while someone types: in a field, a rich-text editor (a note, a comment), an open list, a menu or a dialog. They never act on a key held with a modifier they do not use.
- `?` opens the keys from anywhere nobody is typing. Cmd or Ctrl K searches. Cmd or Ctrl Enter publishes, sends or saves where it is the main action. Esc closes the top layer, then goes back.
- **Focus moves on purpose.** After J, K or a decision in the review, focus moves to the change's heading. After a dock closes, focus returns to what opened it. A popover or dialog traps focus while open and gives it back on close.
- Focus is never hidden behind a sticky bar. The visible focus style is a border in the ring colour plus a 3 px ring at 50 percent.
- **No drag only.** Resizing a pane, the dock or the sidebar has a keyboard route (the resize handle is a focusable separator with a value).
- No hover only. Anything shown on hover is also shown on focus (Rename and Delete in the Ask history, the add-reaction button).

## 4. Targets and touch

- On a touch screen (`pointer: coarse`) every control can be hit with a finger: its tap area grows to **44 px** around it, while the control keeps the size it is drawn. Header actions are spaced so two 44 px areas never overlap.
- Nothing on the review or the quick view is under 44 px under a finger. On a phone the decision bar's actions are 44 px.
- On a desktop pointer, 24 px is the floor for any target, 28 px for row buttons, 32 px for default controls.
- Lists on a phone use Select, and a tap then ticks a row.

## 5. Names, structure, forms

- Icon-only controls have a name. The accessible name contains the visible label.
- Titles cut with an ellipsis show in full on hover or focus (one shared component).
- One `h1`, no skipped heading levels. Landmarks for the header, navigation, main and side panels. A search landmark for the list search.
- A header that sorts is a button inside the header cell; the sorted column carries `aria-sort` (ascending or descending), and Enter or Space flips it as a click does. The Sort button's name says the direction in words ("Sort Title Z to A").
- A real label on every field. Errors are tied by `aria-describedby` and `aria-invalid`. More than two errors add a summary with links. Optional fields say "optional" in words.
- `lang` is set on the document. Dates and numbers go through `Intl`.

## 6. Live regions and messages

- Counts, "Saved" and toasts use a polite status region. A blocking error uses `role="alert"`.
- Selecting rows says "3 selected" on each change and "Selection cleared" at the end.
- A new suggestion in the review is announced when it opens. After the last decision the review says everything is handled.
- Adding a synonym says "Added synonym GMV".
- The Ask thread is `role="log"`. A finished answer is read out. A stopped answer ends in "..." and is read out as stopped.
- A pending button is `aria-busy` and ignores more presses. With reduced motion its spinner stands still and its label changes ("Publishing...") so it still says it is working.
- The "read" progress in the review is also text: the hint says what counts as read.

## 7. Motion

- With `prefers-reduced-motion`, one block of tokens removes movement, staggering, loops and highlights. Content arriving still fades, in 90 ms. A spinner stands still and its words say it is working.
- After a decision, with reduced motion the review waits for Next instead of moving on by itself.
- Nothing flashes more than three times a second. Nothing moves that the person did not ask for. See [Motion](motion.md).

## 8. Charts and data

- Every chart has a table of its numbers for screen readers, and shapes or labels as well as colour.
- A count under 5 reads "Fewer than 5" in words.

## 9. Language

- Plain English for people who read it as a second language ([Copy](copy.md)): short words, short sentences, no idioms, no contractions in labels.
- Every state is said in words, never by an icon alone.

## 10. Forced colours and zoom

- Tiles and chips keep a border. Nothing relies on a background fill alone.
- Pages work at 400 percent zoom and at 360 px wide, with no horizontal page scroll.

## 11. The gates

| Gate                | What it checks                                                                                                                                                  | Where it runs             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Token contrast test | Every text pair 4.5:1 and every control or mark pair 3:1, light and dark                                                                                        | Unit test, in CI          |
| axe                 | WCAG 2.2 AA through `@axe-core/playwright` on every route, at 390 and 1440 px, in light and dark, plus the open palette and menus                               | Playwright, in CI         |
| Lighthouse          | Accessibility 100 on the audited screens. By hand per slice until it is automated                                                                               | By hand, before a release |
| Keyboard specs      | The job specs J13 (the review's keys), J23 (focus and announcements), J24 (picking rows), J20 (tags) and J22 (help and the keys)                                | Playwright, in CI         |
| Touch specs         | J17 (the review on a phone: 44 px targets, the state in words)                                                                                                  | Playwright, in CI         |
| Motion specs        | J29 and J18, with and without reduced motion                                                                                                                    | Playwright, in CI         |
| Copy test           | Labels, state lines and hints stay short and free of contractions                                                                                               | Unit test, in CI          |
| Screen reader pass  | By hand before a release, with NVDA and Firefox, and with VoiceOver and Safari: the document editor, the list and its bulk bar, the review, Ask and the palette | Release checklist         |
| Layout              | No horizontal page scroll at any width, including 360 px                                                                                                        | Playwright, in CI         |

A serious or critical axe finding fails the build. A new moderate finding fails it too. A pull request that lowers a Lighthouse score says why, or does not merge.

## 12. The checklist

Before you ask for a review, every answer is yes.

1. Every pair of colours I added is in the token file and passes the contrast test.
2. Every mark has an icon, a shape or a word as well as its colour.
3. I used the whole screen with the keyboard only. Focus is visible and moves where a person would expect.
4. Shortcuts do not act while I type.
5. Targets under a finger are 44 px. Nothing is hover only.
6. Every icon-only control has a name. Every field has a label. Errors are linked to their fields.
7. State changes are announced in words (selected, saved, added, published, all handled).
8. A pending button is `aria-busy`. Reduced motion changes its label, not only its animation.
9. Charts have a table and shapes.
10. I turned on reduced motion and dark mode and looked again.
11. axe is clean on the routes I touched.
