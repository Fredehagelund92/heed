import { describe, expect, it } from 'vitest'
import { settingKeys } from '@contract/admin'
import { SETTING_KEYS, settingGroups } from '@/model/settings'

describe('the tuning settings Advanced lists', () => {
  it('names every setting an administrator may change, each once', () => {
    expect([...SETTING_KEYS].sort()).toEqual([...settingKeys].sort())
    expect(new Set(SETTING_KEYS).size).toBe(SETTING_KEYS.length)
  })

  it('says every setting in words, with what it does', () => {
    const groups = settingGroups(SETTING_KEYS.map((key) => ({ key, value: 1, changed: null })))
    expect(groups.some((g) => g.group === 'Other')).toBe(false)
    for (const r of groups.flatMap((g) => g.rows)) {
      expect(r.value, r.key).not.toBe('')
      expect(r.what, r.key).not.toBe('')
    }
  })
})
