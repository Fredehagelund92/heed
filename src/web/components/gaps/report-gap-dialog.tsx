import { useId, useRef, useState } from 'react'
import type { GapType } from '@domain/gaps'
import { describeApiError, toApiError, type GapReport, type GapReportInput } from '@/api'
import { useApiWrite } from '@/api/queries'
import {
  CircleAlertIcon,
  FlagIcon,
  LoaderCircleIcon,
  NotebookPenIcon,
  ShapesIcon,
  ShieldCheckIcon,
} from '@/components/icons'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Field,
  FieldControl,
  FieldCounter,
  FieldDescription,
  FieldError,
  FieldFooter,
  FieldGroup,
  FieldHeader,
  FieldLabel,
} from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { usePendingIndicator } from '@/hooks/use-pending-indicator'
import { gapTypeGroups, gapTypeHints, gapTypeNames } from '@/lib/gaps'
import { refusedTextMessage } from '@/lib/proposals'
import { showToast } from '@/lib/toast'

/*
  Report a gap (FR-606 case 5): a person tells the owners that agents fall short on the scope
  they were looking at. Try it opens it from its reply; the assistant opens it the same way, with
  the scope of its answer (the extension point is this dialog and `reportGap` in the API). The
  person chooses what is wrong (FR-607) and may add a short note (FR-611); the topic comes from
  the scope alone. Nothing names the person, and the dialog says so.
*/

/** The scope a report is about: metrics, values grouped by dimension, and both days included. */
export type GapReportScope = Omit<GapReportInput, 'type' | 'note'>

const NOTE_MAX = 500

/** What the service's refusal means for the person, in words, and which field it is about. */
function refusalOf(error: unknown): { note: string | null; form: string | null } {
  const failure = toApiError(error)
  if (failure.kind === 'invalid') {
    const text = refusedTextMessage(failure.findings)
    if (failure.findings.some((finding) => finding.field === 'note'))
      return {
        note: text ?? 'Take out personal data, names and the question, then try again.',
        form: null,
      }
    if (failure.findings.length)
      return {
        note: null,
        form: 'Something in the question changed or is no longer in the catalogue. Ask again, then report it.',
      }
  }
  if (failure.kind === 'unavailable' && failure.status === 429)
    return { note: null, form: 'You reported several gaps just now. Try again in a minute.' }
  if (failure.kind === 'precondition')
    return { note: null, form: "AI apps don't get any facts yet, so there's nothing to report." }
  return { note: null, form: describeApiError(error).description }
}

type DialogProps = {
  scope: GapReportScope
  /** The scope in words, as the person saw it: "Orders, Norway, 1 Aug to 31 Aug 2026". */
  about: string
  /** The type the dialog starts with: Missing, the most common, unless the caller knows better. */
  defaultType?: GapType
  onReported?: (report: GapReport) => void
}

/**
 * The dialog. Its form mounts only while it is open, so a closed dialog asks nothing of the page
 * (no API client) and every opening starts empty.
 */
export function ReportGapDialog({
  open,
  onOpenChange,
  ...props
}: DialogProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  // A report on its way keeps the dialog open: closing it would hide the answer.
  const pending = useRef(false)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending.current) onOpenChange(next)
      }}
    >
      <DialogContent className="max-w-dialog gap-0 p-0">
        <ReportGapForm
          {...props}
          onPending={(now) => {
            pending.current = now
          }}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function ReportGapForm({
  scope,
  about,
  defaultType = 'missing',
  onReported,
  onPending,
  onDone,
}: DialogProps & { onPending: (pending: boolean) => void; onDone: () => void }) {
  const hintId = useId()
  const report = useApiWrite('reportGap')
  const [type, setType] = useState<GapType>(defaultType)
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState<{ note: string | null; form: string | null }>({
    note: null,
    form: null,
  })
  const pending = report.isPending
  const showSpinner = usePendingIndicator(pending)
  const count = [...note].length

  const submit = async () => {
    // Another click while the report is on its way is the same report.
    if (pending) return
    const text = note.trim()
    if ([...text].length > NOTE_MAX)
      return setProblem({ note: `Keep it to ${NOTE_MAX} characters.`, form: null })
    setProblem({ note: null, form: null })
    onPending(true)
    try {
      const reported = await report.mutateAsync({
        ...scope,
        type,
        ...(text ? { note: text } : {}),
      })
      onPending(false)
      showToast(
        'Gap reported',
        "The owners of the domain will see it. We don't record who sent it.",
      )
      onReported?.(reported)
      onDone()
    } catch (error) {
      onPending(false)
      setProblem(refusalOf(error))
    }
  }

  return (
    <form
      noValidate
      aria-label="Report a gap"
      aria-busy={pending || undefined}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      className="flex flex-col gap-6 p-6 pointer-coarse:p-4"
    >
      <DialogHeader>
        <DialogTitle>Report a gap</DialogTitle>
        <DialogDescription>
          Tell the owners where AI apps fall short, so they can add or fix the facts.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1 rounded-lg border bg-muted px-4 py-3">
        <span className="text-caption text-muted-foreground">About</span>
        <span data-slot="report-gap-about" className="text-dense font-bold break-words">
          {about}
        </span>
      </div>
      {problem.form ? (
        <Alert variant="danger" role="alert">
          <CircleAlertIcon aria-hidden />
          <AlertContent>
            <AlertTitle>We couldn't report the gap</AlertTitle>
            <AlertDescription>{problem.form}</AlertDescription>
          </AlertContent>
        </Alert>
      ) : null}
      <FieldGroup>
        <Field disabled={pending}>
          <FieldLabel icon={ShapesIcon}>What's wrong</FieldLabel>
          <Select value={type} onValueChange={(next: GapType | null) => next && setType(next)}>
            <SelectTrigger
              size="lg"
              aria-label="What's wrong"
              aria-describedby={hintId}
              className="w-full"
            >
              <SelectValue>{(value: GapType) => gapTypeNames[value]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {gapTypeGroups.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.types.map((candidate) => (
                    <SelectItem key={candidate} value={candidate}>
                      <div className="flex min-w-0 flex-col gap-1">
                        <SelectItemText className="font-bold">
                          {gapTypeNames[candidate]}
                        </SelectItemText>
                        <span className="text-caption text-muted-foreground">
                          {gapTypeHints[candidate]}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          {/* What the chosen type means, under it, so it changes where the eye already is. */}
          <FieldDescription id={hintId}>{gapTypeHints[type]}.</FieldDescription>
        </Field>
        <Field invalid={Boolean(problem.note)} disabled={pending}>
          <FieldHeader>
            <FieldLabel icon={NotebookPenIcon} optional>
              Note
            </FieldLabel>
            <FieldDescription>
              For the owners of the domain. Leave out the question, names and personal data.
            </FieldDescription>
          </FieldHeader>
          <FieldControl
            value={note}
            onValueChange={(next) => {
              setNote(String(next))
              if (problem.note) setProblem((now) => ({ ...now, note: null }))
            }}
            render={
              <Textarea
                rows={3}
                placeholder="What an AI app needs to know"
                className="resize-y text-body pointer-coarse:text-large"
              />
            }
          />
          <FieldFooter>
            <FieldError>{problem.note}</FieldError>
            <FieldCounter count={count} max={NOTE_MAX} />
          </FieldFooter>
        </Field>
      </FieldGroup>
      <p className="flex gap-2 text-caption text-muted-foreground">
        <ShieldCheckIcon aria-hidden="true" className="size-icon-sm shrink-0 translate-y-px" />
        <span>The owners see the topic and how often it was reported, never who reported it.</span>
      </p>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" disabled={pending} />}>Cancel</DialogClose>
        <Button type="submit" disabled={pending}>
          {showSpinner ? <LoaderCircleIcon className="animate-spin" /> : <FlagIcon />}
          Report gap
        </Button>
      </DialogFooter>
    </form>
  )
}
