import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { migrate, migrationDirectory } from '../../src/server/db/migrate.ts'
import { testDatabase } from './support.ts'

const { client } = testDatabase({ unmigrated: true })

/*
  0004_agent_contract.sql: the six tools of the agent contract. A database at 0003, with the
  tool ids of the fact wording in what it stored and an admin's own choices, comes out with the
  new ids: merged tools once, the tools that left the list gone (their past calls kept), and
  suggest_context and get_related on unless an admin switched one off on purpose. (A test file
  shares one database, so the whole change is one test.)
*/
const six = [
  'find_context',
  'get_context',
  'get_related',
  'read_context',
  'report',
  'suggest_context',
]

async function atVersion3() {
  const before = await mkdtemp(join(tmpdir(), 'heed-migration-0003-'))
  for (const name of [
    '0001_baseline.sql',
    '0002_edition_digest_byte_order.sql',
    '0003_agent_wording.sql',
  ])
    await copyFile(new URL(name, migrationDirectory), join(before, name))
  expect(await migrate(client, pathToFileURL(`${before}/`))).toBe(3)
  return before
}

it('moves the switches, the policies, the limits and the request log to the six tools', async () => {
  const before = await atVersion3()
  try {
    // What an installation at 0003 holds, and what an admin changed: search switched off, which
    // find_facts keeps on for find_context; give_feedback off, which report_gap keeps on.
    await client.query(
      "update tool_config set enabled = false where tool in ('search_facts', 'give_feedback')",
    )
    await client.query(
      `insert into client_policies (client_label, display_name, tools_allowed, enabled)
       values ('cursor', 'Cursor', array['read_item', 'search_facts', 'get_facts', 'find_facts'], true),
              ('helper', 'Help only', array['search_help'], true)`,
    )
    await client.query(
      `insert into settings_versions (key, version, value, reason)
       values ('limits.mcp_rate_per_minute', 3,
               '{"get_facts": 90, "report_gap": 20, "give_feedback": 10, "search_help": 5}', 'an admin')`,
    )
    await client.query(
      `insert into mcp_requests (hour, client_label, tool, status, app_family)
       values (date_trunc('hour', now(), 'UTC'), 'cursor', 'get_facts', 'ok', 'cursor'),
              (date_trunc('hour', now(), 'UTC'), 'cursor', 'search_facts', 'ok', 'cursor'),
              (date_trunc('hour', now(), 'UTC'), 'cursor', 'give_feedback', 'ok', 'cursor'),
              (date_trunc('hour', now(), 'UTC'), 'cursor', 'search_help', 'ok', 'cursor')`,
    )
    // get_related was switched on and then off again by an admin; draft_context was never
    // touched. The audit log keeps every switch.
    await client.query(
      `insert into audit_log (actor_kind, action, subject_type, subject_id, details)
       values ('system', 'tool.switched_on', 'tool', 'get_related', '{"reason": "Trying it"}'),
              ('system', 'tool.switched_off', 'tool', 'get_related', '{"reason": "Not yet"}')`,
    )

    expect(await migrate(client)).toBe(1)

    const tools = await client.query<{ tool: string; enabled: boolean }>(
      'select tool, enabled from tool_config order by tool',
    )
    // A merged tool is on where either tool it replaces was on, and suggest_context is on for
    // Heed v1; get_related too, but an admin switched it off on purpose, so it stays off.
    expect(tools.rows).toEqual(six.map((tool) => ({ tool, enabled: tool !== 'get_related' })))

    const policies = await client.query<{ label: string; tools: string[] | null }>(
      'select client_label as label, tools_allowed as tools from client_policies order by client_label',
    )
    expect(policies.rows).toEqual([
      { label: 'claude-code', tools: null },
      // Each old id once, as its new tool, in the place it first had.
      { label: 'cursor', tools: ['read_context', 'find_context', 'get_context'] },
      { label: 'eval', tools: null },
      // A policy that named only a tool that left the list allows none.
      { label: 'helper', tools: [] },
      { label: 'signed-in', tools: null },
    ])

    // A new version of the setting; a merged tool keeps the tighter limit.
    const limits = await client.query<{ version: number; value: unknown; reason: string }>(
      `select version, value, reason from settings_versions
        where key = 'limits.mcp_rate_per_minute' order by version`,
    )
    expect(limits.rows.map((row) => row.version)).toEqual([1, 2, 3, 4])
    expect(limits.rows[3]!.value).toEqual({ get_context: 90, report: 10 })
    expect(limits.rows[3]!.reason).toMatch(/^the agent contract/)

    // Health keeps one row per tool across the change; a tool that left the list keeps its own.
    const calls = await client.query<{ tool: string }>(
      'select tool from mcp_requests order by tool',
    )
    expect(calls.rows.map((row) => row.tool)).toEqual([
      'find_context',
      'get_context',
      'report',
      'search_help',
    ])
    expect(await migrate(client)).toBe(0)
  } finally {
    await rm(before, { recursive: true })
  }
})
