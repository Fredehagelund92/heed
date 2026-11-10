import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readFigureOverrides } from '../../../src/server/modules/connectors/figures.ts'

// The server's figure settings (HEED_FIGURE_OVERRIDES): read when the service starts, so a file
// that is not one stops the start and names the setting, never a figure read later.

const folder = await mkdtemp(join(tmpdir(), 'heed-figure-overrides-'))
afterAll(() => rm(folder, { recursive: true, force: true }))

const file = async (name: string, text: string) => {
  const path = join(folder, name)
  await writeFile(path, text)
  return path
}

describe('the figure settings file', () => {
  it('is by source, then by view or measure', async () => {
    const settings = { cube: { orders: { date: 'order_day' }, 'orders.revenue': {} } }
    expect(await readFigureOverrides(await file('ok.json', JSON.stringify(settings)))).toEqual(
      settings,
    )
  })

  it('stops the start when it is missing, not JSON, or holds a setting it does not know', async () => {
    for (const path of [
      join(folder, 'missing.json'),
      await file('text.json', 'orders: order_day'),
      await file('flat.json', JSON.stringify({ orders: 'order_day' })),
      await file('unknown.json', JSON.stringify({ cube: { orders: { day: 'order_day' } } })),
    ])
      await expect(readFigureOverrides(path)).rejects.toThrow(/^HEED_FIGURE_OVERRIDES: /)
  })
})
