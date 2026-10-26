# Motion and loading

The mockup's motion follows one rule set (all nine picks of the motion design adopted).
No animation library: CSS tokens, Base UI's starting and ending styles, `@starting-style`, React's
`<ViewTransition>` and `useOptimistic`.

## Three tiers

- **Instant**: anything done by keyboard or very often (J and K, selection, the palette, moving
  between pages).
- **Explained change**, 90 to 220 ms: something appears, leaves or moves.
- **Staged work**: only where an agent really works (Ask, Try it, the answer panel, Quality's check).

Motion that explains nothing is out. There is no page-enter transition and no count-up number, and
a chart grows once, only after a wait you saw. An exit is one step shorter than its entrance.

## Tokens (`src/index.css`)

| Token | Value | For |
| --- | --- | --- |
| `--dur-0` | 0 ms | keyboard, selection, palette |
| `--dur-1` | 90 ms | press, hover colour, icon swap, a menu leaving, a tooltip |
| `--dur-2` | 150 ms | a popover entering, a row leaving, skeleton to content, a banner |
| `--dur-3` | 220 ms | dock, sheet, a row entering, collapse and expand, a toast |
| `--dur-4` | 320 ms | arrival only: chart bars, the settle after a staged answer |
| `--dur-highlight` | 600 ms | a changed value's tint fading out (it comes in at once) |
| `--dur-fade` | 150 ms | the fade that explains a change: content arriving after a wait |
| `--stagger` | 30 ms | arrival after a wait, at most 6 items |
| `ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | entering and leaving: the default |
| `ease-move` | `cubic-bezier(0.77, 0, 0.175, 1)` | already on screen, moving |
| `ease-panel` | `cubic-bezier(0.32, 0.72, 0, 1)` | dock and sheet |

In a class: `duration-(--dur-3) ease-panel`. A `transition-*` class with no duration uses
`--dur-2` and `ease-out`. Linear is only for spinners, shimmer, progress and countdowns.

## Reduced motion

One block in `index.css` sets every duration token to 0, keeps `--dur-fade` at 90 ms (content
arriving still fades), stops staggering, and stops loading loops. A component adds no
`motion-reduce:` override of its own, except for its own keyframes.

## Banned (checked by `src/lib/motion.test.ts`)

A raw `duration-NNN` or `delay-NNN`, `transition-all`, `ease-in`, `ease-linear`, an arbitrary
`ease-[...]`, `scale-0`, `motion-reduce:transition-none`, and keyframes other than the countdown
and the read fill. Also out: shake, bounce, confetti, parallax, scroll-linked
effects, and anything that loops while nothing is loading.

## Loading

What the person waits for decides the look:

| Wait | Look |
| --- | --- |
| A known layout | a skeleton of that layout, after 150 ms, held at least 300 ms |
| An agent's work | the staged reading card |
| A known number of steps | a progress bar with words ("5 of 12") |
| A background refresh | nothing: the old content stays |
| A button | a spinner in its icon slot, after 150 ms |
| A decision that can be undone | no wait: the result now, and Undo |
