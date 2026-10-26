import type pg from 'pg'
import type { AnonymousStore } from './records.ts'

export function createAnonymousStore(pool: pg.Pool): AnonymousStore {
  return {
    /**
     * One transaction and three set-based statements per batch, so a burst of calls is written as
     * fast as it arrives and the bounded queue does not drop records (and with them, counts).
     */
    async write(records) {
      const deliveries = records.flatMap((r) => (r.kind === 'delivery' ? [r.value] : []))
      const requests = records.flatMap((r) => (r.kind === 'request' ? [r.value] : []))
      const topics = [
        ...new Map(deliveries.flatMap((d) => (d.topic ? [[d.topic.key, d.topic]] : []))).values(),
      ]
      const client = await pool.connect()
      try {
        await client.query('begin')
        if (topics.length)
          await client.query(
            `insert into topics (key,area_id,metric_keys,value_keys,dimension_keys,month)
             select t.key, t.area, t.metrics, t.value_keys, t.dimensions, t.month
               from jsonb_to_recordset($1) as t(key text, area text, metrics text[], value_keys text[],
                      dimensions text[], month date)
             on conflict (key) do nothing`,
            [JSON.stringify(topics.map(({ values, ...t }) => ({ ...t, value_keys: values })))],
          )
        if (deliveries.length)
          await client.query(
            `insert into deliveries (id,delivered_hour,client_label,caller,edition_seq,overlay_seq,tool_schema_digest,scope,status,delivered,withheld,cut,response_bytes,duration_ms,topic_id)
             select d.id, d.hour, d.client, d.caller::caller_kind, d.edition, d.overlay, d.digest, coalesce(d.scope, '{}'),
                    d.status::delivery_status, d.delivered, d.withheld, d.cut, d.bytes, d.duration, t.id
               from jsonb_to_recordset($1) as d(id uuid, hour timestamptz, client text, caller text, edition bigint,
                      overlay bigint, digest text, scope jsonb, status text, delivered jsonb, withheld jsonb, cut boolean,
                      bytes int, duration int, topic text)
               left join topics t on t.key = d.topic`,
            [JSON.stringify(deliveries.map((d) => ({ ...d, topic: d.topic?.key ?? null })))],
          )
        if (requests.length)
          await client.query(
            `insert into mcp_requests (id,hour,client_label,app_family,tool,status,result_status,duration_ms,edition_seq,response_bytes)
             select r.id, r.hour, r.client, r.family, r.tool, r.status, r.result, r.duration, r.edition, r.bytes
               from jsonb_to_recordset($1) as r(id uuid, hour timestamptz, client text, family text, tool text,
                      status text, result text, duration int, edition bigint, bytes int)`,
            [JSON.stringify(requests)],
          )
        await client.query('commit')
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    },
    async reportGap(topic, note) {
      const row = await pool.query<{ id: string }>(
        'select serving_report_gap($1,$2,$3,$4,$5,$6,$7) as id',
        [
          topic.key,
          topic.area,
          topic.metrics,
          topic.values,
          topic.dimensions,
          topic.month,
          note ?? null,
        ],
      )
      return row.rows[0]!.id
    },
    async feedback(delivery, verdict, client, note) {
      await pool.query(
        'insert into feedback (delivery_id,verdict,client_label,note) values ($1,$2,$3,$4)',
        [delivery, verdict, client, note ?? null],
      )
    },
  }
}
