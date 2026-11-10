import type { ReactNode } from 'react'
import { CalendarIcon, MapPinIcon, ShieldAlertIcon, type LucideIcon } from '@/components/icons'
import { kindIcons } from '@/components/heed/kind-icons'
import { PeekPending } from '@/components/heed/peek'
import { Related } from '@/components/heed/related'
import { ScopeChips } from '@/components/heed/scope-chips'
import { hostOf } from '@/lib/host'
import { mentionId } from '@/lib/mentions'
import { kindLabel, type Fact } from '@/model/items'

// What a context item's Details hold, one body wherever it opens: the quick view, the item's page,
// a review's Preview and the Inbox's item fold. Each detail is a line in words with its icon, in
// the voice of the checked line above it, then the quote with where it was copied from, then
// Related. A place leaves out what it shows already or what its own page has. Status is not here:
// the lines above Details say it.

/** The closed Details row's muted words: what is set, the values and not their names. */
export const detailsSummary = (fact: Fact) =>
  [kindLabel[fact.kind], fact.where.join(', ') || 'Read from the text', fact.when].join(' - ')

/** Agents use a Live item; a draft's use is still to come and an archived item's is over. */
const useWords = (fact: Fact) =>
  fact.status === 'Draft'
    ? 'Agents will use it for'
    : fact.status === 'Archived'
      ? 'Agents used it for'
      : 'Agents use it for'

function Line({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 leading-6">
      <Icon aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </li>
  )
}

/** The quote as a source block, with where it was copied from under it when that is known. */
function SourceQuote({ quote, source }: { quote: string; source?: string }) {
  return (
    <figure className="flex flex-col gap-1">
      <blockquote className="border-l-2 pl-3 leading-6">{quote}</blockquote>
      {source && (
        <figcaption className="pl-3.5 text-xs leading-5 text-muted-foreground">
          Copied from{' '}
          <a
            href={source}
            target="_blank"
            rel="noreferrer"
            className="font-medium break-all text-primary underline-offset-4 hover:underline"
          >
            {hostOf(source)}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </figcaption>
      )}
    </figure>
  )
}

export function DetailsBody({
  fact,
  leaveOut = [],
  pending = false,
}: {
  fact: Fact
  /**
   * What the place shows already or what its own page has: the kind, the quote with its source,
   * or Related.
   */
  leaveOut?: readonly ('kind' | 'source' | 'related')[]
  /**
   * The item's own read is still coming (the quick view draws from the list row first): the
   * don't-conclude line and the quote hold their places until it answers.
   */
  pending?: boolean
}) {
  const Kind = kindIcons[fact.kind]
  return (
    <div className="flex flex-col gap-4 text-sm [&_b]:font-semibold">
      <ul className="flex flex-col gap-2.5">
        <Line icon={MapPinIcon}>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="text-muted-foreground">{useWords(fact)}</span>
            {fact.where.length ? <ScopeChips fact={fact} /> : <span>what the text says</span>}
          </div>
        </Line>
        <Line icon={CalendarIcon}>
          <b>{fact.when}</b>
        </Line>
        {pending ? (
          <Line icon={ShieldAlertIcon}>
            <PeekPending className="mt-1.5 h-3 w-11/12" />
            <PeekPending className="mt-2.5 mb-1.5 h-3 w-1/2" />
          </Line>
        ) : (
          fact.dontConclude && (
            <Line icon={ShieldAlertIcon}>
              <b>Don&apos;t conclude:</b> {fact.dontConclude}
            </Line>
          )
        )}
        {!leaveOut.includes('kind') && (
          <Line icon={Kind}>
            <b>{kindLabel[fact.kind]}</b>
          </Line>
        )}
      </ul>
      {!leaveOut.includes('source') && (
        <>
          {pending ? (
            <div className="flex flex-col gap-2.5 border-l-2 py-1.5 pl-3">
              <PeekPending className="h-3 w-full" />
              <PeekPending className="h-3 w-2/3" />
            </div>
          ) : (
            fact.quote && <SourceQuote quote={fact.quote} source={fact.source} />
          )}
          {fact.origin && (
            <p className="text-xs leading-5 text-muted-foreground">
              From {fact.origin.tool}: {fact.origin.folder} / {fact.origin.doc}, read{' '}
              {fact.origin.read}
            </p>
          )}
        </>
      )}
      {!leaveOut.includes('related') && <Related id={mentionId('context', fact.id)} />}
    </div>
  )
}
