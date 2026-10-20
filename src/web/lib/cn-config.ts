/**
 * The class merge helper's extension, teaching it the design contract's names (tokens.css).
 * Without this, `text-caption` reads as a text colour and `cn('text-caption',
 * 'text-muted-foreground')` would drop the size. `npm run cn:generate` compiles it into
 * cn-tables.gen.ts, so the app ships the compiled tables and not the config compiler.
 */
/**
 * The named sizes of tokens.css (spacing and container names), so a component's default width
 * gives way to the one a caller passes: `cn('w-popover', 'w-dialog')` keeps `w-dialog`.
 */
const namedSizes = [
  'sidebar',
  'rail',
  'header',
  'assistant',
  'companion',
  'dock',
  'field-label',
  'menu',
  'popover',
  'inbox',
  'inbox-list',
  'row-button',
  'column-title-min',
  'column-domain',
  'column-about',
  'column-status',
  'column-until',
  'column-owner',
  'column-optional',
  'reading',
  'overview',
  'prose',
  'dialog',
  'dialog-wide',
  'confirm',
  'inset',
]

export default {
  extend: {
    classGroups: {
      w: [{ w: namedSizes }],
      'min-w': [{ 'min-w': namedSizes }],
      'max-w': [{ 'max-w': namedSizes }],
      'font-size': [
        { text: ['caption', 'dense', 'body', 'reading', 'row-phone', 'large', 'title', 'display'] },
      ],
      tracking: [{ tracking: ['large', 'title', 'display'] }],
      shadow: [{ shadow: ['raised', 'overlay'] }],
      z: [
        { z: ['sticky', 'selection', 'sidebar', 'popover', 'overlay', 'toast', 'tooltip', 'skip'] },
      ],
      duration: [{ duration: ['instant', 'fast', 'base'] }],
    },
  },
}
