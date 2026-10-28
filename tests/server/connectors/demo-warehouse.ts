import pg from 'pg'
import { shiftDate } from '../../../src/domain/validity.ts'
import { figureSeries } from '../../../src/app/api/mock/data/figure-series.ts'

/*
  The demo warehouse for figures in Ask: Larchwood Outdoor's invented payments and marketing costs
  a day at a time, in the tables the demo Cube model reads (db/seed/cube: `demo.order_payments`,
  `demo.marketing_daily`), in a PostgreSQL database of its own. A stand-in Cube on this machine
  answers figures from it (cube-server.ts). The numbers are the mock's (figure-series.ts), so an
  answer reads the same figure in both modes. Markets are kept by the names Definitions gives
  them, which is what a figure's query filters on.
*/

/** Makes the demo warehouse's tables in a database and fills them; any that were there go first. */
export async function seedDemoWarehouse(url: string) {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await client.query(`
      drop schema if exists demo cascade;
      create schema demo;
      create table demo.order_payments (
        order_id text primary key,
        market_code text not null,
        order_day date not null,
        order_amount numeric not null,
        refund_amount numeric not null default 0
      );
      create table demo.marketing_daily (
        marketing_day date not null,
        market_code text not null,
        discount_eur numeric not null default 0,
        spend_eur numeric not null default 0,
        first_time_buyers integer not null default 0,
        attributed_revenue_eur numeric not null default 0,
        paid_media_spend_eur numeric not null default 0,
        new_accounts integer not null default 0
      );`)
    let order = 0
    for (const series of figureSeries)
      for (const [i, amount] of series.days.entries()) {
        const day = shiftDate(series.from, i)
        if (series.metric === 'discount_cost')
          await client.query(
            'insert into demo.marketing_daily (marketing_day, market_code, discount_eur) values ($1, $2, $3)',
            [day, series.market, amount],
          )
        else
          await client.query(
            `insert into demo.order_payments (order_id, market_code, order_day, order_amount, refund_amount)
             values ($1, $2, $3, $4, $5)`,
            [
              `ord_${String(++order).padStart(6, '0')}`,
              series.market,
              day,
              series.metric === 'orders' ? amount : 0,
              series.metric === 'returns' ? amount : 0,
            ],
          )
      }
  } finally {
    await client.end()
  }
}
