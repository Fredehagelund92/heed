import { CircleCheckIcon, CircleHelpIcon, CircleXIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { KindLabel } from '@/components/heed/review-parts'
import type { Review } from '@/model/review'

// The part only the full review draws: the claim check. Apart
// from review-parts.tsx, which the Inbox's quick review loads up front, so they load on demand with
// the review page.

/** An agent's claims, each against the sentence it copied from the source. Heed didn't open the page. */
export function ClaimCheck({
  claims,
  from,
  drafted,
}: {
  claims: NonNullable<Review['claims']>
  from: string
  drafted?: boolean
}) {
  const verdict = {
    same: { icon: CircleCheckIcon, label: 'Same', cls: 'text-foreground' },
    check: { icon: CircleHelpIcon, label: 'Same? Check', cls: 'text-caution' },
    different: { icon: CircleXIcon, label: 'Different', cls: 'text-destructive' },
  } as const
  return (
    <section className="flex flex-col gap-3 py-2">
      <header className="flex items-center gap-2">
        <KindLabel kind="Added" />
        <span className="text-xs text-muted-foreground">Claim check</span>
      </header>
      <p className="text-sm text-muted-foreground">
        {drafted
          ? 'The draft copied this sentence from the source.'
          : `The agent copied this sentence from the source, with ${from}'s OK.`}{' '}
        The numbers, dates and names in the summary are compared with it.{' '}
        {drafted ? 'Nobody opened the page yet.' : 'It did not open the page.'}
      </p>
      <blockquote className="rounded-frame bg-muted px-3 py-2 text-sm italic">
        “{claims.sentence}”
      </blockquote>
      <div className="overflow-hidden rounded-frame border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">In the summary</th>
              <th className="px-3 py-2 font-medium">In the copied sentence</th>
              <th className="w-36 px-3 py-2 font-medium">Same?</th>
            </tr>
          </thead>
          <tbody>
            {claims.rows.map((r) => {
              const v = verdict[r.same]
              return (
                <tr key={r.claim} className="border-t">
                  <td className="px-3 py-2.5">{r.claim}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.source}</td>
                  <td className={cn('px-3 py-2.5 font-medium whitespace-nowrap', v.cls)}>
                    <span className="inline-flex items-center gap-1.5">
                      <v.icon aria-hidden className="size-4" />
                      {v.label}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
