import * as React from 'react'
import { LinkIcon, MessageSquareTextIcon, ReceiptTextIcon, ShareIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DockFrame, DockMissing } from '@/components/dock'
import { PersonAvatar, StateLine } from '@/components/heed/bits'
import type { Answer } from '@/data/ask'
import type { Fact } from '@/data/world'
import { cardFooter, plainAnswer, slackText, sourceLine, stateLineOf } from '@/lib/share'
import { closeDock, openDock, useDock } from '@/lib/dock'
import { useShownAnswer } from '@/lib/shown-answers'
import { useMe } from '@/lib/store'

// Share, under an answer: one button, two ways for the answer to travel with its state and its
// sources. A Slack message, previewed exactly as it pastes, and a card that fits a screenshot. A
// link is drawn as Later: it would show the context to whoever opens it.

type Way = 'slack' | 'card'
const LINK_REASON = 'Later. A link shows the context to whoever opens it.'

const quiet =
  'h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground pointer-coarse:h-9'

/**
 * Share, in the action row. In Ask it opens the right panel beside the answer, so the answer stays
 * in view; where Ask is itself in that panel, it opens as a popover.
 */
export function ShareButton({
  answer,
  facts,
  answerId,
  docked,
}: {
  answer: Answer
  facts: Fact[]
  answerId: string
  docked?: boolean
}) {
  const dock = useDock()
  const [open, setOpen] = React.useState(false)
  const [way, setWay] = React.useState<Way>('slack')
  // Opened, focus lands on Copy: the one thing most people came to do.
  const copyRef = React.useRef<HTMLButtonElement>(null)
  if (!docked)
    return (
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={dock?.kind === 'share' && dock.id === answerId}
        className={quiet}
        onClick={() =>
          dock?.kind === 'share' && dock.id === answerId ? closeDock() : openDock('share', answerId)
        }
      >
        <ShareIcon data-icon="inline-start" />
        Share
      </Button>
    )
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="sm" className={quiet} />}>
        <ShareIcon data-icon="inline-start" />
        Share
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={10}
        aria-label="Share this answer"
        initialFocus={copyRef}
        className="max-h-[min(40rem,var(--available-height))] w-[min(28rem,calc(100vw-2rem))] gap-3 overflow-y-auto rounded-lg p-4"
      >
        <p className="text-sm font-semibold">Share this answer</p>
        <ShareBody answer={answer} facts={facts} way={way} onWay={setWay} />
        <Button
          ref={copyRef}
          className="w-full"
          onClick={() => copyShare(way, answer, facts).then(() => setOpen(false))}
        >
          {way === 'slack' ? 'Copy for Slack' : 'Copy card'}
        </Button>
      </PopoverContent>
    </Popover>
  )
}

/** The right panel: the two ways, and Copy at the foot. */
export function SharePanel({ id }: { id: string }) {
  const shown = useShownAnswer(id)
  const [way, setWay] = React.useState<Way>('slack')
  // Escape closes it, as it closes a peek.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        !e.defaultPrevented &&
        !(e.target as HTMLElement).closest('input, textarea, [contenteditable=true]')
      )
        closeDock()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  if (!shown)
    return (
      <DockFrame title="Share this answer">
        <DockMissing>
          This answer is not on screen any more. Ask the question again to share it.
        </DockMissing>
      </DockFrame>
    )
  return (
    <DockFrame
      title="Share this answer"
      footer={
        <Button autoFocus onClick={() => copyShare(way, shown.answer, shown.facts)}>
          {way === 'slack' ? 'Copy for Slack' : 'Copy card'}
        </Button>
      }
    >
      <div className="p-4 md:p-5">
        <ShareBody answer={shown.answer} facts={shown.facts} way={way} onWay={setWay} />
      </div>
    </DockFrame>
  )
}

async function copyShare(way: Way, answer: Answer, facts: Fact[]) {
  const text = slackText(answer, facts)
  if (way === 'slack') {
    await navigator.clipboard?.writeText(text).catch(() => undefined)
    toast('Copied for Slack', {
      description: 'It keeps the state, and who checked each source and when.',
    })
    return
  }
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([cardHtml(answer, facts)], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      }),
    ])
  } catch {
    await navigator.clipboard?.writeText(text).catch(() => undefined)
  }
  toast('Card copied', { description: 'It keeps the state, and who checked each source and when.' })
}

function ShareBody({
  answer,
  facts,
  way,
  onWay,
}: {
  answer: Answer
  facts: Fact[]
  way: Way
  onWay: (w: Way) => void
}) {
  const me = useMe()
  const [time] = React.useState(() =>
    new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
  )
  const tabs: { id: Way | 'link'; label: string; icon: typeof LinkIcon }[] = [
    { id: 'slack', label: 'Slack message', icon: MessageSquareTextIcon },
    { id: 'card', label: 'Card', icon: ReceiptTextIcon },
    { id: 'link', label: 'Link', icon: LinkIcon },
  ]
  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label="Share as"
        className="grid grid-cols-3 gap-0.5 rounded-lg bg-muted p-0.5"
      >
        {tabs.map((t) => {
          const later = t.id === 'link'
          const on = way === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              aria-disabled={later || undefined}
              aria-description={later ? LINK_REASON : undefined}
              title={later ? LINK_REASON : undefined}
              onClick={() => !later && onWay(t.id as Way)}
              className={cn(
                'flex h-8 items-center justify-center gap-1.5 rounded-md px-2 text-[13px] whitespace-nowrap text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:h-10',
                on && 'bg-background font-medium text-foreground shadow-xs',
                later ? 'cursor-default' : 'hover:text-foreground',
              )}
            >
              <t.icon className="size-3.5 shrink-0" aria-hidden />
              {t.label}
              {later && (
                <span className="rounded-sm border px-1 text-[10px] leading-4 text-muted-foreground">
                  Later
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div
        role="tabpanel"
        aria-label={way === 'slack' ? 'Slack message' : 'Card'}
        className="flex flex-col gap-2"
      >
        {way === 'slack' ? (
          <>
            <div className="rounded-lg border bg-background p-3">
              <div className="flex items-center gap-2">
                <PersonAvatar name={me.name} size={20} />
                <span className="text-sm font-semibold">{me.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{time}</span>
              </div>
              <SlackPreview answer={answer} facts={facts} />
            </div>
            <p className="text-xs text-muted-foreground">
              Pasted text keeps the state, and who checked each source and when.
            </p>
          </>
        ) : (
          <>
            <AnswerCard answer={answer} facts={facts} />
            <p className="text-xs text-muted-foreground">
              One picture that fits a screenshot, with the same state and sources.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

/** The message as Slack shows it, from the same parts it copies: the bold question, the state line, the answer, the sources quieter. */
function SlackPreview({ answer, facts }: { answer: Answer; facts: Fact[] }) {
  return (
    <div className="mt-1.5 flex flex-col gap-2 pl-7 text-sm leading-relaxed">
      <p>
        <span className="font-semibold">{answer.question}</span>
        <br />
        {stateLineOf(answer, facts.length)}
      </p>
      <p>{plainAnswer(answer.text)}</p>
      {facts.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-[13px] text-muted-foreground">
          {facts.map((f, i) => (
            <li key={f.id}>{sourceLine(f, i)}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The card: a receipt in the product's square hairline frame. State, question, answer, numbered sources, one footer line. */
export function AnswerCard({ answer, facts }: { answer: Answer; facts: Fact[] }) {
  return (
    <figure className="m-0 flex flex-col gap-3 rounded-[3px] border bg-background p-4">
      <StateLine state={answer.state} sentence tip={false} className="text-xs" />
      <div className="flex flex-col gap-1.5">
        <p className="text-base leading-snug font-semibold text-balance">{answer.question}</p>
        <p className="text-sm leading-relaxed">{plainAnswer(answer.text)}</p>
      </div>
      {facts.length > 0 && (
        <ol className="flex flex-col gap-1.5 border-t border-dotted pt-2.5 text-xs">
          {facts.map((f, i) => (
            <li key={f.id} className="grid grid-cols-[1rem_minmax(0,1fr)_auto] gap-x-2">
              <span className="text-muted-foreground tabular-nums">{i + 1}</span>
              <span>{f.title}</span>
              <span className="text-right whitespace-nowrap text-muted-foreground">
                {f.checkedBy} - {f.checkedOn}
              </span>
            </li>
          ))}
        </ol>
      )}
      <figcaption className="border-t border-dotted pt-2 text-[11px] text-muted-foreground">
        {cardFooter()}
      </figcaption>
    </figure>
  )
}

/** The card as rich text for the clipboard: plain tags with inline styles, so it pastes as a block anywhere. */
function cardHtml(answer: Answer, facts: Fact[]) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const state = stateLineOf(answer, facts.length)
  const rows = facts
    .map(
      (f, i) =>
        `<tr><td style="color:#666;padding-right:8px">${i + 1}</td><td>${esc(f.title)}</td><td style="color:#666;padding-left:12px;white-space:nowrap">${esc(`${f.checkedBy} - ${f.checkedOn}`)}</td></tr>`,
    )
    .join('')
  return [
    `<div style="border:1px solid #d4d4d4;padding:16px;font-family:system-ui,sans-serif;font-size:14px;max-width:520px">`,
    `<p style="margin:0 0 8px;font-weight:600">${esc(state)}</p>`,
    `<p style="margin:0 0 6px;font-size:16px;font-weight:600">${esc(answer.question)}</p>`,
    `<p style="margin:0 0 12px">${esc(plainAnswer(answer.text))}</p>`,
    rows
      ? `<table style="border-top:1px dotted #999;font-size:12px;width:100%;padding-top:8px">${rows}</table>`
      : '',
    `<p style="margin:12px 0 0;border-top:1px dotted #999;padding-top:6px;font-size:11px;color:#666">${esc(cardFooter())}</p>`,
    `</div>`,
  ].join('')
}
