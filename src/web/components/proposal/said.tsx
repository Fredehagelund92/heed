import { formatMoment } from '@/lib/library'

/** One sentence that ends with when it happened: "Jon Abara asked for changes · 6 Oct, 09:12". */
export function Said({ who, what, at }: { who: string; what: string; at: string }) {
  return (
    <>
      {who} {what} ·{' '}
      <time dateTime={at} title={formatMoment(at, 'long')} className="tabular-nums">
        {formatMoment(at)}
      </time>
    </>
  )
}

/** The reviewer's or the writer's own words, quoted as written. */
export function Quote({ children }: { children: string }) {
  return <p className="break-words whitespace-pre-line">“{children}”</p>
}
