import type { Area, ItemKind } from '@domain/item'
import { helpTriggerClass } from '@/components/help/help-link'
import { DomainOptionText, domainOptionProps } from '@/components/item/domain-option'
import { DomainBadge, KindIcon } from '@/components/item/item-marks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Field,
  FieldLabel,
  FieldError,
  FieldControl,
  FieldCounter,
  FieldDescription,
} from '@/components/ui/field'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { DateField } from '@/components/form/date-field'
import {
  CalendarIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  HeedDomainIcon,
  LinkIcon,
  QuoteIcon,
} from '@/components/icons'
import { CopyBlock } from '@/components/try-it/copy-block'
import { captureBookmarklet } from '@/lib/capture'
import {
  captureWords,
  examplesPlaceholder,
  kindHelp,
  sourceWords,
  whyWeAsk,
} from '@/lib/context-help'
import { formatDay, kindNames } from '@/lib/library'
import { cn } from '@/lib/utils'
import { lastDayFromEnd, utcToday } from '@/lib/validity-range'
import type { ContextFormValues } from '@/lib/context-form'

/** Event first, as it is the default; Issue last, set apart as the temporary kind. */
const kindOrder: ItemKind[] = ['event', 'note', 'guide', 'example', 'issue']
const descriptions: Record<ItemKind, string> = {
  event: 'Something that happened',
  note: 'A lasting remark',
  guide: 'How to investigate',
  example: 'A checked answer',
  issue: 'A temporary problem',
}

/**
 * "Where this comes from" (the stored evidence): a link, a sentence copied from the source and
 * the day it was read, all three needed. The help and the examples follow the item's kind.
 */
export function EvidenceFields({
  kind,
  value,
  onChange,
  error,
  disabled,
  onBlur,
}: {
  kind: ItemKind
  value: ContextFormValues['evidence']
  onChange: (value: ContextFormValues['evidence']) => void
  error: (field: string) => string | undefined
  disabled: boolean
  onBlur: (field: string) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      {value.map((entry, index) => {
        const prefix = `evidence.${index}`
        const change = (field: keyof typeof entry, next: string) =>
          onChange(value.map((row, i) => (i === index ? { ...row, [field]: next } : row)))
        return (
          <div key={index} className="flex flex-col gap-4">
            <Field invalid={Boolean(error(`${prefix}.url`))} disabled={disabled}>
              <FieldLabel icon={LinkIcon} htmlFor={`context-${prefix}.url`}>
                {sourceWords.link}
              </FieldLabel>
              <Input
                id={`context-${prefix}.url`}
                size="lg"
                value={entry.url}
                onChange={(event) => change('url', event.target.value)}
                onBlur={() => onBlur(`${prefix}.url`)}
                placeholder="https://"
                type="url"
              />
              <FieldDescription>{kindHelp[kind].sources}</FieldDescription>
              <FieldError>{error(`${prefix}.url`)}</FieldError>
            </Field>
            <Field invalid={Boolean(error(`${prefix}.quote`))} disabled={disabled}>
              <FieldLabel icon={QuoteIcon} htmlFor={`context-${prefix}.quote`}>
                {sourceWords.quote}
              </FieldLabel>
              <FieldControl
                value={entry.quote}
                onValueChange={(next) => change('quote', next)}
                onBlur={() => onBlur(`${prefix}.quote`)}
                render={
                  <Textarea
                    id={`context-${prefix}.quote`}
                    disabled={disabled}
                    placeholder={examplesPlaceholder(kindHelp[kind].quotes)}
                  />
                }
              />
              <FieldDescription>{sourceWords.quoteHelp}</FieldDescription>
              <FieldCounter count={[...entry.quote].length} max={500} />
              <FieldError>{error(`${prefix}.quote`)}</FieldError>
            </Field>
            <Field invalid={Boolean(error(`${prefix}.date`))} disabled={disabled}>
              <FieldLabel icon={CalendarIcon}>{sourceWords.date}</FieldLabel>
              {/* Almost always today, but never filled in silently: the person says so. */}
              <div className="flex w-full items-center gap-2">
                <DateField
                  id={`context-${prefix}.date`}
                  value={entry.date || null}
                  onValueChange={(date) => change('date', date ?? '')}
                  disabled={disabled}
                  className="flex-auto"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  aria-label={`${sourceWords.date}: today`}
                  onClick={() => change('date', utcToday())}
                  disabled={disabled}
                >
                  Today
                </Button>
              </div>
              <FieldError>{error(`${prefix}.date`)}</FieldError>
            </Field>
          </div>
        )
      })}
    </div>
  )
}

/** On a phone the sheet's header already names the popover, so its title is for screen readers. */
const sheetNamed = 'max-md:sr-only'

/**
 * "Why we ask": a quiet link at the end of a Details section's help line that opens two sentences
 * on what the answer is for. Named by its section, so a screen reader hears which one it explains.
 * It looks like the help links to the docs (`HelpLink`).
 */
export function WhyWeAsk({ topic, section }: { topic: keyof typeof whyWeAsk; section: string }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Why we ask: ${section}`}
        data-slot="why-we-ask-trigger"
        className={helpTriggerClass}
      >
        <CircleHelpIcon aria-hidden="true" className="size-3" />
        Why we ask
      </PopoverTrigger>
      <PopoverContent align="start" sheetTitle={`Why we ask: ${section}`}>
        <PopoverHeader>
          <PopoverTitle className={sheetNamed}>{`Why we ask: ${section}`}</PopoverTitle>
          <PopoverDescription data-slot="why-we-ask">{whyWeAsk[topic]}</PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  )
}

/**
 * "From any page": a quiet link beside "Why we ask" in the source section that says how to
 * install the capture bookmarklet (lib/capture.ts). The button is dragged to the bookmarks bar;
 * on a phone, or without a bar, the bookmarklet is copied into a bookmark's address instead.
 */
export function CaptureHelp() {
  const origin = window.location.origin
  const bookmarklet = captureBookmarklet(origin)
  // React refuses a javascript: address in JSX, so the bookmarklet is set on the element itself,
  // when the popover mounts it.
  const link = (node: HTMLAnchorElement | null) => node?.setAttribute('href', bookmarklet)
  return (
    <Popover>
      <PopoverTrigger data-slot="capture-help-trigger" className={helpTriggerClass}>
        <LinkIcon aria-hidden="true" className="size-3" />
        {captureWords.trigger}
      </PopoverTrigger>
      <PopoverContent align="start" sheetTitle={captureWords.title}>
        <PopoverHeader>
          <PopoverTitle className={sheetNamed}>{captureWords.title}</PopoverTitle>
          <PopoverDescription>{captureWords.install}</PopoverDescription>
        </PopoverHeader>
        <Button
          variant="outline"
          className="w-fit cursor-grab"
          nativeButton={false}
          render={
            // Clicked here it would only capture this page: it is meant to be dragged.
            <a
              ref={link}
              data-slot="capture-bookmarklet"
              onClick={(event) => event.preventDefault()}
            />
          }
        >
          <LinkIcon />
          {captureWords.button}
        </Button>
        <p className="text-muted-foreground">{captureWords.check}</p>
        <p className="text-muted-foreground">{captureWords.copy}</p>
        <CopyBlock text={bookmarklet} label={captureWords.bookmarklet} />
        <p className="text-muted-foreground">{captureWords.link}</p>
        <CopyBlock text={`${origin}${captureWords.format}`} label={captureWords.linkLabel} />
      </PopoverContent>
    </Popover>
  )
}

/*
  The kind row of the page editor (the editor design, section 1): kind, domain and validity as
  chips above the title, as the item page shows them when the item is read. A chip that still
  needs an answer is tinted for a look and says what it needs.
*/

const chipClass =
  'h-control-md w-fit max-w-full gap-2 rounded-badge px-2 text-body pointer-coarse:h-control-touch'

export function KindChip({
  value,
  onChange,
  disabled,
}: {
  value: ItemKind
  onChange: (kind: ItemKind) => void
  disabled?: boolean
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next)
      }}
      disabled={disabled}
    >
      <SelectTrigger id="context-kind" aria-label="Kind" className={chipClass}>
        <SelectValue>
          <KindIcon kind={value} size="sm" decorative />
          <span>{kindNames[value]}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {kindOrder.map((kind) => (
          <SelectItem key={kind} value={kind}>
            <KindIcon kind={kind} decorative />
            <div className="flex min-w-0 flex-col gap-1">
              <SelectItemText className="font-bold">{kindNames[kind]}</SelectItemText>
              <span className="text-caption text-muted-foreground">{descriptions[kind]}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function DomainChip({
  value,
  onChange,
  areas,
  disabled,
  invalid,
}: {
  value: string
  onChange: (area: string) => void
  areas: Area[]
  disabled?: boolean
  invalid?: boolean
}) {
  const area = areas.find((area) => area.id === value)
  return (
    <Select
      value={value || null}
      onValueChange={(next) => onChange(next ?? '')}
      disabled={disabled}
    >
      <SelectTrigger
        id="context-areaId"
        aria-label={area ? `Domain, ${area.name}` : 'Domain, needed'}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? 'context-areaId-error' : undefined}
        data-tone={area ? area.label : 'warning'}
        className={cn(chipClass, 'border-tone-line bg-tone-tint text-tone-ink')}
      >
        <SelectValue placeholder="Domain">
          {area ? (
            <>
              <HeedDomainIcon aria-hidden="true" className="size-icon-sm shrink-0 text-tone-dot" />
              <span className="truncate">{area.name}</span>
            </>
          ) : (
            <>
              <HeedDomainIcon aria-hidden="true" className="size-icon-sm shrink-0 text-tone-dot" />
              <span>Domain</span>
            </>
          )}
        </SelectValue>
      </SelectTrigger>
      {/* Wide enough for each domain's summary line under its badge. */}
      <SelectContent empty="No domains are available." className="w-popover">
        {areas.map((area) => (
          <SelectItem key={area.id} value={area.id} {...domainOptionProps(area, 'context-domain')}>
            <DomainOptionText area={area} list="context-domain">
              <SelectItemText>
                <DomainBadge name={area.name} label={area.label} />
              </SelectItemText>
            </DomainOptionText>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** "From 4 Aug 2026, still going on" or "Started 2 Sep 2026, still going on", from the form. */
export function validityWords(
  kind: ItemKind,
  validity: ContextFormValues['validity'],
  ended: boolean,
): { lead: string; rest: string } | null {
  if (!validity.start) return null
  const from = formatDay(validity.start)
  const last = validity.end ? formatDay(lastDayFromEnd(validity.end) ?? validity.end) : null
  if (kind === 'issue')
    return ended && last
      ? { lead: `Started ${from}`, rest: `, ended ${last}` }
      : { lead: `Started ${from}`, rest: ', still going on' }
  return last
    ? { lead: `From ${from}`, rest: ` to ${last}` }
    : { lead: `From ${from}`, rest: ', still going on' }
}

/** The validity chip: what the dates say, and a press goes to them in the details. */
export function ValidityChip({
  kind,
  validity,
  ended,
  onOpen,
  invalid,
}: {
  kind: ItemKind
  validity: ContextFormValues['validity']
  ended: boolean
  onOpen: () => void
  invalid?: boolean
}) {
  const words = validityWords(kind, validity, ended)
  return (
    <Button
      type="button"
      variant="outline"
      data-tone={words ? 'neutral' : 'warning'}
      aria-invalid={invalid || undefined}
      onClick={onOpen}
      className={cn(
        chipClass,
        'font-normal',
        !words && 'border-tone-line bg-tone-tint text-tone-ink',
      )}
    >
      {words ? (
        <CircleCheckIcon aria-hidden="true" className="size-icon-sm text-muted-foreground" />
      ) : (
        <CalendarIcon aria-hidden="true" className="size-icon-sm text-tone-dot" />
      )}
      {words ? (
        <span className="truncate">
          {words.lead}
          <span className="text-muted-foreground">{words.rest}</span>
        </span>
      ) : (
        'When it applies'
      )}
    </Button>
  )
}

/** "Needed" at the end of a Details section's heading, until the section has an answer. */
export function NeededBadge({ needed }: { needed: boolean }) {
  return needed ? (
    <Badge tone="warning" size="sm">
      Needed
    </Badge>
  ) : null
}
