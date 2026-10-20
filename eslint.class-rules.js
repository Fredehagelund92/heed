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
