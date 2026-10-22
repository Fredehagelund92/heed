import { describe, expect, it } from 'vitest'
import { avatarPaletteSize, avatarSlot } from '@/lib/avatar-colour'

describe('avatarSlot', () => {
  it('is stable: the same id is the same slot, every time', () => {
    for (const id of ['per_jon', 'per_priya', 'u_0192f3a4-7b1c', '']) {
      expect(avatarSlot(id)).toBe(avatarSlot(id))
    }
    // Pinned, so a change of the hash (which would recolour everyone) shows in review.
    expect(['per_jon', 'per_priya', 'per_noor'].map(avatarSlot)).toEqual([6, 3, 2])
  })

  it('always lands on a slot of the palette', () => {
    for (let i = 0; i < 500; i += 1) {
      const slot = avatarSlot(`person-${i}`)
      expect(Number.isInteger(slot)).toBe(true)
      expect(slot).toBeGreaterThanOrEqual(1)
      expect(slot).toBeLessThanOrEqual(avatarPaletteSize)
    }
  })

  it('spreads ids across the whole palette, none of them starved', () => {
    const counts = new Array<number>(avatarPaletteSize).fill(0)
    for (let i = 0; i < 800; i += 1) counts[avatarSlot(`per_${i.toString(36)}`) - 1]! += 1
    // 100 each on average; a fair hash stays well inside 60 to 140.
    for (const count of counts) {
      expect(count).toBeGreaterThan(60)
      expect(count).toBeLessThan(140)
    }
  })

  it('tells the reference team apart: most neighbours differ', () => {
    const team = [
      'per_maria',
      'per_jon',
      'per_sofia',
      'per_tomas',
      'per_noor',
      'per_alex',
      'per_priya',
      'per_lars',
      'per_ines',
    ]
    const slots = team.map(avatarSlot)
    expect(new Set(slots).size).toBeGreaterThanOrEqual(7)
    const same = slots.filter((slot, i) => i > 0 && slot === slots[i - 1]).length
    expect(same).toBe(0)
  })
})
