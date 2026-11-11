import { describe, expect, it } from 'vitest'
import { readCubeFigure } from '../../../src/connectors/cube/figures.ts'
import {
  SourceError,
  type FigureContext,
  type FigureQuery,
} from '../../../src/domain/connector-runtime.ts'

/*
  Cube's figure reader against a Cube that answers from memory, through the fetch a figure gets:
  `/v1/meta` with what an invented model says of its members, and `/v1/load` with one row. Each
  test has its own address, so what `/v1/meta` said is never kept from one test to the next.
*/

let tests = 0

type Meta = {
  cubes: {
    name: string
    meta?: Record<string, unknown>
    measures: {
      name: string
      aggType?: string
      format?: unknown
      currency?: string
      meta?: Record<string, unknown>
    }[]
  }[]
}

/** A Cube on an address of its own: its `/v1/meta`, and a load that answers with `value`. */
function cube({
  meta,
  metaStatus = 200,
  value = '1200',
  loadAnswer,
  annotation,
}: {
  meta?: Meta
  metaStatus?: number
  value?: string
  /** What every load answers instead of the row. */
  loadAnswer?: { status: number; body: unknown }
  /** What the load's annotation says of the measure: its format, currency and meta. */
  annotation?: Record<string, unknown>
}) {
  tests += 1
  const endpoint = `https://cube-${tests}.example.test/cubejs-api/v1/load`
  const loads: unknown[] = []
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  const context: FigureContext = {
    endpoint,
    token: 'invented-cube-token',
    signal: new AbortController().signal,
    now: () => new Date('2026-10-23T09:00:00Z'),
    fetch: (url) => {
      const address = new URL(url)
      if (address.pathname.endsWith('/meta'))
        return Promise.resolve(json(metaStatus, meta ?? { cubes: [] }))
      const query = JSON.parse(address.searchParams.get('query')!) as { measures: string[] }
      loads.push(query)
      if (loadAnswer) return Promise.resolve(json(loadAnswer.status, loadAnswer.body))
      const measure = query.measures[0]!
      return Promise.resolve(
        json(200, {
          data: [{ [measure]: value }],
          ...(annotation ? { annotation: { measures: { [measure]: annotation } } } : {}),
        }),
      )
    },
  }
  return { context, loads }
}

const sales = (viewMeta?: Record<string, unknown>, measureMeta?: Record<string, unknown>) => ({
  cubes: [
    {
      name: 'sales',
      ...(viewMeta ? { meta: viewMeta } : {}),
      measures: [
        { name: 'sales.revenue', aggType: 'sum', ...(measureMeta ? { meta: measureMeta } : {}) },
      ],
    },
  ],
})

const query = (more: Partial<FigureQuery> = {}): FigureQuery => ({
  metric: 'sales.revenue',
  dates: ['sales.invoice_day', 'sales.order_day', 'sales.ship_day'],
  from: '2026-08-01',
  to: '2026-08-31',
  filters: [],
  ...more,
})

const dateOf = (load: unknown) =>
  (load as { timeDimensions: { dimension: string }[] }).timeDimensions[0]!.dimension

const failure = async (read: Promise<unknown>) => {
  const error = await read.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(SourceError)
  return (error as SourceError).code
}

describe('the date a figure is read by', () => {
  it("is the view's only date, without asking what the model names", async () => {
    const tool = cube({ metaStatus: 503 })
    const read = await readCubeFigure(
      tool.context,
      query({ dates: ['sales.order_day'], settings: { additive: true } }),
    )
    expect(read).toMatchObject({ value: 1200, date: 'sales.order_day' })
    expect(tool.loads.map(dateOf)).toEqual(['sales.order_day'])
  })

  it("is the one the view's meta.default_time_dimension names, by its own name or in full", async () => {
    for (const named of ['order_day', 'sales.order_day']) {
      const tool = cube({ meta: sales({ default_time_dimension: named }) })
      expect(await readCubeFigure(tool.context, query())).toMatchObject({
        value: 1200,
        aggregation: 'sum',
        date: 'sales.order_day',
      })
      expect(tool.loads.map(dateOf)).toEqual(['sales.order_day'])
    }
  })

  it("is the measure's own before its view's, and the model's before the server's settings", async () => {
    const tool = cube({
      meta: sales({ default_time_dimension: 'order_day' }, { default_time_dimension: 'ship_day' }),
    })
    const read = await readCubeFigure(tool.context, query({ settings: { date: 'invoice_day' } }))
    expect(read.date).toBe('sales.ship_day')
  })

  it("is the server's setting when the model names none, or a date the view does not have", async () => {
    for (const viewMeta of [undefined, { default_time_dimension: 'paid_day' }]) {
      const tool = cube({ meta: sales(viewMeta) })
      const read = await readCubeFigure(tool.context, query({ settings: { date: 'invoice_day' } }))
      expect(read.date).toBe('sales.invoice_day')
    }
  })

  it('is never guessed: with several and none named, the read says so and loads nothing', async () => {
    const tool = cube({ meta: sales() })
    expect(await failure(readCubeFigure(tool.context, query()))).toBe('several_dates')
    expect(
      await failure(readCubeFigure(tool.context, query({ settings: { date: 'paid_day' } }))),
    ).toBe('several_dates')
    expect(tool.loads).toEqual([])
  })

  it('says why Cube could not be asked what the model names, rather than that there are several', async () => {
    const refused = cube({ metaStatus: 401 })
    expect(await failure(readCubeFigure(refused.context, query()))).toBe('unauthorized')
    const down = cube({ metaStatus: 503 })
    expect(
      await failure(readCubeFigure(down.context, query({ settings: { additive: true } }))),
    ).toBe('unreachable')
    // The server's setting still names one, so the figure is read.
    const named = cube({ metaStatus: 503 })
    expect(
      await readCubeFigure(
        named.context,
        query({ settings: { date: 'order_day', additive: true } }),
      ),
    ).toMatchObject({ value: 1200, aggregation: null, date: 'sales.order_day' })
  })
})

describe('a measure the token may not read', () => {
  // Cube's own words for a member its access policy hides from the token, as 1.7.39 answers.
  const hidden = {
    error:
      "Error: You requested hidden member: 'sales.revenue'. Please make it visible using `public: true`.",
  }
  const one = { dates: ['sales.order_day'] }

  it('is not allowed, not unreachable, when Cube answers 500 with its hidden member error', async () => {
    const tool = cube({ loadAnswer: { status: 500, body: hidden } })
    const error = await readCubeFigure(tool.context, query(one)).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'not_allowed', errorClass: 'config' })
    // Only the code is kept: nothing of Cube's words.
    expect(JSON.stringify({ ...(error as object), message: (error as Error).message })).not.toMatch(
      /hidden|sales\.revenue/,
    )
  })

  it('is still unreachable for any other server error', async () => {
    for (const loadAnswer of [
      { status: 500, body: { error: 'Error: connection to the warehouse was lost' } },
      { status: 500, body: 'Internal error' },
      { status: 503, body: hidden },
    ]) {
      const tool = cube({ loadAnswer })
      expect(await failure(readCubeFigure(tool.context, query(one)))).toBe('unreachable')
    }
  })
})

describe('a measure that does not add up over days', () => {
  const stock = (measureMeta?: Record<string, unknown>) => ({
    cubes: [
      {
        name: 'stock',
        measures: [
          {
            name: 'stock.units_on_hand',
            aggType: 'sum',
            ...(measureMeta ? { meta: measureMeta } : {}),
          },
        ],
      },
    ],
  })
  const onHand = (more: Partial<FigureQuery> = {}) =>
    query({ metric: 'stock.units_on_hand', dates: ['stock.stock_day'], ...more })
  const rangeOf = (load: unknown) =>
    (load as { timeDimensions: { dateRange: string[] }[] }).timeDimensions[0]!.dateRange

  it('is read on the last day when the model marks it with meta.non_additive_dimension', async () => {
    for (const mark of ['stock_day', { name: 'stock_day', window_choice: 'max' }]) {
      const tool = cube({ meta: stock({ non_additive_dimension: mark }) })
      expect(await readCubeFigure(tool.context, onHand())).toMatchObject({
        value: 1200,
        snapshot: true,
      })
      expect(tool.loads.map(rangeOf)).toEqual([['2026-08-31', '2026-08-31']])
    }
  })

  it("is read on the last day when the server's settings say it does not add up", async () => {
    const tool = cube({ meta: stock() })
    const read = await readCubeFigure(tool.context, onHand({ settings: { additive: false } }))
    expect(read.snapshot).toBe(true)
    expect(tool.loads.map(rangeOf)).toEqual([['2026-08-31', '2026-08-31']])
  })

  it('is not read when Cube cannot say whether it adds up and the settings do not either', async () => {
    for (const dates of [['stock.stock_day'], ['stock.stock_day', 'stock.count_day']]) {
      const tool = cube({ metaStatus: 503 })
      expect(await failure(readCubeFigure(tool.context, onHand({ dates })))).toBe('unreachable')
      expect(tool.loads).toEqual([])
    }
  })

  it('is read on the last day when Cube cannot say but the settings say it does not add up', async () => {
    const tool = cube({ metaStatus: 503 })
    const read = await readCubeFigure(tool.context, onHand({ settings: { additive: false } }))
    expect(read.snapshot).toBe(true)
    expect(tool.loads.map(rangeOf)).toEqual([['2026-08-31', '2026-08-31']])
  })

  it("keeps the model's mark over the settings, and adds up anything not marked", async () => {
    const marked = cube({ meta: stock({ non_additive_dimension: 'stock_day' }) })
    expect(
      (await readCubeFigure(marked.context, onHand({ settings: { additive: true } }))).snapshot,
    ).toBe(true)
    const plain = cube({ meta: stock() })
    const read = await readCubeFigure(plain.context, onHand())
    expect(read.snapshot).toBeUndefined()
    expect(plain.loads.map(rangeOf)).toEqual([['2026-08-01', '2026-08-31']])
  })
})

describe('how a value is written', () => {
  const one = { dates: ['sales.order_day'] }
  const formatOf = async (
    annotation: Record<string, unknown> | undefined,
    more: Partial<FigureQuery> = {},
    meta?: Meta,
  ) => (await readCubeFigure(cube({ annotation, meta }).context, query({ ...one, ...more }))).format
  const euros = { kind: 'currency', currency: 'EUR' }

  it("is money in the currency Cube's own currency property names", async () => {
    expect(await formatOf({ format: 'currency', currency: 'EUR' })).toEqual(euros)
    // A named format, as Cube answers it, and a currency with no format at all.
    expect(
      await formatOf({
        format: { type: 'custom-numeric', value: '$,.0f', alias: 'currency_0' },
        currency: 'NOK',
      }),
    ).toEqual({ kind: 'currency', currency: 'NOK' })
    expect(await formatOf({ currency: 'eur' })).toEqual(euros)
  })

  it('is money in the currency meta.currency names, with or without a format', async () => {
    expect(await formatOf({ format: 'currency', meta: { currency: 'EUR' } })).toEqual(euros)
    expect(await formatOf({ meta: { currency: 'EUR' } })).toEqual(euros)
  })

  it('is a share for a percent format, plain or named', async () => {
    expect(await formatOf({ format: 'percent' })).toEqual({ kind: 'percent' })
    expect(
      await formatOf({ format: { type: 'custom-numeric', value: '.1~%', alias: 'percent_1' } }),
    ).toEqual({ kind: 'percent' })
  })

  it("is what /v1/meta says when the load's answer doesn't", async () => {
    const meta = {
      cubes: [
        {
          name: 'sales',
          measures: [{ name: 'sales.revenue', format: 'currency', currency: 'EUR' }],
        },
      ],
    }
    expect(await formatOf(undefined, {}, meta)).toEqual(euros)
  })

  it("fills in what the model leaves unsaid from the server's settings, and never more", async () => {
    expect(await formatOf(undefined, { settings: { format: 'percent' } })).toEqual({
      kind: 'percent',
    })
    expect(await formatOf(undefined, { settings: { currency: 'SEK' } })).toEqual({
      kind: 'currency',
      currency: 'SEK',
    })
    // Money with no code takes the settings' currency.
    expect(await formatOf({ format: 'currency' }, { settings: { currency: 'SEK' } })).toEqual({
      kind: 'currency',
      currency: 'SEK',
    })
    // The model's own word wins: a number stays a number, euros stay euros.
    expect(await formatOf({ format: 'number' }, { settings: { currency: 'SEK' } })).toEqual({
      kind: 'number',
    })
    expect(
      await formatOf({ format: 'currency', currency: 'EUR' }, { settings: { format: 'percent' } }),
    ).toEqual(euros)
  })

  it('is a number when nothing says, or money with no currency anywhere', async () => {
    expect(await formatOf(undefined)).toEqual({ kind: 'number' })
    expect(await formatOf({ format: 'currency' })).toEqual({ kind: 'number' })
    expect(await formatOf({ format: 'accounting', currency: 'not money' })).toEqual({
      kind: 'number',
    })
  })
})
