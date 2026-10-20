import {
  type FormEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldControl,
  FieldCounter,
  FieldDescription,
  FieldError,
  FieldFooter,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { CircleAlertIcon, type Icon, LoaderCircleIcon } from '@/components/icons'
import { usePendingIndicator } from '@/hooks/use-pending-indicator'

/** A decision reason is at most 500 characters (FR-203). */
export const REASON_MAX_LENGTH = 500

export type ConfirmReason = {
  /** The field's label. "Why" by default. */
  label?: string
  /** Whether a reason must be given. Most governed actions require one. */
  required?: boolean
  max?: number
  hint?: ReactNode
  placeholder?: string
  defaultValue?: string
  /** A line under the field, such as where a filled-in reason came from. */
  note?: ReactNode
  /**
   * The reasons most often given, as chips above the field: one fills it in, and it stays
   * editable. A reason is still required (FR-203); the chips only save typing it.
   */
  suggestions?: readonly string[]
}

/**
 * A first step that shows the real effect before the action can be confirmed (Editions design,
 * slice S5): what going back or a stop would change, read from the service. Continue leads to
 * the reason and the typed confirmation.
 */
export type ConfirmReview = {
  /** What the action would change, from the service, before anything is done. */
  content: ReactNode
  /**
   * `pending` while the effect loads (Continue waits for it), `ready`, or `refused` when the
   * action cannot go ahead: the step then says why and offers only Close.
   */
  state: 'pending' | 'ready' | 'refused'
  /** The first step's name. "Check what changes" by default. */
  label?: string
  /** Runs on Continue; false keeps the first step, where it shows what is missing. */
  onContinue?: () => boolean
}

/** What the dialog shows once the action went through, in place of closing. */
export type ConfirmDone = {
  title: ReactNode
  content: ReactNode
  /** Beside Close: the way to undo it, which is its own confirmed action. */
  actions?: ReactNode
}

type Step = 'review' | 'confirm' | 'done'

export type ConfirmDialogProps = {
  /** The control that opens it, rendered as the dialog's trigger. Leave out when controlled. */
  trigger?: ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** The question, naming the action in plain words: "Go back to edition 2026-10-06.2?" */
  title: ReactNode
  /** The effect, in one sentence. */
  effect: ReactNode
  /** Anything the person must see before deciding, between the effect and the reason. */
  children?: ReactNode
  /** A field after the reason, such as the comment a request for changes may carry. */
  after?: ReactNode
  /** The verb on the button: "Go back", "Retire item". Never "OK". */
  action: string
  actionIcon?: Icon
  /** A destructive action uses the tinted danger button and starts focus on Cancel. */
  tone?: 'default' | 'destructive'
  /** Ask for a reason (FR-203). Leave out for an action that needs none. */
  reason?: ConfirmReason
  /** Type this text to confirm: the edition number, or `permanently delete` (contract 9.4). */
  confirmText?: string
  /**
   * Keep the action button disabled until `confirmText` is typed exactly, as AWS does for a
   * deletion that takes much with it (contract 9.4). Without it the button shows what is missing.
   */
  lockUntilTyped?: boolean
  /**
   * The action cannot go ahead yet (`waiting`: its effect is still loading) or at all (`refused`:
   * the content says why, and only Close is offered). Leave out when it can.
   */
  hold?: 'waiting' | 'refused'
  /** The wide dialog, for content that lists much, as the review step uses. */
  wide?: boolean
  /** Runs the action. The dialog stays open, with the error, if it throws. */
  onConfirm: (input: { reason: string }) => Promise<void> | void
  cancelLabel?: string
  /** Show the effect first, as its own step, before the reason and the typing. */
  review?: ConfirmReview
  /**
   * Stay open after the action, on this step: what happened and what undoes it. Pass `null`
   * until `onConfirm` has something to show; leave it out to close after the action.
   */
  done?: ConfirmDone | null
  /**
   * Where the focus goes when the dialog closes, when not back to what opened it: the row after
   * one the action took out of a list. Return `true` for the usual place.
   */
  finalFocus?: () => HTMLElement | true
}

type Problems = { reason?: string; confirm?: string }

/**
 * The one confirmation for governed actions (contract 9.4): names the action, says its effect in
 * one sentence, asks for a reason where the specification asks for one and, for the actions
 * that cannot be taken back, asks the person to type the edition number or the area name.
 *
 * Command or Control Enter confirms from any field, as the action button does.
 *
 * The action button is never disabled for an incomplete answer: pressing it shows what is
 * missing, next to the field. The one exception is `lockUntilTyped`, for deleting a domain with
 * everything under it, where the button stays disabled until the words are typed, as AWS asks.
 * `onConfirm` runs only when everything is in order. While it runs
 * the button shows a spinner (after 150 ms, for at least 300) and the dialog cannot be closed;
 * if it fails the dialog stays open with the reason kept and the error at the top.
 *
 * With `review`, the dialog has two steps (Editions design, slice S5): first the real effect,
 * read from the service, then the reason and the typing. With `done`, it stays open once the
 * action went through and says what happened, with the way to undo it.
 */
export function ConfirmDialog({
  trigger,
  open: openProp,
  onOpenChange,
  title,
  effect,
  children,
  after,
  action,
  actionIcon: ActionIcon,
  tone = 'default',
  reason,
  confirmText,
  lockUntilTyped = false,
  hold,
  wide = false,
  onConfirm,
  cancelLabel = 'Cancel',
  review,
  done,
  finalFocus,
}: ConfirmDialogProps) {
  const first: Step = review ? 'review' : 'confirm'
  const [chosen, setStep] = useState<Step>(first)
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const [reasonText, setReasonText] = useState(reason?.defaultValue ?? '')
  const [typed, setTyped] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const showSpinner = usePendingIndicator(submitting)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const typedRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const continueRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const moved = useRef(false)
  const formId = useId()
  const refused = review?.state === 'refused' || hold === 'refused'
  // A refusal the service gave at confirm time (a version that cannot be served again) is the
  // first step's to explain, so the dialog shows it again.
  const step: Step = refused && chosen === 'confirm' ? 'review' : chosen

  // A new step takes focus where it starts: the reason or the typing, Continue, or Close.
  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    const target =
      step === 'confirm'
        ? (reasonRef.current ?? typedRef.current)
        : step === 'review'
          ? (continueRef.current ?? cancelRef.current)
          : closeRef.current
    target?.focus()
  }, [step])
  const go = (next: Step) => {
    moved.current = true
    setStep(next)
  }

  const max = reason?.max ?? REASON_MAX_LENGTH
  const problems = check({ reason, reasonText, max, confirmText, typed })
  const shown: Problems = attempted ? problems : overLimitOnly(problems, reasonText, max)

  const setOpen = (next: boolean) => {
    if (!next && submitting) return
    setOpenState(next)
    onOpenChange?.(next)
  }

  const reset = () => {
    setStep(first)
    setReasonText(reason?.defaultValue ?? '')
    setTyped('')
    setAttempted(false)
    setFailure(null)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return
    if (step === 'review') {
      if (review?.state === 'ready' && (review.onContinue?.() ?? true)) go('confirm')
      return
    }
    if (step === 'done' || hold) return
    setAttempted(true)
    if (problems.reason) return reasonRef.current?.focus()
    if (problems.confirm) return typedRef.current?.focus()
    setFailure(null)
    setSubmitting(true)
    try {
      await onConfirm({ reason: reasonText.trim() })
      setSubmitting(false)
      if (done !== undefined) return go('done')
      setOpenState(false)
      onOpenChange?.(false)
    } catch (error) {
      setSubmitting(false)
      setFailure(error instanceof Error && error.message ? error.message : 'Try again.')
    }
  }

  const initialFocus =
    step === 'review'
      ? cancelRef
      : reason
        ? reasonRef
        : confirmText
          ? typedRef
          : tone === 'destructive'
            ? cancelRef
            : true
  const reviewing = step === 'review' && review
  const finished = step === 'done' && done
  // Refused without a review step: the content says why, and the dialog offers only Close.
  const closedOff = refused && !review
  const locked = hold !== undefined || (lockUntilTyped && Boolean(problems.confirm))

  return (
    <AlertDialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) reset()
      }}
    >
      {trigger && <AlertDialogTrigger render={trigger} />}
      <AlertDialogContent
        initialFocus={initialFocus}
        {...(finalFocus ? { finalFocus } : {})}
        aria-busy={submitting || undefined}
        data-step={review ? step : undefined}
        className={review || wide ? 'max-w-dialog-wide' : undefined}
      >
        <form
          id={formId}
          noValidate
          onSubmit={(event) => void submit(event)}
          // Command or Control Enter confirms from the reason, as it submits a page (contract
          // 9.2); the page under the dialog does not get the key.
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.requestSubmit()
          }}
          className="flex flex-col gap-4"
        >
          <AlertDialogHeader>
            {review && !finished && !refused ? (
              <p className="text-caption text-muted-foreground">
                {step === 'review'
                  ? `Step 1 of 2 · ${review.label ?? 'Check what changes'}`
                  : 'Step 2 of 2 · Confirm'}
              </p>
            ) : null}
            <AlertDialogTitle>{finished ? done.title : title}</AlertDialogTitle>
            {finished ? null : <AlertDialogDescription>{effect}</AlertDialogDescription>}
          </AlertDialogHeader>

          {!reviewing && !finished && failure && (
            <Alert variant="danger" role="alert">
              <CircleAlertIcon aria-hidden />
              <AlertContent>
                <AlertTitle>{action} didn&apos;t go through</AlertTitle>
                <AlertDescription>{failure}</AlertDescription>
              </AlertContent>
            </Alert>
          )}

          {finished ? done.content : reviewing ? review.content : children}

          {!reviewing && !finished && !closedOff && reason && (
            <Field invalid={Boolean(shown.reason)} disabled={submitting}>
              <FieldLabel optional={!reason.required}>{reason.label ?? 'Why'}</FieldLabel>
              {reason.hint && <FieldDescription>{reason.hint}</FieldDescription>}
              {reason.suggestions?.length ? (
                <ToggleGroup
                  aria-label="Common reasons"
                  value={reason.suggestions.filter((text) => text === reasonText.trim())}
                  onValueChange={(value: string[]) => {
                    setReasonText(suggestedReason(reasonText, value[0], reason.suggestions ?? []))
                  }}
                  disabled={submitting}
                >
                  {reason.suggestions.map((text) => (
                    <ToggleGroupItem key={text} value={text} size="sm">
                      {text}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              ) : null}
              <FieldControl
                value={reasonText}
                onValueChange={(next) => setReasonText(String(next))}
                render={
                  <Textarea
                    ref={reasonRef}
                    rows={3}
                    placeholder={reason.placeholder}
                    className="resize-y text-body pointer-coarse:text-large"
                  />
                }
              />
              <FieldFooter>
                <FieldError>{shown.reason}</FieldError>
                <FieldCounter count={[...reasonText].length} max={max} />
              </FieldFooter>
              {reason.note && <FieldDescription>{reason.note}</FieldDescription>}
            </Field>
          )}

          {!reviewing && !finished ? after : null}

          {!reviewing && !finished && !closedOff && confirmText && (
            <Field invalid={Boolean(shown.confirm)} disabled={submitting}>
              <FieldLabel>
                Type <span className="font-mono">{confirmText}</span> to confirm
              </FieldLabel>
              <Input
                ref={typedRef}
                size="lg"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                className="font-mono"
              />
              <FieldError>{shown.confirm}</FieldError>
            </Field>
          )}

          {finished ? (
            <AlertDialogFooter>
              {done.actions}
              <AlertDialogCancel ref={closeRef} variant="default">
                Close
              </AlertDialogCancel>
            </AlertDialogFooter>
          ) : closedOff ? (
            <AlertDialogFooter>
              <AlertDialogCancel ref={cancelRef} variant="default">
                Close
              </AlertDialogCancel>
            </AlertDialogFooter>
          ) : reviewing ? (
            <AlertDialogFooter>
              <AlertDialogCancel ref={cancelRef}>
                {refused ? 'Close' : cancelLabel}
              </AlertDialogCancel>
              {refused ? null : (
                <Button
                  ref={continueRef}
                  type="submit"
                  size="lg"
                  aria-disabled={review.state === 'pending' || undefined}
                >
                  Continue
                </Button>
              )}
            </AlertDialogFooter>
          ) : (
            <AlertDialogFooter>
              {review ? (
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  disabled={submitting}
                  onClick={() => go('review')}
                >
                  Back
                </Button>
              ) : null}
              <AlertDialogCancel ref={cancelRef} disabled={submitting}>
                {cancelLabel}
              </AlertDialogCancel>
              <Button
                type="submit"
                size="lg"
                variant={tone === 'destructive' ? 'destructive' : 'default'}
                disabled={locked && !submitting}
                aria-disabled={submitting || undefined}
                className="relative"
              >
                <span
                  className={
                    showSpinner ? 'flex items-center gap-2 opacity-0' : 'flex items-center gap-2'
                  }
                >
                  {ActionIcon && <ActionIcon aria-hidden />}
                  {action}
                </span>
                {showSpinner && (
                  <LoaderCircleIcon
                    aria-hidden
                    className="absolute inset-0 m-auto motion-safe:animate-spin"
                  />
                )}
              </Button>
            </AlertDialogFooter>
          )}
          <p role="status" className="sr-only">
            {showSpinner ? 'Working' : ''}
          </p>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * The reason after a suggestion chip is pressed: the chip's words in place of an empty reason or
 * another chip's, or added after what the person wrote, so typing is never lost. Unpressing the
 * chip that is the whole reason clears it. Exported for the unit tests.
 */
export function suggestedReason(
  current: string,
  chosen: string | undefined,
  suggestions: readonly string[],
): string {
  const text = current.trim()
  if (chosen === undefined) return suggestions.includes(text) ? '' : current
  if (text === '' || suggestions.includes(text)) return chosen
  return `${text.replace(/[.!?]?$/, '.')} ${chosen}`
}

/** What stops the action, in the words shown under each field. Exported for the unit tests. */
export function check({
  reason,
  reasonText,
  max,
  confirmText,
  typed,
}: {
  reason?: ConfirmReason
  reasonText: string
  max: number
  confirmText?: string
  typed: string
}): Problems {
  const problems: Problems = {}
  const length = [...reasonText].length
  if (reason?.required && reasonText.trim() === '') problems.reason = 'Give a reason.'
  else if (reason && length > max)
    problems.reason = `Shorten it by ${(length - max).toLocaleString('en')} ${length - max === 1 ? 'character' : 'characters'}.`
  if (confirmText !== undefined && typed.trim() !== confirmText)
    problems.confirm =
      typed.trim() === '' ? `Type ${confirmText} to confirm.` : `This doesn't match ${confirmText}.`
  return problems
}

/** Before the first press only a reason over the limit is shown: the counter already says so. */
function overLimitOnly(problems: Problems, reasonText: string, max: number): Problems {
  return [...reasonText].length > max ? { reason: problems.reason } : {}
}
