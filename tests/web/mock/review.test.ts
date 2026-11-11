import { describe, expect, it } from 'vitest'
import { reviewFor, reviews } from '@/api/mock/data/review'
import { readyOf } from '@/api/mock/ready'
import { careLine, readiness } from '@/model/review'
import { actionsOf, clashOutcome, needsCare, publishedWords, readTime } from '@/model/review-page'

// The Ready line is the service's (src/domain/readiness.ts, tested in tests/server/domain); the web
// has no second copy of its rules. What is left here is what the web decides: the demo's reviews
// carry the line the domain gives for their facts, an answered clash reads as Ready, and the care
// line counts claims the same way.

const r = (id: string) => reviewFor(id)!

describe('the Ready line', () => {
  it('gives the demo’s reviews the line the domain gives for their facts', () => {
    expect(readiness(r('sug-ines-dates'))).toMatchObject({
      ok: false,
      title: 'Ready, not checked against a source',
    })
    expect(readiness(r('sug-agent')).title).toBe('Ready, with 2 claims to check')
    expect(readiness(r('sug-lars-retire'))).toMatchObject({
      ok: false,
      title: 'Withdrawn by Lars Dahl',
    })
    for (const x of reviews) expect(readiness(x), x.id).toBe(x.ready)
  })

  it('counts the claims to check, not whether there is a list of them', () => {
    const agent = r('sug-agent')
    const checked = {
      ...agent,
      claims: {
        ...agent.claims!,
        rows: agent.claims!.rows.map((x) => ({ ...x, same: 'same' as const })),
      },
    }
    expect(careLine(checked)).toBeUndefined()
    expect(needsCare(checked)).toBe(false)
    expect(readyOf(checked)).toMatchObject({ ok: true, title: 'Ready' })
    expect(careLine(agent)).toBe('2 claims to check')
    expect(needsCare(agent)).toBe(true)
    expect(careLine(r('sug-sofia-clash'))).toBe('Overlaps live context')
    expect(careLine(r('sug-ines'))).toBeUndefined()
  })

  it('waits for an answer for each live item a suggestion overlaps', () => {
    const clash = r('sug-sofia-clash')
    const [stop, card, credit] = clash.clash!.items.map((c) => c.factId)
    expect(clash.clash!.items).toHaveLength(3)
    expect(readiness(clash)).toMatchObject({
      ok: false,
      text: 'Publish waits until you say how this relates to each of the 3 live items.',
    })
    // Two answers are not three: one answer never stands for another item.
    expect(clashOutcome(clash, { [stop!]: 'unrelated', [credit!]: 'replaces' })).toBeNull()
    const answers = { [stop!]: 'unrelated', [card!]: 'disagree', [credit!]: 'replaces' } as const
    expect(clashOutcome(clash, answers)).toBe(
      'When you publish, 1 live item is archived and 2 stay. Where you said they disagree, agents say context disagrees.',
    )
    // The owner's answers settle the clash here; it reads as the domain reads an answered one.
    const settled = readiness(clash, { hint: clashOutcome(clash, answers)! })
    expect(settled).toMatchObject({ ok: true, title: 'Ready', bulk: false })
    // A claim still comes first, as in the domain.
    const withClaims = { ...clash, claims: r('sug-agent').claims }
    expect(readiness(withClaims, { hint: 'x' })).toBe(withClaims.ready)
    // What it did names the one archived, and only it.
    expect(publishedWords(clash, answers)).toBe(
      'Archived: Norway orders count store credit. Where you said they disagree, both stay live and agents say so.',
    )
    expect(
      publishedWords(clash, { [stop!]: 'unrelated', [card!]: 'unrelated', [credit!]: 'unrelated' }),
    ).toBe('Agents get it from the next question.')
  })

  it('what may be done follows the same domain rules, with the owner’s answers so far', () => {
    const clash = r('sug-sofia-clash')
    const ids = clash.clash!.items.map((c) => c.factId)
    expect(actionsOf(clash, {}).blockedBy).toEqual({ publish: 'clash' })
    expect(actionsOf(clash, { [ids[0]!]: 'unrelated', [ids[1]!]: 'unrelated' }).blockedBy).toEqual({
      publish: 'clash',
    })
    expect(
      actionsOf(clash, Object.fromEntries(ids.map((id) => [id, 'unrelated' as const]))).blockedBy,
    ).toEqual({})
    // A suggestion to archive is never returned, withdrawn or not.
    expect(actionsOf(r('sug-lars-retire'), {})).toMatchObject({
      can: ['archive', 'close'],
      primary: 'close',
    })
    expect(actionsOf(r('sug-agent'), {})).toMatchObject({ primary: 'return' })
    expect(actionsOf(r('gap-spain'), {}).can).toEqual(['publish'])
  })

  it('asks a longer change to stay on screen longer before it counts as read', () => {
    const date = readTime(r('sug-ines-dates'))
    const rewrite = readTime(r('sug-ines-long'))
    expect(date).toBe(1500)
    expect(rewrite).toBeGreaterThan(date * 2)
    expect(rewrite).toBeLessThanOrEqual(8000)
  })
})
