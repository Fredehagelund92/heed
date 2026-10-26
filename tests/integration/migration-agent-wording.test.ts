import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { migrate, migrationDirectory } from '../../src/server/db/migrate.ts'
import { testDatabase } from './support.ts'

const { client } = testDatabase({ unmigrated: true })

/*
  0003_agent_wording.sql: the product says agent, and three tools say fact in their ids. A database
  that is at 0002, with the old label and the old tool ids in what it stored, comes out of the
  migration with the new ones and everything else as it was (db/README.md: never edit an applied
  migration, so the baseline's seed rows are changed by a migration).
*/
const oldIds = ['get_context', 'search_context', 'find_context'] as const
const newIds = ['get_facts', 'search_facts', 'find_facts'] as const

it('renames the policy label, the tool ids and what is stored under them, and nothing else', async () => {
  const before = await mkdtemp(join(tmpdir(), 'heed-migration-0002-'))
  try {
    for (const name of ['0001_baseline.sql', '0002_edition_digest_byte_order.sql'])
      await copyFile(new URL(name, migrationDirectory), join(before, name))
    expect(await migrate(client, pathToFileURL(`${before}/`))).toBe(2)

    // What an installation at 0002 holds: the baseline's own rows, and what an admin changed.
    const { rows: seeded } = await client.query<{ tool: string }>(
      'select tool from tool_config order by tool',
    )
    expect(seeded.map((row) => row.tool)).toEqual(expect.arrayContaining([...oldIds]))
    await client.query("update tool_config set enabled = false where tool = 'search_context'")
    await client.query(
      `insert into client_policies (client_label, display_name, tools_allowed, enabled)
       values ('cursor', 'Cursor', array['get_context', 'read_item', 'find_context'], true),
              ('plain', 'Plain', array['read_item'], true)`,
    )
    await client.query(
      `insert into settings_versions (key, version, value, reason)
       values ('limits.mcp_rate_per_minute', 2,
               '{"report_gap": 20, "get_context": 90, "find_context": 40}', 'an admin')`,
    )
    await client.query(
      `insert into mcp_requests (hour, client_label, tool, status, app_family)
       values (date_trunc('hour', now(), 'UTC'), 'cursor', 'get_context', 'ok', 'cursor'),
              (date_trunc('hour', now(), 'UTC'), 'cursor', 'read_item', 'ok', 'cursor')`,
    )

    expect(await migrate(client)).toBe(1)

    const tools = await client.query<{ tool: string; enabled: boolean }>(
      'select tool, enabled from tool_config order by tool',
    )
    expect(tools.rows.map((row) => row.tool)).toEqual(
      expect.arrayContaining([...newIds, 'read_item', 'draft_context']),
    )
    expect(tools.rows.some((row) => (oldIds as readonly string[]).includes(row.tool))).toBe(false)
    // An admin's switch moves with the tool.
    expect(tools.rows.find((row) => row.tool === 'search_facts')?.enabled).toBe(false)
    expect(tools.rows.find((row) => row.tool === 'get_facts')?.enabled).toBe(true)

    const policies = await client.query<{ label: string; name: string; tools: string[] | null }>(
      `select client_label as label, display_name as name, tools_allowed as tools
         from client_policies order by client_label`,
    )
    expect(policies.rows).toEqual([
      { label: 'claude-code', name: 'Claude Code with a token', tools: null },
      { label: 'cursor', name: 'Cursor', tools: ['get_facts', 'read_item', 'find_facts'] },
      { label: 'eval', name: 'Evaluation runner', tools: null },
      { label: 'plain', name: 'Plain', tools: ['read_item'] },
      { label: 'signed-in', name: 'Agents people sign in with', tools: null },
    ])

    // The setting is a new version, since a setting's history is never edited.
    const limits = await client.query<{ version: number; value: unknown; reason: string }>(
      `select version, value, reason from settings_versions
        where key = 'limits.mcp_rate_per_minute' order by version`,
    )
    expect(limits.rows.map((row) => row.version)).toEqual([1, 2, 3])
    expect(limits.rows[1]!.value).toEqual({ report_gap: 20, get_context: 90, find_context: 40 })
    expect(limits.rows[2]!.value).toEqual({ report_gap: 20, get_facts: 90, find_facts: 40 })
    expect(limits.rows[2]!.reason).toMatch(/^tools renamed/)

    // Health keeps one row per tool across the rename.
    const calls = await client.query<{ tool: string }>(
      'select tool from mcp_requests order by tool',
    )
    expect(calls.rows.map((row) => row.tool)).toEqual(['get_facts', 'read_item'])

    // Run again, it changes nothing: not a label an admin changed since, not a setting that
    // names no old tool.
    expect(await migrate(client)).toBe(0)
    await client.query(
      "update client_policies set display_name = 'Claude Code' where client_label = 'claude-code'",
    )
    await client.query(
      await readFile(new URL('0003_agent_wording.sql', migrationDirectory), 'utf8'),
    )
    const again = await client.query<{ name: string }>(
      "select display_name as name from client_policies where client_label in ('claude-code', 'signed-in') order by client_label",
    )
    expect(again.rows.map((row) => row.name)).toEqual(['Claude Code', 'Agents people sign in with'])
    const versions = await client.query(
      "select 1 from settings_versions where key = 'limits.mcp_rate_per_minute'",
    )
    expect(versions.rowCount).toBe(3)
  } finally {
    await rm(before, { recursive: true })
  }
})
