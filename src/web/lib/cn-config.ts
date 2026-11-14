/**
 * The class merge helper's extension, teaching it the app's named tokens (styles/tokens.css) that
 * stand for a number or an arbitrary value, so a named value gives way to
 * another of its kind exactly as that value did: `cn('z-raised', 'z-overlay')` keeps `z-overlay`,
 * and `cn('rounded-md', 'rounded-composer')` keeps `rounded-composer`.
 * `npm run cn:generate` compiles it into cn-tables.gen.ts, so the app ships the compiled tables
 * and not the config compiler.
 */
export default {
  extend: {
    theme: {
      leading: ['chat'],
      tracking: ['hero'],
      radius: ['composer'],
      shadow: [
        'hairline',
        'hairline-top',
        'peeked',
        'sidebar-ring',
        'sidebar-ring-hover',
        'sheet-up',
      ],
      container: ['inset', 'viewport-inset', 'caption', 'caption-wide'],
      spacing: [
        'safe',
        'safe-sm',
        'safe-area',
        'palette',
        'bottom-sheet',
        'bottom-sheet-tall',
        'bottom-sheet-phone',
        'screen-inset',
        'screen-inset-lg',
        'menu',
        'popup',
        'history',
        'popover-phone',
        'share',
        'history-panel',
        'overhang',
        'sheet-inset',
        'arrow',
        'switch',
        'switch-on',
        'skeleton',
        'skeleton-pad',
        'addon',
        'addon-kbd',
        'sidebar-offscreen',
        'sidebar-rail',
        'sidebar-rail-edge',
      ],
    },
    classGroups: {
      z: [{ z: ['base', 'raised', 'header', 'site-header', 'dock', 'overlay', 'skip'] }],
    },
  },
}
