import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { repoRoot } from './pages.ts'

/*
  The web app's tokens for the site, read from src/web/styles/tokens.css when the site is built, so
  the two never drift. Only the names src/styles/theme.css reads come over; a name tokens.css no
  longer has stops the build. Starlight marks the dark theme with `data-theme` on the root, and
  paper is always light, as in the app.
*/

const themed = [
  'background',
  'foreground',
  'primary',
  'primary-foreground',
  'muted',
  'muted-foreground',
  'border',
  'input',
  'ring',
  'band',
  'scrollbar-thumb',
]
const fixed = [
  'font-sans',
  'text-reading',
  'text-hero',
  'leading-hero',
  'tracking-hero',
  'radius',
  'radius-sm',
  'radius-md',
  'radius-frame',
  'spacing-bar',
]

/** The inside of every rule with this selector: its braces matched, its comments gone. */
function rulesOf(css: string, selector: string): string {
  const parts: string[] = []
  for (
    let at = css.indexOf(`${selector} {`);
    at !== -1;
    at = css.indexOf(`${selector} {`, at + 1)
  ) {
    const open = css.indexOf('{', at)
    let depth = 1
    let i = open + 1
    for (; depth > 0 && i < css.length; i++) depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0
    parts.push(css.slice(open + 1, i - 1))
  }
  return parts.join('\n')
}

const declarations = (body: string) =>
  new Map(
    [...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1]!.slice(2), m[2]!.trim()]),
  )

/** The stylesheet of tokens the theme reads. */
export function tokensCss(source: string): string {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const light = declarations(rulesOf(css, ':root'))
  const dark = declarations(rulesOf(css, '.dark'))
  const theme = new Map([
    ...declarations(rulesOf(css, '@theme')),
    ...declarations(rulesOf(css, '@theme inline')),
  ])
  const pick = (names: readonly string[], from: Map<string, string>) =>
    names.flatMap((name) => (from.has(name) ? [`  --${name}: ${from.get(name)};`] : []))
  const missing = [...themed, ...fixed].filter((name) => !light.has(name) && !theme.has(name))
  if (missing.length) throw new Error(`tokens.css has no ${missing.join(', ')}`)
  return [
    ':root {',
    ...pick(themed, light),
    ...pick(fixed, theme),
    ...pick(fixed, light),
    '}',
    '@media not print {',
    "  :root[data-theme='dark'] {",
    ...pick(themed, dark).map((line) => `  ${line}`),
    '  }',
    '}',
    '',
  ].join('\n')
}

const id = 'virtual:heed-tokens.css'

/** Serves the tokens as a stylesheet of their own, in `npm run dev` and in the build. */
export function heedTokens(): Plugin {
  return {
    name: 'heed-tokens',
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load(source) {
      if (source !== `\0${id}`) return undefined
      const file = join(repoRoot, 'src/web/styles/tokens.css')
      this.addWatchFile(file)
      return tokensCss(readFileSync(file, 'utf8'))
    },
  }
}
