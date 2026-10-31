import { blockWords } from '@domain/source-diff'
import type { Word } from '@/lib/line-diff'

// Which words of two texts differ clearly enough to mark (components/heed/differing-words.tsx
// draws them with the Differs mark).

/** A block is marked in at most this many places; past it, the marks stop meaning anything. */
export const MOST_MARKS = 3

/**
 * The words of `text` that `other` does not have, as runs of plain and differing text, or null when
 * nothing clear differs: the same words, a rewrite (under half the shorter text's words stay), or more than
 * MOST_MARKS places. A run of marks alone (a full stop) differs too, but is never marked.
 */
export function differingWords(text: string, other: string): Word[] | null {
  const block = text === other ? null : blockWords([other], [text])
  if (!block) return null
  // A run is marked from its first word to its last: the spaces and marks around it stay plain.
  const words = block.after[0]!.flatMap((w): Word[] => {
    const m = /^([^\p{L}\p{N}]*)([\s\S]*?[\p{L}\p{N}])?([^\p{L}\p{N}]*)$/u.exec(w.text)
    if (!w.changed || !m?.[2]) return [{ text: w.text, changed: false }]
    return [
      { text: m[1]!, changed: false },
      { text: m[2], changed: true },
      { text: m[3]!, changed: false },
    ].filter((x) => x.text)
  })
  const marks = words.filter((w) => w.changed).length
  return marks > 0 && marks <= MOST_MARKS ? words : null
}
