/** @typedef {{ id: string, pattern: string, message: string }} ClassRule */

/*
  The Tailwind class rules of the web app in src/web (design contract v2, sections 2 and 9, and
  docs/design/motion.md). Each pattern matches a complete class name, variants and the `!`
  modifier included, and eslint.config.js feeds them to `better-tailwindcss/no-restricted-classes`. The mockup's scales are allowed as they are: Tailwind's spacing with its
  half steps, margins, Tailwind's text scale, weights 400 to 700, and viewport variants in pages.
  What stays out: raw palette colours, numeric layers, raw motion and the motion the mockup's
  guard rails ban, and arbitrary values outside a short allowlist.
  A value that repeats becomes a token in src/web/styles/tokens.css. tests/lint/web-class-rules.test.ts
  runs them against samples.
*/

/**
 * The arbitrary values the app may write, each a name rather than a number: a token by its
 * variable (`bg-[var(--mark-add)]`; `bg-(--mark-add)` is never an arbitrary value), the
 * properties a transition names (`transition-[width,opacity]`), and the two keyframes of the app's
 * own (`animate-[countdown_...]` and `animate-[readfill_...]`, docs/design/motion.md). An
 * arbitrary property may set a variable to a token: `[--cell-size:--spacing(8)]`.
 */
const allowedArbitrary = String.raw`(?!transition-\[[a-z-]+(?:,[a-z-]+)*\]!?$)(?!animate-\[(?:countdown|readfill)_)(?![a-z0-9-]+-\[var\(--[a-z0-9-]+\)\]!?$)`
/** Utilities with a rule of their own for an arbitrary value: motion and layers. */
const ownRule = String.raw`(?!(?:duration|delay|ease|animate|z)-\[)`

/** @type {ClassRule[]} */
export const webClassRules = [
  {
    id: 'arbitrary-value',
    pattern: String.raw`^(?:[^\s]*:)?!?-?${allowedArbitrary}${ownRule}[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\[[^\]]+\]!?$`,
    message:
      'Arbitrary value "$0". Use the scale, a token from src/web/styles/tokens.css by its name, or add one there.',
  },
  {
    id: 'arbitrary-property',
    pattern: String.raw`^(?:\S*:)?(?!\[--[a-z0-9-]+:(?:var\(--[a-z0-9-]+\)|--spacing\([\d.]+\))\]$)\[[a-z-]+:[^\]]+\]!?$`,
    message: 'Arbitrary property "$0". Write it in a token or a component stylesheet.',
  },
  {
    id: 'raw-colour',
    pattern: String.raw`^(?:[^\s]*:)?!?(?:bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|divide|caret|accent|shadow)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white)(?:-\d{2,3})?(?:/\d+)?!?$`,
    message:
      'Raw palette colour "$0". Use a theme colour from tokens.css, such as text-muted-foreground.',
  },
  {
    id: 'font-weight',
    pattern: String.raw`^(?:[^\s]*:)?font-(?:thin|extralight|light|extrabold|black)$`,
    message: 'Font weight "$0". Use font-normal, font-medium, font-semibold or font-bold.',
  },
  {
    id: 'numeric-z',
    pattern: String.raw`^(?:[^\s]*:)?-?z-(?:\d+|\[[^\]]+\])$`,
    message:
      'Numeric layer "$0". Use a named layer: z-base, z-raised, z-header, z-site-header, z-dock, z-overlay or z-skip.',
  },
  {
    id: 'raw-motion',
    pattern: String.raw`^(?:[^\s]*:)?(?:duration|delay)-(?:\d+|\[[^\]]+\])$`,
    message:
      'Raw time "$0". Use a duration token, such as duration-(--dur-2) (docs/design/motion.md).',
  },
  {
    id: 'transition-all',
    pattern: String.raw`^(?:[^\s]*:)?transition-all$`,
    message:
      '"$0" moves everything. Name what moves: transition-colors, transition-opacity or transition-[width].',
  },
  {
    id: 'easing',
    pattern: String.raw`^(?:[^\s]*:)?ease-(?:in|linear|\[[^\]]+\])$`,
    message:
      'Easing "$0". Use ease-out, ease-move or ease-panel; linear is only for loops and progress, inside their keyframes.',
  },
  {
    id: 'scale-from-nothing',
    pattern: String.raw`^(?:[^\s]*:)?-?scale-(?:x-|y-)?0$`,
    message: '"$0" grows from nothing. Start from 97 percent, as the motion tokens do.',
  },
  {
    id: 'reduced-motion-override',
    pattern: String.raw`^(?:[^\s]*:)?motion-reduce:(?:[^\s]*:)?(?:transition-none|shimmer-none)$`,
    message:
      '"$0" overrides reduced motion. The tokens carry it in one block (docs/design/motion.md), so leave it out.',
  },
  {
    id: 'own-keyframes',
    pattern: String.raw`^(?:[^\s]*:)?animate-\[(?!(?:countdown|readfill)_)[^\]]*\]$`,
    message:
      'Keyframes of its own "$0". Only the countdown and the read fill run their own (docs/design/motion.md).',
  },
  {
    id: 'viewport-variant',
    pattern: String.raw`^(?:[^\s]*:)?(?:sm|md|lg|xl|2xl|max-sm|max-md|max-lg|max-xl|max-2xl|min-\[[^\]]+\]|max-\[[^\]]+\]):`,
    message:
      'Viewport variant "$0". This can sit in the dock, so it reads its container: @md:, @lg: (design contract 3.6).',
  },
]

/** The app's rules without the ones a path is allowed to break. */
export function webClassRulesExcept(...ids) {
  return webClassRules.filter((rule) => !ids.includes(rule.id))
}
