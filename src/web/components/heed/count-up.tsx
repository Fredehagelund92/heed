import * as React from 'react'
import { cn } from '@/lib/utils'

// A number that counts to its new value when it changes while you watch (docs/design/motion.md).
// The count is CSS, not script: a registered integer (--count) that transitions over --dur-4 on the
// ease-out curve, each digit a counter of it, and a place above the number's own size taking no
// room. Shown the first time, it is simply there; with reduced motion the tokens are 0 and it is
// there at once. A reader gets the number itself, never the digits on their way.

/** How many digits a count has: 0 has one. */
const digits = (n: number) => Math.max(1, String(Math.trunc(Math.abs(n))).length)

export function CountUp({
  value,
  suffix,
  className,
}: {
  /** A whole number, 0 or more. */
  value: number
  /** What follows the number: "%", or "+" for a sum with a hidden part. */
  suffix?: string
  className?: string
}) {
  // The places stay as wide as the largest number seen, so a count down from 1,293 to 142 keeps
  // its thousands until the count passes them; a place the count is under takes no room.
  const [places, setPlaces] = React.useState(() => digits(value))
  if (digits(value) > places) setPlaces(digits(value))
  return (
    <span
      data-slot="count-up"
      className={cn('inline-flex tabular-nums count-up', className)}
      style={{ '--count': Math.max(0, Math.round(value)) } as React.CSSProperties}
    >
      <span className="sr-only">
        {value.toLocaleString('en-GB')}
        {suffix}
      </span>
      <span aria-hidden className="inline-flex">
        {Array.from({ length: places }, (_, i) => places - 1 - i).map((p) => (
          <React.Fragment key={p}>
            <span
              className={cn('count-digit', p > 0 && 'count-from')}
              style={{ '--place': 10 ** p, '--from': 10 ** p } as React.CSSProperties}
            />
            {p > 0 && p % 3 === 0 && (
              <span className="count-from" style={{ '--from': 10 ** p } as React.CSSProperties}>
                ,
              </span>
            )}
          </React.Fragment>
        ))}
        {suffix}
      </span>
    </span>
  )
}
