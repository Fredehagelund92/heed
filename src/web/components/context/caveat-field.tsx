import { useId, useRef, useState } from 'react'
import type { ClaimLevel, ItemKind } from '@domain/item'
import { limits, ownCaveat } from '@domain/proposal-rules'
import { helpTriggerClass } from '@/components/help/help-link'
import { BotIcon, ChevronRightIcon, CircleSlashIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Field, FieldControl, FieldCounter, FieldError, FieldFooter } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { caveatStarters, caveatWords, kindHelp } from '@/lib/context-help'

/*
  "What not to conclude" in the Details rail (FR-104, the field report's option B, round 2): an
  optional line on what someone might wrongly conclude from the item. It says in plain sight what
  happens to the line, offers three sentence starters and one example for the item's kind, and
  shows under the box, as the person types, what an agent gets: no save needed, unlike the Agent
  view tab. Five groups at the rail's 320 pixels, 24 apart: the help, the box with its starters
  and example, and the agent's use with its card.
*/

/** The counter shows once the line nears the limit; a short line needs no count. */
const counterFrom = limits.notToConclude - 200

/** Adds a sentence opener after what is there, as its own sentence. */
function withOpener(text: string, opener: string): string {
  const kept = text.trimEnd()
  return kept ? `${kept} ${opener}` : opener
}

export function CaveatField({
  id,
  labelledBy,
  value,
  onChange,
  onBlur,
  kind,
  itemTitle,
  claimLevel,
  error,
  disabled,
}: {
  id: string
  /** The section heading that names the box. */
  labelledBy: string
  value: string
  onChange: (value: string) => void
  onBlur: () => void
  kind: ItemKind
  /** The item's title as the form has it, for the card. */
  itemTitle: string
  claimLevel: ClaimLevel
  error?: string
  disabled: boolean
}) {
  const box = useRef<HTMLTextAreaElement>(null)
  const example = kindHelp[kind].caveat
  /** Puts new words in the box and the caret after them, so the person types on. */
  const write = (next: string) => {
    onChange(next)
    requestAnimationFrame(() => {
      const element = box.current
      if (!element) return
      element.focus()
      element.setSelectionRange(next.length, next.length)
    })
  }
  return (
    <>
      <p id={`${id}-help`} className="text-caption text-muted-foreground">
        {caveatWords.help}
      </p>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <Field invalid={Boolean(error)} disabled={disabled} onBlur={onBlur}>
            <FieldControl
              value={value}
              onValueChange={(next) => onChange(String(next))}
              render={
                <Textarea
                  ref={box}
                  id={id}
                  rows={3}
                  aria-labelledby={labelledBy}
                  aria-describedby={`${id}-help ${id}-error`}
                  className="resize-y text-body pointer-coarse:text-large"
                />
              }
            />
            <FieldFooter>
              <FieldError id={`${id}-error`}>{error}</FieldError>
              {[...value].length >= counterFrom ? (
                <FieldCounter count={[...value].length} max={limits.notToConclude} />
              ) : null}
            </FieldFooter>
          </Field>
          <div
            role="group"
            aria-label={caveatWords.starters}
            data-slot="caveat-starters"
            className="flex flex-wrap gap-2"
          >
            {caveatStarters.map((starter) => (
              <Button
                key={starter.label}
                type="button"
                variant="outline"
                size="sm"
                className="font-normal"
                disabled={disabled}
                onClick={() => write(withOpener(value, starter.text))}
              >
                {starter.label}
              </Button>
            ))}
          </div>
          <p data-slot="caveat-example" className="text-caption text-muted-foreground">
            <span className="font-bold text-foreground">{caveatWords.example}:</span> “{example}”{' '}
            <button
              type="button"
              aria-label={`${caveatWords.useExample} example`}
              disabled={disabled}
              onClick={() => write(value.trim() ? withOpener(value, example) : example)}
              className={helpTriggerClass}
            >
              {caveatWords.useExample}
            </button>
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <p data-slot="caveat-how" className="flex gap-2 text-caption text-muted-foreground">
            <BotIcon aria-hidden="true" className="size-icon-sm shrink-0 translate-y-px" />
            <span>{caveatWords.how}</span>
          </p>
          <AgentGets title={itemTitle} line={ownCaveat(value)} claimLevel={claimLevel} />
        </div>
      </div>
    </>
  )
}

/**
 * The live card "What an agent gets": the item's title and the line as an agent reads it, and,
 * on request, the field as the app receives it. It follows the box as the person types; it is
 * not a live region, so a screen reader is not interrupted at every key.
 */
export function AgentGets({
  title,
  line,
  claimLevel,
}: {
  title: string
  /** The person's own line, or null for nothing (an empty box or the stored default). */
  line: string | null
  claimLevel: ClaimLevel
}) {
  const [raw, setRaw] = useState(false)
  const captionId = useId()
  const rawId = useId()
  return (
    <figure
      aria-labelledby={captionId}
      data-slot="agent-gets"
      className="flex min-w-0 flex-col rounded-lg border bg-card"
    >
      <figcaption
        id={captionId}
        className="border-b px-4 py-2 text-caption font-bold text-muted-foreground"
      >
        {caveatWords.card}
      </figcaption>
      <div className="flex min-w-0 flex-col gap-3 p-4">
        {title ? (
          <p className="text-dense font-bold break-words">{title}</p>
        ) : (
          <p className="text-dense text-muted-foreground">{caveatWords.untitled}</p>
        )}
        <p
          data-slot="agent-gets-line"
          className="flex gap-2 border-t pt-3 text-caption text-muted-foreground"
        >
          <CircleSlashIcon aria-hidden="true" className="size-icon-sm shrink-0 translate-y-px" />
          {line ? (
            <span className="min-w-0 break-words text-foreground">
              <strong className="font-bold">{caveatWords.title}:</strong> {line}
            </span>
          ) : (
            <span className="min-w-0">
              {claimLevel === 'effect_stated' ? caveatWords.emptyStated : caveatWords.empty}
            </span>
          )}
        </p>
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            aria-expanded={raw}
            aria-controls={rawId}
            onClick={() => setRaw((open) => !open)}
            className={`group/raw text-caption ${helpTriggerClass}`}
          >
            <ChevronRightIcon
              aria-hidden="true"
              className="size-icon-sm transition-transform group-aria-expanded/raw:rotate-90 motion-reduce:transition-none"
            />
            {raw ? caveatWords.hideRaw : caveatWords.showRaw}
          </button>
          <div id={rawId} hidden={!raw} className="w-full">
            {line ? (
              <pre className="rounded-md bg-muted px-3 py-2 font-mono text-caption break-words whitespace-pre-wrap">
                <span className="text-muted-foreground">&quot;not_to_conclude&quot;: </span>
                {JSON.stringify(line)}
              </pre>
            ) : (
              <p className="rounded-md bg-muted px-3 py-2 text-caption text-muted-foreground">
                {caveatWords.rawEmpty}
              </p>
            )}
          </div>
        </div>
      </div>
    </figure>
  )
}
