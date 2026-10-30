import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { webClassRules } from '../../eslint.class-rules.js'
import { contrast, toRgb } from './contrast.ts'

/**
 * The token test of the new web app (design contract v2, sections 2 and 9). It reads
 * src/web/styles/tokens.css, checks that every token exists in light and dark, and recomputes
 * every contrast pair from the values in the file: text 4.5:1; controls, field borders, the
 * review marks and the icons that carry meaning 3:1. Both themes.
 */

const css = readFileSync(
  fileURLToPath(new URL('../../src/web/styles/tokens.css', import.meta.url)),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

/** The declarations of the first block that `header` opens. */
function block(header: string): Record<string, string> {
  const start = css.indexOf(`${header} {`)
  if (start === -1) throw new Error(`tokens.css has no "${header}" block`)
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
  const tokens: Record<string, string> = {}
  for (const [, name, value] of css.slice(start, end).matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g))
    if (name && value) tokens[name] = value.trim()
  return tokens
}

const light = block(':root')
const dark = { ...light, ...block('.dark') }
const reduced = block('@media (prefers-reduced-motion: reduce)')
const theme = block('@theme inline')
const themes = { light, dark } as const
type Theme = keyof typeof themes

/** The colour a token paints in a theme; a chip's at hue `h`. */
function paint(name: string, mode: Theme, h = 0): ReturnType<typeof toRgb> {
  const tokens = themes[mode]
  const chip = /^--chip(-foreground)?$/.exec(name)
  if (chip) {
    const [l, c] = chip[1]
      ? [tokens['--chip-ink-l'], tokens['--chip-ink-c']]
      : [tokens['--chip-l'], tokens['--chip-c']]
    return toRgb(`oklch(${l} ${c} ${h})`)
  }
  const value = tokens[name]
  if (value === undefined) throw new Error(`Missing token ${name} in ${mode}`)
  return toRgb(value)
}

/** The colours of shadcn's theme that the app keeps, and the ones it adds. */
const surfaces = ['background', 'card', 'popover', 'muted', 'accent', 'secondary', 'sidebar']
const marks = ['add', 'del', 'fmt', 'link', 'move'] as const
const colours = [
  ...surfaces,
  ...[
    'card-foreground',
    'popover-foreground',
    'primary',
    'primary-foreground',
    'secondary-foreground',
    'muted-foreground',
    'accent-foreground',
    'destructive',
    'border',
    'input',
    'ring',
    'foreground',
    'ok',
    'warn',
    'idle',
    'sidebar-foreground',
    'sidebar-primary',
    'sidebar-primary-foreground',
    'sidebar-accent',
    'sidebar-accent-foreground',
    'sidebar-border',
    'sidebar-ring',
  ],
  ...marks.flatMap((mark) => [`mark-${mark}`, `mark-${mark}-line`]),
]

describe('src/web/styles/tokens.css holds every token of the design contract', () => {
  it.each(colours)('--%s is set for light and for dark', (name) => {
    expect(light[`--${name}`], 'light').toBeDefined()
    expect(block('.dark')[`--${name}`], 'dark').toBeDefined()
  })

  it('keeps the chart greys the same in both themes', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(light[`--chart-${n}`]).toBeDefined()
      expect(block('.dark')[`--chart-${n}`]).toBeUndefined()
    }
  })

  it('gives every colour a Tailwind name, so a class names it, never its value', () => {
    for (const name of [...colours, 'chart-1', 'chip', 'chip-foreground'])
      expect(theme[`--color-${name}`], name).toBeDefined()
  })

  it('keeps Heed blue as the one primary, and the contrast changes to shadcn neutral', () => {
    expect([light['--primary'], light['--ring'], light['--sidebar-primary']]).toEqual([
      '#2c5dbd',
      '#2c5dbd',
      '#2c5dbd',
    ])
    expect([dark['--primary'], dark['--ring'], dark['--sidebar-primary']]).toEqual([
      '#7aa2f0',
      '#7aa2f0',
      '#7aa2f0',
    ])
    expect([light['--muted-foreground'], dark['--muted-foreground']]).toEqual(['#666', '#a3a3a3'])
    expect([light['--input'], dark['--input']]).toEqual(['#8f8f8f', '#6b6b6b'])
  })

  it('keeps the three radius rules, one bar height and the three widths (contract 0 and 2)', () => {
    expect(light['--radius']).toBe('0.625rem')
    expect(theme['--radius-frame']).toBe('0px')
    expect(theme['--radius-surface']).toBe('var(--radius)')
    expect(theme['--radius-sm']).toBe('calc(var(--radius) * 0.6)')
    expect(theme['--radius-md']).toBe('calc(var(--radius) * 0.8)')
    expect(theme['--radius-lg']).toBe('var(--radius)')
    expect(theme['--radius-xl']).toBe('calc(var(--radius) * 1.4)')
    expect([theme['--spacing-bar'], theme['--spacing-tool']]).toEqual(['3rem', '2.5rem'])
    expect([
      theme['--container-reading'],
      theme['--container-sheet'],
      theme['--container-wide'],
    ]).toEqual(['60ch', '56rem', '80rem'])
  })
})

describe('the motion tokens (docs/design/motion.md)', () => {
  it('has the durations, distances and curves of the token table', () => {
    expect(
      ['0', '1', '2', '3', '4', 'highlight', 'fade'].map((step) => light[`--dur-${step}`]),
    ).toEqual(['0ms', '90ms', '150ms', '220ms', '320ms', '600ms', '150ms'])
    expect([light['--stagger'], light['--dist-1'], light['--dist-2'], light['--dist-3']]).toEqual([
      '30ms',
      '4px',
      '8px',
      '16px',
    ])
    const curves = block('@theme')
    expect(curves['--ease-out']).toBe('cubic-bezier(0.23, 1, 0.32, 1)')
    expect(curves['--ease-move']).toBe('cubic-bezier(0.77, 0, 0.175, 1)')
    expect(curves['--ease-panel']).toBe('cubic-bezier(0.32, 0.72, 0, 1)')
    expect(curves['--default-transition-duration']).toBe('var(--dur-2)')
    expect(curves['--default-transition-timing-function']).toBe('var(--ease-out)')
  })

  it('carries reduced motion in one block: no movement, no stagger, the fade kept at 90ms', () => {
    expect(reduced).toEqual({
      '--dur-1': '0ms',
      '--dur-2': '0ms',
      '--dur-3': '0ms',
      '--dur-4': '0ms',
      '--dur-highlight': '0ms',
      '--dur-fade': '90ms',
      '--stagger': '0ms',
      '--dist-1': '0px',
      '--dist-2': '0px',
      '--dist-3': '0px',
      '--tw-animation-duration': '0ms',
    })
    expect(css).toMatch(
      /\.animate-spin,\s*\.animate-pulse,\s*\.animate-ping\s*\{\s*animation: none;/,
    )
  })
})

describe('the layers (contract 2.5)', () => {
  const layers = [...css.matchAll(/@utility (z-[a-z-]+) \{\s*z-index: (\d+);/g)].map(
    ([, name, value]) => [name!, Number(value)] as const,
  )

  it('names every layer, lowest first', () => {
    expect(layers.map(([name]) => name)).toEqual([
      'z-base',
      'z-raised',
      'z-header',
      'z-site-header',
      'z-dock',
      'z-overlay',
      'z-skip',
    ])
    const values = layers.map(([, value]) => value)
    expect(values).toEqual([...values].sort((a, b) => a - b))
  })

  it('is the list the numeric-layer lint message offers', () => {
    const message = webClassRules.find((rule) => rule.id === 'numeric-z')?.message ?? ''
    for (const [name] of layers) expect(message, name).toContain(name)
  })
})

describe('contrast pairs meet their minimum in both themes', () => {
  type Pair = { what: string; fg: string; bg: string; min: number }
  const pairs: Pair[] = [
    // Text, 4.5:1
    ...surfaces.flatMap((bg): Pair[] => [
      { what: 'text', fg: 'foreground', bg, min: 4.5 },
      { what: 'muted text', fg: 'muted-foreground', bg, min: 4.5 },
    ]),
    { what: 'text', fg: 'muted-foreground', bg: 'sidebar-accent', min: 4.5 },
    { what: 'text', fg: 'card-foreground', bg: 'card', min: 4.5 },
    { what: 'text', fg: 'popover-foreground', bg: 'popover', min: 4.5 },
    { what: 'text', fg: 'secondary-foreground', bg: 'secondary', min: 4.5 },
    { what: 'text', fg: 'accent-foreground', bg: 'accent', min: 4.5 },
    { what: 'text', fg: 'sidebar-foreground', bg: 'sidebar', min: 4.5 },
    { what: 'text', fg: 'sidebar-accent-foreground', bg: 'sidebar-accent', min: 4.5 },
    { what: 'main button', fg: 'primary-foreground', bg: 'primary', min: 4.5 },
    { what: 'sidebar button', fg: 'sidebar-primary-foreground', bg: 'sidebar-primary', min: 4.5 },
    ...['background', 'card', 'popover', 'sidebar'].map((bg): Pair => ({
      what: 'link',
      fg: 'primary',
      bg,
      min: 4.5,
    })),
    ...['background', 'card', 'popover'].map((bg): Pair => ({
      what: 'error text',
      fg: 'destructive',
      bg,
      min: 4.5,
    })),
    ...marks.map((mark): Pair => ({
      what: 'marked words',
      fg: 'foreground',
      bg: `mark-${mark}`,
      min: 4.5,
    })),
    // Controls, field borders, marks and meaningful icons, 3:1
    ...['background', 'card', 'popover'].map((bg): Pair => ({
      what: 'field border',
      fg: 'input',
      bg,
      min: 3,
    })),
    ...['background', 'card', 'popover', 'sidebar', 'muted'].map((bg): Pair => ({
      what: 'focus ring',
      fg: 'ring',
      bg,
      min: 3,
    })),
    { what: 'focus ring', fg: 'sidebar-ring', bg: 'sidebar', min: 3 },
    ...marks.flatMap((mark): Pair[] => [
      { what: 'mark line on the page', fg: `mark-${mark}-line`, bg: 'background', min: 3 },
      { what: 'mark line on its fill', fg: `mark-${mark}-line`, bg: `mark-${mark}`, min: 3 },
    ]),
    ...['ok', 'warn', 'idle'].flatMap((fg) =>
      ['background', 'card', 'muted', 'accent'].map((bg): Pair => ({
        what: 'freshness and trust',
        fg,
        bg,
        min: 3,
      })),
    ),
  ]

  const cases = (['light', 'dark'] as const).flatMap((mode) =>
    pairs.map((pair) => ({ ...pair, mode })),
  )
  it.each(cases)('$mode: $what, --$fg on --$bg, at least $min', ({ fg, bg, min, mode }) => {
    expect(contrast(paint(`--${fg}`, mode), paint(`--${bg}`, mode))).toBeGreaterThanOrEqual(min)
  })

  it.each(['light', 'dark'] as const)(
    '%s: a chip reads at 4.5:1 at every hue, so any domain hue is safe',
    (mode) => {
      const low = Array.from({ length: 360 }, (_, h) =>
        contrast(paint('--chip-foreground', mode, h), paint('--chip', mode, h)),
      ).filter((ratio) => ratio < 4.5)
      expect(low).toEqual([])
      for (const name of ['metric', 'dimension', 'market', 'term', 'warn'])
        expect(Number(light[`--chip-h-${name}`]), name).toBeLessThan(360)
    },
  )
})
