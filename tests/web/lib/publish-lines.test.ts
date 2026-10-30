import { describe, expect, it } from 'vitest'
import { publishLines } from '@/components/obs/charts'

// The dashed lines Overview's chart draws at each publish: one per bar, and a label above the plot
// only where it has room, so labels never run into each other ("PublishPublished").

const xOf = (i: number) => 28 + i * 20

describe('publishLines', () => {
  it('draws one line per bar, counting publishes that fall on the same bar', () => {
    const lines = publishLines([{ index: 3 }, { index: 3 }, { index: 20 }], xOf, 28, 632)
    expect(lines).toEqual([
      { index: 3, x: 88, label: '2 published', end: false },
      { index: 20, x: 428, label: 'Published', end: false },
    ])
  })

  it('leaves out a label that would run into the one before it, never the line', () => {
    const lines = publishLines(
      [{ index: 10 }, { index: 11 }, { index: 12 }, { index: 16 }],
      xOf,
      28,
      632,
    )
    expect(lines.map((l) => l.index)).toEqual([10, 11, 12, 16])
    expect(lines.map((l) => l.label)).toEqual(['Published', undefined, undefined, 'Published'])
  })

  it('ends a label at its line when it would run past the right edge', () => {
    const [line] = publishLines([{ index: 29 }], xOf, 28, 632)
    expect(line).toMatchObject({ x: 608, label: 'Published', end: true })
  })
})
