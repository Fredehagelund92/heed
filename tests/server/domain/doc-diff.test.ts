import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  changeCount,
  docDiff,
  docMarkdown,
  inlineSegments,
  LCS_CELLS,
  markdownBlocks,
  sequenceDiff,
  sourceDiff,
  valuesIn,
  wordTokens,
  type ChangeBlock,
  type DocSide,
  type Run,
} from '../../../src/domain/doc-diff.ts'

/*
  The review's difference of a suggestion (FR-224), read against the mockup's own review
  examples (apps/mockup/src/data/review.ts): each change told apart by kind, the same way every
  time, and the Source view's line diff (J19).
*/

const side = (patch: Partial<DocSide> = {}): DocSide => ({
  kind: 'note',
  title: 'Units sold excludes test accounts',
  summary:
    'Units sold in Norway leaves out the 312 accounts our teams use to test the webshop. From 29 May 2026 the test accounts of the new app are left out too.',
  body: null,
  where: ['Units sold', 'Norway'],
  validFrom: '2026-01-01',
  validUntil: null,
  reviewDate: '2026-12-01',
  sources: [{ url: 'https://wiki.example/data/definitions/units-sold', quote: null }],
  notToConclude: 'cause not proven',
  ...patch,
})
const textOf = (runs: readonly Run[], which: 'before' | 'after') =>
  runs
    .filter((r) => r.t === 'same' || r.t === 'fmt' || r.t === (which === 'before' ? 'del' : 'add'))
    .map((r) => r.text)
    .join('')
const kinds = (blocks: readonly ChangeBlock[]) => blocks.map((b) => [b.kind, b.field])

describe('the difference of a suggestion, by kind (FR-224)', () => {
  it('marks only the changed words, counts each stretch once, and finds the new link and mention', () => {
    const after = side({
      summary:
        'Units sold in Norway leaves out the 340 accounts our teams use to test the webshop. From 29 May 2026 the test accounts of the new app are left out too.',
      body: 'From 1 October 2026 the 28 accounts the returns team uses to @[test refunds](term:test_account) are left out as well.',
      sources: [{ url: 'https://wiki.example/data/definitions/units-sold-october', quote: null }],
    })
    const diff = docDiff(side(), after)
    expect(diff.mode).toBe('edit')
    expect(diff.counts).toEqual([
      { kind: 'wording', n: 1 },
      { kind: 'link', n: 2 },
      { kind: 'added', n: 1 },
    ])
    const wording = diff.blocks.find((b) => b.kind === 'wording')!
    expect(wording).toMatchObject({ field: 'text', changes: 1, rewrite: false })
    if (!('runs' in wording)) throw new Error('expected runs')
    expect(wording.runs.filter((r) => r.t !== 'same')).toEqual([
      { t: 'del', text: '312' },
      { t: 'add', text: '340' },
    ])
    expect(diff.blocks).toContainEqual({
      kind: 'link',
      field: 'text',
      mention: { target: 'term:test_account', label: 'test refunds', change: 'added' },
    })
    expect(diff.blocks).toContainEqual({
      kind: 'link',
      field: 'sources',
      text: '',
      before: 'https://wiki.example/data/definitions/units-sold',
      after: 'https://wiki.example/data/definitions/units-sold-october',
    })
    expect(diff.unchanged).toEqual(['title', 'kind', 'where', 'when', 'checkDate', 'notToConclude'])
    // What moved: the number, the new date, and the new source page.
    expect(diff.values).toEqual([
      { what: 'number', field: 'text', before: '312', after: '340' },
      { what: 'date', field: 'text', before: null, after: '1 October 2026' },
      { what: 'number', field: 'text', before: null, after: '28' },
      {
        what: 'source',
        field: 'sources',
        before: 'https://wiki.example/data/definitions/units-sold',
        after: 'https://wiki.example/data/definitions/units-sold-october',
      },
    ])
  })

  it('tells formatting from wording: bold, italic and a list that became numbered', () => {
    const before = side({
      summary: 'There are no stores in Norway, so the webshop was the only way to buy there.',
      body: '- Parcels already on their way still arrived.\n- Compare Norway with itself before or after the stop, never across it.',
    })
    const after = side({
      summary: 'There are no stores in Norway, so the webshop was **the only way to buy there**.',
      body: '1. Parcels already on their way still arrived.\n2. Compare Norway with itself before or after the stop, _never across it_.',
    })
    const diff = docDiff(before, after)
    expect(diff.counts).toEqual([{ kind: 'formatting', n: 3 }])
    expect(diff.only).toBe('formatting')
    const changes = diff.blocks.map((b) => (b.kind === 'formatting' ? b.change : null))
    expect(changes).toEqual(
      expect.arrayContaining([
        { what: 'marks', added: ['bold'], removed: [] },
        { what: 'marks', added: ['italic'], removed: [] },
        { what: 'list', was: 'bullet', now: 'number' },
      ]),
    )
    const bold = diff.blocks.find(
      (b) => b.kind === 'formatting' && b.change.what === 'marks' && b.change.added[0] === 'bold',
    )!
    if (!('runs' in bold)) throw new Error('expected runs')
    expect(bold.runs.filter((r) => r.t === 'fmt').map((r) => r.text)).toEqual([
      'the only way to buy there',
    ])
    const list = diff.blocks.find((b) => b.kind === 'formatting' && 'items' in b)
    expect(list).toMatchObject({
      items: [
        'Parcels already on their way still arrived.',
        'Compare Norway with itself before or after the stop, never across it.',
      ],
    })
  })

  it('reads a step moved to the top as a change of order, and says where it came from', () => {
    const steps = [
      'Look at four weeks or more, never one weekend.',
      "Check for a few very large orders. One big order at full price can lift a week's margin.",
      'Compare with the average order value for the same weeks.',
    ]
    const before = side({
      summary: 'Before you explain a jump:',
      body: steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    })
    const moved = [steps[1]!, steps[0]!, steps[2]!]
    const after = side({
      summary: 'Before you explain a jump:',
      body: moved.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    })
    const diff = docDiff(before, after)
    expect(diff.counts).toEqual([{ kind: 'order', n: 1 }])
    expect(diff.only).toBe('order')
    expect(diff.blocks).toEqual([
      {
        kind: 'order',
        field: 'text',
        moved: 1,
        steps: [
          { text: steps[1], from: 2 },
          { text: steps[0], from: null },
          { text: steps[2], from: null },
        ],
      },
    ])
  })

  it('reads a change of when it applies as Dates, with the last day people read', () => {
    const before = side({ validFrom: '2026-05-12', validUntil: '2026-05-20' })
    const after = side({ validFrom: '2026-05-12', validUntil: '2026-05-27' })
    const diff = docDiff(before, after)
    expect(diff.counts).toEqual([{ kind: 'dates', n: 1 }])
    expect(diff.blocks).toEqual([
      {
        kind: 'dates',
        field: 'when',
        before: { from: '2026-05-12', until: '2026-05-20' },
        after: { from: '2026-05-12', until: '2026-05-27' },
      },
    ])
    expect(diff.values).toEqual([
      { what: 'date', field: 'when', before: '2026-05-19', after: '2026-05-26' },
    ])
  })

  it('shows a long rewording side by side, with how many stretches changed', () => {
    const before = side({
      summary:
        'Before you explain a jump in France orders, check the file dates. The provider sends weekend files together on Monday, and most jumps are those late files, not customers. Compare a full week with the same week last year.',
    })
    const after = side({
      summary:
        "Before you explain a jump in France orders, check the file dates. The provider sends Saturday's file on Sunday and Sunday's on Monday, and most jumps are files arriving late rather than more customers. Then check refunds: a batch of refunds booked on one day reads as a drop. Compare whole weeks, Monday to Sunday, with the same weeks last year.",
    })
    const diff = docDiff(before, after)
    const wording = diff.blocks.find((b) => b.kind === 'wording')!
    expect(wording).toMatchObject({ kind: 'wording', field: 'text', rewrite: true })
    if (!('runs' in wording)) throw new Error('expected runs')
    expect(wording.changes).toBeGreaterThanOrEqual(4)
    expect(textOf(wording.runs, 'before')).toBe(before.summary)
    expect(textOf(wording.runs, 'after')).toBe(after.summary)
  })

  it('counts a new item as one addition, and an archived one as one removal', () => {
    const created = docDiff(null, side({ notToConclude: 'Fewer units do not mean fewer buyers.' }))
    expect(created.mode).toBe('new')
    expect(created.counts).toEqual([{ kind: 'added', n: 1 }])
    expect(kinds(created.blocks)).toEqual([
      ['added', 'text'],
      ['added', 'where'],
      ['added', 'when'],
      ['added', 'sources'],
      ['added', 'notToConclude'],
    ])
    expect(created.unchanged).toEqual([])
    const retired = docDiff(side(), null)
    expect(retired).toMatchObject({
      mode: 'retire',
      blocks: [],
      counts: [{ kind: 'removed', n: 1 }],
    })
  })

  it('reads a new paragraph as Added and a dropped one as Removed, never as one reworded', () => {
    const before = side({
      body: 'The returns team uses its own accounts.\n\nSales staff test on Fridays.',
    })
    const after = side({
      body: 'The returns team uses its own accounts.\n\nA new market opens in March.',
    })
    const diff = docDiff(before, after)
    expect(kinds(diff.blocks)).toEqual([
      ['added', 'text'],
      ['removed', 'text'],
    ])
    expect(diff.counts).toEqual([
      { kind: 'added', n: 1 },
      { kind: 'removed', n: 1 },
    ])
  })

  it('reads a changed kind, a narrower scope, a new check date and new words not to conclude', () => {
    const after = side({
      kind: 'issue',
      where: ['Units sold'],
      reviewDate: '2027-01-15',
      notToConclude: 'Fewer units do not mean fewer buyers.',
    })
    const diff = docDiff(side(), after)
    expect(kinds(diff.blocks)).toEqual([
      ['wording', 'kind'],
      ['removed', 'where'],
      ['dates', 'checkDate'],
      ['wording', 'notToConclude'],
    ])
    expect(diff.blocks[0]).toEqual({
      kind: 'wording',
      field: 'kind',
      before: 'note',
      after: 'issue',
    })
    expect(diff.blocks[1]).toEqual({ kind: 'removed', field: 'where', parts: ['Norway'] })
  })

  it('finds no change when nothing changed, however the Markdown is spaced', () => {
    const diff = docDiff(side({ body: 'One.\n\n\nTwo.' }), side({ body: 'One.\n\nTwo.  ' }))
    expect(diff.blocks).toEqual([])
    expect(diff.counts).toEqual([])
    expect(diff.only).toBeNull()
  })

  it('gives the same difference every time', () => {
    const before = side({ body: '## Why\n\nSee [the notice](https://example.test/a).' })
    const after = side({ body: '### Why\n\nSee [the notice](https://example.test/b).' })
    expect(docDiff(before, after)).toEqual(docDiff(before, after))
    expect(kinds(docDiff(before, after).blocks)).toEqual([
      ['formatting', 'text'],
      ['link', 'text'],
    ])
  })
})

describe('reading the Markdown the editor writes', () => {
  it('tells paragraphs, headings, quotes, list items and rules apart', () => {
    const blocks = markdownBlocks(
      '## Title\n\nA line\nwrapped.\n\n> Quoted\n\n- One\n  more\n1. Two\n\n---',
    )
    expect(blocks.map((b) => [b.shape, b.text])).toEqual([
      [{ type: 'heading', level: 2 }, 'Title'],
      [{ type: 'paragraph' }, 'A line wrapped.'],
      [{ type: 'quote' }, 'Quoted'],
      [{ type: 'bullet', depth: 0 }, 'One more'],
      [{ type: 'number', depth: 0 }, 'Two'],
      [{ type: 'rule' }, ''],
    ])
  })

  it('reads marks, links and mentions inline, and an underscore inside a word as a word', () => {
    expect(
      inlineSegments(
        '**Bold** and _it_ and `code` and [a link](https://x.test) and @[Norway](val:market/norway) and snake_case_name',
      ),
    ).toEqual([
      { text: 'Bold', marks: new Set(['bold']), href: null, mention: null },
      { text: ' and ', marks: new Set(), href: null, mention: null },
      { text: 'it', marks: new Set(['italic']), href: null, mention: null },
      { text: ' and ', marks: new Set(), href: null, mention: null },
      { text: 'code', marks: new Set(['code']), href: null, mention: null },
      { text: ' and ', marks: new Set(), href: null, mention: null },
      { text: 'a link', marks: new Set(), href: 'https://x.test', mention: null },
      { text: ' and ', marks: new Set(), href: null, mention: null },
      {
        text: 'Norway',
        marks: new Set(),
        href: null,
        mention: { target: 'val:market/norway', label: 'Norway' },
      },
      { text: ' and snake_case_name', marks: new Set(), href: null, mention: null },
    ])
  })

  it('keeps the stored Markdown of an item as its summary, then its body', () => {
    expect(docMarkdown({ summary: 'First.', body: 'Then more.' })).toBe('First.\n\nThen more.')
    expect(docMarkdown({ summary: 'Only this.', body: null })).toBe('Only this.')
  })

  it('pulls dates and numbers out of words, a number inside a date being the date’s', () => {
    expect(
      valuesIn('From 1 October 2026 the 28 accounts, 12.5% of them, and 3 to 5 May 2026.'),
    ).toEqual({
      dates: ['1 October 2026', '3 to 5 May 2026'],
      numbers: ['28', '12.5%'],
      all: [
        { what: 'date', text: '1 October 2026' },
        { what: 'number', text: '28' },
        { what: 'number', text: '12.5%' },
        { what: 'date', text: '3 to 5 May 2026' },
      ],
    })
  })
})

describe('the Source view (J19)', () => {
  // The mockup's own stored Markdown for this change (apps/mockup/src/data/review.ts, sug-ines).
  const before =
    'Units sold in Norway leaves out the 312 accounts our teams use to test the webshop. From 29 May 2026 the test accounts of the new app are left out too.\n\nSource: [Units sold definition](https://wiki.example/data/definitions/units-sold)'
  const after =
    'Units sold in Norway leaves out the 340 accounts our teams use to test the webshop. From 29 May 2026 the test accounts of the new app are left out too. From 1 October 2026 the 28 accounts the returns team uses to test refunds are left out as well.\n\nSource: [Units sold definition](https://wiki.example/data/definitions/units-sold-october)'

  it('shows what was removed before what was added', () => {
    expect(sourceDiff('a\nold\nc', 'a\nnew\nc').map((r) => r.t)).toEqual([' ', '-', '+', ' '])
  })

  it('marks only the words that changed: 312 to 340, not the whole sentence', () => {
    const rows = sourceDiff(before, after)
    const removed = rows.find((r) => r.t === '-' && r.line.includes('312'))!
    const added = rows.find((r) => r.t === '+' && r.line.includes('340'))!
    expect(removed.words!.filter((w) => w.changed).map((w) => w.text)).toEqual(['312'])
    const changed = added.words!.filter((w) => w.changed).map((w) => w.text)
    expect(changed[0]).toBe('340')
    // The added sentence is one run, not a box per word.
    expect(changed[1]).toBe(
      ' From 1 October 2026 the 28 accounts the returns team uses to test refunds are left out as well.',
    )
    expect(rows.indexOf(removed)).toBeLessThan(rows.indexOf(added))
  })

  it("diffs a link's address by its parts", () => {
    const added = sourceDiff(before, after).find((r) => r.t === '+' && r.line.startsWith('Source'))!
    expect(added.words!.filter((w) => w.changed).map((w) => w.text)).toEqual(['-october'])
  })
})

describe('comparing two sequences', () => {
  const rebuild = <T>(ops: ReturnType<typeof sequenceDiff>, a: readonly T[], b: readonly T[]) => ({
    a: ops.flatMap((op) => (op.op === 'add' ? [] : [a[op.a]!])),
    b: ops.flatMap((op) => (op.op === 'del' ? [] : [b[op.b]!])),
  })

  it('always rebuilds both sides, and keeps a common subsequence', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('a', 'b', 'c', 'd'), { maxLength: 30 }),
        fc.array(fc.constantFrom('a', 'b', 'c', 'd'), { maxLength: 30 }),
        fc.constantFrom('del' as const, 'add' as const),
        (a, b, prefer) => {
          const ops = sequenceDiff(a, b, (x, y) => x === y, prefer)
          expect(rebuild(ops, a, b)).toEqual({ a, b })
          for (const op of ops) if (op.op === 'same') expect(a[op.a]).toBe(b[op.b])
        },
      ),
      { seed: 20261026, numRuns: 2000 },
    )
  })

  it('gives a very long change as one removal and one addition, and stays fast', () => {
    const a = Array.from({ length: 2000 }, (_, i) => `a${i}`)
    const b = Array.from({ length: 2000 }, (_, i) => `b${i}`)
    expect((a.length + 1) * (b.length + 1)).toBeGreaterThan(LCS_CELLS)
    const started = performance.now()
    const ops = sequenceDiff(a, b, (x, y) => x === y)
    expect(performance.now() - started).toBeLessThan(200)
    expect(rebuild(ops, a, b)).toEqual({ a, b })
    expect(ops.filter((op) => op.op === 'same')).toHaveLength(0)
  })

  it('rebuilds the words of a wording change on each side', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('Orders', 'in', 'Norway', 'fell', '312', '340', ',', '.'), {
          maxLength: 20,
        }),
        fc.array(fc.constantFrom('Orders', 'in', 'Spain', 'rose', '312', '340', ',', '.'), {
          maxLength: 20,
        }),
        (x, y) => {
          const before = side({ summary: x.join(' ') || 'Start.' })
          const after = side({ summary: y.join(' ') || 'Start.' })
          const diff = docDiff(before, after)
          for (const block of diff.blocks)
            if (block.kind === 'wording' && 'runs' in block) {
              expect(wordTokens(textOf(block.runs, 'before')).join('')).toBe(
                markdownBlocks(before.summary)[0]!.text,
              )
              expect(changeCount(block.runs)).toBe(block.changes)
            }
        },
      ),
      { seed: 20261026, numRuns: 500 },
    )
  })
})
