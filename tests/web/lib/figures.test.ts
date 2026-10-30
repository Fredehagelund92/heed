import { describe, expect, it } from 'vitest'
import { figureTryFailures } from '@contract/figures'
import { tryFailureWords } from '@/lib/figures'

// Why Try a figure read nothing, in plain words: what happened and what to do, for every code the
// service can give, and never what the tool said.

describe('the words for a try that failed', () => {
  it('says what happened and what to do for every code', () => {
    for (const code of figureTryFailures) {
      const { title, fix } = tryFailureWords(code, 'Cube')
      expect(title, code).toMatch(/^[A-Z]/)
      // The dialog ends the title with a full stop of its own.
      expect(title, code).not.toMatch(/[.!?]$/)
      expect(fix, code).toMatch(/^[A-Z].*\.$/)
      expect(`${title} ${fix}`, code).not.toMatch(/—/)
    }
  })

  it('names the tool where the tool did it', () => {
    expect(tryFailureWords('unauthorized', 'Cube').title).toBe('Cube refused the token')
    expect(tryFailureWords('timed_out', 'Cube').title).toBe('No answer within 4 seconds')
  })
})
