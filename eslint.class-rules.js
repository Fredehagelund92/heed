/*
  The Tailwind class rules of the design contract (section 3.3), one entry per row. Each pattern
  matches a complete class name, variants and the `!` modifier included. eslint.config.js feeds
  them to `better-tailwindcss/no-restricted-classes`, and tests/lint/class-rules.test.ts runs
  them against the contract's sample lists (appendix C), so the patterns cannot drift.
*/

/** @typedef {{ id: string, pattern: string, message: string }} ClassRule */

/** @type {ClassRule[]} */
export const classRules = [
  {
    id: 'arbitrary-value',
    pattern: String.raw`^(?:[^\s]*:)?!?-?[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\[[^\]]+\]!?$`,
    message: 'Arbitrary value "$0". Add a token to tokens.css, or use a named size.',
  },
  {
    id: 'arbitrary-property',
    pattern: String.raw`^(?:\S*:)?\[[a-z-]+:[^\]]+\]!?$`,
    message: 'Arbitrary property "$0". Write it in tokens.css or a component stylesheet.',
  },
  {
    id: 'spacing-off-scale',
    pattern: String.raw`^(?:[^\s]*:)?!?(?:p|px|py|pt|pr|pb|pl|ps|pe|gap|gap-x|gap-y|scroll-p[xytrblse]?)-(?!(?:0|1|2|3|4|6|8|12|16)!?$)(?=\d|\(|\[|px)[^\s]+$`,
    message: 'Off-scale spacing "$0". Use 1, 2, 3, 4, 6, 8, 12 or 16 (4 to 64 pixels).',
  },
  {
    id: 'margin',
    pattern: String.raw`^(?:[^\s]*:)?!?-?(?:m|mx|my|mt|mr|mb|ml|ms|me|scroll-m[xytrblse]?)-(?!auto!?$)[^\s]+$`,
    message: 'Margin "$0". Let the parent set a gap.',
  },
  {
    id: 'space-utility',
    pattern: String.raw`^(?:[^\s]*:)?!?-?space-[xy]-[^\s]+$`,
    message: '"$0" adds margins. Use gap on a flex or grid parent.',
  },
  {
    id: 'size-token-as-spacing',
    pattern: String.raw`^(?:[^\s]*:)?!?(?:p|px|py|pt|pr|pb|pl|ps|pe|gap|gap-x|gap-y)-(?:sidebar|rail|header|row|row-[a-z]+|control-[a-z]+|assistant|companion|footer|selection-bar|table-header|tabs|prose)!?$`,
    message: 'Named size "$0" used as spacing. Named sizes are for width, height and size only.',
  },
  {
    id: 'size-off-grid',
    pattern: String.raw`^(?:[^\s]*:)?!?-?(?:w|h|size|min-w|min-h|max-w|max-h)-(?:\d+\.\d+|(?:1[7-9]|[2-9]\d|\d{3,}))!?$`,
    message: 'Off-grid size "$0". Use a whole step up to 16, or a named size.',
  },
  {
    id: 'default-text-size',
    pattern: String.raw`^(?:[^\s]*:)?!?text-(?:xs|sm|base|lg|xl|[2-9]xl)!?$`,
    message:
      'Default text size "$0". Use a role: text-caption, text-dense, text-body, text-large, text-title or text-display.',
  },
  {
    id: 'font-weight',
    pattern: String.raw`^(?:[^\s]*:)?font-(?:thin|extralight|light|medium|semibold|extrabold|black)$`,
    message: 'Font weight "$0". Use font-normal or font-bold.',
  },
  {
    id: 'raw-colour',
    pattern: String.raw`^(?:[^\s]*:)?!?(?:bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|divide|caret|accent|shadow)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white)(?:-\d{2,3})?(?:/\d+)?!?$`,
    message:
      'Raw palette colour "$0". Use a semantic token (text-type-on-solid on a solid tile, bg-scrim for scrims).',
  },
  {
    id: 'important',
    pattern: String.raw`(?:^|:)!|!$`,
    message: 'Do not use !important ("$0"). Fix the cascade.',
  },
  {
    id: 'numeric-z',
    pattern: String.raw`^(?:[^\s]*:)?-?z-\d+$`,
    message:
      'Numeric layer "$0". Use z-sticky, z-selection, z-sidebar, z-popover, z-overlay and so on.',
  },
  {
    id: 'raw-motion',
    pattern: String.raw`^(?:[^\s]*:)?(?:transition-all|duration-\d+|delay-\d+)$`,
    message:
      'Raw motion "$0". Use duration-instant, duration-fast or duration-base, and name the property.',
  },
  {
    id: 'viewport-variant',
    pattern: String.raw`^(?:[^\s]*:)?(?:sm|md|lg|xl|2xl|max-sm|max-md|max-lg|max-xl|max-2xl):`,
    message:
      'Viewport variant "$0". Feature components use container variants (@md:). Viewport variants belong to the shell and the page templates.',
  },
  {
    id: 'gutter-outside-template',
    pattern: String.raw`^(?:[^\s]*:)?!?-?(?:p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y)-gutter!?$`,
    message:
      'The page gutter "$0" belongs to the page templates and the list. Put the content in a template region.',
  },
]

/** The rules without the ones a path is allowed to break. */
export function classRulesExcept(...ids) {
  return classRules.filter((rule) => !ids.includes(rule.id))
}

/*
  The class rules of the new web app in src/app (design contract v2, sections 2 and 9, and
  docs/design/motion.md). The mockup's scales are allowed as they are: Tailwind's spacing with its
  half steps, margins, Tailwind's text scale, weights 400 to 700, and viewport variants in pages.
  What stays out: raw palette colours, numeric layers, raw motion and the motion the mockup's
  guard rails ban, and arbitrary values outside a short allowlist.
  A value that repeats becomes a token in src/app/styles/tokens.css. eslint.config.js applies
  them to src/app and tests/lint/app-class-rules.test.ts runs them against samples. The rules
  above stay for the old front end in src/web until the switch.
*/

/**
 * The arbitrary values the new app may write, each a name rather than a number: a token by its
 * variable (`bg-[var(--mark-add)]`; `bg-(--mark-add)` is never an arbitrary value), the
 * properties a transition names (`transition-[width,opacity]`), and the two keyframes of the app's
 * own (`animate-[countdown_...]` and `animate-[readfill_...]`, docs/design/motion.md). An
 * arbitrary property may set a variable to a token: `[--cell-size:--spacing(8)]`.
 */
const allowedArbitrary = String.raw`(?!transition-\[[a-z-]+(?:,[a-z-]+)*\]!?$)(?!animate-\[(?:countdown|readfill)_)(?![a-z0-9-]+-\[var\(--[a-z0-9-]+\)\]!?$)`
/** Utilities with a rule of their own for an arbitrary value: motion and layers. */
const ownRule = String.raw`(?!(?:duration|delay|ease|animate|z)-\[)`

/** @type {ClassRule[]} */
export const appClassRules = [
  {
    id: 'arbitrary-value',
    pattern: String.raw`^(?:[^\s]*:)?!?-?${allowedArbitrary}${ownRule}[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\[[^\]]+\]!?$`,
    message:
      'Arbitrary value "$0". Use the scale, a token from src/app/styles/tokens.css by its name, or add one there.',
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
export function appClassRulesExcept(...ids) {
  return appClassRules.filter((rule) => !ids.includes(rule.id))
}
