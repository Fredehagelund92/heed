import { limits } from '@domain/proposal-rules'

/*
  The part of capture from anywhere (lib/capture.ts) that the app's first load needs: the params
  a capture link sets and how its sentence is cleaned, which the address's search params
  (search-params.ts) apply. Part of lib/capture.ts, which re-exports it; kept apart only so the
  first load does not carry the bookmarklet.
*/

/** The params Add context reads: `/library/new?evidence_url=…&quote=…`. */
export const captureParams = { url: 'evidence_url', quote: 'quote' } as const

/** Bidirectional controls, which can make a sentence read differently from what it holds. */
const bidiControls = /[‪-‮⁦-⁩]/gu

/**
 * A selected sentence as a quote: control and direction characters out, white space collapsed to
 * one space, and at most `limits.quote` characters (code points), so a long selection is cut, not
 * lost. Empty when nothing is left.
 */
export function captureQuote(raw: string): string {
  const text = raw
    .replace(bidiControls, '')
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim()
  return [...text].slice(0, limits.quote).join('').trim()
}
