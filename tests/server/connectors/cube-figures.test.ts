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
    measures: { name: string; aggType?: string; meta?: Record<string, unknown> }[]
  }[]
}

/** A Cube on an address of its own: its `/v1/meta`, and a load that answers with `value`. */
function cube({
  meta,
  metaStatus = 200,
  value = '1200',
}: {
  meta?: Meta
  metaStatus?: number
  value?: string
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
      return Promise.resolve(json(200, { data: [{ [query.measures[0]!]: value }] }))
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
    const read = await readCubeFigure(tool.context, query({ dates: ['sales.order_day'] }))
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
    expect(await failure(readCubeFigure(down.context, query()))).toBe('unreachable')
    // The server's setting still names one, so the figure is read.
    const named = cube({ metaStatus: 503 })
    expect(
      await readCubeFigure(named.context, query({ settings: { date: 'order_day' } })),
    ).toMatchObject({ value: 1200, aggregation: null, date: 'sales.order_day' })
  })
})
