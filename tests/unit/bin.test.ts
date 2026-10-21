import { describe, expect, it } from 'vitest'
import type { BinRestoreResult } from '@/api'
import { rescueChangeLine, restoredWords } from '@/lib/bin'

const edition = { label: '2026-10-17.2' } as BinRestoreResult['edition']

describe("the Bin's words", () => {
  it('says each change restoring into another domain makes, in one line', () => {
    expect(rescueChangeLine({ field: 'domain', before: 'Bakery', after: 'Pantry' })).toEqual({
      label: 'Domain',
      words: 'Bakery is deleted, so it moves to Pantry',
    })
    expect(rescueChangeLine({ field: 'owner', before: 'Ravi', after: 'Mia' }).words).toBe(
      'Mia, an owner there, takes over from Ravi',
    )
    expect(rescueChangeLine({ field: 'owner', before: null, after: 'Mia' }).words).toBe(
      'Mia, an owner there',
    )
    expect(rescueChangeLine({ field: 'scope', before: 'Loaves', after: null }).words).toBe(
      "Loaves is removed: it's no longer in the catalogue",
    )
    expect(rescueChangeLine({ field: 'mentions', before: 'the bakery', after: null })).toEqual({
      label: 'Mention',
      words: "the bakery becomes plain text: it's no longer there",
    })
    expect(
      rescueChangeLine({ field: 'reviewDate', before: '2026-10-01', after: '2027-01-06' }).words,
    ).toBe('1 Oct 2026 has passed, so it becomes 6 Jan 2027')
  })

  it('says what a restore brought back, and the proposals it opened', () => {
    expect(restoredWords({ restored: ['a'], edition, proposals: [] })).toEqual({
      title: 'Fact restored',
      description: 'Agents get it again.',
    })
    expect(restoredWords({ restored: ['a', 'b'], edition: null, proposals: [] })).toEqual({
      title: '2 facts restored',
      description: "They're back in the library, archived.",
    })
    expect(
      restoredWords(
        { restored: ['a'], edition: null, proposals: [{ itemId: 'a', id: 'p', number: 412 }] },
        'Pantry',
      ),
    ).toEqual({
      title: 'Fact restored',
      description: "It's back, archived. Proposal #412 waits for the owners of Pantry.",
    })
    expect(
      restoredWords(
        {
          restored: ['a', 'b', 'c'],
          edition,
          proposals: [
            { itemId: 'b', id: 'p', number: 412 },
            { itemId: 'c', id: 'q', number: 413 },
          ],
        },
        'Pantry',
      ).description,
    ).toBe(
      'Agents get it again. 2 facts are back, archived, each with a proposal for the owners of Pantry.',
    )
  })
})
