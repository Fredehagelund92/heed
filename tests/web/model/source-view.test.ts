import { describe, expect, it } from 'vitest'
import type { SourceLast, SourceRead } from '@domain/source-state'
import type { ConnectorKind, Source } from '@/model/integrations'
import { readEndedWords, sourceView } from '@/model/source-view'

// What a tool's page says of it, for every cell of kind, intent or pending read, and last read:
// 2 kinds, paused or one of 3 reads, and 5 last reads make 40, each with words chosen on purpose.

const source = (state: Source['state'], over: Partial<Source> = {}): Source => ({
  id: 'cube',
  connector: 'cube',
  state,
  every: 'every hour',
  staleAfter: '6 hours',
  last:
    state.last === 'never'
      ? null
      : { at: { day: 'Today', time: '10:00' }, seconds: state.last === 'ok' ? 3 : 1, seen: 0 },
  lastGood: state.last === 'failed' ? { day: 'Today', time: '06:00' } : null,
  failures: state.last === 'failed' || state.last === 'refused' ? 1 : 0,
  failure:
    state.last === 'failed'
      ? "it couldn't be reached"
      : state.last === 'refused'
        ? 'Cube refused the key'
        : null,
  definitions: { metrics: 22, dimensions: 5, views: 7, noDomain: 0, flagged: 0 },
  documents: null,
  created: null,
  inbox: null,
  added: null,
  ...over,
})

const active = (read: SourceRead, last: SourceLast, retry: 'period' | 'backoff' | null = null) =>
  ({ intent: 'active', read, next: { day: 'Today', time: '11:00' }, retry, last }) as const
const paused = (last: SourceLast) => ({ intent: 'paused', last }) as const

const kinds: ConnectorKind[] = ['definitions', 'context']
const lasts: SourceLast[] = ['never', 'ok', 'partial', 'failed', 'refused']
const states = lasts.flatMap((last): Source['state'][] => [
  paused(last),
  ...(['scheduled', 'queued', 'reading'] as const).map((read) =>
    active(read, last, last === 'failed' || last === 'refused' ? 'period' : null),
  ),
])
const cells = kinds.flatMap((kind) => states.map((state) => [kind, state] as const))

/** Everything a cell says, as one line of words. */
const said = (kind: ConnectorKind, state: Source['state']) => {
  const view = sourceView(kind, source(state, kind === 'context' ? contentOf : {}), null)
  return JSON.stringify(view)
}
const contentOf: Partial<Source> = {
  connector: 'google-drive',
  definitions: null,
  documents: { held: 14, waiting: 0, domains: 0, madeToday: 0, perDay: 5 },
}

describe('a tool on its page, in every cell', () => {
  it('has 40 cells', () => {
    expect(cells).toHaveLength(40)
  })

  it.each(cells)('%s, %j: a failed read is never in part, nor a read of 0 documents', (kind, s) => {
    if (s.last !== 'failed' && s.last !== 'refused') return
    expect(said(kind, s)).not.toMatch(/in part|complete|looked at/)
  })

  it.each(cells)('%s, %j: an active tool is never called paused', (kind, s) => {
    if (s.intent !== 'active') return
    expect(said(kind, s)).not.toMatch(/paused/i)
  })

  it.each(cells)('%s, %j: a paused tool says it is paused, and has no next read', (kind, s) => {
    if (s.intent !== 'paused') return
    const view = sourceView(kind, source(s, kind === 'context' ? contentOf : {}), null)
    expect(view.banner).toMatchObject({ kind: 'paused' })
    expect(view.pending).toBeNull()
    expect(view.numbers[1]).toMatchObject({ value: 'Paused' })
  })

  it.each(cells)('%s, %j: a tool never read is never "soon"', (kind, s) => {
    expect(said(kind, s)).not.toMatch(/soon/)
  })

  it.each(cells)('%s, %j: only a retry that backs off is "backing off"', (kind, s) => {
    expect(said(kind, s)).not.toMatch(/backing off/)
  })
})

describe('the cells the audit found', () => {
  it('a definitions tool whose key was refused says so, with when it is tried again', () => {
    const view = sourceView('definitions', source(active('scheduled', 'refused', 'period')), null)
    expect(view.health).toBe('reauth')
    expect(view.banner).toEqual({ kind: 'refused', retry: 'It is tried again at 11:00.' })
    expect(view.numbers.slice(0, 2)).toEqual([
      {
        label: 'Last read',
        value: 'Today, 10:00',
        sub: 'refused: it needs a new key',
        tone: 'warn',
      },
      { label: 'Next try', value: '11:00', sub: 'every hour' },
    ])
  })

  it('a content tool whose read failed shows its last good read, not 0 documents looked at', () => {
    const view = sourceView(
      'context',
      source(active('scheduled', 'failed', 'period'), contentOf),
      null,
    )
    expect(view.banner).toEqual({ kind: 'failed' })
    expect(view.numbers[0]).toEqual({
      label: 'Last good read',
      value: 'Today',
      sub: '06:00',
      tone: 'bad',
    })
  })

  it('a tool paused before its first read says so', () => {
    const view = sourceView('context', source(paused('never'), contentOf), null)
    expect(view.banner).toEqual({ kind: 'paused', words: 'Paused before its first read.' })
    expect(view.numbers[0]).toEqual({
      label: 'Last read',
      value: 'Not yet',
      sub: 'first read once it is resumed',
    })
  })

  it('a tool paused after a failed read says why it failed, and after a refused key what it needs', () => {
    expect(sourceView('definitions', source(paused('failed')), null).banner).toEqual({
      kind: 'paused',
      words: "Paused. Its last read failed: it couldn't be reached.",
    })
    expect(sourceView('definitions', source(paused('refused')), null).banner).toEqual({
      kind: 'paused',
      words: 'Paused. It will need a new key.',
    })
  })

  it('a failure tried again sooner than its period is backing off; one a period on is not', () => {
    const next = (retry: 'period' | 'backoff') =>
      sourceView('definitions', source(active('scheduled', 'failed', retry)), null).numbers[1]
    expect(next('backoff')).toEqual({ label: 'Next try', value: '11:00', sub: 'backing off' })
    expect(next('period')).toEqual({ label: 'Next try', value: '11:00', sub: 'every hour' })
  })

  it('a read that ended is told by how it went, with one full stop', () => {
    expect(readEndedWords('Cube', 'refused', 'Cube refused the key.')).toEqual({
      title: "Couldn't read Cube",
      description: 'Cube refused the key.',
    })
    expect(readEndedWords('Cube', 'ok', '27 definitions, no changes')).toEqual({
      title: 'Read Cube',
      description: '27 definitions, no changes.',
    })
  })
})
