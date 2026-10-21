import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import { canonicalJson } from '../../../domain/canonical.ts'

/**
 * Evidence that survives turns (FR-707). The client holds the conversation, so a tool result it
 * sends back proves nothing by itself. Each result a tool of this service produced is sealed: an
 * HMAC over the person, the conversation, the call, the tool, the edition the result was read in,
 * an expiry and the result itself. The seal travels beside the result as a `data-evidence` part,
 * and a later turn of the same conversation counts the result as evidence only when its seal
 * verifies. An edited result, a made-up one, a seal moved to another call, person or conversation,
 * an expired one, or one from an edition no longer live does not count.
 */

/** How long a result read in a conversation may be cited without reading it again. */
export const EVIDENCE_TTL_MS = 2 * 60 * 60 * 1000

/** The seal of one tool result, as the `data-evidence` part carries it (its id is the call's). */
export type Seal = {
  /** The edition the result was read in, when it names one. */
  edition: string | null
  /** When the result stops counting as evidence (ISO instant). */
  expires: string
  signature: string
}

/** Whose conversation a seal belongs to: the person, and the conversation's first message. */
export type Binding = { personId: string; conversationId: string }

/** A sealed result, as the client sends it back in its tool part. */
export type SealedResult = { toolCallId: string; toolName: string; output: unknown }

export type SealCheck = 'valid' | 'expired' | 'stale_edition' | 'invalid'

/**
 * The key that signs evidence, derived from the secret that signs confirmations so that neither
 * signature can stand in for the other.
 */
export function evidenceKey(secret: Uint8Array): Buffer {
  return Buffer.from(
    hkdfSync('sha256', secret, new Uint8Array(0), 'heed-assistant-evidence-v1', 32),
  )
}

/** The result as the client holds it: what JSON keeps of it. */
const asSent = (output: unknown): unknown => JSON.parse(JSON.stringify(output ?? null)) as unknown

/** The edition a result was read in: get_facts, read_item and the others name it at the top. */
export function editionOf(output: unknown): string | null {
  const edition = (output as { edition?: unknown } | null)?.edition
  return typeof edition === 'string' ? edition : null
}

function sign(
  key: Buffer,
  binding: Binding,
  result: SealedResult,
  edition: string | null,
  expires: string,
) {
  const digest = createHash('sha256')
    .update(canonicalJson(asSent(result.output)))
    .digest('hex')
  return createHmac('sha256', key)
    .update(
      canonicalJson([
        'heed-assistant-evidence-v1',
        binding.personId,
        binding.conversationId,
        result.toolCallId,
        result.toolName,
        edition ?? '',
        expires,
        digest,
      ]),
    )
    .digest('base64url')
}

/** Seals one result this service produced, for this person and conversation, from `now`. */
export function sealResult(key: Buffer, binding: Binding, result: SealedResult, now: Date): Seal {
  const edition = editionOf(asSent(result.output))
  const expires = new Date(now.getTime() + EVIDENCE_TTL_MS).toISOString()
  return { edition, expires, signature: sign(key, binding, result, edition, expires) }
}

/**
 * Whether a result the client sent back carries a valid seal: signed by this service for this
 * person, conversation, call and exact result, not expired, and read in the edition still live.
 */
export function checkSeal(
  key: Buffer,
  binding: Binding,
  result: SealedResult,
  seal: unknown,
  now: Date,
  liveEdition: string | null,
): SealCheck {
  if (!seal || typeof seal !== 'object') return 'invalid'
  const { edition, expires, signature } = seal as Record<string, unknown>
  if (
    (edition !== null && typeof edition !== 'string') ||
    typeof expires !== 'string' ||
    typeof signature !== 'string'
  )
    return 'invalid'
  let expected: Buffer
  try {
    if (edition !== editionOf(result.output)) return 'invalid'
    expected = Buffer.from(sign(key, binding, result, edition, expires), 'base64url')
  } catch {
    return 'invalid'
  }
  const given = Buffer.from(signature, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return 'invalid'
  const until = Date.parse(expires)
  if (!(until > now.getTime()) || until > now.getTime() + EVIDENCE_TTL_MS) return 'expired'
  if (edition !== null && edition !== liveEdition) return 'stale_edition'
  return 'valid'
}
