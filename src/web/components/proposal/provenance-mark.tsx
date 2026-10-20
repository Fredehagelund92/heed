import type { FieldMark, Provenance, ProvenanceFlag } from '@domain/provenance'
import {
  BotIcon,
  DatabaseIcon,
  GlobeIcon,
  SlidersHorizontalIcon,
  TriangleAlertIcon,
  UserRoundCheckIcon,
  UserRoundIcon,
  type Icon,
} from '@/components/icons'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger, TOOLTIP_DELAY } from '@/components/ui/tooltip'
import {
  externalWords,
  fieldsMarked,
  flagWords,
  listWords,
  markLabel,
  markMeaning,
  writerOf,
} from '@/lib/provenance'
import { cn } from '@/lib/utils'

/*
  Where a field of a draft came from (FR-121, FR-707), as a muted 14 pixel glyph beside the
  field's name, never a badge per field (contract 6.13, "Field provenance"): the summary line
  above the fields says who wrote what, and the glyph's name and meaning are its tooltip and its
  accessible name, on hover and on keyboard focus. Every glyph is muted: a field an AI app wrote
  or suggested also carries the line at its start edge (`ai-mark`), which asks for the look. A
  flag of the words (May be high risk, Reads like orders to an AI) keeps its soft badge under the
  value.
*/

const markIcons: Record<FieldMark, Icon> = {
  prefilled: BotIcon,
  derived: DatabaseIcon,
  default: SlidersHorizontalIcon,
  confirmed: UserRoundCheckIcon,
  not_inferred: UserRoundIcon,
}

export function ProvenanceMark({
  mark,
  by,
  where,
  className,
}: {
  mark: FieldMark
  by: Provenance['by']
  where: 'editor' | 'review'
  className?: string
}) {
  const Glyph = markIcons[mark]
  const label = markLabel(mark, by, where)
  const meaning = markMeaning(mark, by, where)
  return (
    <Tooltip>
      <TooltipTrigger
        delay={TOOLTIP_DELAY}
        render={
          <span
            role="img"
            tabIndex={0}
            aria-label={`${label}: ${meaning}`}
            data-slot="provenance-mark"
            data-mark={mark}
            className={cn(
              'inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring',
              className,
            )}
          />
        }
      >
        <Glyph aria-hidden="true" className="size-icon-sm" />
      </TooltipTrigger>
      <TooltipContent side="top">
        <span>
          <b className="font-bold">{label}.</b> {meaning}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

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
 * What the person reads at the top of a draft someone wrote for them: nothing is sent until
 * they submit, which fields to check, and what Heed filled itself. It is the editor's one
 * summary of where the fields came from, tinted because it asks for a look; each field then
 * carries only its glyph.
 */
export function DraftProvenanceNotice({ provenance }: { provenance: Provenance }) {
  const check = fieldsMarked(provenance, 'prefilled')
  const confirmed = fieldsMarked(provenance, 'confirmed')
  const derived = fieldsMarked(provenance, 'derived').filter(
    (field) => field !== 'references' && field !== 'changeMarks',
  )
  const writer = writerOf(provenance.by)
  return (
    <Alert variant="info" data-slot="provenance-notice">
      <BotIcon aria-hidden="true" />
      <AlertContent>
        <AlertTitle>
          {writer.charAt(0).toUpperCase() + writer.slice(1)} drafted this for you
        </AlertTitle>
        <AlertDescription>
          <p>
            Nobody else sees it until you send it.
            {check.length
              ? ` Check the ${listWords(check)}. ${provenance.by === 'agent' ? 'The AI app' : 'The assistant'} suggested them.`
              : ''}
            {confirmed.length
              ? ` You confirmed these in your AI app: ${listWords(confirmed)}.`
              : ''}
            {derived.length ? ` We worked out the ${listWords(derived)}.` : ''}
            {check.length ? ' A line marks each one until you change it.' : ''}
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
 * The evidence the assistant took from web pages Heed read: each one an external source nobody
 * has reviewed, and a warning when its sentence was not on the page Heed read. Never a block.
 */
export function ExternalSources({
  provenance,
  where,
}: {
  provenance: Provenance
  where: 'editor' | 'review'
}) {
  if (!provenance.external?.length) return null
  return (
    <ul data-slot="external-sources" className="flex flex-col gap-2">
      {provenance.external.map((source) => {
        const words = externalWords(source, provenance.by, where)
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
