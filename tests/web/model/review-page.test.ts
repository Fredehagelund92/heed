import { describe, expect, it } from 'vitest'
import { draftItem } from '@/model/review-page'
import type { Domains } from '@/model/people'
import { reviewFor } from '@/api/mock/data/review'
import { domains as world, facts } from '@/api/mock/data/world'

const domains: Domains = Object.fromEntries(
  Object.entries(world).map(([id, d]) => [id, { ...d, id, text: d.covers }]),
)
const live = (title: string) => facts.find((f) => f.title === title)!

describe('the suggested version as its item page will show it', () => {
  it('is the live item with what an edit changes, and nothing only publishing sets', () => {
    const r = reviewFor('sug-ines')!
    const before = live(r.title)
    const item = draftItem(r, before, domains)!
    expect(item).toMatchObject({
      id: before.id,
      title: before.title,
      domain: 'sales',
      kind: 'note',
      where: before.where,
      when: before.when,
      status: 'Live',
      source: 'https://wiki.example/data/definitions/units-sold-october',
      quote: before.quote,
      dontConclude: before.dontConclude,
      checkedBy: '',
      checkedOn: '',
    })
    // The new text, its link as the editor writes it.
    expect(item.summary).toContain('leaves out the 340 accounts')
    expect(item.summary).toContain('[@ id="term:Test account" label="accounts"]')
    // The owners it leaves alone stay as the live item has them: its domain's.
    expect(item.owners).toBe(before.owners)
  })

  it('splits the stored text into the summary and the body', () => {
    const item = draftItem(reviewFor('gap-spain')!, undefined, domains)!
    // Its owner is one of Sales' owners: the page names them all, so the preview leaves it to them.
    expect(item.owners).toBeUndefined()
    const [summary, ...body] = reviewFor('gap-spain')!.source.after.split('\n\n')
    expect(item.summary).toBe(summary)
    expect(item.body).toBe(body.join('\n\n'))
  })

  it('names a new item’s owner, and reads its kind and domain from their names', () => {
    const item = draftItem(reviewFor('sug-agent')!, undefined, domains)!
    expect(item).toMatchObject({
      kind: 'issue',
      domain: 'sales',
      owners: ['Kofi Mensah'],
      where: ['Orders', 'Poland'],
    })
    expect(item.scope).toBeUndefined()
  })

  it('has no suggested version for an archive', () => {
    const r = reviewFor('sug-lars-retire')!
    expect(
      draftItem(
        r,
        facts.find((f) => f.id === r.retire!.factId),
        domains,
      ),
    ).toBeNull()
  })
})
