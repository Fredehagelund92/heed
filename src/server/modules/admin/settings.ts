import { ORPCError } from '@orpc/client'
import {
  type Setting,
  type SettingKey,
  settingSchemas,
  unknownToolsMessage,
} from '../../../contract/admin.ts'
import { canonicalJson } from '../../../domain/canonical.ts'
import type { Queryable } from '../../db/database.ts'
import { ModelConfigError } from '../models/index.ts'
import { plainReason, recordAudit } from './audit.ts'

const columns = `key,version,value,changed_at::text as "changedAt",changed_by::text as "changedBy",reason`
type Row = Omit<Setting, 'editable'>

const editable = (key: string): key is SettingKey => Object.hasOwn(settingSchemas, key)
const withEditable = (row: Row): Setting => ({ ...row, editable: editable(row.key) })

/** The current version of every setting (FR-809). */
export async function listSettings(tx: Queryable): Promise<Setting[]> {
  const rows = await tx.query<Row>(
    `select distinct on (key) ${columns} from settings_versions order by key,version desc`,
  )
  return rows.map(withEditable)
}

export async function settingHistory(tx: Queryable, key: string): Promise<Setting[]> {
  const rows = await tx.query<Row>(
    `select ${columns} from settings_versions where key=$1 order by version desc`,
    [key],
  )
  if (!rows.length) throw new ORPCError('NOT_FOUND', { message: "We couldn't find this setting." })
  return rows.map(withEditable)
}

/**
 * A change is a new version with a reason, never an update, and the history log names who made
 * it (FR-806). The caller passes the version they read, so two administrators cannot overwrite
 * each other without seeing it.
 */
export async function setSetting(
  tx: Queryable,
  input: { key: string; version: number; value: unknown; reason: string },
  validTools: () => Promise<readonly string[]>,
  /** Refuses a value the service cannot serve, such as a model its providers do not list. */
  checkValue: (key: string, value: unknown) => void = () => {},
): Promise<Setting> {
  plainReason(input.reason)
  if (!editable(input.key))
    throw new ORPCError('UNPROCESSABLE_CONTENT', {
      message: "You can't change this setting here. The data team sets it where the app runs.",
    })
  const parsed = settingSchemas[input.key].safeParse(input.value)
  if (!parsed.success)
    throw new ORPCError('UNPROCESSABLE_CONTENT', {
      message: parsed.error.issues
        .map((i) => [i.path.join('.'), i.message].filter(Boolean).join(': '))
        .join('; '),
    })
  if (input.key === 'limits.mcp_rate_per_minute') {
    const tools = await validTools()
    const unknown = Object.keys(parsed.data as Record<string, number>).filter(
      (tool) => !tools.includes(tool),
    )
    if (unknown.length)
      throw new ORPCError('UNPROCESSABLE_CONTENT', {
        message: unknownToolsMessage(unknown),
      })
  }
  try {
    checkValue(input.key, parsed.data)
  } catch (error) {
    if (!(error instanceof ModelConfigError)) throw error
    throw new ORPCError('UNPROCESSABLE_CONTENT', { message: error.message })
  }
  // One writer per key at a time; the primary key catches any other race.
  await tx.query("select pg_advisory_xact_lock(hashtextextended('heed.setting:' || $1,0))", [
    input.key,
  ])
  const [current] = await tx.query<Row>(
    `select ${columns} from settings_versions where key=$1 order by version desc limit 1`,
    [input.key],
  )
  if (!current) throw new ORPCError('NOT_FOUND', { message: "We couldn't find this setting." })
  if (current.version !== input.version)
    throw new ORPCError('CONFLICT', {
      message:
        'Someone changed this setting after you opened it. Look at the latest value, then try again.',
    })
  const value = JSON.parse(canonicalJson(parsed.data)) as unknown
  const [saved] = await tx.query<Row>(
    `insert into settings_versions(key,version,value,changed_by,reason) values($1,$2,$3,cl_person(),$4)
     returning ${columns}`,
    [input.key, current.version + 1, JSON.stringify(value), input.reason],
  )
  await recordAudit(tx, {
    action: 'setting.changed',
    subjectType: 'setting',
    subjectId: input.key,
    details: { from: current.version, to: saved!.version, value, reason: input.reason },
  })
  return withEditable(saved!)
}
