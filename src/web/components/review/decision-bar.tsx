import { useState, type ReactNode } from 'react'
import {
  CheckIcon,
  CircleXIcon,
  EllipsisIcon,
  LoaderCircleIcon,
  LockIcon,
  MessageSquareIcon,
  ShieldCheckIcon,
  type Icon,
} from '@/components/icons'
import { AssistantBarButton } from '@/components/app-shell/assistant-launcher'
import { ConfirmDialog } from '@/components/form/confirm-dialog'
import { PageStickyBar } from '@/components/page/page'
import { BlockedButton } from '@/components/ui/blocked-button'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Field,
  FieldControl,
  FieldCounter,
  FieldDescription,
  FieldError,
  FieldFooter,
  FieldLabel,
} from '@/components/ui/field'
import { Kbd } from '@/components/ui/kbd'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import type { DecisionBar as DecisionBarState, DecisionOutcome, OutcomeState } from '@/lib/review'

/*
  The decision bar (frame C2, 8 and C3): Accept (ink), Ask for changes (outline) and Reject
  (tinted danger), sticky at the bottom of the page, beside one or two lines that say in which
  capacity the person decides, or why they cannot. Each opens a dialog that asks for a reason;
  no key commits a decision. A blocked decision stays visible with a lock and its reason
  (BlockedButton). On a phone, the first decision the person may make is the one button and
  the others are in its menu. The bar holds the assistant's launcher at its end, past a hairline,
  where the corner's launcher was: risen over the bar, that one floated over the rail's controls
  as the page scrolled (contract 9.8, Entry). Not at the start, where its mark beside "Your
  decision" would read as if the assistant decides.
*/

const outcomeLook: Record<
  DecisionOutcome,
  { icon: Icon; variant: 'default' | 'outline' | 'destructive' }
> = {
  accept: { icon: CheckIcon, variant: 'default' },
  request_changes: { icon: MessageSquareIcon, variant: 'outline' },
  reject: { icon: CircleXIcon, variant: 'destructive' },
}

/** The keys that open each decision's dialog (9.2), for assistive technology. */
const outcomeKeys: Record<DecisionOutcome, string> = {
  accept: 'A',
  request_changes: 'R',
  reject: 'Shift+R',
}

/** Reject first and Accept last, so Accept sits at the end of the row (frame C2). */
const order: DecisionOutcome[] = ['reject', 'request_changes', 'accept']

function OutcomeButton({
  outcome,
  state,
  onOpen,
  size,
  className,
}: {
  outcome: DecisionOutcome
  state: NonNullable<OutcomeState>
  onOpen: (outcome: DecisionOutcome) => void
  size?: 'default' | 'touch'
  className?: string
}) {
  const look = outcomeLook[outcome]
  const Glyph = state.label.startsWith('Accept as approver') ? ShieldCheckIcon : look.icon
  if (!state.allowed)
    return (
      <BlockedButton
        reason={state.reason}
        title={state.title}
        variant="outline"
        size={size}
        data-outcome={outcome}
        className={className}
      >
        {state.saving ? (
          <LoaderCircleIcon className="motion-safe:animate-spin" />
        ) : state.label.startsWith('Accepted') ? (
          <CheckIcon />
        ) : (
          <LockIcon />
        )}
        {state.label}
      </BlockedButton>
    )
  return (
    <Button
      variant={look.variant}
      size={size}
      data-outcome={outcome}
      aria-keyshortcuts={outcomeKeys[outcome]}
      onClick={() => onOpen(outcome)}
      className={className}
    >
      <Glyph />
      {state.label}
    </Button>
  )
}

/** The keys that open the dialogs, for the line under the bar's heading. */
function KeyHints({ bar }: { bar: DecisionBarState }) {
  const keys: { keys: ReactNode; words: string; outcome: DecisionOutcome }[] = [
    {
      keys: <Kbd>a</Kbd>,
      words: bar.outcomes.accept?.label.toLowerCase() ?? 'accept',
      outcome: 'accept',
    },
    { keys: <Kbd>r</Kbd>, words: 'ask for changes', outcome: 'request_changes' },
    {
      keys: (
        <>
          <Kbd>Shift</Kbd> + <Kbd>r</Kbd>
        </>
      ),
      words: 'reject',
      outcome: 'reject',
    },
  ]
  const shown = keys.filter((key) => bar.outcomes[key.outcome]?.allowed)
  if (!shown.length) return null
  return (
    // From a 896 container: narrower, the line would wrap the bar to four lines, and each
    // button still names its key (`aria-keyshortcuts`) and the shortcut sheet lists them.
    <span className="hidden flex-wrap items-center gap-x-1 gap-y-1 @4xl:inline-flex">
      {shown.map((key, index) => (
        <span key={key.outcome} className="inline-flex items-center gap-1">
          {key.keys} {key.words}
          {index < shown.length - 1 ? <span aria-hidden="true">·</span> : '.'}
        </span>
      ))}
      <span>Each decision asks for a reason.</span>
    </span>
  )
}

/** The decisions after the first one on a phone, in one menu. */
function MoreDecisions({
  bar,
  outcomes,
  onOpen,
}: {
  bar: DecisionBarState
  outcomes: DecisionOutcome[]
  onOpen: (outcome: DecisionOutcome) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="icon-touch" aria-label="More decisions" />}
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {outcomes.map((outcome) => {
          const state = bar.outcomes[outcome]!
          const Glyph = state.allowed ? outcomeLook[outcome].icon : LockIcon
          return (
            <DropdownMenuItem
              key={outcome}
              disabled={!state.allowed}
              onClick={() => onOpen(outcome)}
            >
              <Glyph />
              <span className="flex flex-col">
                {state.label}
                {state.allowed ? null : (
                  <span className="text-caption text-muted-foreground">{state.reason}</span>
                )}
              </span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function DecisionBar({
  bar,
  onOpen,
}: {
  bar: DecisionBarState
  onOpen: (outcome: DecisionOutcome) => void
}) {
  const offered = order.filter((outcome) => bar.outcomes[outcome] !== null)
  const primary =
    [...offered].reverse().find((outcome) => bar.outcomes[outcome]?.allowed) ?? offered.at(-1)
  const rest = offered.filter((outcome) => outcome !== primary)
  return (
    <PageStickyBar
      role="region"
      aria-label="Your decision"
      data-slot="decision-bar"
      data-state={bar.state}
    >
      <div className="flex items-end gap-3 @2xl:items-center">
        <div className="min-w-0 flex-1">
          <div className="hidden items-center justify-between gap-6 @2xl:flex">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-body font-bold">{bar.heading}</p>
              <p className="text-caption text-muted-foreground">
                {bar.detail}{' '}
                {bar.state === 'ready' || bar.state === 'checks' ? <KeyHints bar={bar} /> : null}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {offered.map((outcome) => (
                <OutcomeButton
                  key={outcome}
                  outcome={outcome}
                  state={bar.outcomes[outcome]!}
                  onOpen={onOpen}
                />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2 @2xl:hidden">
            {bar.state === 'ready' ? null : (
              <p className="text-caption text-muted-foreground">
                <span className="font-bold text-foreground">{bar.heading}.</span> {bar.detail}
              </p>
            )}
            <div className="flex items-center gap-2">
              {primary ? (
                <OutcomeButton
                  outcome={primary}
                  state={bar.outcomes[primary]!}
                  onOpen={onOpen}
                  size="touch"
                  className="flex-1"
                />
              ) : null}
              {rest.length ? <MoreDecisions bar={bar} outcomes={rest} onOpen={onOpen} /> : null}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Separator orientation="vertical" className="h-6" />
          <AssistantBarButton />
        </div>
      </div>
    </PageStickyBar>
  )
}

/**
 * The decision bar in a docked panel's footer (design round 3, direction A): the same outcomes
 * as the page's bar, each blocked one with its lock and its reason on press. One line says in
 * which capacity the person decides, or why they cannot; the decisions follow, Accept last. On
 * a phone (the panel full screen) the first decision the person may make is the one button and
 * the others are in its menu, as on the page.
 */
export function DecisionFooter({
  bar,
  onOpen,
  touch,
}: {
  bar: DecisionBarState
  onOpen: (outcome: DecisionOutcome) => void
  /** The panel fills the screen: touch sized controls. */
  touch: boolean
}) {
  const offered = order.filter((outcome) => bar.outcomes[outcome] !== null)
  const primary =
    [...offered].reverse().find((outcome) => bar.outcomes[outcome]?.allowed) ?? offered.at(-1)
  const rest = offered.filter((outcome) => outcome !== primary)
  return (
    <div
      role="region"
      aria-label="Your decision"
      data-slot="decision-bar"
      data-state={bar.state}
      className="flex w-full min-w-0 flex-col gap-3"
    >
      <p className="text-caption text-muted-foreground">
        <span className="font-bold text-foreground">{bar.heading}.</span> {bar.detail}
      </p>
      {touch ? (
        <div className="flex items-center gap-2">
          {primary ? (
            <OutcomeButton
              outcome={primary}
              state={bar.outcomes[primary]!}
              onOpen={onOpen}
              size="touch"
              className="flex-1"
            />
          ) : null}
          {rest.length ? <MoreDecisions bar={bar} outcomes={rest} onOpen={onOpen} /> : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {offered.map((outcome) => (
            <OutcomeButton
              key={outcome}
              outcome={outcome}
              state={bar.outcomes[outcome]!}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export type DecisionDialogCopy = {
  /** The proposer's name, for "Ask Kofi Mensah for changes?". */
  proposerName: string
  /** What is decided: a change to an item, a new item, a retirement or a term. */
  subject: 'change' | 'create' | 'retire' | 'recheck' | 'term'
  /** The accept's effect, from the bar's state and the risk. */
  acceptEffect: ReactNode
  /** A reason filled in from "Reject with this reason". */
  rejectWith: string | null
}

/** The reason field asks for the reason, in the verb of the decision. */
const reasonLabels: Record<DecisionOutcome, Record<DecisionDialogCopy['subject'], string>> = {
  accept: {
    change: 'Why are you accepting it?',
    create: 'Why are you accepting it?',
    retire: 'Why are you archiving it?',
    recheck: 'Why are you accepting it?',
    term: 'Why are you accepting it?',
  },
  request_changes: {
    change: 'Why are you asking for changes?',
    create: 'Why are you asking for changes?',
    retire: 'Why are you asking for changes?',
    recheck: 'Why are you asking for changes?',
    term: 'Why are you asking for changes?',
  },
  reject: {
    change: 'Why are you rejecting it?',
    create: 'Why are you rejecting it?',
    retire: 'Why are you keeping it?',
    recheck: 'Why are you rejecting it?',
    term: 'Why are you rejecting it?',
  },
}

const acceptTitles: Record<DecisionDialogCopy['subject'], string> = {
  change: 'Accept this change?',
  create: 'Accept this proposal?',
  retire: 'Archive this fact?',
  recheck: 'Accept this check?',
  term: 'Accept this name?',
}

/**
 * The reasons most often given for each decision, as chips that fill in the reason (heed-ux
 * A10). The reason stays editable and required (FR-203); the source tool's reason has its own
 * line on the page, "Reject with this reason". "The team" is the people who know the numbers,
 * never the owner, who is the one deciding.
 */
export const reasonSuggestions: Record<
  DecisionOutcome,
  Record<DecisionDialogCopy['subject'], readonly string[]>
> = {
  accept: {
    create: [
      'Checked the source',
      'Confirmed with the team',
      'Where and when it applies are right',
    ],
    change: [
      'Checked the source',
      'Confirmed with the team',
      'Where and when it applies are right',
    ],
    retire: ['No longer applies', 'Replaced by a newer fact'],
    recheck: ['Still right, checked the source', 'Confirmed with the team'],
    term: ['Matches Cube', 'Confirmed with the team'],
  },
  request_changes: {
    create: ['Add a source I can check', 'Narrow where it applies', 'Check the dates'],
    change: ['Add a source I can check', 'Narrow where it applies', 'Check the dates'],
    retire: ['Say why it no longer applies', 'Name the fact that replaces it'],
    recheck: ['Add a source I can check', 'Check the dates'],
    term: ['Check the name in Cube', 'Add a definition'],
  },
  reject: {
    create: ['Another fact already covers it', "The source doesn't support it"],
    change: ['Another fact already covers it', "The source doesn't support it"],
    retire: ['It still applies', 'AI apps still need it'],
    recheck: ["The source doesn't support it"],
    term: ['We already know this name', "It isn't in Cube"],
  },
}

/** A comment is at most 2,000 characters (proposals.comment). */
const COMMENT_MAX = 2000

/**
 * The comment a request for changes may carry (FR-222): longer than the reason, in the small
 * Markdown of a comment, and shown in the proposal's discussion beside the request.
 */
function RequestComment({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const count = [...value].length
  return (
    <Field invalid={count > COMMENT_MAX}>
      <FieldLabel optional>Comment for the discussion</FieldLabel>
      <FieldDescription>
        Say more about what to change. You can use **bold**, _italic_, `code`, links and lists. Only
        the person who sent it and the owners of the domain can read it.
      </FieldDescription>
      <FieldControl
        value={value}
        onValueChange={(next) => onChange(String(next))}
        render={<Textarea rows={4} className="resize-y text-body pointer-coarse:text-large" />}
      />
      <FieldFooter>
        <FieldError>
          {count > COMMENT_MAX
            ? `Keep it to ${COMMENT_MAX.toLocaleString('en')} characters.`
            : null}
        </FieldError>
        <FieldCounter count={count} max={COMMENT_MAX} />
      </FieldFooter>
    </Field>
  )
}

/** The three decision dialogs: one reason field, one sentence on the effect, a verb on the button. */
export function DecisionDialogs({
  open,
  onOpenChange,
  copy,
  acceptLabel,
  onDecide,
}: {
  open: DecisionOutcome | null
  onOpenChange: (open: DecisionOutcome | null) => void
  copy: DecisionDialogCopy
  acceptLabel: string
  onDecide: (outcome: DecisionOutcome, reason: string, comment?: string) => Promise<void>
}) {
  const first = copy.proposerName.split(' ')[0] ?? copy.proposerName
  const [comment, setComment] = useState('')
  const hint = 'Everyone who can see the proposal can read this.'
  const close = (outcome: DecisionOutcome) => (next: boolean) => onOpenChange(next ? outcome : null)
  return (
    <>
      <ConfirmDialog
        open={open === 'accept'}
        onOpenChange={close('accept')}
        title={acceptTitles[copy.subject]}
        effect={copy.acceptEffect}
        action={acceptLabel}
        actionIcon={acceptLabel.includes('approver') ? ShieldCheckIcon : CheckIcon}
        reason={{
          label: reasonLabels.accept[copy.subject],
          required: true,
          hint,
          suggestions: reasonSuggestions.accept[copy.subject],
        }}
        onConfirm={({ reason }) => onDecide('accept', reason)}
      />
      <ConfirmDialog
        open={open === 'request_changes'}
        onOpenChange={(next) => {
          if (!next) setComment('')
          close('request_changes')(next)
        }}
        title={`Ask ${copy.proposerName} for changes?`}
        effect={`${first} sees your reason and can change it and send it again. The time to review starts again when it comes back.`}
        action="Ask for changes"
        actionIcon={MessageSquareIcon}
        reason={{
          label: reasonLabels.request_changes[copy.subject],
          required: true,
          hint,
          suggestions: reasonSuggestions.request_changes[copy.subject],
        }}
        after={<RequestComment value={comment} onChange={setComment} />}
        onConfirm={async ({ reason }) => {
          if ([...comment.trim()].length > COMMENT_MAX)
            throw new Error(`Keep the comment to ${COMMENT_MAX.toLocaleString('en')} characters.`)
          await onDecide('request_changes', reason, comment.trim() || undefined)
          setComment('')
        }}
      />
      <ConfirmDialog
        // A reason filled in from the source-tool question starts a fresh dialog with it.
        key={copy.rejectWith ?? 'plain'}
        open={open === 'reject'}
        onOpenChange={close('reject')}
        title={copy.subject === 'retire' ? 'Keep this fact?' : 'Reject this proposal?'}
        effect={
          copy.subject === 'retire'
            ? `The fact stays, and AI apps keep getting it. ${first} sees your reason.`
            : `Rejecting closes it, and AI apps never get it. ${first} can start a new draft from it.`
        }
        action="Reject"
        actionIcon={CircleXIcon}
        tone="destructive"
        reason={{
          label: reasonLabels.reject[copy.subject],
          required: true,
          hint,
          suggestions: reasonSuggestions.reject[copy.subject],
          ...(copy.rejectWith
            ? {
                defaultValue: copy.rejectWith,
                note: 'Filled in from “Reject with this reason”. You can change it.',
              }
            : {}),
        }}
        onConfirm={({ reason }) => onDecide('reject', reason)}
      />
    </>
  )
}
