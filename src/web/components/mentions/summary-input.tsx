import { lazy, Suspense, useId } from 'react'
import { SUMMARY_MAX_LENGTH } from '@domain/item'
import { parseMentions } from '@domain/mentions'
import { AlignLeftIcon, CircleAlertIcon } from '@/components/icons'
import type { MentionStatus } from '@/lib/mention-names'
import type { MentionOption } from '@/lib/mention-targets'
import { useMentionTargets } from '@/lib/use-mention-targets'
import { cn } from '@/lib/utils'

// ProseMirror and the editor are their own chunk: only a page with a summary field loads them.
const SummaryEditor = lazy(() => import('@/components/mentions/summary-editor'))

export type SummaryEditorProps = {
  /** The summary as markup, mentions as `@[words](target)` (src/domain/mentions.ts). */
  value: string
  onChange: (markup: string) => void
  /** Asks an owner to add a term the list does not have. Without it there is no such row. */
  onRequestTerm?: (words: string) => void
  /** The state of targets the text already mentions, from `items.links`, when it is known. */
  statuses?: Readonly<Record<string, MentionStatus>>
  id?: string
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
  labelledBy?: string
  label?: string
  /** `field` is a bordered input; `zone` sits borderless in the page editor's summary zone. */
  appearance?: 'field' | 'zone'
  /** The most visible characters; a longer paste keeps what fits and hands the rest on. */
  max?: number
  /** Takes the rest of a paste that does not fit (the page editor puts it in the body). */
  onOverflow?: (rest: string) => void
  /** Enter, or an arrow past the first or last line, moves on to the field before or after. */
  onLeave?: (where: 'previous' | 'next') => void
  /** Marks words the text check of FR-117 would refuse, with a sentence and "Remove it". */
  checkText?: boolean
}

/** The visible length of a summary: its words, with each mention counted as its words. */
export function visibleLength(markup: string): number {
  return [...parseMentions(markup).text].length
}

/**
 * "What happened" (contract 9.6, FR-118): one block of at most 280 visible characters. `@` opens
 * one list of metrics, values, dimensions, context items and domains; `#` opens it on values
 * only. A pick becomes an inline chip that Backspace removes whole and Delete turns back into
 * words. Undo and redo work across chips, paste is plain, and a recognised word is underlined and
 * offered as a mention, never made one by itself. The counter under the field counts what a
 * reader sees, so a mention counts as its words.
 */
export function SummaryInput({
  max = SUMMARY_MAX_LENGTH,
  targets: given,
  className,
  describedBy,
  ...props
}: SummaryEditorProps & {
  /** The targets to mention; the cached vocabulary, library and domains when left out. */
  targets?: MentionOption[]
  className?: string
}) {
  const cached = useMentionTargets()
  const targets = given ?? cached.targets
  const listId = `${useId()}-mentions`
  const counterId = `${listId}-count`
  const length = visibleLength(props.value)
  const over = length - max
  const editor = (
    <Suspense
      fallback={
        <div
          aria-hidden="true"
          className={cn(
            'w-full text-large break-words whitespace-break-spaces text-muted-foreground',
            props.appearance === 'zone'
              ? 'min-h-control-md'
              : 'min-h-control-lg rounded-md border border-input px-3 py-2',
          )}
        >
          {parseMentions(props.value).text || props.placeholder}
        </div>
      }
    >
      <SummaryEditor
        {...props}
        max={max}
        invalid={props.invalid || over > 0}
        describedBy={[describedBy, counterId].filter(Boolean).join(' ')}
        targets={targets}
        pending={!given && cached.pending}
        listId={listId}
        labelledBy={props.appearance === 'zone' ? `${listId}-label` : props.labelledBy}
        label={props.appearance === 'zone' ? undefined : props.label}
      />
    </Suspense>
  )
  const tooLong = (
    <span role="status" className="sr-only">
      {over > 0 ? `Too long by ${over} ${over === 1 ? 'character' : 'characters'}.` : ''}
    </span>
  )
  if (props.appearance === 'zone')
    return (
      <div className={cn('flex w-full flex-col gap-2', className)}>
        <div
          data-slot="summary-zone"
          data-over={over > 0 || undefined}
          className="flex flex-col gap-1 rounded-lg bg-muted px-4 py-3 focus-within:ring-3 focus-within:ring-ring/50"
        >
          <div className="flex items-center gap-2 text-dense text-muted-foreground">
            <AlignLeftIcon aria-hidden="true" className="size-4 shrink-0" />
            <span id={`${listId}-label`} className="font-bold text-foreground">
              {props.label ?? 'Summary'}
            </span>
            <span className="min-w-0 flex-1 truncate">AI apps read this first</span>
            <span
              id={counterId}
              data-over={over > 0 || undefined}
              className="shrink-0 tabular-nums data-over:font-bold data-over:text-status-danger-fg"
            >
              {length} of {max}
              <span className="sr-only"> characters</span>
            </span>
          </div>
          {editor}
        </div>
        {over > 0 ? (
          <p className="flex items-center gap-2 text-caption text-status-danger-fg">
            <CircleAlertIcon aria-hidden="true" className="size-icon-sm shrink-0" />
            Shorten it by {over} {over === 1 ? 'character' : 'characters'}, or move the rest into
            the text below.
          </p>
        ) : null}
        {tooLong}
      </div>
    )
  return (
    <div className={cn('flex w-full flex-col gap-1', className)}>
      {editor}
      <div
        id={counterId}
        data-over={over > 0 || undefined}
        className="flex items-center gap-2 text-caption text-muted-foreground data-over:text-status-danger-fg"
      >
        {over > 0 ? (
          <>
            <CircleAlertIcon aria-hidden="true" className="size-icon-sm shrink-0" />
            <span className="min-w-0 flex-1">
              Shorten it by {over} {over === 1 ? 'character' : 'characters'}.
            </span>
            <span className="font-bold tabular-nums">
              {length} of {max} characters
            </span>
          </>
        ) : (
          <span className="tabular-nums">
            {length} of {max} characters
          </span>
        )}
      </div>
      {tooLong}
    </div>
  )
}
