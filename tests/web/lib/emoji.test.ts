import { describe, expect, it } from 'vitest'
import {
  EMOJI,
  GROUPS,
  REACTION_CHARS,
  STARTER_CHARS,
  emojiQuery,
  fromShortcode,
  hasEmoji,
  searchEmoji,
} from '@/lib/emoji'
import { REACTIONS } from '@/components/templates/comment-box/utils'

// The emoji people type with ':': a curated set, found by name or shortcode, with
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

describe("where ':' opens the list", () => {
  it('opens on the colon alone, at the start or after a space, and follows the letters', () => {
    expect(emojiQuery(':')).toBe('')
    expect(emojiQuery('Ship it :')).toBe('')
    expect(emojiQuery('Ship it :t')).toBe('t')
    expect(emojiQuery('Ship it :th')).toBe('th')
    expect(emojiQuery('Line one\n:')).toBe('')
    expect(emojiQuery('Agreed :+1')).toBe('+1')
    expect(emojiQuery('Hm :thinking_f')).toBe('thinking_f')
  })

  it('opens nothing inside a word, a link, a time or a double colon', () => {
    expect(emojiQuery('Note:')).toBeNull()
    expect(emojiQuery('Note:th')).toBeNull()
    expect(emojiQuery('See https:')).toBeNull()
    expect(emojiQuery('See https://wiki.example')).toBeNull()
    expect(emojiQuery('Back at 18:')).toBeNull()
    expect(emojiQuery('Back at 18:30')).toBeNull()
    expect(emojiQuery('::')).toBeNull()
    expect(emojiQuery('Look ::')).toBeNull()
    expect(emojiQuery('Look ::th')).toBeNull()
    // A mention right before reads as a word.
    expect(emojiQuery('\ufffc:')).toBeNull()
  })

  it('closes on a space or a character no shortcode has', () => {
    expect(emojiQuery('Ship it : ')).toBeNull()
    expect(emojiQuery('Nice :)')).toBeNull()
    expect(emojiQuery('Ship it :th ')).toBeNull()
  })
})

describe('the colon alone', () => {
  it('offers a short list: the reactions, then the common ones', () => {
    const groups = searchEmoji('', [])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.label).toBe('Frequently used')
    expect(groups[0]!.items.map((x) => x.char)).toEqual(STARTER_CHARS)
    expect(STARTER_CHARS.slice(0, REACTION_CHARS.length)).toEqual(REACTION_CHARS)
    for (const c of ['👍', '🤔', '👀', '✅', '🎉', '❤️', '💯', '😄']) {
      expect(STARTER_CHARS).toContain(c)
    }
  })

  it('puts what was used lately first, once each, and stays short', () => {
    const items = searchEmoji('', ['🐛', '👍'])[0]!.items.map((x) => x.char)
    expect(items.slice(0, 3)).toEqual(['🐛', '👍', '👀'])
    expect(new Set(items).size).toBe(items.length)
    expect(items.length).toBeLessThanOrEqual(12)
  })
})

describe('finding one', () => {
  it('starts with what was used and the reactions', () => {
    const first = searchEmoji('th', [])[0]!
    expect(first.label).toBe('Frequently used')
    expect(first.items[0]!.char).toBe('👍')
    expect(searchEmoji('ta', ['🎉'])[0]!).toEqual({
      label: 'Frequently used',
      items: [expect.objectContaining({ char: '🎉' })],
    })
  })

  it('puts the best fit first, and the group it is in', () => {
    const groups = searchEmoji('ta', [])
    expect(groups[0]!.items[0]!.short).toBe('tada')
    // "star-struck" only contains the letters, and something starts with them: it stays out.
    expect(groups.flatMap((g) => g.items).some((x) => x.short === 'star_struck')).toBe(false)
  })

  it('finds by a word of the name or another name', () => {
    expect(searchEmoji('celebr', [])[0]!.items[0]!.char).toBe('🎉')
    expect(searchEmoji('thanks', [])[0]!.items[0]!.char).toBe('🙏')
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
