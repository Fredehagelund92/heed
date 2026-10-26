import { describe, expect, it } from 'vitest'
import { EMOJI, GROUPS, REACTION_CHARS, fromShortcode, hasEmoji, searchEmoji } from '@/lib/emoji'
import { REACTIONS } from '@/components/templates/comment-box/utils'

// The emoji people type with ':' and two letters: a curated set, found by name or shortcode, with
// what was used lately and the five reactions first.

describe('the set', () => {
  it('is about 150 common emoji in four groups, no skin tones', () => {
    expect(EMOJI).toHaveLength(150)
    expect(new Set(EMOJI.map((x) => x.group))).toEqual(new Set(GROUPS))
    expect(EMOJI.some((x) => /[\u{1F3FB}-\u{1F3FF}]/u.test(x.char))).toBe(false)
  })

  it('names each one once, by shortcode and by name', () => {
    const shorts = EMOJI.map((x) => x.short)
    expect(new Set(shorts).size).toBe(shorts.length)
    expect(new Set(EMOJI.map((x) => x.char)).size).toBe(EMOJI.length)
    for (const x of EMOJI) expect(x.name.length, x.short).toBeGreaterThan(2)
  })

  it('puts the five fixed reactions first, the same five as on a comment', () => {
    expect(REACTION_CHARS).toEqual(REACTIONS.map((r) => r.emoji))
    for (const c of REACTION_CHARS) expect(EMOJI.some((x) => x.char === c)).toBe(true)
  })
})

describe('finding one', () => {
  it('starts with what was used and the reactions', () => {
    const [first] = searchEmoji('th', [])
    expect(first.label).toBe('Frequently used')
    expect(first.items[0].char).toBe('👍')
    expect(searchEmoji('ta', ['🎉'])[0]).toEqual({
      label: 'Frequently used',
      items: [expect.objectContaining({ char: '🎉' })],
    })
  })

  it('puts the best fit first, and the group it is in', () => {
    const groups = searchEmoji('ta', [])
    expect(groups[0].items[0].short).toBe('tada')
    // "star-struck" only contains the letters, and something starts with them: it stays out.
    expect(groups.flatMap((g) => g.items).some((x) => x.short === 'star_struck')).toBe(false)
  })

  it('finds by a word of the name or another name', () => {
    expect(searchEmoji('celebr', [])[0].items[0].char).toBe('🎉')
    expect(searchEmoji('thanks', [])[0].items[0].char).toBe('🙏')
  })

  it('finds nothing for words that are no emoji', () => {
    expect(searchEmoji('qqzz', [])).toEqual([])
  })
})

describe('typed out, and pasted', () => {
  it('turns a full shortcode into its emoji', () => {
    expect(fromShortcode('tada')?.char).toBe('🎉')
    expect(fromShortcode('+1')?.char).toBe('👍')
    expect(fromShortcode('THUMBSUP')?.char).toBe('👍')
    expect(fromShortcode('nope')).toBeUndefined()
  })

  it('tells text with an emoji from text without', () => {
    expect(hasEmoji('Orders fell 🎉')).toBe(true)
    expect(hasEmoji('Orders fell at 10:30, 4 August')).toBe(false)
  })
})
