import type { Node } from 'prosemirror-model'
import { Decoration } from 'prosemirror-view'
import { sensitiveMatches } from '@domain/draft'
import { OBJECT_REPLACEMENT } from '@/lib/mention-markup'
import './text-check.css'

/*
  The text check of FR-117 as marks on the words (the editor design, section 3): what the service
  would refuse is underlined where it is, with a plain sentence under the text, instead of a code
  word after a save fails. The patterns are the service's (src/domain/draft.ts).
*/

export type TextCheckMatch = { code: string; from: number; to: number; words: string }

/** Every match in the document, in order. A mention counts as one sign, so it never matches. */
export function textCheckMatches(doc: Node): TextCheckMatch[] {
  const found: TextCheckMatch[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    const text = node.textBetween(0, node.content.size, undefined, (leaf) =>
      leaf.type.name === 'hard_break' ? '\n' : OBJECT_REPLACEMENT,
    )
    for (const match of sensitiveMatches(text))
      found.push({
        code: match.code,
        from: pos + 1 + match.start,
        to: pos + 1 + match.end,
        words: text.slice(match.start, match.end),
      })
    return false
  })
  return found.sort((a, b) => a.from - b.from)
}

export function textCheckDecorations(matches: readonly TextCheckMatch[]) {
  return matches.map((match) =>
    Decoration.inline(match.from, match.to, {
      class: 'text-check-mark',
      'data-text-check': match.code,
    }),
  )
}
