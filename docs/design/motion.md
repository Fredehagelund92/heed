# Motion and loading

Part of the [design contract](design-contract.md). It comes from the motion rules of the approved mockup, adapted. There is no animation library. Motion is CSS tokens, Base UI's starting and ending styles, `@starting-style`, React's `<ViewTransition>` and `useOptimistic`.

## The idea

Motion explains. It shows that something appeared, left or moved, or that an agent is working. Motion that explains nothing is out. There is no page-enter transition and no count-up number. A chart grows once, only after a wait the person saw. An exit is one step shorter than its entrance.

## Three tiers

| Tier                 | For                                                                                            | Time         |
| -------------------- | ---------------------------------------------------------------------------------------------- | ------------ |
| **Instant**          | Anything done by keyboard or very often: J and K, selection, the palette, moving between pages | 0 ms         |
| **Explained change** | Something appears, leaves or moves                                                             | 90 to 220 ms |
| **Staged work**      | Only where an agent really works: Ask, Try it, the answer panel, Quality's check               | Real steps   |

## Tokens

All durations and curves are tokens. A component never writes a raw time.

| Token                  | Value                             | For                                                              |
| ---------------------- | --------------------------------- | ---------------------------------------------------------------- |
| `--dur-0`              | 0 ms                              | The keyboard, selection, the palette                             |
| `--dur-1`              | 90 ms                             | Press, hover colour, icon swap, a menu leaving, a tooltip        |
| `--dur-2`              | 150 ms                            | A popover entering, a row leaving, skeleton to content, a banner |
| `--dur-3`              | 220 ms                            | Dock, sheet, a row entering, collapse and expand, a toast        |
| `--dur-4`              | 320 ms                            | Arrival only: chart bars, the settle after a staged answer       |
| `--dur-highlight`      | 600 ms                            | A changed value's tint fading out (it comes in at once)          |
| `--dur-fade`           | 150 ms                            | The fade that explains a change: content arriving after a wait   |
| `--stagger`            | 30 ms                             | Arrival after a wait, at most 6 items                            |
| `--dist-1`, `-2`, `-3` | 4, 8, 16 px                       | How far something travels                                        |
| `ease-out`             | `cubic-bezier(0.23, 1, 0.32, 1)`  | Entering and leaving. The default                                |
| `ease-move`            | `cubic-bezier(0.77, 0, 0.175, 1)` | Already on screen, and moving                                    |
| `ease-panel`           | `cubic-bezier(0.32, 0.72, 0, 1)`  | The dock and sheets                                              |

In a class: `duration-(--dur-3) ease-panel`. A `transition-*` class with no duration uses `--dur-2` and `ease-out` (set as the default). Linear is only for spinners, shimmer, progress and countdowns, never for movement.

## Reduced motion

One block in the token file does all of it. It sets every duration token to 0, keeps `--dur-fade` at 90 ms (content arriving still fades), stops staggering, sets the distances to 0 and stops loading loops (a spinner stands still and its words say it is still working). A component adds no `motion-reduce:` override of its own. The one exception is a component's own keyframes (the countdown and the read fill).

## Banned

These are checked by a unit test (`src/lib/motion.test.ts` in the mockup) and become lint rules in the app:

- a raw `duration-NNN` or `delay-NNN`;
- `transition-all`, `ease-in`, `ease-linear` for movement, an arbitrary `ease-[...]`, `scale-0`;
- `motion-reduce:transition-none` and `motion-reduce:shimmer-none`;
- keyframes other than the countdown and the read fill.

Also out: shake, bounce, confetti, parallax, scroll-linked effects, and anything that loops while nothing is loading.

## What moves, and how

| Thing                                     | Motion                                                                                                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Popover, menu, select, tooltip            | A small step from the trigger: from 97 percent and 4 px towards it. In 150 ms, out 90 ms. Opened from the keyboard, or a second tooltip right after a first: at once |
| Dialog                                    | The same small scale and fade from the centre. The backdrop only fades                                                                                               |
| Dock                                      | The page moves in one frame. The dock slides in from 16 px to the right, fading, in 220 ms on the panel curve. A new peek in an open dock only fades, in 90 ms       |
| A row that leaves or arrives              | A row collapses and fades in 150 ms. One added later opens in 220 ms. A table row only fades. One presence pattern for all (`lib/presence.ts`)                       |
| Moving between suggestions                | The change crossfades in 150 ms. With reduced motion the review does not start a transition                                                                          |
| A changed number                          | A tint there at once, fading over 600 ms. Shown for the first time, it is simply there. With reduced motion it is not drawn                                          |
| Chart bars                                | After a wait, each grows from the baseline in 320 ms, 30 ms after the one before, once. None with reduced motion                                                     |
| Theme switch                              | The colours ease across in 220 ms. With reduced motion it switches at once                                                                                           |
| The wait after a decision                 | A bar that empties (the countdown). None with reduced motion                                                                                                         |
| The read hint                             | A bar that fills as the read counts (the read fill). None with reduced motion                                                                                        |
| The sidebar folding because a dock opened | Instant: the page reflows once. A person's own fold keeps its motion                                                                                                 |

## Loading

What the person waits for decides the look.

| Wait                          | Look                                                          |
| ----------------------------- | ------------------------------------------------------------- |
| A known layout                | A skeleton of that layout, after 150 ms, held at least 300 ms |
| An agent's work               | The staged reading card                                       |
| A known number of steps       | A progress bar with words ("5 of 12")                         |
| A background refresh          | Nothing: the old content stays                                |
| A button                      | A spinner in its icon slot, after 150 ms                      |
| A decision that can be undone | No wait: the result now, and Undo                             |

Rules:

- **Nothing shows before 150 ms.** A fast load never flashes a skeleton.
- The skeleton has the page's own shape: rows at the list's height, a sheet where the document goes. The page's title and its line are not data, so they show at once.
- Content arrives through React's `<ViewTransition>`: the skeleton leaves in 90 ms and the content fades in over `--dur-fade`. With reduced motion the skeleton goes at once and the content still fades, in 90 ms.
- A button in a pending state is `aria-busy`, ignores more presses, and keeps its label and width. With reduced motion `loadingLabel` ("Publishing...") says it is still working.
- **Staged work** (Ask's look-up, Try it, the answer panel, Quality's check) is one quiet line with a spinner and a shimmer on the words while it works, then what it found. Shimmer is only ever on these words. The steps and their times come from the real work, not from a timer.
- An answer arrives as one piece: no word-by-word stream, one motion as the sources settle in. A stopped answer ends in "...", names no source count, and says it was stopped.

## Decisions are optimistic

Inbox decisions, review publishes and bulk changes show their result at once (`useOptimistic`), with Undo for 6 seconds (10 seconds after a delete) and a rollback if the save fails. See section 5.10 of the design contract.

## Testing slow networks

The app has a **Slow network** switch (in Help, or `?slow=1` in the mock build) that adds a wait to each page's first visit and to every save, so loading and optimistic states can be seen and tested. It belongs to the mock binding and never reaches a production build.

The job spec J29 keeps these rules, and runs both with and without reduced motion.
