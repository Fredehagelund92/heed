import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  checkSeal,
  EVIDENCE_TTL_MS,
  evidenceKey,
  sealResult,
} from '../../../src/server/modules/assistant/seals.ts'

/*
  A tool result counts as evidence in a later turn only under a seal this service made for the
  same person, conversation, call, tool and exact result, before it expires and while its edition
  is live. Anything the client changes or makes up does not count.
*/

const key = evidenceKey(randomBytes(32))
const binding = { personId: 'person-1', conversationId: 'conversation-1' }
const result = {
  toolCallId: 'call_1',
  toolName: 'read_item',
  output: {
    edition: '2026-10-07.2',
    item: { id: 'itm_abc12345', summary: 'Online sales stopped by law on 4 August.' },
    // What JSON drops is not part of the result the client holds.
    dropped: undefined,
  },
}
const now = new Date('2026-10-12T10:00:00Z')
const seal = sealResult(key, binding, result, now)
const later = new Date(now.getTime() + 60_000)
const check = (overrides: Partial<typeof result> = {}, at = later, live = '2026-10-07.2') =>
  checkSeal(key, binding, { ...result, ...overrides }, seal, at, live)

describe('a sealed tool result', () => {
  it('names its edition and expires within the evidence lifetime', () => {
    expect(seal.edition).toBe('2026-10-07.2')
    expect(Date.parse(seal.expires) - now.getTime()).toBe(EVIDENCE_TTL_MS)
    expect(check()).toBe('valid')
    // The client sends back what it received: JSON, with keys in any order.
    const sent = JSON.parse(JSON.stringify(result.output)) as Record<string, unknown>
    const reordered = Object.fromEntries(Object.entries(sent).reverse())
    expect(check({ output: reordered as never })).toBe('valid')
  })

  it('refuses an edited result, or the seal moved to another call or tool', () => {
    const edited = {
      ...result.output,
      item: { ...result.output.item, summary: 'Orders tripled.' },
    }
    expect(check({ output: edited })).toBe('invalid')
    expect(check({ toolCallId: 'call_2' })).toBe('invalid')
    expect(check({ toolName: 'get_facts' })).toBe('invalid')
  })

  it('refuses a seal replayed in another conversation, for another person or another key', () => {
    expect(
      checkSeal(
        key,
        { ...binding, conversationId: 'conversation-2' },
        result,
        seal,
        later,
        '2026-10-07.2',
      ),
    ).toBe('invalid')
    expect(
      checkSeal(key, { ...binding, personId: 'person-2' }, result, seal, later, '2026-10-07.2'),
    ).toBe('invalid')
    expect(
      checkSeal(evidenceKey(randomBytes(32)), binding, result, seal, later, '2026-10-07.2'),
    ).toBe('invalid')
  })

  it('refuses a forged seal, and a changed expiry or edition', () => {
    for (const forged of [
      null,
      'a seal',
      { edition: '2026-10-07.2', expires: seal.expires },
      { ...seal, signature: randomBytes(32).toString('base64url') },
      { ...seal, signature: 'short' },
      { ...seal, expires: new Date(now.getTime() + 2 * EVIDENCE_TTL_MS).toISOString() },
      { ...seal, edition: '2026-10-08.1' },
    ])
      expect(checkSeal(key, binding, result, forged, later, '2026-10-07.2')).toBe('invalid')
  })

  it('stops counting once it expires, or once another edition is live', () => {
    expect(check({}, new Date(now.getTime() + EVIDENCE_TTL_MS))).toBe('expired')
    expect(check({}, later, '2026-10-12.1')).toBe('stale_edition')
    // A result that names no edition (a gap, a saved draft) is not bound to one.
    const gap = { toolCallId: 'call_3', toolName: 'read_gap', output: { id: 'gap-1' } }
    const sealed = sealResult(key, binding, gap, now)
    expect(sealed.edition).toBeNull()
    expect(checkSeal(key, binding, gap, sealed, later, '2026-10-12.1')).toBe('valid')
  })
})
