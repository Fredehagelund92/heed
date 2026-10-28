import { ORPCError } from '@orpc/client'
import type { AlertRaise, AlertRuleRecord, AlertRules } from '../../../contract/alerts.ts'
import {
  alertRule,
  alertRuleIds,
  type AlertAudience,
  type AlertRuleId,
} from '../../../domain/alerts.ts'
import type { Queryable } from '../../db/database.ts'
import { recordAudit, setSetting } from '../admin/index.ts'

/*
  Alerts on the service (FR-621, src/domain/alerts.ts), read and changed by the signed-in person
  inside the request's transaction. Row security decides what each reads: every raise for an
  administrator, those about their own domains for an owner, and only their own mutes. An
  administrator turns a rule on or off and sets its threshold; the Not found rule's threshold is
  the gap detection's own setting, so changing it there changes the setting, with its history. An
  owner mutes a rule only for a domain they own.
*/

const raiseFields = `r.id::text, r.rule, r.area_ids as "areaIds", r.title, r.subject,
  to_char(r.raised_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "raisedAt"`

type RuleRow = {
  rule: AlertRuleId
  enabled: boolean
  threshold: number | null
  audience: AlertAudience
}

export function createAlertsService(tx: Queryable) {
  /** Whom each raise reached, by name, for the raises the person may read. */
  async function withReached(rows: Omit<AlertRaise, 'reached'>[]): Promise<AlertRaise[]> {
    if (!rows.length) return []
    const reached = await tx.query<{ id: string; names: string[] }>(
      'select raise_id::text as id, names from cl_alert_reached($1::uuid[])',
      [rows.map((r) => r.id)],
    )
    const names = new Map(reached.map((r) => [r.id, r.names]))
    return rows.map((r) => ({ ...r, reached: names.get(r.id) ?? [] }))
  }

  /** The gap detection's setting, which holds the Not found rule's threshold. */
  async function gapSetting() {
    const [row] = await tx.query<{ version: number; value: { calls: number; days: number } }>(
      `select version, value from settings_versions where key = 'gaps.no_item_threshold'
        order by version desc limit 1`,
    )
    return row ?? null
  }

  async function rules(): Promise<AlertRules> {
    const rows = await tx.query<RuleRow>(
      'select rule, enabled, threshold, audience from alert_rules',
    )
    const gap = await gapSetting()
    const mutes = await tx.query<{ rule: AlertRuleId; area: string }>(
      `select rule, area_id as area from alert_mutes where person_id = cl_person()
        order by area_id`,
    )
    const last = await withReached(
      await tx.query<Omit<AlertRaise, 'reached'>>(
        `select distinct on (r.rule) ${raiseFields} from alert_raises r
          order by r.rule, r.raised_at desc, r.id desc`,
      ),
    )
    return {
      rules: alertRuleIds.flatMap((id) => {
        const row = rows.find((r) => r.rule === id)
        if (!row) return []
        return [
          {
            rule: id,
            enabled: row.enabled,
            threshold: id === 'gap' ? (gap?.value.calls ?? null) : row.threshold,
            audience: row.audience,
            mutedFor: mutes.filter((m) => m.rule === id).map((m) => m.area),
            last: last.find((r) => r.rule === id) ?? null,
          },
        ]
      }),
    }
  }

  const one = async (id: AlertRuleId): Promise<AlertRuleRecord> =>
    (await rules()).rules.find((r) => r.rule === id)!

  return {
    rules,

    async setRule(input: {
      rule: AlertRuleId
      enabled?: boolean | undefined
      threshold?: number | undefined
    }): Promise<AlertRuleRecord> {
      const { rule, enabled, threshold } = input
      if (threshold !== undefined) {
        const offered = alertRule(rule).threshold
        if (!offered?.choices.includes(threshold))
          throw new ORPCError('UNPROCESSABLE_CONTENT', {
            message: "This rule's sentence doesn't offer that threshold.",
          })
        if (offered.setting === 'gaps.no_item_threshold') {
          const current = await gapSetting()
          if (!current)
            throw new ORPCError('NOT_FOUND', { message: "We couldn't find this setting." })
          if (current.value.calls !== threshold)
            await setSetting(
              tx,
              {
                key: 'gaps.no_item_threshold',
                version: current.version,
                value: { ...current.value, calls: threshold },
                reason: `Alerts: Not found at ${threshold} or more times.`,
              },
              () => Promise.resolve([]),
            )
        } else
          await tx.query(
            `update alert_rules set threshold = $2, changed_by = cl_person(), changed_at = now()
              where rule = $1`,
            [rule, threshold],
          )
      }
      if (enabled !== undefined)
        await tx.query(
          `update alert_rules set enabled = $2, changed_by = cl_person(), changed_at = now()
            where rule = $1`,
          [rule, enabled],
        )
      if (enabled !== undefined || threshold !== undefined)
        await recordAudit(tx, {
          action: 'alert.rule_changed',
          subjectType: 'alert_rule',
          subjectId: rule,
          details: {
            ...(enabled !== undefined ? { enabled } : {}),
            ...(threshold !== undefined ? { threshold } : {}),
          },
        })
      return one(rule)
    },

    async mute(input: {
      rule: AlertRuleId
      areaIds: string[]
      muted: boolean
    }): Promise<AlertRuleRecord> {
      if (alertRule(input.rule).audience === 'admins')
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          message: "This rule's cards go only to admins, so there is nothing to mute.",
        })
      const areas = [...new Set(input.areaIds)]
      const [owned] = await tx.query<{ all: boolean }>(
        'select bool_and(cl_is_owner_now(a)) as all from unnest($1::text[]) a',
        [areas],
      )
      if (!owned?.all)
        throw new ORPCError('FORBIDDEN', {
          message: 'You can mute an alert only for a domain you own.',
        })
      if (input.muted)
        await tx.query(
          `insert into alert_mutes (person_id, area_id, rule)
           select cl_person(), a, $2 from unnest($1::text[]) a
           on conflict (person_id, area_id, rule) do nothing`,
          [areas, input.rule],
        )
      else
        await tx.query(
          `delete from alert_mutes where person_id = cl_person() and rule = $2
              and area_id = any($1::text[])`,
          [areas, input.rule],
        )
      return one(input.rule)
    },

    async raised({ limit = 20 }: { limit?: number | undefined }): Promise<AlertRaise[]> {
      return withReached(
        await tx.query<Omit<AlertRaise, 'reached'>>(
          `select ${raiseFields} from alert_raises r order by r.raised_at desc, r.id desc limit $1`,
          [limit],
        ),
      )
    },
  }
}

export type AlertsService = ReturnType<typeof createAlertsService>
