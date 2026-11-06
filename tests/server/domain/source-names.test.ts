import { describe, expect, it } from 'vitest'
import {
  nameRefusal,
  sourceNames,
  wordsOf,
  type WordHolders,
} from '../../../src/domain/source-names.ts'
import type { CandidateMember, KnownTerm } from '../../../src/domain/term-candidates.ts'
import type { WordHolder } from '../../../src/domain/terms.ts'

/*
  The names a read makes (FR-141): what an owner accepts with one press, and what waits for a look
  because it would give a word a second meaning (FR-138). A flagged name is never picked.
*/

const member = (ref: string, extra: Partial<CandidateMember> = {}): CandidateMember => ({
  ref,
  source: 'dbt',
  kind: 'metric',
  name: ref.slice(ref.indexOf(':') + 1),
  title: null,
  description: null,
  valueType: 'count',
  areaHint: 'sales',
  synonyms: [],
  baseName: null,
  mergeDimensions: 'never',
  ...extra,
})

const noHolders: WordHolders = new Map()
const nothingLeft = new Set<string>()

describe('the names a read makes', () => {
  it('offers a metric and a dimension with nothing against them as ready', () => {
    const names = sourceNames(
      [
        member('dbt:orders.net_revenue', { title: 'Net revenue' }),
        member('dbt:orders.channel', { kind: 'dimension', valueType: 'categorical' }),
      ],
      [],
      noHolders,
      nothingLeft,
    )
    expect(names.map((n) => [n.key, n.name, n.state])).toEqual([
      ['metric:net_revenue', 'Net revenue', 'ready'],
      ['dim:channel', 'Channel', 'ready'],
    ])
    expect(names[0]!.flags).toEqual([])
  })

  it('leaves dates and ids out by themselves, and what an owner left out', () => {
    const names = sourceNames(
      [
        member('dbt:orders.ordered_at', { kind: 'dimension', valueType: 'time' }),
        member('dbt:orders.customer_id', { kind: 'dimension', valueType: 'categorical' }),
        member('dbt:orders.internal_score'),
      ],
      [],
      noHolders,
      new Set(['dbt:orders.internal_score']),
    )
    expect(names.map((n) => [n.name, n.state, n.leftByOwner])).toEqual([
      ['Internal score', 'left_out', true],
      ['Customer id', 'left_out', false],
      ['Ordered at', 'left_out', false],
    ])
  })

  it('flags both of two members of one name, and picks neither', () => {
    const names = sourceNames(
      [
        member('dbt:orders.revenue', { title: 'Revenue' }),
        member('dbt:refunds.revenue', { title: 'Revenue' }),
      ],
      [],
      noHolders,
      nothingLeft,
    )
    expect(names.map((n) => n.state)).toEqual(['flagged', 'flagged'])
    expect(names.map((n) => n.name).sort()).toEqual(['Revenue', 'Revenue (refunds)'])
    expect(names[0]!.flags[0]).toEqual({
      code: 'same_name',
      message: 'Another definition is called “Revenue”: refunds.revenue.',
    })
  })

  it('flags a metric and a dimension that read as one word', () => {
    const names = sourceNames(
      [
        member('dbt:orders.orders', { title: 'Orders' }),
        member('dbt:orders.order_kind', {
          kind: 'dimension',
          valueType: 'categorical',
          title: 'orders',
        }),
      ],
      [],
      noHolders,
      nothingLeft,
    )
    expect(names.map((n) => n.state)).toEqual(['flagged', 'flagged'])
  })

  it('flags a word people already gave another meaning, and says who has it', () => {
    const term: WordHolder = {
      origin: 'term',
      id: 't1',
      name: 'Revenue',
      sameAs: { ref: 'metric:gross_sales', name: 'Gross sales' },
      by: 'Maria',
    }
    const names = sourceNames(
      [member('dbt:orders.revenue', { title: 'Revenue' })],
      [],
      new Map([['revenue', [term]]]),
      nothingLeft,
    )
    expect(names[0]).toMatchObject({
      state: 'flagged',
      flags: [
        {
          code: 'taken',
          message: '“Revenue” is already another name for Gross sales, added by Maria.',
        },
      ],
    })
  })

  it('flags a live metric of the same name, and offers the name with its view', () => {
    const live: KnownTerm = {
      key: 'metric:revenue',
      kind: 'metric',
      name: 'Revenue',
      aliases: [],
      areaId: 'sales',
      definitionRefs: ['cube:orders.revenue'],
      open: false,
    }
    const holder: WordHolder = {
      origin: 'vocabulary',
      ref: 'metric:revenue',
      name: 'Revenue',
      tool: null,
    }
    const names = sourceNames(
      [member('dbt:orders.revenue', { title: 'Revenue' })],
      [live],
      new Map([['revenue', [holder]]]),
      nothingLeft,
    )
    expect(names[0]).toMatchObject({ state: 'flagged', name: 'Revenue (orders)' })
    expect(names[0]!.flags[0]!.message).toBe('“Revenue” is already a name for Revenue.')
  })

  it('flags a dimension whose views title it differently', () => {
    const names = sourceNames(
      [
        member('cube:orders.market', {
          kind: 'dimension',
          valueType: 'string',
          title: 'Orders Market',
          mergeDimensions: 'by-name',
        }),
        member('cube:returns.market', {
          kind: 'dimension',
          valueType: 'string',
          title: 'Returns Country',
          mergeDimensions: 'by-name',
        }),
      ],
      [],
      noHolders,
      nothingLeft,
    )
    expect(names[0]).toMatchObject({ state: 'flagged' })
    expect(names[0]!.flags[0]!.code).toBe('titles_differ')
    expect(names[0]!.flags[0]!.message).toContain('“Market” and “Country”')
  })

  it('flags a name the service would refuse, so Publish all never carries it', () => {
    const names = sourceNames(
      [
        member('dbt:orders.net', { title: 'Revenue, net' }),
        member('dbt:orders.long', { title: 'x'.repeat(101) }),
        member('dbt:orders.fine', { title: 'Fine' }),
      ],
      [],
      noHolders,
      nothingLeft,
    )
    expect(names.map((n) => [n.name, n.state])).toEqual([
      ['Revenue, net', 'flagged'],
      ['x'.repeat(101), 'flagged'],
      ['Fine', 'ready'],
    ])
    expect(names[0]!.flags[0]).toEqual({
      code: 'bad_name',
      message: 'A name holds no comma or line break.',
    })
    expect(names[1]!.flags[0]!.message).toBe('A name can be 100 characters at most.')
  })

  it('gives a word shared across kinds to neither', () => {
    const names = sourceNames(
      [
        member('dbt:orders.revenue', { title: 'Revenue', synonyms: ['Sales'] }),
        member('dbt:orders.channel', {
          kind: 'dimension',
          valueType: 'categorical',
          synonyms: ['Sales', 'Route'],
        }),
        member('dbt:orders.sales', { title: 'Sales' }),
      ],
      [],
      noHolders,
      nothingLeft,
    )
    const alias = (key: string) => names.find((n) => n.key === key)!.aliases
    expect(alias('metric:revenue')).toEqual([])
    expect(alias('dim:channel')).toEqual(['Route'])
    expect(names.every((n) => n.state === 'ready')).toBe(true)
  })

  it('keeps a live name from taking a word a term people wrote has, and flags differing titles', () => {
    const live: KnownTerm = {
      key: 'dim:market',
      kind: 'dimension',
      name: 'Market',
      aliases: ['Region'],
      areaId: null,
      definitionRefs: ['cube:orders.market'],
      open: false,
    }
    const term: WordHolder = { origin: 'term', id: 't1', name: 'Sales', sameAs: null, by: 'Maria' }
    const members = [
      member('cube:orders.market', { kind: 'dimension', valueType: 'string', mergeDimensions: 'by-name' }),
      member('cube:returns.market', {
        kind: 'dimension',
        valueType: 'string',
        mergeDimensions: 'by-name',
        title: 'Returns Country',
        synonyms: ['Sales', 'Territory'],
      }),
    ]
    const [name] = sourceNames(members, [live], new Map([['sales', [term]]]), nothingLeft)
    expect(name!.aliases).toEqual(['Region', 'Territory'])
    expect(name).toMatchObject({ state: 'flagged' })
    expect(name!.flags[0]!.code).toBe('titles_differ')
  })

  it('refuses two names that go by one word, aliases included', () => {
    const chosen = new Map([
      ['metric:a', ['Alpha', 'Sales']],
      ['dim:b', ['Sales']],
    ])
    expect(nameRefusal('dim:b', 'Sales', noHolders, chosen)).toContain('“Sales”')
    expect(nameRefusal('metric:a', 'Alpha', noHolders, chosen)).toContain('“Sales”')
    expect(nameRefusal('dim:b', 'Beta', noHolders, new Map([...chosen, ['dim:b', ['Beta']]]))).toBe(
      null,
    )
  })

  it('drops another name someone else already has, rather than flag the metric', () => {
    const term: WordHolder = {
      origin: 'term',
      id: 't1',
      name: 'Purchases',
      sameAs: null,
      by: 'Maria',
    }
    const names = sourceNames(
      [member('dbt:orders.orders', { title: 'Orders', synonyms: ['purchases', 'order count'] })],
      [],
      new Map([['purchases', [term]]]),
      nothingLeft,
    )
    expect(names[0]).toMatchObject({ state: 'ready', aliases: ['order count'] })
  })

  it('offers the rest of a live dimension as ready, without flags', () => {
    const live: KnownTerm = {
      key: 'dim:market',
      kind: 'dimension',
      name: 'Market',
      aliases: [],
      areaId: null,
      definitionRefs: ['cube:orders.market'],
      open: false,
    }
    const members = ['cube:orders.market', 'cube:returns.market'].map((ref) =>
      member(ref, { kind: 'dimension', valueType: 'string', mergeDimensions: 'by-name' }),
    )
    const holder: WordHolder = { origin: 'vocabulary', ref: 'dim:market', name: 'Market' }
    const [name] = sourceNames(members, [live], new Map([['market', [holder]]]), nothingLeft)
    expect(name).toMatchObject({
      key: 'dim:market',
      state: 'ready',
      linked: ['cube:orders.market'],
      flags: [],
    })
  })
})

describe('accepting a name', () => {
  const held: WordHolders = new Map([
    ['net sales', [{ origin: 'vocabulary', ref: 'metric:net_sales', name: 'Net sales' }]],
  ])

  it('takes a free word, and the word its own term has', () => {
    expect(nameRefusal('metric:orders', 'Orders', held, new Map())).toBeNull()
    expect(nameRefusal('metric:net_sales', 'Net sales', held, new Map())).toBeNull()
  })

  it('refuses a word with another meaning, and says who has it', () => {
    expect(nameRefusal('metric:orders', ' net  SALES', held, new Map())).toBe(
      '“net SALES” is already a name for Net sales.',
    )
  })

  it('takes a word that is only what a source calls another live term', () => {
    const renamed: WordHolders = new Map([
      ['revenue', [{ origin: 'source', ref: 'metric:shop_revenue', name: 'Shop revenue' }]],
    ])
    expect(nameRefusal('metric:revenue', 'Revenue', renamed, new Map())).toBeNull()
  })

  it('refuses two names of one step that read as one word', () => {
    expect(
      nameRefusal(
        'metric:a',
        'Revenue',
        noHolders,
        new Map([
          ['metric:a', 'Revenue'],
          ['metric:b', 'revenue'],
        ]),
      ),
    ).toContain('two definitions the name')
  })

  it('refuses a name that is empty, too long or holds a comma', () => {
    expect(nameRefusal('metric:a', '  ', noHolders, new Map())).toBe('Give it a name.')
    expect(nameRefusal('metric:a', 'x'.repeat(101), noHolders, new Map())).toContain('100')
    expect(nameRefusal('metric:a', 'a, b', noHolders, new Map())).toContain('comma')
  })

  it('lists the words of a list of terms once each', () => {
    expect(
      wordsOf([
        { name: 'Orders', aliases: ['Purchases'] },
        { name: 'ORDERS', aliases: [] },
      ]),
    ).toEqual(['orders', 'purchases'])
  })
})
