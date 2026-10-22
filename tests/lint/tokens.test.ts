import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  queueColumnIds,
  queueColumnSpecs,
} from '../../src/web/components/proposals/queue-columns.ts'

/**
 * The token test of the design contract (section 12.1). It reads src/web/styles/tokens.css, checks
 * that every token of section 6 exists for light and dark, and recomputes the contrast table of
 * section 6.3 from the values in the file: OKLCH to 8 bit sRGB, then the WCAG 2.x ratio, rounded
 * down to one decimal so a number is never overstated (appendix B).
 */

const css = readFileSync(
  fileURLToPath(new URL('../../src/web/styles/tokens.css', import.meta.url)),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`tokens.css has no "${selector}" block`)
  let depth = 0
  let end = start
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    if (css[i] === '}') depth -= 1
    if (depth === 0) {
      end = i
      break
    }
  }
  const body = css.slice(start, end)
  const tokens: Record<string, string> = {}
  for (const [, name, value] of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    if (name && value) tokens[name] = value.trim()
  }
  return tokens
}

const light = block(':root')
const dark = { ...light, ...block('.dark') }
/** The values that change from 768 wide (the `@media (width >= 768px)` block). */
const wide = { ...light, ...block('@media (width >= 768px) {\n  :root') }
const themes = { light, dark } as const

type Rgb = [number, number, number]

function resolve(tokens: Record<string, string>, name: string, seen = new Set<string>()): string {
  const value = tokens[name]
  if (value === undefined) throw new Error(`Missing token ${name}`)
  if (seen.has(name)) throw new Error(`Token ${name} refers to itself`)
  seen.add(name)
  const alias = /^var\((--[a-z0-9-]+)\)$/.exec(value)
  return alias?.[1] ? resolve(tokens, alias[1], seen) : value
}

function oklchToOklab(value: string): [number, number, number] {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value)
  if (!match) throw new Error(`Not an opaque oklch() value: ${value}`)
  const [l, c, h] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const rad = (h * Math.PI) / 180
  return [l, c * Math.cos(rad), c * Math.sin(rad)]
}

function oklabToRgb([l, a, b]: [number, number, number]): Rgb {
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
  return linear.map((channel) => {
    const clamped = Math.min(1, Math.max(0, channel))
    const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055
    return Math.round(encoded * 255)
  }) as Rgb
}

/** The 8 bit colour a browser paints for a token, including the one computed `--selected`. */
function paint(theme: keyof typeof themes, name: string): Rgb {
  const tokens = themes[theme]
  const value = resolve(tokens, name)
  const mix = /^color-mix\(in oklab, var\((--[a-z-]+)\) (\d+)%, var\((--[a-z-]+)\)\)$/.exec(value)
  if (mix?.[1] && mix[3]) {
    const share = Number(mix[2]) / 100
    const [l1, a1, b1] = oklchToOklab(resolve(tokens, mix[1]))
    const [l2, a2, b2] = oklchToOklab(resolve(tokens, mix[3]))
    const blend = (x: number, y: number) => x * share + y * (1 - share)
    return oklabToRgb([blend(l1, l2), blend(a1, a2), blend(b1, b2)])
  }
  return oklabToRgb(oklchToOklab(value))
}

function luminance([r, g, b]: Rgb): number {
  const linear = (channel: number) => {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

function contrast(one: Rgb, two: Rgb): number {
  const high = Math.max(luminance(one), luminance(two))
  const low = Math.min(luminance(one), luminance(two))
  return Math.floor(((high + 0.05) / (low + 0.05)) * 10) / 10
}

const kinds = ['event', 'note', 'guide', 'example'] as const
/** The ring of domain hues (contract 6.13). Red and amber are not on it. */
const hues = ['teal', 'sky', 'indigo', 'violet', 'pink', 'lime', 'stone', 'gray'] as const
const statuses = ['success', 'warning', 'info', 'danger'] as const
/** The eight soft tints of a person's avatar, and the assistant's own, each a background and initials. */
const avatars = [1, 2, 3, 4, 5, 6, 7, 8] as const

describe('tokens.css holds every token of the design contract', () => {
  const required = [
    'background',
    'foreground',
    'card',
    'card-foreground',
    'popover',
    'popover-foreground',
    'primary',
    'primary-foreground',
    'primary-hover',
    'brand-ink',
    'ink',
    'ink-foreground',
    'ink-hover',
    'secondary',
    'secondary-foreground',
    'muted',
    'muted-foreground',
    'accent',
    'accent-foreground',
    'border',
    'input',
    'ring',
    'sidebar',
    'sidebar-foreground',
    'sidebar-accent',
    'sidebar-accent-foreground',
    'sidebar-border',
    'sidebar-ring',
    'selected',
    'scrim',
    'destructive',
    'type-on-solid',
    ...kinds.flatMap((kind) =>
      ['solid', 'tint', 'line', 'ink', 'dot'].map((role) => `type-${kind}-${role}`),
    ),
    ...hues.flatMap((hue) => ['tint', 'line', 'ink', 'dot'].map((role) => `hue-${hue}-${role}`)),
    ...avatars.flatMap((slot) => ['bg', 'fg'].map((role) => `avatar-${slot}-${role}`)),
    'assistant-avatar-bg',
    'assistant-avatar-fg',
    'avatar-chip',
    'avatar-row',
    'avatar-chat',
    'avatar-card',
    'avatar-profile',
    ...statuses.flatMap((status) =>
      ['icon', 'fg', 'bg', 'border'].map((role) => `status-${status}-${role}`),
    ),
    'duration-instant',
    'duration-fast',
    'duration-base',
    'sidebar-width',
    'sidebar-width-rail',
    'header-height',
    'page-gutter',
    'assistant-width',
    'companion-width',
    'row-height',
    'row-height-comfortable',
    'row-height-scope',
    'row-height-summary',
    'row-height-phone',
    'table-header-height',
    'toolbar-height',
    'border-subtle',
    'tabs-height',
    'footer-height',
    'selection-bar-height',
    'selection-clearance',
    'control-sm',
    'control-md',
    'control-lg',
    'control-touch',
    'icon-sm',
    'badge-md',
    'badge-sm',
    'badge-pad-md',
    'badge-pad-sm',
    'badge-gap-md',
    'badge-gap-sm',
    'badge-tint',
    'badge-line',
    'field-label-width',
    'field-label-wide-width',
    'number-field-width',
    'launcher-offset',
  ]

  it.each(required)('--%s is defined', (name) => {
    expect(dark[`--${name}`], `--${name}`).toBeDefined()
  })

  it('redefines every colour that changes in dark mode', () => {
    const sameInBoth = new Set(['--type-on-solid', '--destructive'])
    const colours = Object.keys(light).filter(
      (name) => /^oklch/.test(light[name] ?? '') && !sameInBoth.has(name),
    )
    const missing = colours.filter((name) => block('.dark')[name] === undefined)
    expect(missing).toEqual([])
  })

  it('keeps the layout metrics of section 4.1 and the professional pass (8.12)', () => {
    expect(light['--sidebar-width']).toBe('16rem')
    expect(light['--sidebar-width-rail']).toBe('3rem')
    // The header is 48 from 768 wide; a phone keeps 56 around its 44 pixel targets.
    expect(light['--header-height']).toBe('3.5rem')
    expect(wide['--header-height']).toBe('3rem')
    expect(light['--toolbar-height']).toBe('2.75rem')
    expect([
      light['--row-height'],
      light['--row-height-comfortable'],
      light['--row-height-scope'],
    ]).toEqual(['2.5rem', '3rem', '4rem'])
    expect(light['--table-header-height']).toBe('2.25rem')
    expect(light['--footer-height']).toBe('2.25rem')
    expect(light['--icon-status']).toBe('1rem')
    expect([light['--control-sm'], light['--control-md'], light['--control-lg']]).toEqual([
      '1.75rem',
      '2rem',
      '2.5rem',
    ])
  })
})

describe('contrast pairs of section 6.3 meet their minimum in both themes', () => {
  type Pair = { what: string; fg: string; bg: string; min: number }
  const pairs: Pair[] = [
    ...[
      'background',
      'card',
      'popover',
      'sidebar',
      'muted',
      'accent',
      'selected',
      'sidebar-accent',
    ].flatMap((bg): Pair[] => [
      { what: 'text', fg: 'foreground', bg, min: 4.5 },
      { what: 'secondary text', fg: 'muted-foreground', bg, min: 4.5 },
    ]),
    { what: 'label on the main button', fg: 'primary-foreground', bg: 'primary', min: 4.5 },
    {
      what: 'label on the main button, hovered',
      fg: 'primary-foreground',
      bg: 'primary-hover',
      min: 4.5,
    },
    { what: 'label on ink', fg: 'ink-foreground', bg: 'ink', min: 4.5 },
    { what: 'label on ink, hovered', fg: 'ink-foreground', bg: 'ink-hover', min: 4.5 },
    // Links and the selected nav icon (contract 6.1): text on every surface a link sits on.
    ...['background', 'card', 'popover', 'sidebar', 'accent', 'selected'].map((bg): Pair => ({
      what: 'link',
      fg: 'brand-ink',
      bg,
      min: 4.5,
    })),
    ...['background', 'card', 'popover', 'sidebar', 'accent', 'selected'].map((bg): Pair => ({
      what: 'focus ring',
      fg: 'ring',
      bg,
      min: 3,
    })),
    ...['background', 'card', 'popover'].map((bg): Pair => ({
      what: 'field boundary',
      fg: 'input',
      bg,
      min: 3,
    })),
    ...kinds.flatMap((kind): Pair[] => [
      { what: 'glyph on solid tile', fg: 'type-on-solid', bg: `type-${kind}-solid`, min: 3 },
      { what: 'solid tile on page', fg: `type-${kind}-solid`, bg: 'background', min: 3 },
      { what: 'ink text on tint', fg: `type-${kind}-ink`, bg: `type-${kind}-tint`, min: 4.5 },
      { what: 'ink text on page', fg: `type-${kind}-ink`, bg: 'background', min: 4.5 },
    ]),
    // The domain badge (contract 6.13): the label on its tint, the dot on its tint and, for the
    // outline and bare forms, on the page, a hovered row, a selected row and the sidebar.
    ...hues.flatMap((hue): Pair[] => [
      { what: 'domain label on its tint', fg: `hue-${hue}-ink`, bg: `hue-${hue}-tint`, min: 4.5 },
      { what: 'domain dot on its tint', fg: `hue-${hue}-dot`, bg: `hue-${hue}-tint`, min: 3 },
      ...['background', 'accent', 'selected', 'sidebar'].flatMap((bg): Pair[] => [
        { what: 'domain label on a surface', fg: `hue-${hue}-ink`, bg, min: 4.5 },
        { what: 'domain dot on a surface', fg: `hue-${hue}-dot`, bg, min: 3 },
      ]),
    ]),
    // A kind's glyph (the dot, which is the ink) on its soft tile, and in an outline badge or running text
    // on the page, a hovered row and a selected row.
    ...kinds.flatMap((kind): Pair[] => [
      { what: 'kind glyph on its tint', fg: `type-${kind}-dot`, bg: `type-${kind}-tint`, min: 3 },
      ...['background', 'accent', 'selected'].map((bg): Pair => ({
        what: 'kind glyph on a surface',
        fg: `type-${kind}-dot`,
        bg,
        min: 3,
      })),
    ]),
    ...statuses.flatMap((status): Pair[] => [
      { what: 'status icon', fg: `status-${status}-icon`, bg: 'background', min: 3 },
      { what: 'status icon', fg: `status-${status}-icon`, bg: 'accent', min: 3 },
      { what: 'status icon', fg: `status-${status}-icon`, bg: 'selected', min: 3 },
      { what: 'status icon', fg: `status-${status}-icon`, bg: `status-${status}-bg`, min: 3 },
      { what: 'status text', fg: `status-${status}-fg`, bg: `status-${status}-bg`, min: 4.5 },
      { what: 'status text', fg: `status-${status}-fg`, bg: 'background', min: 4.5 },
    ]),
    // The initials on a person's soft tint and the assistant's bot on its blue tint (avatars).
    ...[...avatars.map((slot) => `avatar-${slot}`), 'assistant-avatar'].map((avatar): Pair => ({
      what: 'avatar initials on their tint',
      fg: `${avatar}-fg`,
      bg: `${avatar}-bg`,
      min: 4.5,
    })),
    // A trend mark on a Home tile (contract 6.1, "Status"): the success and danger ink as text on
    // the card.
    ...['success', 'danger'].map((status): Pair => ({
      what: 'trend mark on a card',
      fg: `status-${status}-fg`,
      bg: 'card',
      min: 4.5,
    })),
  ]

  for (const theme of ['light', 'dark'] as const) {
    it.each(pairs)(`${theme}: $what, --$fg on --$bg, needs $min`, ({ fg, bg, min }) => {
      expect(contrast(paint(theme, `--${fg}`), paint(theme, `--${bg}`))).toBeGreaterThanOrEqual(min)
    })
  }

  it('keeps the badge anatomy: 24 and 20 high, radius 6 (contract 6.13)', () => {
    expect([light['--badge-md'], light['--badge-sm']]).toEqual(['1.5rem', '1.25rem'])
    expect(/--radius-badge:\s*0\.375rem;/.test(css)).toBe(true)
  })

  it('keeps the R4 corners: controls and cards 4, badges and dialogs 6, checkboxes 3 (contract 6.4)', () => {
    const radius: Record<string, string> = {}
    for (const [, name, value] of css.matchAll(/--radius-(sm|badge|md|lg|xl):\s*([^;]+);/g)) {
      if (name && value) radius[name] = value
    }
    expect(radius).toEqual({
      sm: '0.1875rem',
      badge: '0.375rem',
      md: '0.25rem',
      lg: '0.25rem',
      xl: '0.375rem',
    })
  })

  it('keeps eight different avatar tints, light and deeper in dark, and the avatar sizes', () => {
    for (const theme of ['light', 'dark'] as const) {
      const tints = avatars.map((slot) => paint(theme, `--avatar-${slot}-bg`).join())
      expect(new Set(tints).size, `${theme} avatar tints`).toBe(8)
      // Soft in light, a deeper tint in dark: the tint sits on the page side of its initials.
      for (const slot of avatars) {
        const tint = luminance(paint(theme, `--avatar-${slot}-bg`))
        const initials = luminance(paint(theme, `--avatar-${slot}-fg`))
        expect(theme === 'light' ? tint > initials : tint < initials, `${theme} ${slot}`).toBe(true)
      }
    }
    expect([
      light['--avatar-chip'],
      light['--avatar-row'],
      light['--avatar-chat'],
      light['--avatar-card'],
      light['--avatar-profile'],
    ]).toEqual(['1.25rem', '1.75rem', '2rem', '2.25rem', '2.5rem'])
  })

  it('keeps red and amber off the domain ring', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const hue of hues) {
        const value = resolve(themes[theme], `--hue-${hue}-dot`)
        const angle = Number(/oklch\(\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s*\)/.exec(value)?.[1])
        const chroma = Number(/oklch\(\s*[\d.]+\s+([\d.]+)/.exec(value)?.[1])
        // Red sits near 27 and amber between 60 and 90; a hue with real chroma may not sit there.
        const alarm = (angle >= 15 && angle <= 40) || (angle >= 60 && angle <= 90)
        expect(alarm && chroma > 0.05, `${theme} --hue-${hue}-dot is an alarm hue`).toBe(false)
      }
    }
  })

  it('paints every tone the Reference way: one ink for label and mark (contract 6.1, 6.13)', () => {
    const tones = [
      ...hues.map((hue) => ({
        ink: `hue-${hue}-ink`,
        mark: `hue-${hue}-dot`,
        tint: `hue-${hue}-tint`,
        line: `hue-${hue}-line`,
      })),
      ...kinds.map((kind) => ({
        ink: `type-${kind}-ink`,
        mark: `type-${kind}-dot`,
        tint: `type-${kind}-tint`,
        line: `type-${kind}-line`,
      })),
      ...statuses.map((status) => ({
        ink: `status-${status}-fg`,
        mark: `status-${status}-icon`,
        tint: `status-${status}-bg`,
        line: `status-${status}-border`,
      })),
    ]
    const on = (theme: keyof typeof themes, fg: string, bg: string) =>
      contrast(paint(theme, `--${fg}`), paint(theme, `--${bg}`))
    for (const { ink, mark, tint, line } of tones) {
      for (const theme of ['light', 'dark'] as const) {
        // The label and the mark are one ink, so the mark reads as well as the label.
        expect(paint(theme, `--${mark}`), `${theme} --${mark} is --${ink}`).toEqual(
          paint(theme, `--${ink}`),
        )
      }
      // Dark mode has one neutral fill and line for every tone: the hue is only in the ink.
      expect(resolve(dark, `--${tint}`)).toBe(resolve(dark, '--badge-tint'))
      expect(resolve(dark, `--${line}`)).toBe(resolve(dark, '--badge-line'))
    }
    // The lowest numbers 6.3 quotes.
    expect(Math.min(...tones.map(({ ink, tint }) => on('light', ink, tint)))).toBe(7.3)
    expect(Math.min(...tones.map(({ ink, tint }) => on('dark', ink, tint)))).toBe(9.5)
  })

  it('reproduces the contract numbers it quotes (appendix B method)', () => {
    const on = (theme: keyof typeof themes, fg: string, bg: string) =>
      contrast(paint(theme, `--${fg}`), paint(theme, `--${bg}`))
    expect(on('light', 'foreground', 'background')).toBe(18.1)
    expect(on('light', 'input', 'background')).toBe(3.1)
    // Heed blue (6.1): the main button, the ring and the link ink, light then dark.
    expect([
      on('light', 'primary-foreground', 'primary'),
      on('dark', 'primary-foreground', 'primary'),
    ]).toEqual([6.1, 4.7])
    expect([on('light', 'ring', 'background'), on('dark', 'ring', 'background')]).toEqual([
      6.1, 9.0,
    ])
    expect([on('light', 'brand-ink', 'background'), on('dark', 'brand-ink', 'background')]).toEqual(
      [7.0, 9.0],
    )
    expect([on('light', 'brand-ink', 'sidebar'), on('dark', 'brand-ink', 'sidebar')]).toEqual([
      6.5, 9.4,
    ])
    const hex = (rgb: Rgb) =>
      `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
    expect([hex(paint('light', '--primary')), hex(paint('dark', '--primary'))]).toEqual([
      '#2c5dbd',
      '#4170cb',
    ])
    expect([hex(paint('light', '--brand-ink')), hex(paint('dark', '--brand-ink'))]).toEqual([
      '#2855ad',
      '#94b8f8',
    ])
    expect([hex(paint('light', '--selected')), hex(paint('dark', '--selected'))]).toEqual([
      '#e1ecff',
      '#1f2734',
    ])
  })

  it('keeps the logo, counts and the launcher out of the accent: ink stays the old main button', () => {
    expect(resolve(light, '--ink')).toBe('oklch(0.24 0.02 270)')
    expect(resolve(dark, '--ink')).toBe('oklch(0.93 0.004 270)')
  })
})

describe('two line weights (contract 8.12)', () => {
  it('draws data lighter than structure, and both stay decorative', () => {
    const page = paint('light', '--background')
    const data = contrast(paint('light', '--border-subtle'), page)
    const structure = contrast(paint('light', '--border'), page)
    expect([data, structure]).toEqual([1.1, 1.2])
    // Dark keeps the order: white at 6 percent inside data, at 9 percent for structure.
    expect([dark['--border-subtle'], dark['--border']]).toEqual([
      'oklch(1 0 0 / 6%)',
      'oklch(1 0 0 / 9%)',
    ])
  })
})

describe('the header height the lists scroll under (hooks/use-header-height.ts)', () => {
  // Read as text: the hook belongs to the web build, this test to the node one.
  const source = readFileSync(
    fileURLToPath(new URL('../../src/web/hooks/use-header-height.ts', import.meta.url)),
    'utf8',
  )
  const constant = (name: string) =>
    Number(new RegExp(`export const ${name} = (\\d+)`).exec(source)?.[1])
  const px = (value: string | undefined) => Number(/^([\d.]+)rem$/.exec(value ?? '')?.[1]) * 16

  it('is the --header-height token, from 768 wide and on a phone', () => {
    expect(constant('HEADER_HEIGHT')).toBe(px(wide['--header-height']))
    expect(constant('HEADER_HEIGHT_PHONE')).toBe(px(light['--header-height']))
  })
})

describe('the library columns use the widths of the --column-* tokens (contract 8.1)', () => {
  // Read as text: columns.ts belongs to the web build, this test to the node one.
  const source = readFileSync(
    fileURLToPath(new URL('../../src/web/components/library/columns.ts', import.meta.url)),
    'utf8',
  )
  const px = (name: string) => Number(/^([\d.]+)rem$/.exec(light[`--${name}`] ?? '')?.[1]) * 16
  const specs = [
    ...source.matchAll(/(\w+): \{\s*title: '[^']+',\s*width: (\d+),\s*widthClass: 'w-([\w-]+)'/g),
  ]
  const constant = (name: string) =>
    Number(new RegExp(`export const ${name} = (\\d+)`).exec(source)?.[1])

  it('finds every column', () => {
    expect(specs.map(([, id]) => id)).toEqual([
      'domain',
      'about',
      'kind',
      'status',
      'until',
      'owner',
      'starts',
      'checked',
      'review',
      'version',
    ])
  })

  it.each(specs.map(([, id, width, token]) => [id, Number(width), token ?? ''] as const))(
    '%s is %d wide, like --%s',
    (_, width, token) => {
      expect(px(token)).toBe(width)
    },
  )

  it('keeps the title minimum, the checkbox column and the row button', () => {
    expect(px('column-title-min')).toBe(constant('TITLE_MIN_WIDTH'))
    expect(px('column-select')).toBe(constant('SELECT_WIDTH'))
    expect(px('row-button-width')).toBe(constant('ROW_BUTTON_WIDTH'))
  })
})

describe('the catalogue columns use the widths of the --column-* tokens (contract 5)', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../../src/web/components/catalogue/columns.ts', import.meta.url)),
    'utf8',
  )
  const px = (name: string) => Number(/^([\d.]+)rem$/.exec(light[`--${name}`] ?? '')?.[1]) * 16
  const specs = [
    ...source.matchAll(/(\w+): \{\s*title: '[^']+',\s*width: (\d+),\s*widthClass: 'w-([\w-]+)'/g),
  ]
  const constant = (name: string) =>
    Number(new RegExp(`export const ${name} = (\\d+)`).exec(source)?.[1])

  it('finds every column', () => {
    expect(specs.map(([, id]) => id)).toEqual(['domain', 'context', 'status', 'changed'])
  })

  it.each(specs.map(([, id, width, token]) => [id, Number(width), token ?? ''] as const))(
    '%s is %d wide, like --%s',
    (_, width, token) => {
      expect(px(token)).toBe(width)
    },
  )

  it('keeps the library title minimum for Name', () => {
    expect(px('column-title-min')).toBe(constant('NAME_MIN_WIDTH'))
  })
})

describe('the proposal columns use the widths of the --column-* tokens', () => {
  // Read as text: proposal-columns.ts belongs to the web build, this test to the node one.
  const source = readFileSync(
    fileURLToPath(
      new URL('../../src/web/components/proposals/proposal-columns.ts', import.meta.url),
    ),
    'utf8',
  )
  const px = (name: string) => Number(/^([\d.]+)rem$/.exec(light[`--${name}`] ?? '')?.[1]) * 16
  const specs = [
    ...source.matchAll(/(\w+): \{ title: '[^']+', width: (\d+), widthClass: 'w-([\w-]+)'/g),
  ]

  it('finds every column', () => {
    expect(specs.map(([, id]) => id)).toEqual(['change', 'status', 'domain', 'due', 'updated'])
  })

  it.each(specs.map(([, id, width, token]) => [id, Number(width), token ?? ''] as const))(
    '%s is %d wide, like --%s',
    (_, width, token) => {
      expect(px(token)).toBe(width)
    },
  )
})

describe('the gap columns use the widths of the --column-* tokens', () => {
  // Read as text: gap-columns.ts belongs to the web build, this test to the node one.
  const source = readFileSync(
    fileURLToPath(new URL('../../src/web/components/gaps/gap-columns.ts', import.meta.url)),
    'utf8',
  )
  const px = (name: string) => Number(/^([\d.]+)rem$/.exec(light[`--${name}`] ?? '')?.[1]) * 16
  const specs = [
    ...source.matchAll(/(\w+): \{\s*title: '[^']+',\s*width: (\d+),\s*widthClass: 'w-([\w-]+)'/g),
  ]

  it('finds every column of the gaps and of the topic counts', () => {
    expect(specs.map(([, id]) => id)).toEqual([
      'type',
      'status',
      'domain',
      'reports',
      'noItemCalls',
      'lastSeen',
      'domain',
      'calls',
      'noItemCalls',
      'share',
    ])
  })

  it.each(specs.map(([, id, width, token]) => [id, Number(width), token ?? ''] as const))(
    '%s is %d wide, like --%s',
    (_, width, token) => {
      expect(px(token)).toBe(width)
    },
  )
})

describe('the chart ramp reads against the page (contract 7.1, 11)', () => {
  for (const theme of ['light', 'dark'] as const) {
    it.each(['chart-1', 'chart-2'])(
      `${theme}: --%s on --background and --popover, needs 3`,
      (fg) => {
        for (const bg of ['background', 'popover'])
          expect(contrast(paint(theme, `--${fg}`), paint(theme, `--${bg}`))).toBeGreaterThanOrEqual(
            3,
          )
      },
    )
  }
})

describe('the To review queue columns use the widths of the --column-* tokens', () => {
  const px = (name: string) => Number(/^([\d.]+)rem$/.exec(light[`--${name}`] ?? '')?.[1]) * 16

  it('lists every column', () => {
    expect([...queueColumnIds]).toEqual(['change', 'status', 'checks', 'risk', 'due', 'proposer'])
  })

  it.each(queueColumnIds.map((id) => [id, queueColumnSpecs[id]] as const))(
    '%s is as wide as the token behind its width class',
    (_, spec) => {
      expect(px(spec.widthClass.replace(/^w-/, ''))).toBe(spec.width)
    },
  )
})
