import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { webClassRules } from '../../eslint.class-rules.js'
import { contrast, over, rgbToOklab, toRgb } from './contrast.ts'

/**
 * The token test of the web app (design contract v2, sections 2 and 9). It reads
 * src/web/styles/tokens.css, checks that every token exists in light and dark, and recomputes
 * every contrast pair from the values in the file: text 4.5:1; controls, field borders, the
 * review marks and the icons that carry meaning 3:1. Both themes. It also holds the file to the
 * small system: six text sizes, two text greys, five corners, and one amber, one green and one red.
 */

const css = readFileSync(
  fileURLToPath(new URL('../../src/web/styles/tokens.css', import.meta.url)),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

/** The declarations of the first block that `header` opens, or of every one with `all`. */
function block(header: string, all = false): Record<string, string> {
  const start = css.indexOf(`${header} {`)
  if (start === -1) throw new Error(`tokens.css has no "${header}" block`)
  const tokens = declarations(start)
  if (!all) return tokens
  for (
    let at = css.indexOf(`${header} {`, start + 1);
    at !== -1;
    at = css.indexOf(`${header} {`, at + 1)
  )
    Object.assign(tokens, declarations(at))
  return tokens
}

function declarations(start: number): Record<string, string> {
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
const scales = block('@theme', true)
const themes = { light, dark } as const
type Theme = keyof typeof themes

/** The colour a token paints in a theme; a chip's at hue `h`. A token may name another, and
 *  `--caution/8` is a soft fill: the colour at 8 percent over the page. */
function paint(name: string, mode: Theme, h = 0): ReturnType<typeof toRgb> {
  const tokens = themes[mode]
  const soft = /^(--[a-z0-9-]+)\/(\d+)$/.exec(name)
  if (soft) return over(paint(soft[1]!, mode), Number(soft[2]) / 100, paint('--background', mode))
  const chip = /^--chip(-foreground)?$/.exec(name)
  if (chip) {
    const [l, c] = chip[1]
      ? [tokens['--chip-ink-l'], tokens['--chip-ink-c']]
      : [tokens['--chip-l'], tokens['--chip-c']]
    return toRgb(`oklch(${l} ${c} ${h})`)
  }
  const value = tokens[name]
  if (value === undefined) throw new Error(`Missing token ${name} in ${mode}`)
  const named = /^var\((--[a-z0-9-]+)\)$/.exec(value)
  return named ? paint(named[1]!, mode) : toRgb(value)
}

/** The hand-written stylesheets of src/web: everything but the token file. */
const webDir = fileURLToPath(new URL('../../src/web', import.meta.url))
const stylesheets = (readdirSync(webDir, { recursive: true }) as string[])
  .filter((file) => file.endsWith('.css') && !file.endsWith('tokens.css'))
  .map((file) => ({
    file,
    css: readFileSync(join(webDir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
  }))
/** Every value a stylesheet gives the properties `property` matches, as `file: value`. */
function valuesOf(property: RegExp): string[] {
  return stylesheets.flatMap(({ file, css: sheet }) =>
    [...sheet.matchAll(/([a-z-]+):\s*([^;{}]+);/g)]
      .filter(([, name]) => property.test(name!))
      .map(([, , value]) => `${file}: ${value!.trim()}`),
  )
}

/** The colours of shadcn's theme that the app keeps, and the ones it adds. */
const surfaces = ['background', 'card', 'popover', 'muted', 'accent', 'secondary', 'sidebar']
const marks = ['add', 'del', 'fmt', 'link', 'move'] as const
/** The marks with a stronger fill for a changed word inside a changed line of the Text diff. */
const words = ['add', 'del'] as const
/** The inks of marked text (components/heed/mark.tsx) and the caution icon and line beside them. */
const inks = ['caution', 'good', 'destructive'] as const
/** Where marked text sits: the page, a card, a popover, and a selected or hovered row. */
const markedOn = ['background', 'card', 'popover', 'muted', 'accent']
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
    'border',
    'input',
    'ring',
    'foreground',
    'band',
    'sidebar-foreground',
    'sidebar-primary',
    'sidebar-primary-foreground',
    'sidebar-accent',
    'sidebar-accent-foreground',
    'sidebar-border',
    'sidebar-ring',
  ],
  ...marks.flatMap((mark) => [`mark-${mark}`, `mark-${mark}-line`]),
  ...words.map((mark) => `mark-${mark}-word`),
  ...inks,
]

describe('src/web/styles/tokens.css holds every token of the design contract', () => {
  it.each(colours)('--%s is set for light and for dark', (name) => {
    expect(light[`--${name}`], 'light').toBeDefined()
    // A token that names another follows that one into dark.
    if (!light[`--${name}`]!.startsWith('var('))
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

  it('keeps one bar height and the three widths (contract 0 and 2)', () => {
    expect([theme['--spacing-bar'], theme['--spacing-tool']]).toEqual(['3rem', '2.5rem'])
    expect([
      theme['--container-reading'],
      theme['--container-sheet'],
      theme['--container-wide'],
    ]).toEqual(['60ch', '56rem', '80rem'])
  })
})

describe('six text sizes, one line height each (contract 2.3)', () => {
  const steps = {
    xs: ['0.75rem', '1rem'],
    sm: ['0.875rem', '1.25rem'],
    base: ['1rem', '1.5rem'],
    xl: ['1.25rem', '1.75rem'],
    '2xl': ['1.5rem', '1.875rem'],
    '3xl': ['1.875rem', '2.375rem'],
  }

  it("clears Tailwind's scale and names the six steps, none between them", () => {
    expect(css).toMatch(/--text-\*: initial;/)
    const sizes = Object.entries(scales).filter(([name]) => name.startsWith('--text-'))
    expect(Object.fromEntries(sizes)).toEqual(
      Object.fromEntries(
        Object.entries(steps).flatMap(([step, [size, line]]) => [
          [`--text-${step}`, size],
          [`--text-${step}--line-height`, line],
        ]),
      ),
    )
    expect(Object.keys(light).filter((name) => /^--(rte-)?text-/.test(name))).toEqual([])
  })

  it('sets every size of the hand-written stylesheets on a step', () => {
    const step = /: var\(--text-(?:xs|sm|base|xl|2xl|3xl)\)$/
    expect(valuesOf(/^font-size$/).filter((value) => !step.test(value))).toEqual([])
  })
})

describe('two text greys, ink and muted (contract 2.1)', () => {
  it.each(['light', 'dark'] as const)(
    '%s: every text colour of the theme is one of the two',
    (mode) => {
      const ink = paint('--foreground', mode)
      for (const name of [
        'card-foreground',
        'popover-foreground',
        'secondary-foreground',
        'accent-foreground',
        'sidebar-foreground',
        'sidebar-accent-foreground',
      ])
        expect(paint(`--${name}`, mode), name).toEqual(ink)
    },
  )
})

describe('five corners (contract 2.2)', () => {
  it("clears Tailwind's scale and names the five, with the Ask composer's 14 px", () => {
    expect(css).toMatch(/--radius-\*: initial;/)
    const corners = Object.entries(theme).filter(([name]) => name.startsWith('--radius-'))
    expect(Object.fromEntries(corners)).toEqual({
      '--radius-frame': '0px',
      '--radius-xs': '4px',
      '--radius-sm': '6px',
      '--radius-md': '8px',
      '--radius-full': 'calc(infinity * 1px)',
      // The rules by name (contract 0): a conversational surface is a control's 8 px, and the Ask
      // composer, the one box a chat is typed in, the one soft thing at 14 px.
      '--radius-surface': 'var(--radius-md)',
      '--radius-composer': '14px',
    })
    expect(Object.keys(light).filter((name) => /^--(rte-)?radius/.test(name))).toEqual([])
  })

  it('rounds every corner of the hand-written stylesheets on a step', () => {
    const step = /: (?:0|var\(--radius-(?:frame|xs|sm|md|full|surface|composer)\))$/
    expect(valuesOf(/radius$/).filter((value) => !step.test(value))).toEqual([])
  })
})

describe('one colour per meaning, and soft fills by rule (contract 2.1)', () => {
  /** Fills with a palette of their own: the review marks, the Text diff, chips and code. */
  const fill = /^--(?:mark-[a-z]+(?:-word)?|diff-(?:add|del)|chip.*|code-.*)$/
  const hues = { amber: [40, 100], green: [120, 175], red: [-35, 35] } as const

  it.each(['light', 'dark'] as const)('%s: one amber, one green and one red', (mode) => {
    const found: Record<string, string[]> = { amber: [], green: [], red: [] }
    for (const [name, value] of Object.entries(themes[mode])) {
      if (fill.test(name) || /^(?:var|color-mix|repeating|radial)\(/.test(value)) continue
      let rgb
      try {
        rgb = toRgb(value)
      } catch {
        continue
      }
      const [, a, b] = rgbToOklab(rgb)
      if (Math.hypot(a, b) < 0.1) continue
      const h = (Math.atan2(b, a) * 180) / Math.PI
      for (const [hue, [from, to]] of Object.entries(hues))
        if (h >= from && h <= to) found[hue]!.push(name)
    }
    expect(found).toEqual({ amber: ['--caution'], green: ['--good'], red: ['--destructive'] })
  })

  it('draws the lines of the review marks and the Text diff in those three', () => {
    expect(light['--mark-add-line']).toBe('var(--good)')
    expect(light['--mark-link-line']).toBe('var(--caution)')
    expect(light['--mark-del-line']).toBe('var(--destructive)')
    expect(light['--diff-add-line']).toBe('var(--good)')
  })

  it('gives each colour one name, a soft fill none, and keeps one band', () => {
    const second = /^--(?:color-)?(?:(?:caution|good|destructive|band)-|row-hover$)/
    expect(Object.keys({ ...light, ...theme }).filter((name) => second.test(name))).toEqual([])
    expect(light['--sidebar']).toBe('var(--band)')
    expect(paint('--band', 'light')).toEqual(toRgb('#fafafa'))
    expect(paint('--band', 'dark')).toEqual(toRgb('#171717'))
  })
})

describe('the Ask type (contract 2.3)', () => {
  it('sets a question and an answer at 16 px on 26 px lines, as the chat apps people know', () => {
    // text-base is Tailwind's 16 px; the line height is the chat's own.
    expect(css).toMatch(/--leading-chat: 1\.625rem;/)
  })
})

describe('the motion tokens (docs/design/motion.md)', () => {
  it('has the durations, distances and curves of the token table', () => {
    expect(
      ['0', '1', '2', '3', '4', 'highlight', 'fade'].map((step) => light[`--dur-${step}`]),
    ).toEqual(['0ms', '90ms', '150ms', '220ms', '320ms', '600ms', '150ms'])
    expect(light['--ask-word-fade']).toBe('var(--dur-fade)')
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
      '--ask-word-fade': '0ms',
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
    ...['background', 'card', 'popover', 'muted'].map((bg): Pair => ({
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
    ...words.map((mark): Pair => ({
      what: 'changed words in a changed line',
      fg: 'foreground',
      bg: `mark-${mark}-word`,
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
    ...words.map((mark): Pair => ({
      what: 'mark line on a changed word',
      fg: `mark-${mark}-line`,
      bg: `mark-${mark}-word`,
      min: 3,
    })),
    // Marked text (components/heed/mark.tsx): one colour per meaning, as text, 4.5:1, which also
    // carries the triangle beside it and the 2 px underline of words that differ.
    ...inks.flatMap((fg) =>
      markedOn.map((bg): Pair => ({ what: 'marked text', fg, bg, min: 4.5 })),
    ),
    // A soft fill is its colour at 8 percent: a Conflict answer in the quick view sits on the
    // amber one, a good note on the green one, and their words and ink keep their contrast there.
    ...(['caution', 'good'] as const).flatMap((hue) =>
      (['foreground', 'muted-foreground', hue] as const).map((fg): Pair => ({
        what: 'text on a soft fill',
        fg,
        bg: `${hue}/8`,
        min: 4.5,
      })),
    ),
    ...(['add', 'del'] as const).map((side): Pair => ({
      what: 'Text diff ink',
      fg: `diff-${side}-ink`,
      bg: `diff-${side}`,
      min: 4.5,
    })),
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
