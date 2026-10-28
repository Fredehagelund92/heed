import { describe, expect, it } from 'vitest'
import { facts, factById } from '@/api/mock/data/world'
import { definitionSeed } from '@/api/mock/definitions'
import { createWorkspace } from '@/api/mock/workspace'
import { answerLinks, follow, linksOf } from '@/lib/links'

// get_related: links both ways and the owners' relations, one step, a retired target shown and
// never followed, a definition from another domain marked, and the switch turns it all off.

const w = { facts, definitions: definitionSeed, domains: createWorkspace().domainMap() }

describe('links', () => {
  it("lists an item's links both ways, in a fixed order", () => {
    const links = linksOf('context:itm_norway_stop', w)
    expect(links.map((l) => [l.rel, l.to.id])).toEqual([
      ['mentions', 'term:Webshop'],
      ['mentions', 'metric:Orders'],
      ['mentions', 'context:itm_za26xpzv'],
      ['mentions', 'context:itm_kh4llvi9'],
    ])
    expect(links.find((l) => l.to.id === 'context:itm_kh4llvi9')!.to.retired).toBe(true)
    expect(links.find((l) => l.to.id === 'context:itm_za26xpzv')!.otherDomain).toBe(true)
    // Linked from: the Norway stop links here.
    expect(linksOf('context:itm_za26xpzv', w).map((l) => [l.rel, l.to.id])).toEqual([
      ['mentioned_by', 'context:itm_norway_stop'],
    ])
  })

  it("carries the owners' relations: replaces, and disagrees with both ways", () => {
    expect(linksOf('context:itm_0tmqp7o1', w)[0]).toMatchObject({
      rel: 'replaces',
      to: { id: 'context:itm_lag_two_days', retired: true },
    })
    expect(linksOf('context:itm_gift_store_credit', w)[0]).toMatchObject({
      rel: 'disagrees',
      to: { id: 'context:itm_gift_card_only' },
    })
  })

  it('marks a definition from another domain', () => {
    const orders = linksOf('context:itm_eprlkrz2', w).find((l) => l.to.id === 'metric:Orders')!
    expect(orders.otherDomain).toBe(true)
    expect(orders.to.domain).toBe('sales')
  })

  it('follows one step to items and terms, never a retired one, and nothing when switched off', () => {
    const got = [factById('itm_norway_stop')!, factById('itm_za26xpzv')!]
    const { followed, notFollowed } = follow(got, w, true)
    expect(followed.map((f) => f.link.to.id)).toEqual(['term:Webshop'])
    expect(notFollowed.map((f) => f.link.to.id)).toEqual(['context:itm_kh4llvi9'])
    expect(follow(got, w, false)).toEqual({ followed: [], notFollowed: [] })
  })

  it("gives an answer's links with what the agent read where each led", () => {
    const links = answerLinks(['itm_norway_stop', 'itm_za26xpzv'], w, true)
    const stop = { id: 'itm_norway_stop', title: factById('itm_norway_stop')!.title }
    expect(links.on).toBe(true)
    expect(links.followed).toHaveLength(1)
    expect(links.followed[0]).toMatchObject({
      from: stop,
      rel: 'mentions',
      to: { id: 'term:Webshop', label: 'Webshop' },
    })
    expect(links.followed[0]!.read).toContain('larchwood.example')
    expect(links.notFollowed).toEqual([
      {
        from: stop,
        rel: 'mentions',
        to: {
          id: 'context:itm_kh4llvi9',
          label: 'Payment provider switched in Norway on 9 July 2025',
        },
      },
    ])
    expect(answerLinks(['itm_norway_stop'], w, false)).toEqual({
      on: false,
      followed: [],
      notFollowed: [],
    })
  })
})
