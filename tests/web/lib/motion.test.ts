/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The motion rules as checks (docs/design/motion.md): every duration and easing comes from the tokens in
// index.css, so reduced motion is one rule there, not an override on each component.

const ROOT = fileURLToPath(new URL('../../../src/web', import.meta.url))
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
const source = files(ROOT).map((path) => ({
  file: relative(ROOT, path),
  text: readFileSync(path, 'utf8'),
}))

function hits(re: RegExp, allowed: (line: string, file: string) => boolean = () => false) {
  return source.flatMap(({ file, text }) =>
    text.split('\n').flatMap((line, i) => {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
      return [...line.matchAll(g)]
        .filter(() => !allowed(line, file))
        .map((m) => `${file}:${i + 1} ${m[0]}`)
    }),
  )
}

describe('motion tokens', () => {
  it('uses the duration tokens, never a raw duration', () => {
    expect(hits(/\b(duration|delay)-\d+\b/)).toEqual([])
  })
  it('never transitions everything, never eases in, never scales from nothing', () => {
    expect(hits(/\btransition-all\b|\bease-in\b(?!-)|\bscale-0\b|\bease-\[/)).toEqual([])
  })
  it('keeps linear for loops and progress, never for movement', () => {
    expect(hits(/\bease-linear\b/)).toEqual([])
  })
  it('lets the tokens carry reduced motion, with no transition overrides of their own', () => {
    expect(hits(/motion-reduce:transition-none|motion-reduce:shimmer-none/)).toEqual([])
    // An animate-none override is only for a component's own keyframes.
    expect(hits(/motion-reduce:animate-none/, (line) => line.includes('animate-['))).toEqual([])
  })
  it('runs its own keyframes only for the countdown and the read fill', () => {
    expect(hits(/animate-\[(?!countdown_|readfill_)[^\]]*\]/)).toEqual([])
  })
})

describe('the motion of small moments', () => {
  const read = (file: string) => source.find((s) => s.file === file)?.text ?? ''
  const css = readFileSync(join(ROOT, 'styles/index.css'), 'utf8')

  it('opens and shuts every fold through the collapsible, which moves', () => {
    expect(read('components/ui/collapsible.tsx')).toContain("'fold-motion'")
    // A fold of its own (a button and a panel hidden while shut) snaps: use the collapsible.
    expect(hits(/(?<![-\w])hidden=\{!\w+\}/)).toEqual([])
  })
  it('turns a copy icon into a tick in one place, so it moves', () => {
    expect(hits(/\?\s*<CheckIcon\b[^>]*\/>\s*:\s*<CopyIcon\b/)).toEqual([])
    expect(hits(/\bsetCopied\b/, (_, file) => file === 'components/heed/copied-icon.tsx')).toEqual(
      [],
    )
  })
  it('lets rows leave and arrive through one presence pattern (lib/presence.ts)', () => {
    // A row's own leaving classes or its own timer drift from the 150ms and 220ms of the doc.
    expect(hits(/\bdata-leaving:|\bDELETE_MS\b/)).toEqual([])
  })
  it('moves a sheet on the panel curve, by a token distance', () => {
    const sheet = read('components/ui/sheet.tsx')
    expect(sheet).toContain('sheet-motion')
    expect(sheet).not.toMatch(/translate-[xy]-\d|ease-move/)
  })
  it('runs toasts on the tokens, not on the times of their library', () => {
    expect(css).toMatch(/\[data-sonner-toast\][^{]*\{[^}]*transition-duration: var\(--dur-3\)/)
    expect(css).toMatch(/\[data-removed='true'\][^{]*\{[^}]*transition-duration: var\(--dur-2\)/)
  })
})
