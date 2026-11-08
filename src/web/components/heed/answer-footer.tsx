import type { AnswerFooter as Footer } from '@domain/records-answer'

/** What every answer owes the reader, under it: what it is out of, not seen, and out of date. */
export function AnswerFooter({ footer }: { footer: Footer | undefined }) {
  if (!footer) return null
  return (
    <>
      {[footer.denominator, footer.notSeen, footer.stale].map(
        (line) => line && <p key={line}>{line}</p>,
      )}
    </>
  )
}
