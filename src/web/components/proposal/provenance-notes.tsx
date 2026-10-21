import type { Provenance, ProvenanceFlag } from '@domain/provenance'
import { GlobeIcon, ListChecksIcon, TriangleAlertIcon } from '@/components/icons'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { externalWords, fieldsMarked, flagWords, listWords } from '@/lib/provenance'

/*
  What a draft written for a person asks of them (FR-121, FR-707): the fields to check before
  they send it, a flag of the words (May be high risk, Reads like orders to an AI) as a soft
  badge, and the outside sources of the evidence. None of it says who wrote a field: the stored
  provenance keeps that, and the screens do not show it.
*/

/** A flag of the words: shown to the person and the owner, never acted on. */
export function ProvenanceFlagBadge({ flag }: { flag: ProvenanceFlag }) {
  const words = flagWords(flag)
  return (
    <Badge
      size="sm"
      tone="warning"
      icon={TriangleAlertIcon}
      data-slot="provenance-flag"
      data-flag={flag.code}
      title={words.sentence}
    >
      {words.label}
      <span className="sr-only">: {words.sentence}</span>
    </Badge>
  )
}

/**
 * What the person reads at the top of a draft written for them: nothing is sent until they
 * submit it, and which fields to check first. Tinted because it asks for a look.
 */
export function DraftProvenanceNotice({ provenance }: { provenance: Provenance }) {
  const check = fieldsMarked(provenance, 'prefilled')
  return (
    <Alert variant="info" data-slot="provenance-notice">
      <ListChecksIcon aria-hidden="true" />
      <AlertContent>
        <AlertTitle>Check this draft before you send it</AlertTitle>
        <AlertDescription>
          <p>
            Nobody else sees it until you send it.
            {check.length ? ` Check the ${listWords(check)}.` : ''}
          </p>
          {provenance.flags.length ? (
            <ul className="flex flex-col gap-2">
              {provenance.flags.map((flag) => (
                <li key={`${flag.code}.${flag.field}`} className="flex items-start gap-2">
                  <TriangleAlertIcon
                    aria-hidden="true"
                    className="size-icon-sm shrink-0 translate-y-px text-status-warning-icon"
                  />
                  <span>
                    <b className="font-bold">{flagWords(flag).label}.</b> {flagWords(flag).sentence}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <ExternalSources provenance={provenance} where="editor" />
        </AlertDescription>
      </AlertContent>
    </Alert>
  )
}

/**
 * The evidence copied from web pages Heed read: each one an external source nobody has reviewed,
 * and a warning when its sentence was not on the page Heed read. Never a block.
 */
export function ExternalSources({
  provenance,
  where,
  className,
}: {
  provenance: Provenance
  where: 'editor' | 'review'
  className?: string
}) {
  if (!provenance.external?.length) return null
  return (
    <ul data-slot="external-sources" className={cn('flex flex-col gap-2', className)}>
      {provenance.external.map((source) => {
        const words = externalWords(source, where)
        return (
          <li
            key={`${source.url}\n${source.quote}`}
            data-slot="external-source"
            data-quote-found={source.quoteFound}
            className="flex flex-col gap-1"
          >
            <span className="flex items-start gap-2">
              <GlobeIcon aria-hidden="true" className="size-icon-sm shrink-0 translate-y-px" />
              <span>
                <b className="font-bold">{words.label}.</b> {words.sentence}
              </span>
            </span>
            {words.warning ? (
              <span data-slot="quote-warning" className="flex items-start gap-2">
                <TriangleAlertIcon
                  aria-hidden="true"
                  className="size-icon-sm shrink-0 translate-y-px text-status-warning-icon"
                />
                <span>
                  <b className="font-bold">{words.warning.label}.</b> {words.warning.sentence}
                </span>
              </span>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
