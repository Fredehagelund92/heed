import { lazy, Suspense, useId } from 'react'
import { parseMentions } from '@domain/mentions'
import { Kbd } from '@/components/ui/kbd'
import { formatHotkey } from '@/lib/commands'
import type { MentionOption } from '@/lib/mention-targets'
import { useMentionTargets } from '@/lib/use-mention-targets'
import { cn } from '@/lib/utils'
import type { BodyEditorProps } from './body-editor'

// ProseMirror and the editor load as their own chunk, with the page that writes item text.
const BodyEditor = lazy(() => import('./body-editor'))

/** The longest body, in the characters a reader sees (FR-118, the service's 20,000). */
export const BODY_MAX_LENGTH = 20000

/** What the counter counts by default: the characters a reader sees, a mention as its words. */
const readerLength = (markdown: string) => [...parseMentions(markdown).text].length

/**
 * The body of an item as one document (contract 9.6, FR-119): headings, lists, quotes, code,
 * bold, italic, links and @ mentions render as they are typed. `/` opens the blocks, `@` the
 * mentions, and a selection shows the formatting toolbar. Under it, the keys and a counter of
 * the characters a reader sees. Other Markdown text, such as what a domain is or About our
 * business, writes in it too as a bordered `field` with mentions off.
 */
export function BodyInput({
  max = BODY_MAX_LENGTH,
  count = readerLength,
  targets: given,
  describedBy,
  className,
  ...props
}: BodyEditorProps & {
  max?: number
  /** How the text is counted against `max`, when the field's own rule counts differently. */
  count?: (markdown: string) => number
  /** The targets to mention; the cached vocabulary, library and domains when left out. */
  targets?: MentionOption[]
  className?: string
}) {
  const cached = useMentionTargets()
  const listId = `${useId()}-mentions`
  const counterId = `${listId}-count`
  const length = count(props.value)
  const over = length > max
  const field = props.appearance === 'field'
  const keys: [string, string][] = [
    ['/', 'blocks'],
    ...(props.mentions === false ? [] : [['@', 'mention'] as [string, string]]),
    [formatHotkey('mod+b').join(''), 'bold'],
    [formatHotkey('mod+enter').join(''), 'send'],
  ]
  return (
    <div className={cn('flex w-full flex-col', field ? 'gap-2' : 'gap-4', className)}>
      <Suspense
        fallback={
          <div
            aria-hidden="true"
            className={cn(
              'w-full break-words whitespace-pre-wrap text-muted-foreground',
              props.size === 'reading' ? 'text-reading pointer-coarse:text-large' : 'text-large',
              field
                ? 'min-h-editor rounded-md border border-input px-3 py-2 dark:bg-input/30'
                : 'min-h-control-md',
            )}
          >
            {props.value ? parseMentions(props.value).text : props.placeholder}
          </div>
        }
      >
        <BodyEditor
          {...props}
          invalid={props.invalid || over}
          describedBy={[describedBy, counterId].filter(Boolean).join(' ')}
          targets={given ?? cached.targets}
          pending={!given && cached.pending}
          listId={listId}
        />
      </Suspense>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-caption text-muted-foreground">
        <span
          aria-hidden="true"
          className="flex flex-wrap items-center gap-3 pointer-coarse:hidden"
        >
          {keys.map(([key, does]) => (
            <span key={does} className="inline-flex items-center gap-2">
              <Kbd>{key}</Kbd>
              {does}
            </span>
          ))}
        </span>
        <span
          id={counterId}
          data-slot="body-counter"
          data-over={over || undefined}
          className="ml-auto tabular-nums data-over:font-bold data-over:text-status-danger-fg"
        >
          {length.toLocaleString('en')} of {max.toLocaleString('en')} characters
          {over && `, ${(length - max).toLocaleString('en')} too many`}
        </span>
      </div>
    </div>
  )
}
