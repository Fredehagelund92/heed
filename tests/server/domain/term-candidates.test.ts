import { describe, expect, it } from 'vitest'
import {
  keyPart,
  memberName,
  pastedValues,
  termCandidates,
  type CandidateMember,
  type KnownTerm,
} from '../../../src/domain/term-candidates.ts'

/*
  The terms an administrator may propose for a definition source's members (the pilot walk's B1):
  one per metric, one per dimension name however many views share it (strict merge by name), a
  live dimension again with the members of its name it does not link yet, never one a live term
  or an open proposal already links, with names people read.
*/

const member = (ref: string, extra: Partial<CandidateMember> = {}): CandidateMember => ({
  ref,
  source: 'cube',
  kind: 'metric',
  name: ref.slice(ref.indexOf(':') + 1),
  title: null,
  description: null,
  valueType: 'number',
  areaHint: 'paid_social',
  synonyms: [],
  baseName: null,
  ...extra,
})

const known = (
  key: string,
  kind: string,
  definitionRefs: string[],
  extra: Partial<KnownTerm> = {},
): KnownTerm => ({
  key,
  kind,
  name: key,
  aliases: [],
  areaId: null,
  definitionRefs,
  open: false,
  ...extra,
})

describe('termCandidates', () => {
  it('names a member without the view Cube puts in front of its title', () => {
    expect(
      memberName({
        name: 'marketing_cost.sum_cost',
        title: 'Marketing Cost sum cost',
        baseName: null,
      }),
    ).toBe('Sum cost')
    expect(memberName({ name: 'traffic.market', title: 'Country market', baseName: null })).toBe(
      'Country market',
    )
    expect(memberName({ name: 'traffic.page_views', title: null, baseName: null })).toBe(
      'Page views',
    )
    expect(keyPart("Côte d'Ivoire")).toBe('cote_d_ivoire')
  })

  it('makes one dimension of a name every view shares, of no domain when the views differ', () => {
    const candidates = termCandidates(
      [
        member('cube:ads.market', { kind: 'dimension', valueType: 'string' }),
        member('cube:web.market', { kind: 'dimension', valueType: 'string', areaHint: 'search' }),
        member('cube:ads.brand', { kind: 'dimension', valueType: 'string' }),
        member('cube:ads.day', { kind: 'dimension', valueType: 'time' }),
        member('cube:ads.brand_id', { kind: 'dimension', valueType: 'string' }),
      ],
      [],
    )
    expect(candidates.map((c) => [c.key, c.areaId, c.views, c.suggested])).toEqual([
      ['dim:brand', 'paid_social', ['ads'], true],
      ['dim:brand_id', 'paid_social', ['ads'], false],
      ['dim:day', 'paid_social', ['ads'], false],
      ['dim:market', null, ['ads', 'web'], true],
    ])
  })

  it('leaves out what a term or a proposal links, and keeps metric keys and names apart', () => {
    const candidates = termCandidates(
      [
        member('cube:ads.cost'),
        member('cube:ads.sessions'),
        member('cube:web.sessions', { areaHint: 'search' }),
        member('cube:web.market', { kind: 'dimension' }),
        member('cube:ads.market', { kind: 'dimension' }),
      ],
      [
        known('metric:spend', 'metric', ['cube:ads.cost']),
        known('dim:market', 'dimension', ['cube:ads.market', 'cube:web.market']),
      ],
    )
    expect(candidates.map((c) => [c.key, c.name, c.areaId])).toEqual([
      ['metric:sessions', 'Sessions', 'paid_social'],
      ['metric:web_sessions', 'Sessions (web)', 'search'],
    ])
  })

  it("links every view's member of a dimension's name: one term, many Cube names", () => {
    const [market] = termCandidates(
      [
        member('cube:web.market', { kind: 'dimension', areaHint: 'search' }),
        member('cube:ads.market', { kind: 'dimension' }),
        member('cube:crm.market', { kind: 'dimension' }),
      ],
      [],
    )
    expect(market).toMatchObject({
      key: 'dim:market',
      definitionRefs: ['cube:ads.market', 'cube:crm.market', 'cube:web.market'],
      linked: [],
      views: ['ads', 'crm', 'web'],
      // Its views lie in two domains: shared, so no domain and an administrator reviews it.
      areaId: null,
    })
  })

  it('offers a live dimension again with the members of its name it does not link yet', () => {
    const candidates = termCandidates(
      [
        member('cube:web.market', { kind: 'dimension', areaHint: 'search' }),
        member('cube:ads.market', { kind: 'dimension' }),
        member('cube:ads.country', { kind: 'dimension' }),
        member('cube:web.country', { kind: 'dimension', areaHint: 'search' }),
      ],
      [
        // Linked before a term could name several (the migration kept the first view's).
        known('dim:market', 'dimension', ['cube:ads.market'], { name: 'Market', aliases: ['Geo'] }),
        // A term whose key is the name's but that links nothing yet.
        known('dim:country', 'dimension', [], { name: 'Country', areaId: 'paid_social' }),
      ],
    )
    expect(candidates).toEqual([
      expect.objectContaining({
        key: 'dim:country',
        name: 'Country',
        definitionRefs: ['cube:ads.country', 'cube:web.country'],
        linked: [],
        areaId: 'paid_social',
      }),
      expect.objectContaining({
        key: 'dim:market',
        name: 'Market',
        aliases: ['Geo'],
        definitionRefs: ['cube:ads.market', 'cube:web.market'],
        linked: ['cube:ads.market'],
        areaId: null,
        suggested: true,
      }),
    ])
  })

  it("keeps a live dimension's own domain, and takes the members' agreed one only without it", () => {
    const candidates = termCandidates(
      [
        member('cube:ads.market', { kind: 'dimension' }),
        member('cube:web.market', { kind: 'dimension', areaHint: 'search' }),
        member('cube:crm.market', { kind: 'dimension', areaHint: 'search' }),
        member('cube:web.brand', { kind: 'dimension', areaHint: 'search' }),
        member('cube:crm.brand', { kind: 'dimension', areaHint: 'search' }),
      ],
      [
        known('dim:market', 'dimension', ['cube:ads.market'], { areaId: 'finance' }),
        known('dim:brand', 'dimension', ['cube:web.brand']),
      ],
    )
    expect(candidates.map((c) => [c.key, c.areaId])).toEqual([
      ['dim:brand', 'search'],
      ['dim:market', 'finance'],
    ])
  })

  it('never links a second member of a view the live term has one of', () => {
    const candidates = termCandidates(
      [
        member('cube:web.country', { kind: 'dimension' }),
        member('cube:web.country_name', { kind: 'dimension' }),
        member('cube:ads.country', { kind: 'dimension' }),
      ],
      // Linked by hand to another member of web.
      [known('dim:country', 'dimension', ['cube:web.country_name'])],
    )
    expect(candidates.find((c) => c.key === 'dim:country')).toMatchObject({
      definitionRefs: ['cube:ads.country', 'cube:web.country_name'],
      linked: ['cube:web.country_name'],
    })
  })

  it('waits for an open proposal, and leaves a name that terms split by hand as it is', () => {
    const members = [
      member('cube:ads.partner', { kind: 'dimension' }),
      member('cube:web.partner', { kind: 'dimension' }),
      member('cube:crm.partner', { kind: 'dimension' }),
    ]
    expect(
      termCandidates(members, [
        known('dim:partner', 'dimension', ['cube:ads.partner']),
        known('dim:partner', 'dimension', ['cube:ads.partner', 'cube:web.partner'], {
          open: true,
        }),
      ]),
    ).toEqual([])
    expect(
      termCandidates(members, [
        known('dim:partner', 'dimension', ['cube:ads.partner']),
        known('dim:footwear', 'dimension', ['cube:web.partner']),
      ]),
    ).toEqual([])
  })
})

describe('members a view joins with a prefix', () => {
  it('read as their own name and merge with the same name in other views', () => {
    expect(
      memberName({
        name: 'web_traffic.store_store_name',
        title: 'Web Traffic Store Store Name',
        baseName: 'store_name',
      }),
    ).toBe('Store name')
    // A title the model's authors gave loses the join's words only.
    expect(
      memberName({
        name: 'web_traffic.region_country_name',
        title: 'Web Traffic Region Country (full name)',
        baseName: 'country_name',
      }),
    ).toBe('Country (full name)')
    const candidates = termCandidates(
      [
        member('cube:web_traffic.store_store_name', {
          kind: 'dimension',
          title: 'Web Traffic Store Store Name',
          baseName: 'store_name',
        }),
        member('cube:web_traffic.store_store_id', {
          kind: 'dimension',
          title: 'Web Traffic Store Store ID',
          baseName: 'store_id',
        }),
        member('cube:stock_levels.store_name', {
          kind: 'dimension',
          title: 'Stock Levels Store Name',
          areaHint: 'search',
        }),
      ],
      [],
    )
    expect(candidates.map((c) => [c.key, c.name, c.definitionRefs, c.suggested])).toEqual([
      ['dim:store_id', 'Store ID', ['cube:web_traffic.store_store_id'], false],
      [
        'dim:store_name',
        'Store Name',
        ['cube:stock_levels.store_name', 'cube:web_traffic.store_store_name'],
        true,
      ],
    ])
  })
})

describe("the model's other names (meta.synonyms)", () => {
  it('become other names of the term, each going to one term only', () => {
    const candidates = termCandidates(
      [
        member('cube:ads.spend', { synonyms: ['ad spend', 'Media spend', 'spend'] }),
        member('cube:web.sessions', { synonyms: ['visits', 'Clicks'] }),
        member('cube:ads.country', {
          kind: 'dimension',
          synonyms: ['geo', 'country', 'market'],
        }),
        member('cube:web.country', { kind: 'dimension', synonyms: ['nation', 'Geo'] }),
        member('cube:web.country_name', { kind: 'dimension', synonyms: ['country', 'geo'] }),
        member('cube:ads.region', { kind: 'dimension', synonyms: ['area'] }),
      ],
      [
        known('metric:clicks', 'metric', [], { name: 'Clicks' }),
        known('dim:region', 'dimension', ['cube:ads.region'], {
          name: 'Region',
          aliases: ['Zone'],
        }),
        known('dim:market', 'dimension', [], { name: 'Market' }),
      ],
    )
    expect(candidates.map((c) => [c.key, c.aliases])).toEqual([
      // Clicks is another term's name.
      ['metric:sessions', ['visits']],
      // Its own name is no other name; the rest keep the authors' words.
      ['metric:spend', ['ad spend', 'Media spend']],
      // Geo is on both Country members and on Country name: it goes to neither. Market is a
      // term's name, Country this term's own.
      ['dim:country', ['nation']],
      ['dim:country_name', []],
    ])
  })

  it("keep a live term's other names first when it links more members", () => {
    const [region] = termCandidates(
      [
        member('cube:ads.region', { kind: 'dimension', synonyms: ['area'] }),
        member('cube:web.region', { kind: 'dimension', synonyms: ['Area', 'zone', 'territory'] }),
      ],
      [
        known('dim:region', 'dimension', ['cube:ads.region'], {
          name: 'Region',
          aliases: ['Zone'],
        }),
      ],
    )
    expect(region).toMatchObject({ key: 'dim:region', aliases: ['Zone', 'area', 'territory'] })
  })
})

describe('termCandidates against the live vocabulary', () => {
  it('gives a metric its view name when a live or proposed metric has its name', () => {
    const candidates = termCandidates(
      [member('cube:tiktok.clicks', { title: 'Clicks' }), member('cube:tiktok.spend')],
      [
        known('metric:clicks', 'metric', ['cube:ads.clicks'], { name: 'Clicks' }),
        known('dim:spend', 'dimension', [], { name: 'Spend' }),
      ],
    )
    expect(candidates.map((c) => [c.key, c.name])).toEqual([
      ['metric:tiktok_clicks', 'Clicks (tiktok)'],
      // Only a metric of the same name counts: a dimension may share it.
      ['metric:spend', 'Spend'],
    ])
  })
})

describe('pastedValues', () => {
  it('reads one value per line with its other names, once each', () => {
    expect(
      pastedValues('dim:market', 'Norway, Norge\n\nPoland, Polska, EM\nNorway\n***\n'),
    ).toEqual({
      values: [
        { key: 'val:market/norway', name: 'Norway', aliases: ['Norge'] },
        { key: 'val:market/poland', name: 'Poland', aliases: ['Polska', 'EM'] },
      ],
      unreadable: ['***'],
    })
  })
})
