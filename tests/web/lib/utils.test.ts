import { describe, expect, it } from 'vitest'
import { midSentence } from '@/lib/utils'

describe('a time label inside a sentence', () => {
  it('lowers a leading word, never a month', () => {
    expect(midSentence('Today, 09:31')).toBe('today, 09:31')
    expect(midSentence('Yesterday, 14:20')).toBe('yesterday, 14:20')
    expect(midSentence('Just now')).toBe('just now')
    expect(midSentence('Since 2 Oct')).toBe('since 2 Oct')
    expect(midSentence('23 Oct')).toBe('23 Oct')
    expect(midSentence('21 Oct 2025')).toBe('21 Oct 2025')
  })
})
