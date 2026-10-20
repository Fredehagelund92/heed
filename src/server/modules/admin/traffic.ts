import type { TrafficSummary } from '../../../contract/admin.ts'
import type { Queryable } from '../../db/database.ts'

/**
 * MCP traffic by client and tool (FR-410), for the MCP and gateway page. It reads the request
 * log, which holds the hour, the client label, the kind of AI app, the tool, the status, a read's
 * outcome, the duration and the size, and never a person, a question, a token, an address or an
 * app's own name; nothing here adds one. The kind of AI app is counted by the week elsewhere
 * (`quality` service, `apps`), so its small counts can be hidden.
 */
export async function trafficSummary(tx: Queryable, days: number): Promise<TrafficSummary> {
  const [window] = await tx.query<{ from: string; to: string; retention: number }>(
    `with h as (select date_trunc('hour', now(), 'UTC') + interval '1 hour' as upper)
     select to_char((upper - make_interval(days => $1)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "from",
            to_char(upper at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "to",
            (select (value #>> '{}')::int from settings_current where key = 'retention.request_log_days') as retention
       from h`,
    [days],
  )
  const rows = await tx.query<TrafficSummary['rows'][number] & { total: boolean }>(
    `select grouping(r.client_label, r.tool) = 3 as total,
       coalesce(r.client_label, '') as client, max(p.display_name) as "clientName", coalesce(r.tool, '') as tool,
       count(*)::int as calls,
       (count(*) filter (where r.status = 'ok'))::int as ok,
       (count(*) filter (where r.status = 'error'))::int as errors,
       (count(*) filter (where r.status = 'invalid_input'))::int as "invalidInput",
       (count(*) filter (where r.status = 'rate_limited'))::int as "rateLimited",
       (count(*) filter (where r.status = 'forbidden'))::int as forbidden,
       (count(*) filter (where r.status = 'unauthorized'))::int as unauthorized,
       round(percentile_cont(0.5) within group (order by r.duration_ms))::int as "medianMs",
       round(percentile_cont(0.95) within group (order by r.duration_ms))::int as "p95Ms",
       coalesce(sum(r.response_bytes), 0)::float8 as bytes,
       to_char(max(r.hour) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "lastHour"
     from mcp_requests r left join client_policies p on p.client_label = r.client_label
     where r.hour >= $1::timestamptz and r.hour < $2::timestamptz
     group by grouping sets ((r.client_label, r.tool), ())
     order by total desc, calls desc, r.client_label collate "C", r.tool collate "C"`,
    [window!.from, window!.to],
  )
  // The empty grouping set adds one row over every call, even when there was none.
  const {
    total: _total,
    client: _client,
    clientName: _name,
    tool: _tool,
    ...totals
  } = rows.find((row) => row.total)!
  return {
    from: window!.from,
    to: window!.to,
    retentionDays: window!.retention,
    total: totals,
    rows: rows.filter((row) => !row.total).map(({ total: _total, ...row }) => row),
  }
}
