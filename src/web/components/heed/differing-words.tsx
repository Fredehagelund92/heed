import * as React from 'react'
import { Mark } from '@/components/heed/mark'
import { differingWords } from '@/lib/differing-words'

/** Text with the words that differ from `other` marked, or the text as it is when nothing clear differs. */
export function DifferingWords({ text, other }: { text: string; other: string }) {
  const words = differingWords(text, other)
  if (!words) return <>{text}</>
  return (
    <>
      {words.map((w, i) =>
        w.changed ? (
          <Mark key={i} role="differs">
            {w.text}
          </Mark>
        ) : (
          <React.Fragment key={i}>{w.text}</React.Fragment>
        ),
      )}
    </>
  )
}
