import { ORPCError } from '@orpc/client'
import type {
  CreateReport,
  MyReports,
  Report,
  ReportOutcome,
  SentReport,
} from '../../../contract/reports.ts'
import type { Queryable } from '../../db/database.ts'

/*
  Named reports (FR-622; docs/product.md, section 9). A person sends one from Ask as themselves:
  the question, the part that is wrong, what is wrong and, optionally, the correct version and a
  link. It is filed on the item it is about, in that item's domain, and reaches that domain's
  owners as a Reported card (the Inbox, src/server/modules/inbox). What the owners did after it is
  read by cl_report_outcome, so its sender sees it in their chat. Row security keeps a report to
  its sender, the owners of its domain and administrators (db/migrations/0013_named_reports.sql);
  the MCP read path has no grant on it, and nothing an edition holds is built from it.
*/

/** Times as ISO 8601, so the app reads them alike. */
const iso = (column: string) => `to_json(${column})#>>'{}'`

type Row = Omit<Report, 'outcome'> & { outcome: ReportOutcome | null; outcomeAt: string | null }

const select = `select r.id::text, r.question, r.item_id as "itemId", r.part, ${iso('r.created_at')} as at,
       o.outcome, ${iso('o.decided_at')} as "outcomeAt"
  from reports r left join lateral cl_report_outcome(r.id) o on true`

const reportOf = ({ outcome, outcomeAt, ...row }: Row): Report => ({
  ...row,
  outcome: outcome && outcomeAt ? { kind: outcome, at: outcomeAt } : null,
})

export function createReportsService(tx: Queryable) {
  return {
    /**
     * Files a report on its item, in the item's domain. An item the person may not read is one
     * that does not exist for them, as everywhere else.
     */
    async create(input: CreateReport): Promise<SentReport> {
      const [item] = await tx.query<{ area: string }>(
        `select v.area_id as area from item_version_service s join item_versions v on v.id = s.version_id
          where s.item_id = $1 and cl_item_open($1)
          order by lower(s.editions) desc limit 1`,
        [input.itemId],
      )
      if (!item) throw new ORPCError('NOT_FOUND')
      const [row] = await tx.query<SentReport>(
        `insert into reports (person_id, area_id, item_id, part, question, what, correction, link)
         values (cl_person(), $1, $2, $3, $4, $5, $6, $7) returning id::text, ${iso('created_at')} as at`,
        [
          item.area,
          input.itemId,
          input.part,
          input.question,
          input.what,
          input.correction ?? null,
          input.link ?? null,
        ],
      )
      return row!
    },

    /** The person's own reports of the last 90 days, newest first, each with its outcome. */
    async mine(): Promise<MyReports> {
      const rows = await tx.query<Row>(
        `${select} where r.person_id = cl_person() and r.created_at > now() - interval '90 days'
          order by r.created_at desc, r.id desc limit 200`,
      )
      return { reports: rows.map(reportOf) }
    },
  }
}

export type ReportsService = ReturnType<typeof createReportsService>
